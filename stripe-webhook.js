const DEFAULT_TOLERANCE_SECONDS = 300;

export async function handleStripeWebhook(request, env) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Stripe webhook secret not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const signature = request.headers.get("Stripe-Signature");
  if (!signature) return webhookError("Missing Stripe-Signature", 400);

  const rawBody = await request.text();
  const valid = await verifyStripeSignature(
    rawBody,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
    DEFAULT_TOLERANCE_SECONDS
  );
  if (!valid) return webhookError("Invalid Stripe signature", 400);

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return webhookError("Invalid JSON payload", 400);
  }

  if (!event?.id || !event?.type) return webhookError("Invalid Stripe event", 400);

  // Stripe may retry the same event. Store the event ID before processing so
  // the same event is not applied twice. If DB is not configured we still
  // acknowledge the event, but no durable idempotency is available.
  if (env.DB) {
    await ensureStripeWebhookEventsTable(env);
    const existing = await env.DB
      .prepare("SELECT event_id FROM stripe_webhook_events WHERE event_id = ? LIMIT 1")
      .bind(event.id)
      .first();

    if (existing) {
      return webhookJson({ received: true, duplicate: true });
    }

    await env.DB
      .prepare("INSERT INTO stripe_webhook_events (event_id,event_type,created_at) VALUES (?,?,CURRENT_TIMESTAMP)")
      .bind(event.id, event.type)
      .run();
  }

  // These events are deliberately handled without changing booking state yet.
  // The current worker already derives partner statistics from PaymentIntents.
  // This webhook gives us a verified, idempotent integration point for the
  // later provider-settlement/Connect-transfer logic.
  switch (event.type) {
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed":
      await recordPaymentIntentEvent(env, event);
      break;
    default:
      // Stripe can send additional events when the endpoint is expanded later.
      // Acknowledge them rather than returning 4xx and causing retries.
      break;
  }

  return webhookJson({ received: true });
}

async function recordPaymentIntentEvent(env, event) {
  if (!env.DB) return;

  await ensureStripePaymentEventsTable(env);
  const paymentIntent = event.data?.object || {};
  const metadata = paymentIntent.metadata || {};

  await env.DB.prepare(`
    INSERT INTO stripe_payment_events
      (event_id,payment_intent_id,event_type,booking_id,partner_ref,amount,currency,payment_status,created_at)
    VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(event_id) DO NOTHING
  `).bind(
    event.id,
    paymentIntent.id || null,
    event.type,
    metadata.booking_id || null,
    metadata.partner_ref || null,
    Number(paymentIntent.amount || 0),
    paymentIntent.currency || null,
    paymentIntent.status || null
  ).run();
}

async function ensureStripeWebhookEventsTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

async function ensureStripePaymentEventsTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS stripe_payment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      payment_intent_id TEXT,
      event_type TEXT NOT NULL,
      booking_id TEXT,
      partner_ref TEXT,
      amount INTEGER,
      currency TEXT,
      payment_status TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_stripe_payment_events_payment_intent ON stripe_payment_events(payment_intent_id)"
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_stripe_payment_events_booking ON stripe_payment_events(booking_id)"
  ).run();
}

async function verifyStripeSignature(payload, header, secret, toleranceSeconds) {
  const parts = header.split(",");
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));

  if (!timestampPart || signatures.length === 0) return false;

  const timestamp = Number(timestampPart.slice(2));
  if (!Number.isInteger(timestamp)) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expected = await hmacSha256Hex(secret, signedPayload);

  return signatures.some((signature) => timingSafeEqualHex(signature, expected));
}

async function hmacSha256Hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a, b) {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function webhookError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function webhookJson(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
