import legacyWorker from "./worker.js";

const EMAILJS_SERVICE_ID = "service_0fqphlf";
const EMAILJS_TEMPLATE_ID = "template_x2mmo2p";
const EMAILJS_PUBLIC_KEY = "Q_tJ6LhJkeMcVE0U4";
const DEFAULT_APP_URL = "https://getlocalis.nasti8311.workers.dev";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/cancel-booking") {
      return handleCancellation(request, env);
    }

    if (url.pathname === "/api/stripe/webhook") {
      const body = await request.text();
      const replay = new Request(request, { body });
      const response = await legacyWorker.fetch(replay, env, ctx);
      if (response.ok) {
        try {
          const event = JSON.parse(body);
          if (event?.type === "payment_intent.succeeded") {
            ctx.waitUntil(finalizePaidBooking(env, event.data?.object));
          }
        } catch (error) {
          console.error("FiiViu webhook post-processing parse failed", error);
        }
      }
      return response;
    }

    if (request.method === "POST" && url.pathname === "/api/create-payment-intent") {
      const body = await request.text();
      try {
        const data = JSON.parse(body);
        data.customerName = data.customerName || "";
        data.customerEmail = data.customerEmail || "";
        data.customerPhone = data.customerPhone || "";
        data.customerLanguage = data.customerLanguage || "en";
        data.bookingDate = data.bookingDate || "";
        data.bookingTime = data.bookingTime || extractTime(data.experienceName || data.tourName || "");
        data.experienceName = data.experienceName || data.tourName || "";
        data.providerName = data.providerName || "";
        data.meetingPointName = data.meetingPointName || "";
        data.meetingAddress = data.meetingAddress || "";
        data.meetingCity = data.meetingCity || "";
        data.meetingCountry = data.meetingCountry || "";
        data.meetingInstructions = data.meetingInstructions || "";
        data.arrivalMinutesBefore = data.arrivalMinutesBefore ?? "";
        data.meetingLatitude = data.meetingLatitude || "";
        data.meetingLongitude = data.meetingLongitude || "";
        data.providerConnectAccountId = data.providerConnectAccountId || "";

        const response = await legacyWorker.fetch(
          new Request(request, { body: JSON.stringify(data) }),
          env,
          ctx
        );

        if (response.ok && env.STRIPE_SECRET_KEY) {
          try {
            const result = await response.clone().json();
            if (result?.paymentIntentId) {
              await updatePaymentIntentMetadata(env, result.paymentIntentId, {
                customer_name: data.customerName,
                customer_email: data.customerEmail,
                customer_phone: data.customerPhone,
                customer_language: normalizeLanguage(data.customerLanguage),
                booking_date: data.bookingDate,
                booking_time: data.bookingTime,
                experience_name: data.experienceName,
                provider_name: data.providerName,
                meeting_point_name: data.meetingPointName,
                meeting_address: data.meetingAddress,
                meeting_city: data.meetingCity,
                meeting_country: data.meetingCountry,
                meeting_instructions: data.meetingInstructions,
                arrival_minutes_before: data.arrivalMinutesBefore,
                meeting_latitude: data.meetingLatitude,
                meeting_longitude: data.meetingLongitude,
                provider_connect_account_id: data.providerConnectAccountId
              });
            }
          } catch (error) {
            console.error("FiiViu PaymentIntent metadata enrichment failed", error);
          }
        }
        return response;
      } catch (_) {
        return legacyWorker.fetch(new Request(request, { body }), env, ctx);
      }
    }

    const response = await legacyWorker.fetch(request, env, ctx);
    if (request.method === "GET" && isHtmlResponse(response, url)) {
      return injectCheckoutBridge(response);
    }
    return response;
  }
};

