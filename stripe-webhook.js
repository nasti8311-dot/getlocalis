const DEFAULT_TOLERANCE_SECONDS = 300;
const DEFAULT_PROVIDER_CONNECT_ACCOUNT_ID = "acct_1UGKf1Rs1xBDKsEX";

export async function handleStripeWebhook(request, env) {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
  if (!env.STRIPE_WEBHOOK_SECRET) return webhookError("Stripe webhook secret not configured", 500);
  const signature = request.headers.get("Stripe-Signature");
  if (!signature) return webhookError("Missing Stripe-Signature", 400);
  const rawBody = await request.text();
  if (!await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET, DEFAULT_TOLERANCE_SECONDS)) return webhookError("Invalid Stripe signature", 400);
  let event;
  try { event = JSON.parse(rawBody); } catch { return webhookError("Invalid JSON payload", 400); }
  if (!event?.id || !event?.type) return webhookError("Invalid Stripe event", 400);

  if (env.DB) {
    await ensureStripeWebhookEventsTable(env);
    await ensureBookingSettlementsTable(env);
    await ensureStripeRefundEventsTable(env);
    await ensureStripeTransferReversalEventsTable(env);
    const existing = await env.DB.prepare("SELECT event_id FROM stripe_webhook_events WHERE event_id = ? LIMIT 1").bind(event.id).first();
    if (existing) return webhookJson({ received: true, duplicate: true });
  }

  try {
    if (event.type === "payment_intent.succeeded") {
      await recordPaymentIntentEvent(env, event);
      await createBookingSettlement(env, event);
    } else if (event.type === "payment_intent.payment_failed") {
      await recordPaymentIntentEvent(env, event);
    } else if (event.type === "charge.refunded" || event.type === "charge.refund.updated" || event.type === "refund.created" || event.type === "refund.updated") {
      await recordRefundEvent(env, event);
    }
    if (env.DB) await env.DB.prepare("INSERT INTO stripe_webhook_events (event_id,event_type,created_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(event_id) DO NOTHING").bind(event.id, event.type).run();
  } catch (error) {
    console.error("Stripe webhook processing failed", error);
    return webhookError(error?.message || "Webhook processing failed", 500);
  }
  return webhookJson({ received: true });
}

async function recordPaymentIntentEvent(env, event) {
  if (!env.DB) return;
  await ensureStripePaymentEventsTable(env);
  const paymentIntent = event.data?.object || {};
  const metadata = paymentIntent.metadata || {};
  await env.DB.prepare(`INSERT INTO stripe_payment_events (event_id,payment_intent_id,event_type,booking_id,partner_ref,amount,currency,payment_status,created_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(event_id) DO NOTHING`).bind(event.id, paymentIntent.id || null, event.type, metadata.booking_id || null, metadata.partner_ref || null, Number(paymentIntent.amount || 0), paymentIntent.currency || null, paymentIntent.status || null).run();
}

async function recordRefundEvent(env, event) {
  if (!env.DB || !env.STRIPE_SECRET_KEY) return;
  const object = event.data?.object || {};
  const isChargeEvent = event.type === "charge.refunded" || event.type === "charge.refund.updated";
  const chargeId = isChargeEvent ? String(object.id || "").trim() : String(object.charge || "").trim();
  if (!chargeId) throw new Error("Refund event is missing a valid charge ID");
  await syncChargeRefunds(env, chargeId);
}

async function syncChargeRefunds(env, chargeId) {
  let startingAfter = "";
  let paymentIntentId = "";
  let pages = 0;
  while (pages < 20) {
    const params = new URLSearchParams({ charge: chargeId, limit: "100" });
    if (startingAfter) params.set("starting_after", startingAfter);
    const response = await fetch(`https://api.stripe.com/v1/refunds?${params.toString()}`, { headers: { "Authorization": "Bearer " + env.STRIPE_SECRET_KEY } });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "Stripe refund reconciliation failed");
    for (const refund of data.data || []) {
      const refundPaymentIntentId = String(refund.payment_intent || "").trim();
      if (refundPaymentIntentId) paymentIntentId = refundPaymentIntentId;
      if (!refund.id || !refundPaymentIntentId || !Number.isInteger(Number(refund.amount)) || Number(refund.amount) <= 0) continue;
      await env.DB.prepare(`INSERT INTO stripe_refund_events (refund_id,payment_intent_id,charge_id,amount,status,event_type,created_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(refund_id) DO UPDATE SET payment_intent_id=excluded.payment_intent_id,charge_id=excluded.charge_id,amount=excluded.amount,status=excluded.status,event_type=excluded.event_type`).bind(String(refund.id), refundPaymentIntentId, chargeId, Number(refund.amount), String(refund.status || "").trim(), "refund.reconciled").run();
    }
    if (!data.has_more || !data.data?.length) break;
    startingAfter = String(data.data[data.data.length - 1].id || "");
    if (!startingAfter) break;
    pages += 1;
  }
  if (paymentIntentId) await applyRefundToSettlement(env, paymentIntentId);
}

