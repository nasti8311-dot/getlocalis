export async function handleProviderConnectRoute(request, env, url, corsHeaders) {
  if (!url.pathname.startsWith('/api/admin/providers')) return null;
  if (!env.ADMIN_PAYOUT_KEY) return json({ error: 'Admin key not configured' }, 500, corsHeaders);
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401, corsHeaders);
  if (!env.DB) return json({ error: 'D1 database not configured' }, 500, corsHeaders);
  try {
    await ensureProvidersTable(env);
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
      const onboarding = await createAccountLink(env, accountId, url.origin, providerId);
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
  params.set('refresh_url', `${origin}/?stripe_connect=refresh&provider_id=${encodeURIComponent(providerId || '')}`);
  params.set('return_url', `${origin}/?stripe_connect=return&provider_id=${encodeURIComponent(providerId || '')}`);
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

function isAdmin(request, env) { return request.headers.get('Authorization') === `Bearer ${env.ADMIN_PAYOUT_KEY}`; }
function json(data, status, corsHeaders) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } }); }