async function handleCancellation(request, env) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (!env.DB || !env.STRIPE_SECRET_KEY) return json({ error: "Cancellation service is not configured." }, 500, corsHeaders);

  try {
    await ensureBookingColumns(env);
    const url = new URL(request.url);
    const token = String(url.searchParams.get("token") || "").trim();
    if (!token || token.length < 32) return json({ error: "Ungültiger Stornierungslink." }, 400, corsHeaders);

    const booking = await env.DB.prepare("SELECT * FROM bookings WHERE cancellation_token=? LIMIT 1").bind(token).first();
    if (!booking) return json({ error: "Buchung nicht gefunden." }, 404, corsHeaders);

    if (request.method === "GET") {
      return json(buildCancellationView(booking), 200, corsHeaders);
    }

    if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405, corsHeaders);
    if (String(booking.status || "") === "cancelled") return json({ success: true, status: "cancelled", message: "Diese Buchung wurde bereits storniert." }, 200, corsHeaders);
    if (String(booking.status || "") !== "confirmed" || String(booking.payment_status || "") !== "paid") {
      return json({ error: "Diese Buchung kann nicht mehr storniert werden." }, 409, corsHeaders);
    }

    const cancellation = getCancellationState(booking);
    if (!cancellation.allowed) {
      return json({ error: "Die kostenlose Stornierungsfrist ist abgelaufen.", cancellation_deadline: cancellation.deadline }, 409, corsHeaders);
    }

    const lock = await env.DB.prepare(
      "UPDATE bookings SET status='cancellation_processing', updated_at=CURRENT_TIMESTAMP WHERE cancellation_token=? AND status='confirmed' AND payment_status='paid'"
    ).bind(token).run();
    if (Number(lock.meta?.changes || 0) !== 1) return json({ error: "Die Stornierung wird bereits bearbeitet." }, 409, corsHeaders);

    try {
      const refund = await stripeRefundPaymentIntent(env, booking.payment_intent_id);
      await env.DB.prepare(
        "UPDATE bookings SET status='cancelled', payment_status='refunded', cancelled_at=CURRENT_TIMESTAMP, cancellation_refund_id=?, updated_at=CURRENT_TIMESTAMP WHERE cancellation_token=?"
      ).bind(refund.id, token).run();
      return json({ success: true, status: "cancelled", refund_id: refund.id, message: "Deine Buchung wurde storniert. Die Rückerstattung wurde bei Stripe angestoßen." }, 200, corsHeaders);
    } catch (error) {
      await env.DB.prepare("UPDATE bookings SET status='confirmed', updated_at=CURRENT_TIMESTAMP WHERE cancellation_token=? AND status='cancellation_processing'").bind(token).run();
      throw error;
    }
  } catch (error) {
    console.error("FiiViu cancellation failed", error);
    return json({ error: error?.message || "Stornierung fehlgeschlagen." }, 500, corsHeaders);
  }
}

function buildCancellationView(booking) {
  const cancellation = getCancellationState(booking);
  return {
    booking_id: booking.booking_id,
    tour_title: booking.experience_name,
    booking_date: booking.booking_date || "",
    booking_time: booking.booking_time || "",
    guests: Number(booking.guests || 1),
    total_price: `${(Number(booking.amount_cents || 0) / 100).toFixed(2)} ${String(booking.currency || "eur").toUpperCase()}`,
    status: booking.status,
    allowed: cancellation.allowed,
    cancellation_deadline: cancellation.deadline,
    cancellation_hours: getCancellationHours(),
    policy_text: cancellation.allowed
      ? `Kostenlose Stornierung bis ${getCancellationHours()} Stunden vor Beginn.`
      : "Die kostenlose Stornierungsfrist ist abgelaufen."
  };
}

function getCancellationHours() {
  const value = Number(globalThis.__FIIVIU_CANCELLATION_HOURS || 24);
  return Number.isFinite(value) ? Math.max(0, Math.min(Math.floor(value), 168)) : 24;
}

function getCancellationState(booking) {
  const hours = getCancellationHours();
  const start = parseBookingDateTime(booking.booking_date, booking.booking_time);
  if (!start) return { allowed: false, deadline: null };
  const deadlineMs = start.getTime() - hours * 60 * 60 * 1000;
  return { allowed: Date.now() <= deadlineMs, deadline: new Date(deadlineMs).toISOString() };
}