async function applyRefundToSettlement(env, paymentIntentId) {
  const refundRow = await env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS refunded_cents FROM stripe_refund_events WHERE payment_intent_id = ? AND status = 'succeeded'").bind(paymentIntentId).first();
  const refundedCents = Number(refundRow?.refunded_cents || 0);
  const settlement = await env.DB.prepare("SELECT id,total_amount_cents,provider_amount_cents,provider_transfer_amount_cents,provider_transfer_id,settlement_status FROM booking_settlements WHERE payment_intent_id = ? LIMIT 1").bind(paymentIntentId).first();
  if (!settlement) return;
  const totalCents = Number(settlement.total_amount_cents || 0);
  const providerTransferAmountCents = Number(settlement.provider_transfer_amount_cents || settlement.provider_amount_cents || 0);
  if (totalCents <= 0 || providerTransferAmountCents <= 0 || !settlement.provider_transfer_id) {
    if (refundedCents >= totalCents && totalCents > 0) await env.DB.prepare("UPDATE booking_settlements SET settlement_status='refunded',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(settlement.id).run();
    return;
  }
  const targetProviderReversalCents = Math.min(providerTransferAmountCents, Math.round(providerTransferAmountCents * Math.min(refundedCents, totalCents) / totalCents));
  const reversedRow = await env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS reversed_cents FROM stripe_transfer_reversal_events WHERE payment_intent_id = ? AND status = 'succeeded'").bind(paymentIntentId).first();
  const reversedCents = Number(reversedRow?.reversed_cents || 0);
  const reversalDeltaCents = targetProviderReversalCents - reversedCents;
  if (reversalDeltaCents > 0) await reverseProviderTransfer(env, settlement.provider_transfer_id, reversalDeltaCents, paymentIntentId, refundedCents, totalCents);
  const newReversedCents = reversedCents + Math.max(reversalDeltaCents, 0);
  if (refundedCents >= totalCents && newReversedCents >= providerTransferAmountCents) {
    await env.DB.prepare("UPDATE booking_settlements SET settlement_status='refunded',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(settlement.id).run();
  } else if (refundedCents > 0) {
    await env.DB.prepare("UPDATE booking_settlements SET updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(settlement.id).run();
  }
}

async function reverseProviderTransfer(env, transferId, amountCents, paymentIntentId, refundedCents, totalCents) {
  if (!env.STRIPE_SECRET_KEY || !transferId || !Number.isInteger(amountCents) || amountCents <= 0) return;
  const params = new URLSearchParams();
  params.set("amount", String(amountCents));
  params.set("metadata[payment_intent_id]", paymentIntentId);
  params.set("metadata[settlement]", "provider_refund_reversal");
  params.set("metadata[refunded_cents]", String(refundedCents));
  params.set("metadata[total_cents]", String(totalCents));
  const response = await fetch(`https://api.stripe.com/v1/transfers/${encodeURIComponent(transferId)}/reversals`, { method:"POST", headers:{"Authorization":"Bearer "+env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":`provider-reversal-${paymentIntentId}-${amountCents}`}, body:params });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Stripe transfer reversal failed");
  await env.DB.prepare("INSERT OR IGNORE INTO stripe_transfer_reversal_events (reversal_id,payment_intent_id,transfer_id,amount,status,event_type,created_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(String(data.id),paymentIntentId,transferId,Number(data.amount || amountCents),"succeeded","transfer.reversed").run();
}

async function getChargeBalanceTransaction(env, chargeId) {
  if (!env.STRIPE_SECRET_KEY || !chargeId) return null;
  const params = new URLSearchParams({ source: String(chargeId), limit: "1" });
  const response = await fetch(`https://api.stripe.com/v1/balance_transactions?${params.toString()}`, { headers: { "Authorization": "Bearer " + env.STRIPE_SECRET_KEY } });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Stripe balance transaction lookup failed");
  return data.data?.[0] || null;
}

async function createBookingSettlement(env, event) {
  if (!env.DB) return;
  await ensureBookingSettlementsTable(env);
  const paymentIntent = event.data?.object || {};
  const metadata = paymentIntent.metadata || {};
  const totalAmountCents = Number(paymentIntent.amount_received || paymentIntent.amount || 0);
  const bookingId = String(metadata.booking_id || paymentIntent.id || "").trim();
  const paymentIntentId = String(paymentIntent.id || "").trim();
  if (!bookingId || !paymentIntentId || !Number.isInteger(totalAmountCents) || totalAmountCents <= 0) throw new Error("PaymentIntent is missing a valid booking or amount");

  const existing = await env.DB.prepare("SELECT id,provider_transfer_id,settlement_status FROM booking_settlements WHERE booking_id = ? OR payment_intent_id = ? LIMIT 1").bind(bookingId, paymentIntentId).first();
  if (existing?.provider_transfer_id || existing?.settlement_status === "transferred") return;

  let partnerRef = typeof metadata.partner_ref === "string" ? metadata.partner_ref.trim() : "";
  if (partnerRef) {
    const partner = await env.DB.prepare("SELECT partner_ref FROM partners WHERE partner_ref = ? AND active = 1 LIMIT 1").bind(partnerRef).first();
    if (!partner) partnerRef = "";
  }

  const partnerAmountCents = partnerRef ? Math.round(totalAmountCents * 0.03) : 0;
  const fiiviuAmountCents = partnerRef ? Math.round(totalAmountCents * 0.12) : Math.round(totalAmountCents * 0.15);
  const providerBusinessAmountCents = totalAmountCents - fiiviuAmountCents - partnerAmountCents;
  if (providerBusinessAmountCents < 0) throw new Error("Settlement amounts exceed payment amount");

  const providerConnectAccountId = String(metadata.provider_connect_account_id || env.STRIPE_PROVIDER_CONNECT_ACCOUNT_ID || DEFAULT_PROVIDER_CONNECT_ACCOUNT_ID).trim();
  let settlementStatus = providerConnectAccountId ? "ready" : "pending";
  let providerTransferId = existing?.provider_transfer_id || null;
  let providerTransferAmountCents = null;
  let providerTransferCurrency = null;

  if (providerConnectAccountId) {
    if (!/^acct_[A-Za-z0-9]+$/.test(providerConnectAccountId)) throw new Error("Invalid provider Connect account ID");
    const balanceTransaction = await getChargeBalanceTransaction(env, paymentIntent.latest_charge);
    if (!balanceTransaction?.currency || !Number.isInteger(Number(balanceTransaction.amount)) || Number(balanceTransaction.amount) <= 0) throw new Error("Stripe balance transaction is missing for provider transfer");
    providerTransferCurrency = String(balanceTransaction.currency).toLowerCase();
    providerTransferAmountCents = Math.round(Number(balanceTransaction.amount) * providerBusinessAmountCents / totalAmountCents);
    if (!Number.isInteger(providerTransferAmountCents) || providerTransferAmountCents <= 0) throw new Error("Invalid provider transfer amount");
    const transfer = await createProviderTransfer(env, { amountCents: providerTransferAmountCents, currency: providerTransferCurrency, destination: providerConnectAccountId, bookingId, paymentIntentId, sourceTransaction: paymentIntent.latest_charge });
    providerTransferId = transfer.id;
    settlementStatus = "transferred";
  }

  if (existing?.id) {
    await env.DB.prepare(`UPDATE booking_settlements SET payment_intent_id=?,total_amount_cents=?,provider_amount_cents=?,provider_transfer_amount_cents=?,provider_transfer_currency=?,fiiviu_amount_cents=?,partner_amount_cents=?,partner_ref=?,provider_transfer_id=?,settlement_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(paymentIntentId,totalAmountCents,providerBusinessAmountCents,providerTransferAmountCents,providerTransferCurrency,fiiviuAmountCents,partnerAmountCents,partnerRef||null,providerTransferId,settlementStatus,existing.id).run();
    return;
  }

  await env.DB.prepare(`INSERT INTO booking_settlements (booking_id,payment_intent_id,total_amount_cents,provider_amount_cents,provider_transfer_amount_cents,provider_transfer_currency,fiiviu_amount_cents,partner_amount_cents,partner_ref,provider_transfer_id,settlement_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(booking_id) DO UPDATE SET payment_intent_id=excluded.payment_intent_id,total_amount_cents=excluded.total_amount_cents,provider_amount_cents=excluded.provider_amount_cents,provider_transfer_amount_cents=excluded.provider_transfer_amount_cents,provider_transfer_currency=excluded.provider_transfer_currency,fiiviu_amount_cents=excluded.fiiviu_amount_cents,partner_amount_cents=excluded.partner_amount_cents,partner_ref=excluded.partner_ref,provider_transfer_id=excluded.provider_transfer_id,settlement_status=excluded.settlement_status,updated_at=CURRENT_TIMESTAMP`).bind(bookingId,paymentIntentId,totalAmountCents,providerBusinessAmountCents,providerTransferAmountCents,providerTransferCurrency,fiiviuAmountCents,partnerAmountCents,partnerRef||null,providerTransferId,settlementStatus).run();
}

async function createProviderTransfer(env, { amountCents, currency, destination, bookingId, paymentIntentId, sourceTransaction }) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe secret not configured");
  if (!sourceTransaction) throw new Error("Provider transfer is missing source transaction");
  const params = new URLSearchParams();
  params.set("amount", String(amountCents));
  params.set("currency", currency);
  params.set("destination", destination);
  params.set("source_transaction", sourceTransaction);
  params.set("metadata[booking_id]", bookingId);
  params.set("metadata[payment_intent_id]", paymentIntentId);
  params.set("metadata[settlement]", "provider_85_percent");
  const response = await fetch("https://api.stripe.com/v1/transfers", { method:"POST", headers:{"Authorization":"Bearer "+env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":`provider-transfer-${paymentIntentId}`}, body:params });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Stripe transfer failed");
  return data;
}

async function ensureStripeWebhookEventsTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS stripe_webhook_events (event_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
}
async function ensureStripePaymentEventsTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS stripe_payment_events (id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,payment_intent_id TEXT,event_type TEXT NOT NULL,booking_id TEXT,partner_ref TEXT,amount INTEGER,currency TEXT,payment_status TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_stripe_payment_events_payment_intent ON stripe_payment_events(payment_intent_id)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_stripe_payment_events_booking ON stripe_payment_events(booking_id)").run();
}
async function ensureStripeRefundEventsTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS stripe_refund_events (id INTEGER PRIMARY KEY AUTOINCREMENT,refund_id TEXT NOT NULL UNIQUE,payment_intent_id TEXT NOT NULL,charge_id TEXT,amount INTEGER NOT NULL CHECK (amount > 0),status TEXT,event_type TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_stripe_refund_events_payment_intent ON stripe_refund_events(payment_intent_id)").run();
}
async function ensureStripeTransferReversalEventsTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS stripe_transfer_reversal_events (id INTEGER PRIMARY KEY AUTOINCREMENT,reversal_id TEXT NOT NULL UNIQUE,payment_intent_id TEXT NOT NULL,transfer_id TEXT NOT NULL,amount INTEGER NOT NULL CHECK (amount > 0),status TEXT,event_type TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_stripe_transfer_reversal_events_payment_intent ON stripe_transfer_reversal_events(payment_intent_id)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_stripe_transfer_reversal_events_transfer ON stripe_transfer_reversal_events(transfer_id)").run();
}
async function ensureBookingSettlementsTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS booking_settlements (id INTEGER PRIMARY KEY AUTOINCREMENT,booking_id TEXT NOT NULL UNIQUE,payment_intent_id TEXT UNIQUE,total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents > 0),provider_amount_cents INTEGER NOT NULL CHECK (provider_amount_cents >= 0),provider_transfer_amount_cents INTEGER CHECK (provider_transfer_amount_cents >= 0),provider_transfer_currency TEXT,fiiviu_amount_cents INTEGER NOT NULL CHECK (fiiviu_amount_cents >= 0),partner_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (partner_amount_cents >= 0),partner_ref TEXT,provider_transfer_id TEXT,settlement_status TEXT NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending','ready','transferred','failed','refunded','cancelled')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (partner_ref) REFERENCES partners(partner_ref))`).run();
  try { await env.DB.prepare("ALTER TABLE booking_settlements ADD COLUMN provider_transfer_id TEXT").run(); } catch (e) {}
  try { await env.DB.prepare("ALTER TABLE booking_settlements ADD COLUMN provider_transfer_amount_cents INTEGER").run(); } catch (e) {}
  try { await env.DB.prepare("ALTER TABLE booking_settlements ADD COLUMN provider_transfer_currency TEXT").run(); } catch (e) {}
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_settlements_provider_transfer ON booking_settlements(provider_transfer_id)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_booking_settlements_payment_intent ON booking_settlements(payment_intent_id)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_booking_settlements_partner_ref ON booking_settlements(partner_ref)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_booking_settlements_status ON booking_settlements(settlement_status)").run();
}
async function verifyStripeSignature(payload, header, secret, toleranceSeconds) {
  const parts = header.split(",");
  const timestampPart = parts.find(part => part.startsWith("t="));
  const signatures = parts.filter(part => part.startsWith("v1=")).map(part => part.slice(3));
  if (!timestampPart || signatures.length === 0) return false;
  const timestamp = Number(timestampPart.slice(2));
  if (!Number.isInteger(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now()/1000)-timestamp) > toleranceSeconds) return false;
  const expected = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  return signatures.some(signature => timingSafeEqualHex(signature, expected));
}
async function hmacSha256Hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2,"0")).join("");
}
function timingSafeEqualHex(a,b) {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) return false;
  let diff=0; for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i); return diff===0;
}
function webhookError(message,status){return new Response(JSON.stringify({error:message}),{status,headers:{"Content-Type":"application/json"}})}
function webhookJson(data){return new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json"}})}