export async function handleProviderConnectRoute(request, env, url, corsHeaders) {
  if (url.pathname === '/api/stripe/webhook') {
    if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405, corsHeaders);
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'Stripe webhook secret not configured' }, 500, corsHeaders);
    if (!env.DB) return json({ error: 'D1 database not configured' }, 500, corsHeaders);
    try {
      const signature = request.headers.get('Stripe-Signature') || '';
      const payload = await request.text();
      const valid = await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET);
      if (!valid) return json({ error: 'Invalid Stripe signature' }, 400, corsHeaders);
      const event = JSON.parse(payload);
      await ensureProvidersTable(env);
      if (event.type === 'account.updated') {
        const account = event.data?.object;
        const accountId = String(account?.id || '').trim();
        if (accountId) {
          const detailsSubmitted = account.details_submitted === true;
          const payoutsEnabled = account.payouts_enabled === true;
          const chargesEnabled = account.charges_enabled === true;
          const disabled = !!account.requirements?.disabled_reason;
          const onboardingStatus = detailsSubmitted ? 'complete' : 'pending';
          const status = payoutsEnabled && chargesEnabled && !disabled ? 'active' : 'pending';
          await env.DB.prepare(`UPDATE providers SET stripe_onboarding_status=?, stripe_payouts_enabled=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE stripe_account_id=?`)
            .bind(onboardingStatus, payoutsEnabled ? 1 : 0, status, accountId).run();
        }
      } else if (event.type === 'account.application.deauthorized') {
        const accountId = String(event.account || event.data?.object?.id || '').trim();
        if (accountId) {
          await env.DB.prepare(`UPDATE providers SET stripe_onboarding_status='deauthorized', stripe_payouts_enabled=0, status='inactive', updated_at=CURRENT_TIMESTAMP WHERE stripe_account_id=?`)
            .bind(accountId).run();
        }
      } else if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed' || event.type === 'payment_intent.canceled') {
        const paymentIntent = event.data?.object;
        const paymentIntentId = String(paymentIntent?.id || '').trim();
        const status = event.type === 'payment_intent.succeeded' ? 'paid' : event.type === 'payment_intent.canceled' ? 'canceled' : 'failed';
        if (paymentIntentId) {
          await ensureSettlementTable(env);
          await env.DB.prepare(`UPDATE booking_settlements SET status=?, updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id=?`).bind(status, paymentIntentId).run();
        }
      } else if (event.type === 'charge.refunded') {
        const charge = event.data?.object;
        const paymentIntentId = String(charge?.payment_intent || '').trim();
        if (paymentIntentId) {
          await ensureSettlementTable(env);
          const settlement = await env.DB.prepare(`SELECT gross_cents,refunded_cents FROM booking_settlements WHERE payment_intent_id=? LIMIT 1`).bind(paymentIntentId).first();
          if (settlement) {
            const refundedCents = Math.min(Number(settlement.gross_cents || 0), Math.max(Number(settlement.refunded_cents || 0), Number(charge.amount_refunded || 0)));
            const status = refundedCents >= Number(settlement.gross_cents || 0) ? 'refunded' : 'partially_refunded';
            await env.DB.prepare(`UPDATE booking_settlements SET refunded_cents=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id=?`)
              .bind(refundedCents, status, paymentIntentId).run();
          }
        }
      }
      return json({ received: true }, 200, corsHeaders);
    } catch (error) {
      return json({ error: error?.message || 'Webhook processing error' }, 400, corsHeaders);
    }
  }

  if (!url.pathname.startsWith('/api/admin/providers')) return null;
  if (!env.ADMIN_PAYOUT_KEY) return json({ error: 'Admin key not configured' }, 500, corsHeaders);
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401, corsHeaders);
  if (!env.DB) return json({ error: 'D1 database not configured' }, 500, corsHeaders);
  try {
    await ensureProvidersTable(env);

    if (url.pathname === '/api/admin/providers/onboarding-link') {
      if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405, corsHeaders);
      const accountId = String(url.searchParams.get('account') || '').trim();
      if (!accountId) return json({ error: 'Stripe account missing' }, 400, corsHeaders);
      const provider = await env.DB.prepare('SELECT id,stripe_account_id FROM providers WHERE stripe_account_id = ? LIMIT 1').bind(accountId).first();
      if (!provider) return json({ error: 'Provider not found' }, 404, corsHeaders);
      const onboarding = await createAccountLink(env, accountId, env.ADMIN_URL || url.origin, provider.id);
      if (!onboarding.ok) return json({ error: onboarding.data?.error?.message || 'Stripe onboarding link creation failed' }, onboarding.status, corsHeaders);
      return json({ success: true, onboardingUrl: onboarding.data.url }, 200, corsHeaders);
    }

    if (request.method === 'GET') {
      const result = await env.DB.prepare(`SELECT id,legal_name,display_name,contact_email,phone,cui,vat_number,stripe_account_id,stripe_onboarding_status,stripe_payouts_enabled,status,created_at,updated_at FROM providers ORDER BY created_at DESC,id DESC`).all();
      return json({ providers: result.results || [] }, 200, corsHeaders);
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const legalName = String(body.legalName || '').trim();
      const displayName = String(body.displayName || legalName).trim();
      const contactEmail = String(body.contactEmail || '').trim();
      const phone = String(body.phone || '').trim();
      const address = String(body.address || '').trim();
      const cui = String(body.cui || '').trim();
      const vatNumber = String(body.vatNumber || '').trim();
      if (!legalName || !displayName || !contactEmail) return json({ error: 'Legal name, display name and email are required.' }, 400, corsHeaders);
      if (!env.STRIPE_SECRET_KEY) return json({ error: 'Stripe secret not configured' }, 500, corsHeaders);

      const accountParams = new URLSearchParams();
      accountParams.set('type', 'express');
      accountParams.set('country', 'RO');
      accountParams.set('email', contactEmail);
      accountParams.set('business_profile[name]', displayName);
      accountParams.set('business_profile[product_description]', 'Independent provider of experiences listed on the FiiViu marketplace.');
      accountParams.set('capabilities[card_payments][requested]', 'true');
      accountParams.set('capabilities[transfers][requested]', 'true');
      const stripeResponse = await stripeRequest(env, '/v1/accounts', 'POST', accountParams);
      if (!stripeResponse.ok) return json({ error: stripeResponse.data?.error?.message || 'Stripe account creation failed' }, stripeResponse.status, corsHeaders);

      const accountId = stripeResponse.data.id;
      const result = await env.DB.prepare(`INSERT INTO providers (legal_name,display_name,contact_email,phone,address,cui,vat_number,stripe_account_id,stripe_onboarding_status,status) VALUES (?,?,?,?,?,?,?,?,'created','pending')`)
        .bind(legalName, displayName, contactEmail, phone || null, address || null, cui || null, vatNumber || null, accountId).run();
      const providerId = result.meta?.last_row_id || null;
      const onboarding = await createAccountLink(env, accountId, env.ADMIN_URL || url.origin, providerId);
      if (!onboarding.ok) return json({ error: onboarding.data?.error?.message || 'Stripe onboarding link creation failed', providerId, stripeAccountId: accountId }, onboarding.status, corsHeaders);

      return json({ success: true, providerId, stripeAccountId: accountId, onboardingUrl: onboarding.data.url }, 201, corsHeaders);
    }
    return json({ error: 'Method Not Allowed' }, 405, corsHeaders);
  } catch (error) {
    return json({ error: error?.message || 'Server error' }, 500, corsHeaders);
  }
}