function parseBookingDateTime(dateValue, timeValue) {
  const date = String(dateValue || "").trim();
  const time = String(timeValue || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  return new Date(`${date}T${time.padStart(5, "0")}:00Z`);
}

async function stripeRefundPaymentIntent(env, paymentIntentId) {
  if (!paymentIntentId) throw new Error("Keine Stripe PaymentIntent-ID vorhanden.");
  const params = new URLSearchParams();
  params.set("payment_intent", String(paymentIntentId));
  const response = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "Stripe-Rückerstattung fehlgeschlagen.");
  return data;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function isHtmlResponse(response, url) {
  if (url.pathname.startsWith("/api/")) return false;
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("text/html");
}

async function injectCheckoutBridge(response) {
  const html = await response.text();
  const bridge = `<script>
(function(){
  var originalFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/api/create-payment-intent') !== -1 && init && typeof init.body === 'string') {
        var data = JSON.parse(init.body);
        var get = function(id){ var el=document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
        data.customerName = get('customer-name') || data.customerName || '';
        data.customerEmail = get('customer-email') || data.customerEmail || '';
        data.customerPhone = get('customer-phone') || data.customerPhone || '';
        data.bookingDate = get('booking-date') || data.bookingDate || '';
        data.bookingTime = (typeof selectedTourTime !== 'undefined' ? String(selectedTourTime || '').trim() : '') || data.bookingTime || extractTime(data.experienceName || data.tourName || '');
        data.customerLanguage = (typeof currentLang !== 'undefined' ? String(currentLang || 'en').slice(0,2) : 'en');
        data.experienceName = data.experienceName || data.tourName || '';
        var meeting = window.__fiiviuMeetingPoint || {};
        data.providerName = meeting.providerName || data.providerName || '';
        data.meetingPointName = meeting.name || data.meetingPointName || '';
        data.meetingAddress = meeting.address || data.meetingAddress || '';
        data.meetingCity = meeting.city || data.meetingCity || '';
        data.meetingCountry = meeting.country || data.meetingCountry || '';
        data.meetingInstructions = meeting.instructions || data.meetingInstructions || '';
        data.arrivalMinutesBefore = meeting.arrivalMinutesBefore ?? data.arrivalMinutesBefore ?? '';
        data.meetingLatitude = meeting.latitude || data.meetingLatitude || '';
        data.meetingLongitude = meeting.longitude || data.meetingLongitude || '';
        data.providerConnectAccountId = window.__fiiviuProviderConnectAccountId || data.providerConnectAccountId || '';
        init.body = JSON.stringify(data);
      }
    } catch (_) {}
    return originalFetch(input, init);
  };
  function extractTime(value){var match=String(value||'').match(/\\b([01]?\\d|2[0-3]):[0-5]\\d\\b/);return match?match[0]:'';}
  try {
    if (window.emailjs && typeof window.emailjs.send === 'function') {
      var originalSend = window.emailjs.send.bind(window.emailjs);
      window.emailjs.send = function(serviceId, templateId, params, options){
        if (serviceId === '${EMAILJS_SERVICE_ID}' && templateId === '${EMAILJS_TEMPLATE_ID}') {
          return Promise.resolve({status:200, text:'Server-side confirmation queued'});
        }
        return originalSend(serviceId, templateId, params, options);
      };
    }
  } catch (_) {}
})();
</script>`;

  const marker = "</body>";
  const output = html.includes(marker) ? html.replace(marker, bridge + marker) : html + bridge;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-cache");
  return new Response(output, { status: response.status, statusText: response.statusText, headers });
}

async function updatePaymentIntentMetadata(env, paymentIntentId, values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && String(value) !== "") {
      params.set(`metadata[${key}]`, String(value).slice(0, 500));
    }
  }
  if (!params.size) return;
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || "Stripe PaymentIntent metadata update failed");
  }
}

async function finalizePaidBooking(env, paymentIntent) {
  if (!env.DB || !env.STRIPE_SECRET_KEY || !paymentIntent?.id) return;

  try {
    await ensureBookingColumns(env);
    const pi = await stripeGet(env, `/v1/payment_intents/${encodeURIComponent(paymentIntent.id)}?expand[]=payment_method`);
    const metadata = pi.metadata || {};
    const paymentMethod = pi.payment_method && typeof pi.payment_method === "object" ? pi.payment_method : null;
    const billing = paymentMethod?.billing_details || {};

    const bookingId = String(metadata.booking_id || `FV-${paymentIntent.id.slice(-8).toUpperCase()}`).trim();
    const email = String(metadata.customer_email || pi.receipt_email || billing.email || "").trim().toLowerCase();
    const name = String(metadata.customer_name || billing.name || "").trim();
    const language = normalizeLanguage(metadata.customer_language);
    const guests = Math.max(1, Number(metadata.guests || 1));
    const amountCents = Number(pi.amount_received || pi.amount || 0);
    const currency = String(pi.currency || "eur").toLowerCase();
    const experienceName = String(metadata.experience_name || metadata.tour_name || "Experience").trim();
    const meeting = {
      name: clean(metadata.meeting_point_name),
      address: clean(metadata.meeting_address),
      city: clean(metadata.meeting_city),
      country: clean(metadata.meeting_country),
      instructions: clean(metadata.meeting_instructions),
      arrivalMinutes: integerOrNull(metadata.arrival_minutes_before),
      latitude: clean(metadata.meeting_latitude),
      longitude: clean(metadata.meeting_longitude)
    };
    const cancellationToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

    await env.DB.prepare(`
      INSERT INTO bookings (
        booking_id, payment_intent_id, status, payment_status,
        customer_name, customer_email, customer_phone, customer_language,
        experience_name, booking_date, booking_time, guests,
        amount_cents, currency,
        meeting_point_name, meeting_address, meeting_city, meeting_country,
        meeting_instructions, arrival_minutes_before, meeting_latitude, meeting_longitude,
        partner_ref, provider_name, provider_connect_account_id, cancellation_token,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(payment_intent_id) DO UPDATE SET
        booking_id=excluded.booking_id,
        status='confirmed', payment_status='paid',
        customer_name=excluded.customer_name, customer_email=excluded.customer_email,
        customer_phone=excluded.customer_phone, customer_language=excluded.customer_language,
        experience_name=excluded.experience_name, booking_date=excluded.booking_date,
        booking_time=excluded.booking_time, guests=excluded.guests,
        amount_cents=excluded.amount_cents, currency=excluded.currency,
        meeting_point_name=excluded.meeting_point_name, meeting_address=excluded.meeting_address,
        meeting_city=excluded.meeting_city, meeting_country=excluded.meeting_country,
        meeting_instructions=excluded.meeting_instructions,
        arrival_minutes_before=excluded.arrival_minutes_before,
        meeting_latitude=excluded.meeting_latitude, meeting_longitude=excluded.meeting_longitude,
        partner_ref=excluded.partner_ref, provider_name=excluded.provider_name,
        provider_connect_account_id=excluded.provider_connect_account_id,
        cancellation_token=COALESCE(bookings.cancellation_token, excluded.cancellation_token),
        updated_at=CURRENT_TIMESTAMP
    `).bind(
      bookingId, paymentIntent.id, "confirmed", "paid", name || "Customer", email,
      clean(metadata.customer_phone), language, experienceName,
      clean(metadata.booking_date), clean(metadata.booking_time), guests,
      amountCents, currency, meeting.name, meeting.address, meeting.city,
      meeting.country, meeting.instructions, meeting.arrivalMinutes, meeting.latitude,
      meeting.longitude, clean(metadata.partner_ref), clean(metadata.provider_name),
      clean(metadata.provider_connect_account_id), cancellationToken
    ).run();

    const booking = await env.DB.prepare("SELECT * FROM bookings WHERE payment_intent_id=? LIMIT 1").bind(paymentIntent.id).first();
    if (!booking || booking.confirmation_email_sent_at) return;
    if (!booking.customer_email) {
      await env.DB.prepare("UPDATE bookings SET confirmation_email_error=?, updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id=?")
        .bind("Keine Kunden-E-Mail für Bestätigungsversand vorhanden.", paymentIntent.id).run();
      return;
    }

    await sendConfirmationWithRetry(env, booking);
    await env.DB.prepare("UPDATE bookings SET confirmation_email_sent_at=CURRENT_TIMESTAMP, confirmation_email_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id=? AND confirmation_email_sent_at IS NULL")
      .bind(paymentIntent.id).run();
  } catch (error) {
    console.error("FiiViu paid booking finalization failed", error);
    try {
      await env.DB.prepare("UPDATE bookings SET confirmation_email_error=?, updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id=?")
        .bind(String(error?.message || error).slice(0, 1000), paymentIntent?.id).run();
    } catch (_) {}
  }
}

async function sendConfirmationWithRetry(env, booking) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await sendEmailJsConfirmation(env, booking); return; }
    catch (error) { lastError = error; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1))); }
  }
  throw lastError || new Error("EmailJS confirmation failed");
}