async function createAccountLink(env, accountId, origin, providerId) {
  const params = new URLSearchParams();
  params.set('account', accountId);
  params.set('refresh_url', `${origin}/admin.html?stripe_connect=refresh&provider_id=${encodeURIComponent(providerId || '')}`);
  params.set('return_url', `${origin}/admin.html?stripe_connect=return&provider_id=${encodeURIComponent(providerId || '')}`);
  params.set('type', 'account_onboarding');
  return stripeRequest(env, '/v1/account_links', 'POST', params);
}

async function stripeRequest(env, path, method, body) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

async function ensureProvidersTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS providers (id INTEGER PRIMARY KEY AUTOINCREMENT,legal_name TEXT NOT NULL,display_name TEXT NOT NULL,contact_email TEXT NOT NULL,phone TEXT,address TEXT,cui TEXT,vat_number TEXT,stripe_account_id TEXT UNIQUE,stripe_onboarding_status TEXT NOT NULL DEFAULT 'not_started',stripe_payouts_enabled INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
}

async function ensureSettlementTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS booking_settlements (id INTEGER PRIMARY KEY AUTOINCREMENT,booking_id TEXT NOT NULL UNIQUE,experience_id TEXT NOT NULL,provider_id INTEGER NOT NULL,payment_intent_id TEXT UNIQUE,gross_cents INTEGER NOT NULL,provider_cents INTEGER NOT NULL,platform_cents INTEGER NOT NULL,partner_cents INTEGER NOT NULL DEFAULT 0,currency TEXT NOT NULL DEFAULT 'eur',partner_ref TEXT,status TEXT NOT NULL DEFAULT 'created',refunded_cents INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
}

async function verifyStripeSignature(payload, signatureHeader, secret) {
  const parts = signatureHeader.split(',').map(part => part.trim());
  const timestamp = parts.find(part => part.startsWith('t='))?.slice(2);
  const signatures = parts.filter(part => part.startsWith('v1=')).map(part => part.slice(3));
  if (!timestamp || !signatures.length) return false;
  const timestampNumber = Number(timestamp);
  if (!Number.isInteger(timestampNumber)) return false;
  const tolerance = 300;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) > tolerance) return false;
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return signatures.some(signature => timingSafeEqual(signature, expected));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function isAdmin(request, env) { return request.headers.get('Authorization') === `Bearer ${env.ADMIN_PAYOUT_KEY}`; }
function json(data, status, corsHeaders) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } }); }