async function sendEmailJsConfirmation(env, booking) {
  const serviceId = String(env.EMAILJS_SERVICE_ID || EMAILJS_SERVICE_ID).trim();
  const templateId = String(env.EMAILJS_TEMPLATE_ID || EMAILJS_TEMPLATE_ID).trim();
  const publicKey = String(env.EMAILJS_PUBLIC_KEY || EMAILJS_PUBLIC_KEY).trim();
  const language = normalizeLanguage(booking.customer_language);
  const subject = language === "de" ? `Buchung bestätigt – ${booking.experience_name}` : language === "ro" ? `Rezervare confirmată – ${booking.experience_name}` : `Booking confirmed – ${booking.experience_name}`;
  const appUrl = String(env.PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/$/, "");
  const cancellationUrl = booking.cancellation_token ? `${appUrl}/api/cancel-booking?token=${encodeURIComponent(booking.cancellation_token)}` : "";
  const params = {
    user_name: booking.customer_name,
    user_email: booking.customer_email,
    tour_title: booking.experience_name,
    booking_date: booking.booking_date || "",
    booking_time: booking.booking_time || "",
    guests: String(booking.guests || 1),
    total_price: `${(Number(booking.amount_cents || 0) / 100).toFixed(2)} ${String(booking.currency || "eur").toUpperCase()}`,
    booking_id: booking.booking_id,
    customer_language: language,
    subject,
    provider_name: booking.provider_name || "FiiViu Demo Organizer",
    meeting_point_name: booking.meeting_point_name || "",
    meeting_address: booking.meeting_address || "",
    meeting_city: booking.meeting_city || "",
    meeting_country: booking.meeting_country || "",
    meeting_instructions: booking.meeting_instructions || "",
    arrival_minutes_before: booking.arrival_minutes_before == null ? "" : String(booking.arrival_minutes_before),
    meeting_latitude: booking.meeting_latitude || "",
    meeting_longitude: booking.meeting_longitude || "",
    meeting_map_link: makeMeetingMapLink(booking),
    cancellation_url: cancellationUrl,
    cancellation_hours: String(getCancellationHours())
  };
  const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service_id: serviceId, template_id: templateId, user_id: publicKey, template_params: params })
  });
  if (!response.ok) { const text = await response.text(); throw new Error(`EmailJS ${response.status}: ${text.slice(0, 500)}`); }
}

function makeMeetingMapLink(booking) {
  const latitude = clean(booking.meeting_latitude);
  const longitude = clean(booking.meeting_longitude);
  const query = latitude && longitude ? `${latitude},${longitude}` : [booking.meeting_point_name, booking.meeting_address, booking.meeting_city, booking.meeting_country].map(clean).filter(Boolean).join(", ");
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : "";
}

function extractTime(value) { const match = String(value || "").match(/\b([01]?\d|2[0-3]):[0-5]\d\b/); return match ? match[0] : ""; }

async function stripeGet(env, path) {
  const response = await fetch(`https://api.stripe.com${path}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Stripe request failed");
  return data;
}

async function ensureBookingColumns(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id TEXT NOT NULL UNIQUE,
    payment_intent_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending', payment_status TEXT NOT NULL DEFAULT 'pending',
    customer_name TEXT NOT NULL, customer_email TEXT NOT NULL, customer_phone TEXT,
    customer_language TEXT NOT NULL DEFAULT 'en', experience_name TEXT NOT NULL,
    booking_date TEXT, booking_time TEXT, guests INTEGER NOT NULL DEFAULT 1,
    amount_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'eur',
    meeting_point_name TEXT, meeting_address TEXT, meeting_city TEXT, meeting_country TEXT,
    meeting_instructions TEXT, arrival_minutes_before INTEGER,
    meeting_latitude TEXT, meeting_longitude TEXT, partner_ref TEXT,
    provider_name TEXT, provider_connect_account_id TEXT, confirmation_email_sent_at TEXT,
    confirmation_email_error TEXT, cancellation_token TEXT, cancelled_at TEXT, cancellation_refund_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  for (const statement of [
    "ALTER TABLE bookings ADD COLUMN provider_name TEXT",
    "ALTER TABLE bookings ADD COLUMN provider_connect_account_id TEXT",
    "ALTER TABLE bookings ADD COLUMN confirmation_email_error TEXT",
    "ALTER TABLE bookings ADD COLUMN cancellation_token TEXT",
    "ALTER TABLE bookings ADD COLUMN cancelled_at TEXT",
    "ALTER TABLE bookings ADD COLUMN cancellation_refund_id TEXT"
  ]) { try { await env.DB.prepare(statement).run(); } catch (_) {} }
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_cancellation_token ON bookings(cancellation_token)").run();
}

function normalizeLanguage(value) { const language = String(value || "en").toLowerCase().slice(0, 2); return ["de", "en", "ro"].includes(language) ? language : "en"; }
function clean(value) { const text = String(value ?? "").trim(); return text || null; }
function integerOrNull(value) { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : null; }
