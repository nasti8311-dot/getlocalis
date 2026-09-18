import legacyWorker from "./worker.js";
// FiiViu deployment sync: EmailJS private-key sender

const EMAILJS_SERVICE_ID = "service_0fqphlf";
const EMAILJS_TEMPLATE_ID = "template_x2mmo2p";
const EMAILJS_PUBLIC_KEY = "Q_tJ6LhJkeMcVE0U4";
const DEFAULT_APP_URL = "https://getlocalis.nasti8311.workers.dev";
const CANCELLATION_HOURS = 24;
const BOOKING_TIME_ZONE = "Europe/Bucharest";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/cancel-booking") return handleCancellation(request, env);

    if (request.method === "POST" && url.pathname === "/api/admin/resend-confirmation") {
      return handleAdminResendConfirmation(request, env);
    }

    if (url.pathname === "/api/stripe/webhook") {
      if (request.method !== "POST") {
        return json({ error: "Method Not Allowed" }, 405);
      }

      const body = await request.text();
      const signature = request.headers.get("Stripe-Signature") || "";
      const signatureSecret = String(env.STRIPE_WEBHOOK_SECRET || "").trim();

      if (!signatureSecret) {
        console.error("FiiViu Stripe webhook secret is not configured");
        return json({ error: "Webhook is not configured." }, 500);
      }

      const verified = await verifyStripeWebhookSignature(
        body,
        signature,
        signatureSecret
      );

      if (!verified) {
        console.error("FiiViu Stripe webhook signature verification failed");
        return json({ error: "Invalid webhook signature." }, 400);
      }

      const response = await legacyWorker.fetch(
        new Request(request, { body }),
        env,
        ctx
      );

      if (response.ok) {
        try {
          const event = JSON.parse(body);
          if (event?.type === "payment_intent.succeeded") {
            const stripeSecretKey = String(env.STRIPE_SECRET_KEY || "").trim();
            const configuredTestMode = stripeSecretKey.startsWith("sk_test_");
            const eventIsTestMode = event?.livemode === false;

            // Safety guard: never finalize a live event while the Worker is
            // configured with test credentials, or vice versa.
            if (configuredTestMode !== eventIsTestMode) {
              console.error("FiiViu Stripe mode mismatch; booking finalization skipped", {
                configuredTestMode,
                eventIsTestMode,
              });
            } else {
              ctx.waitUntil(finalizePaidBooking(env, event.data?.object));
            }
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
          new Request(request, {
            body: JSON.stringify(data)
          }),
          env,
          ctx
        );

        if (response.ok && env.STRIPE_SECRET_KEY) {
          try {
            const result = await response.clone().json();

            if (result?.paymentIntentId) {
              await updatePaymentIntentMetadata(
                env,
                result.paymentIntentId,
                {
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
                }
              );
            }
          } catch (error) {
            console.error(
              "FiiViu PaymentIntent metadata enrichment failed",
              error
            );
          }
        }

        return response;
      } catch (_) {
        return legacyWorker.fetch(
          new Request(request, { body }),
          env,
          ctx
        );
      }
    }

    const response = await legacyWorker.fetch(request, env, ctx);

    if (request.method === "GET" && isHtmlResponse(response, url)) {
      return injectCheckoutBridge(response);
    }

    return response;
  }
};

async function handleAdminResendConfirmation(request, env) {
  if (!env.ADMIN_PAYOUT_KEY) {
    return json({ error: "Admin key is not configured." }, 500);
  }

  const authorization = String(request.headers.get("Authorization") || "").trim();
  const expected = "Bearer " + String(env.ADMIN_PAYOUT_KEY).trim();

  if (!authorization || authorization !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    await ensureBookingColumns(env);

    const url = new URL(request.url);
    const bookingId = String(url.searchParams.get("booking_id") || "").trim();

    if (!bookingId) {
      return json({ error: "booking_id is required." }, 400);
    }

    const booking = await env.DB
      .prepare("SELECT * FROM bookings WHERE booking_id=? LIMIT 1")
      .bind(bookingId)
      .first();

    if (!booking) {
      return json({ error: "Booking not found." }, 404);
    }

    if (!booking.customer_email) {
      return json({ error: "No customer email is stored for this booking." }, 409);
    }

    await sendConfirmationWithRetry(env, booking);

    await env.DB
      .prepare(
        "UPDATE bookings SET confirmation_email_sent_at=CURRENT_TIMESTAMP,confirmation_email_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE booking_id=?"
      )
      .bind(bookingId)
      .run();

    return json({
      success: true,
      booking_id: bookingId,
      email: booking.customer_email,
      message: "Confirmation email sent."
    });
  } catch (error) {
    console.error("FiiViu admin confirmation resend failed", error);

    try {
      const url = new URL(request.url);
      const bookingId = String(url.searchParams.get("booking_id") || "").trim();
      if (bookingId) {
        await env.DB
          .prepare(
            "UPDATE bookings SET confirmation_email_error=?,updated_at=CURRENT_TIMESTAMP WHERE booking_id=?"
          )
          .bind(String(error?.message || error).slice(0, 1000), bookingId)
          .run();
      }
    } catch (_) {}

    return json(
      { error: error?.message || "Confirmation email resend failed." },
      500
    );
  }
}

async function handleCancellation(request, env) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  if (!env.DB || !env.STRIPE_SECRET_KEY) {
    return json(
      { error: "Cancellation service is not configured." },
      500,
      corsHeaders
    );
  }

  try {
    await ensureBookingColumns(env);

    const url = new URL(request.url);
    const token = String(url.searchParams.get("token") || "").trim();

    if (!token || token.length < 32) {
      return json(
        { error: "Ungültiger Stornierungslink." },
        400,
        corsHeaders
      );
    }

    const booking = await env.DB
      .prepare("SELECT * FROM bookings WHERE cancellation_token=? LIMIT 1")
      .bind(token)
      .first();

    if (!booking) {
      return json(
        { error: "Buchung nicht gefunden." },
        404,
        corsHeaders
      );
    }

    if (request.method === "GET") {
      return json(
        buildCancellationView(booking),
        200,
        corsHeaders
      );
    }

    if (request.method !== "POST") {
      return json(
        { error: "Method Not Allowed" },
        405,
        corsHeaders
      );
    }

    if (String(booking.status || "") === "cancelled") {
      return json(
        {
          success: true,
          status: "cancelled",
          message: "Diese Buchung wurde bereits storniert."
        },
        200,
        corsHeaders
      );
    }

    if (
      String(booking.status || "") !== "confirmed" ||
      String(booking.payment_status || "") !== "paid"
    ) {
      return json(
        {
          error: "Diese Buchung kann nicht mehr storniert werden."
        },
        409,
        corsHeaders
      );
    }

    const cancellation = getCancellationState(booking);

    if (!cancellation.allowed) {
      return json(
        {
          error: "Die kostenlose Stornierungsfrist ist abgelaufen.",
          cancellation_deadline: cancellation.deadline
        },
        409,
        corsHeaders
      );
    }

    const lock = await env.DB
      .prepare(
        "UPDATE bookings SET status='cancellation_processing', updated_at=CURRENT_TIMESTAMP WHERE cancellation_token=? AND status='confirmed' AND payment_status='paid'"
      )
      .bind(token)
      .run();

    if (Number(lock.meta?.changes || 0) !== 1) {
      return json(
        {
          error: "Die Stornierung wird bereits bearbeitet."
        },
        409,
        corsHeaders
      );
    }

    try {
      const refund = await stripeRefundPaymentIntent(
        env,
        booking.payment_intent_id,
        token
      );

      await env.DB
        .prepare(
          "UPDATE bookings SET status='cancelled', payment_status='refunded', cancelled_at=CURRENT_TIMESTAMP, cancellation_refund_id=?, updated_at=CURRENT_TIMESTAMP WHERE cancellation_token=? AND status='cancellation_processing'"
        )
        .bind(refund.id, token)
        .run();

      return json(
        {
          success: true,
          status: "cancelled",
          refund_id: refund.id,
          message:
            "Deine Buchung wurde storniert. Die Rückerstattung wurde bei Stripe angestoßen."
        },
        200,
        corsHeaders
      );
    } catch (error) {
      await env.DB
        .prepare(
          "UPDATE bookings SET status='confirmed', updated_at=CURRENT_TIMESTAMP WHERE cancellation_token=? AND status='cancellation_processing'"
        )
        .bind(token)
        .run();

      throw error;
    }
  } catch (error) {
    console.error("FiiViu cancellation failed", error);

    return json(
      {
        error: error?.message || "Stornierung fehlgeschlagen."
      },
      500,
      corsHeaders
    );
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
    total_price: Number(booking.amount_cents || 0) / 100 + " " + String(booking.currency || "eur").toUpperCase(),
    status: booking.status,
    allowed: cancellation.allowed,
    cancellation_deadline: cancellation.deadline,
    cancellation_hours: CANCELLATION_HOURS,
    policy_text: cancellation.allowed
      ? "Kostenlose Stornierung bis " + CANCELLATION_HOURS + " Stunden vor Beginn."
      : "Die kostenlose Stornierungsfrist ist abgelaufen."
  };
}

function getCancellationState(booking) {
  const start = parseBookingDateTime(
    booking.booking_date,
    booking.booking_time
  );

  if (!start) {
    return {
      allowed: false,
      deadline: null
    };
  }

  const deadlineMs =
    start.getTime() - CANCELLATION_HOURS * 60 * 60 * 1000;

  return {
    allowed: Date.now() <= deadlineMs,
    deadline: new Date(deadlineMs).toISOString()
  };
}

function parseBookingDateTime(dateValue, timeValue) {
  const date = String(dateValue || "").trim();
  const time = String(timeValue || "").trim();

  let normalizedDate = date;

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(date)) {
    const parts = date.split(".");
    normalizedDate =
      parts[2] + "-" + parts[1] + "-" + parts[0];
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) ||
    !/^\d{1,2}:\d{2}$/.test(time)
  ) {
    return null;
  }

  const [hour, minute] = time
    .padStart(5, "0")
    .split(":")
    .map(Number);

  const utcGuess = Date.UTC(
    Number(normalizedDate.slice(0, 4)),
    Number(normalizedDate.slice(5, 7)) - 1,
    Number(normalizedDate.slice(8, 10)),
    hour,
    minute
  );

  return new Date(
    utcGuess -
      timeZoneOffsetMs(
        new Date(utcGuess),
        BOOKING_TIME_ZONE
      )
  );
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map(p => [p.type, p.value])
  );

  return (
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second)
    ) - date.getTime()
  );
}

async function stripeRefundPaymentIntent(
  env,
  paymentIntentId,
  token
) {
  if (!paymentIntentId) {
    throw new Error(
      "Keine Stripe PaymentIntent-ID vorhanden."
    );
  }

  const params = new URLSearchParams({
    payment_intent: String(paymentIntentId)
  });

  const response = await fetch(
  "https://api.stripe.com/v1/refunds",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": "fiiviu-cancel-" + token
    },
    body: params
  }
);

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        "Stripe-Rückerstattung fehlgeschlagen."
    );
  }

  return data;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type":
        "application/json; charset=utf-8",
      ...headers
    }
  });
}

function isHtmlResponse(response, url) {
  return (
    !url.pathname.startsWith("/api/") &&
    (response.headers.get("content-type") || "")
      .includes("text/html")
  );
}

async function injectCheckoutBridge(response) {
  const html = await response.text();

  const bridge = `<script>
(function(){
var originalFetch=window.fetch.bind(window);window.fetch=function(input,init){try{var url=typeof input==='string'?input:(input&&input.url)||'';if(url.indexOf('/api/create-payment-intent')!==-1&&init&&typeof init.body==='string'){var data=JSON.parse(init.body);var get=function(id){var el=document.getElementById(id);return el?String(el.value||'').trim():''};data.customerName=get('customer-name')||data.customerName||'';data.customerEmail=get('customer-email')||data.customerEmail||'';data.customerPhone=get('customer-phone')||data.customerPhone||'';data.bookingDate=get('booking-date')||data.bookingDate||'';data.bookingTime=(typeof selectedTourTime!=='undefined'?String(selectedTourTime||'').trim():'')||data.bookingTime||extractTime(data.experienceName||data.tourName||'');data.customerLanguage=(typeof currentLang!=='undefined'?String(currentLang||'en').slice(0,2):'en');data.experienceName=data.experienceName||data.tourName||'';var sourceName=String(data.experienceName||data.tourName||'').toLowerCase();var meeting=window.__fiiviuMeetingPoint||{};if(!meeting.name){if(/bike|cycling|pedal|fahrrad/.test(sourceName))meeting={providerName:'Urban Pedal Bucharest',name:'Piața Unirii Fountain',address:'Piața Unirii',city:'București',country:'Romania',instructions:'Please arrive 15 minutes before the start. Your guide will wait beside the main fountain with the bicycles.',arrivalMinutesBefore:15,latitude:'44.4279',longitude:'26.1025'};else if(/old town|story walk|universitate|national theatre/.test(sourceName))meeting={providerName:'FiiViu City Guides',name:'Universitate – National Theatre',address:'Piața Universității 2',city:'București',country:'Romania',instructions:'Please arrive 15 minutes before the start. Look for the FiiViu guide with a FiiViu sign near the main entrance.',arrivalMinutesBefore:15,latitude:'44.4354',longitude:'26.1027'};else if(/therme|spa|wellness|vip/.test(sourceName))meeting={providerName:'FiiViu Travel Experiences',name:'Therme Bucharest – Main Entrance',address:'Calea București 1K',city:'Balotești',country:'Romania',instructions:'Please arrive 20 minutes before the scheduled start. Meet the FiiViu representative at the main entrance.',arrivalMinutesBefore:20,latitude:'44.6568',longitude:'26.0774'};else if(/night out|nightlife|club|after dark/.test(sourceName))meeting={providerName:'Bucharest After Dark',name:'Manuc’s Inn – Main Courtyard',address:'Strada Franceză 62',city:'București',country:'Romania',instructions:'Please arrive 15 minutes before the start. Meet your guide in the main courtyard near the entrance.',arrivalMinutesBefore:15,latitude:'44.4305',longitude:'26.1014'};else if(/kart|grand prix/.test(sourceName))meeting={providerName:'Bucharest Karting Club',name:'Karting Arena – Reception',address:'Șoseaua Pipera 4',city:'București',country:'Romania',instructions:'Please arrive 20 minutes before the start for registration and safety briefing. Bring your booking ID.',arrivalMinutesBefore:20,latitude:'44.4900',longitude:'26.1200'};}data.providerName=meeting.providerName||data.providerName||'';data.meetingPointName=meeting.name||data.meetingPointName||'';data.meetingAddress=meeting.address||data.meetingAddress||'';data.meetingCity=meeting.city||data.meetingCity||'';data.meetingCountry=meeting.country||data.meetingCountry||'';data.meetingInstructions=meeting.instructions||data.meetingInstructions||'';data.arrivalMinutesBefore=meeting.arrivalMinutesBefore??data.arrivalMinutesBefore??'';data.meetingLatitude=meeting.latitude||data.meetingLatitude||'';data.meetingLongitude=meeting.longitude||data.meetingLongitude||'';data.providerConnectAccountId=window.__fiiviuProviderConnectAccountId||data.providerConnectAccountId||'';init.body=JSON.stringify(data)}}catch(_){}return originalFetch(input,init)};function extractTime(value){var match=String(value||'').match(/\b([01]?\d|2[0-3]):[0-5]\d\b/);return match?match[0]:''}try{if(window.emailjs&&typeof window.emailjs.send==='function'){var originalSend=window.emailjs.send.bind(window.emailjs);window.emailjs.send=function(serviceId,templateId,params,options){if(serviceId==='${EMAILJS_SERVICE_ID}'&&templateId==='${EMAILJS_TEMPLATE_ID}')return Promise.resolve({status:200,text:'Server-side confirmation queued'});return originalSend(serviceId,templateId,params,options)}}}catch(_){} })();
</script>`;

  const marker = "</body>";

  const output = html.includes(marker)
    ? html.replace(marker, bridge + marker)
    : html + bridge;

  const headers = new Headers(response.headers);

  headers.delete("content-length");
  headers.set("cache-control", "no-cache");

  return new Response(output, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function updatePaymentIntentMetadata(
  env,
  paymentIntentId,
  values
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (
      value !== null &&
      value !== undefined &&
      String(value) !== ""
    ) {
      params.set(
        `metadata[${key}]`,
        String(value).slice(0, 500)
      );
    }
  }

  if (!params.size) return;

  const response = await fetch(
    `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type":
          "application/x-www-form-urlencoded"
      },
      body: params
    }
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));

    throw new Error(
      data?.error?.message ||
        "Stripe PaymentIntent metadata update failed"
    );
  }
}

async function verifyStripeWebhookSignature(body, header, secret) {
  try {
    const parts = String(header || "")
      .split(",")
      .map(part => part.trim())
      .filter(Boolean);

    let timestamp = "";
    const signatures = [];

    for (const part of parts) {
      const separator = part.indexOf("=");
      if (separator <= 0) continue;

      const key = part.slice(0, separator);
      const value = part.slice(separator + 1);

      if (key === "t") timestamp = value;
      if (key === "v1" && /^[a-f0-9]{64}$/i.test(value)) {
        signatures.push(value.toLowerCase());
      }
    }

    if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) {
      return false;
    }

    const timestampSeconds = Number(timestamp);
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (
      !Number.isFinite(timestampSeconds) ||
      Math.abs(nowSeconds - timestampSeconds) > 300
    ) {
      return false;
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signedPayload = timestamp + "." + body;
    const digest = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(signedPayload)
    );

    const expected = Array.from(new Uint8Array(digest))
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");

    return signatures.some(signature => timingSafeEqualHex(signature, expected));
  } catch (error) {
    console.error("FiiViu Stripe webhook verification error", error);
    return false;
  }
}

function timingSafeEqualHex(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string" ||
    a.length !== b.length ||
    a.length === 0
  ) {
    return false;
  }

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return difference === 0;
}

async function finalizePaidBooking(
  env,
  paymentIntent
) {
  if (
    !env.DB ||
    !env.STRIPE_SECRET_KEY ||
    !paymentIntent?.id
  ) {
    return;
  }

  try {
    await ensureBookingColumns(env);

    const pi = await stripeGet(
      env,
      `/v1/payment_intents/${encodeURIComponent(
        paymentIntent.id
      )}?expand[]=payment_method`
    );

    const metadata = pi.metadata || {};

    const billing =
      pi.payment_method &&
      typeof pi.payment_method === "object"
        ? pi.payment_method.billing_details
        : null;

    const bookingId = String(
      metadata.booking_id ||
        `FV-${paymentIntent.id
          .slice(-8)
          .toUpperCase()}`
    ).trim();

    const email = String(
      metadata.customer_email ||
        pi.receipt_email ||
        billing?.email ||
        ""
    )
      .trim()
      .toLowerCase();

    const name = String(
      metadata.customer_name ||
        billing?.name ||
        ""
    ).trim();

    const language = normalizeLanguage(
      metadata.customer_language
    );

    const guests = Math.max(
      1,
      Number(metadata.guests || 1)
    );

    const amountCents = Number(
      pi.amount_received || pi.amount || 0
    );

    const currency = String(
      pi.currency || "eur"
    ).toLowerCase();

    const experienceName = String(
      metadata.experience_name ||
        metadata.tour_name ||
        "Experience"
    ).trim();

    const fallback =
      resolveMeetingDefaults(experienceName);

    const meeting = {
      name:
        clean(metadata.meeting_point_name) ||
        fallback.name,
      address:
        clean(metadata.meeting_address) ||
        fallback.address,
      city:
        clean(metadata.meeting_city) ||
        fallback.city,
      country:
        clean(metadata.meeting_country) ||
        fallback.country,
      instructions:
        clean(metadata.meeting_instructions) ||
        fallback.instructions,
      arrivalMinutes:
        integerOrNull(
          metadata.arrival_minutes_before
        ) ?? fallback.arrivalMinutes,
      latitude:
        clean(metadata.meeting_latitude) ||
        fallback.latitude,
      longitude:
        clean(metadata.meeting_longitude) ||
        fallback.longitude
    };

    const cancellationToken =
      crypto.randomUUID().replace(/-/g, "") +
      crypto.randomUUID().replace(/-/g, "");

    await env.DB
      .prepare(
        `INSERT INTO bookings (
          booking_id,
          payment_intent_id,
          status,
          payment_status,
          customer_name,
          customer_email,
          customer_phone,
          customer_language,
          experience_name,
          booking_date,
          booking_time,
          guests,
          amount_cents,
          currency,
          meeting_point_name,
          meeting_address,
          meeting_city,
          meeting_country,
          meeting_instructions,
          arrival_minutes_before,
          meeting_latitude,
          meeting_longitude,
          partner_ref,
          provider_name,
          provider_connect_account_id,
          cancellation_token,
          created_at,
          updated_at
        ) VALUES (
          ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
        )
        ON CONFLICT(payment_intent_id) DO UPDATE SET
          booking_id=excluded.booking_id,
          status='confirmed',
          payment_status='paid',
          customer_name=excluded.customer_name,
          customer_email=excluded.customer_email,
          customer_phone=excluded.customer_phone,
          customer_language=excluded.customer_language,
          experience_name=excluded.experience_name,
          booking_date=excluded.booking_date,
          booking_time=excluded.booking_time,
          guests=excluded.guests,
          amount_cents=excluded.amount_cents,
          currency=excluded.currency,
          meeting_point_name=excluded.meeting_point_name,
          meeting_address=excluded.meeting_address,
          meeting_city=excluded.meeting_city,
          meeting_country=excluded.meeting_country,
          meeting_instructions=excluded.meeting_instructions,
          arrival_minutes_before=excluded.arrival_minutes_before,
          meeting_latitude=excluded.meeting_latitude,
          meeting_longitude=excluded.meeting_longitude,
          partner_ref=excluded.partner_ref,
          provider_name=excluded.provider_name,
          provider_connect_account_id=excluded.provider_connect_account_id,
          cancellation_token=COALESCE(
            bookings.cancellation_token,
            excluded.cancellation_token
          ),
          updated_at=CURRENT_TIMESTAMP`
      )
      .bind(
        bookingId,
        paymentIntent.id,
        "confirmed",
        "paid",
        name || "Customer",
        email,
        clean(metadata.customer_phone),
        language,
        experienceName,
        clean(metadata.booking_date),
        clean(metadata.booking_time),
        guests,
        amountCents,
        currency,
        meeting.name,
        meeting.address,
        meeting.city,
        meeting.country,
        meeting.instructions,
        meeting.arrivalMinutes,
        meeting.latitude,
        meeting.longitude,
        clean(metadata.partner_ref),
        clean(metadata.provider_name) ||
          fallback.providerName,
        clean(metadata.provider_connect_account_id),
        cancellationToken
      )
      .run();

    const booking = await env.DB
      .prepare(
        "SELECT * FROM bookings WHERE payment_intent_id=? LIMIT 1"
      )
      .bind(paymentIntent.id)
      .first();

    if (!booking || booking.confirmation_email_sent_at) {
      return;
    }

    if (!booking.customer_email) {
      await env.DB
        .prepare(
          "UPDATE bookings SET confirmation_email_error=?,updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id=?"
        )
        .bind(
          "Keine Kunden-E-Mail für Bestätigungsversand vorhanden.",
          paymentIntent.id
        )
        .run();

      return;
    }

    await sendConfirmationWithRetry(env, booking);

    await env.DB
      .prepare(
        "UPDATE bookings SET confirmation_email_sent_at=CURRENT_TIMESTAMP,confirmation_email_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id=? AND confirmation_email_sent_at IS NULL"
      )
      .bind(paymentIntent.id)
      .run();
  } catch (error) {
    console.error(
      "FiiViu paid booking finalization failed",
      error
    );

    try {
      await env.DB
        .prepare(
          "UPDATE bookings SET confirmation_email_error=?,updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id=?"
        )
        .bind(
          String(error?.message || error).slice(
            0,
            1000
          ),
          paymentIntent?.id
        )
        .run();
    } catch (_) {}
  }
}

async function sendConfirmationWithRetry(
  env,
  booking
) {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await sendEmailJsConfirmation(env, booking);
      return;
    } catch (error) {
      lastError = error;

      if (attempt < 2) {
        await new Promise(resolve =>
          setTimeout(resolve, 750 * (attempt + 1))
        );
      }
    }
  }

  throw (
    lastError ||
    new Error("EmailJS confirmation failed")
  );
}

async function sendEmailJsConfirmation(
  env,
  booking
) {
  const serviceId = String(
    env.EMAILJS_SERVICE_ID ||
      EMAILJS_SERVICE_ID
  ).trim();

  const templateId = String(
    env.EMAILJS_TEMPLATE_ID ||
      EMAILJS_TEMPLATE_ID
  ).trim();

  const publicKey = String(
    env.EMAILJS_PUBLIC_KEY ||
      EMAILJS_PUBLIC_KEY
  ).trim();

  const privateKey = String(
    env.EMAILJS_PRIVATE_KEY || ""
  ).trim();

  const language = normalizeLanguage(
    booking.customer_language
  );

  if (!privateKey) {
    throw new Error(
      "EMAILJS_PRIVATE_KEY is not configured"
    );
  }

  const subject =
    language === "de"
      ? `Buchung bestätigt – ${booking.experience_name}`
      : language === "ro"
        ? `Rezervare confirmată – ${booking.experience_name}`
        : `Booking confirmed – ${booking.experience_name}`;

  const appUrl = String(
    env.PUBLIC_APP_URL || DEFAULT_APP_URL
  ).replace(/\/$/, "");

  const cancellationUrl =
    booking.cancellation_token
      ? `${appUrl}/cancel.html?token=${encodeURIComponent(
          booking.cancellation_token
        )}`
      : "";

  const bookingTime =
    clean(booking.booking_time) ||
    extractTime(booking.experience_name) ||
    "";

  const provider =
    booking.provider_name || "FiiViu";

  const meetingPoint =
    booking.meeting_point_name || "";

  const address =
    booking.meeting_address || "";

  const arrival =
    booking.arrival_minutes_before == null
      ? ""
      : String(
          booking.arrival_minutes_before
        );

  const cancellationHours = String(
    CANCELLATION_HOURS
  );

  const mapLink = makeMeetingMapLink(
    booking
  );

  const params = {
    user_name: booking.customer_name,
    user_email: booking.customer_email,
    tour_title: booking.experience_name,
    booking_date: booking.booking_date || "",
    booking_time: bookingTime,
    guests: String(booking.guests || 1),
    total_price: `${(
      Number(booking.amount_cents || 0) / 100
    ).toFixed(2)} ${String(
      booking.currency || "eur"
    ).toUpperCase()}`,
    booking_id: booking.booking_id,
    customer_language: language,
    subject,
    provider_name: provider,
    meeting_point_name: meetingPoint,
    meeting_address: address,
    meeting_city: booking.meeting_city || "",
    meeting_country:
      booking.meeting_country || "",
    meeting_instructions:
      booking.meeting_instructions || "",
    arrival_minutes_before: arrival,
    meeting_latitude:
      booking.meeting_latitude || "",
    meeting_longitude:
      booking.meeting_longitude || "",
    meeting_map_link: mapLink,
    cancellation_url: cancellationUrl,
    cancellation_hours: cancellationHours,
    provider,
    meeting_point: meetingPoint,
    address,
    address_city: booking.meeting_city || "",
    address_country:
      booking.meeting_country || "",
    arrival_minutes: arrival,
    meeting_instructions:
      booking.meeting_instructions || "",
    map_link: mapLink,
    cancel_url: cancellationUrl,
    cancel_link: cancellationUrl,
    bookingTime: bookingTime,
    start_time: bookingTime,
    startTime: bookingTime,
    start: bookingTime,
    time: bookingTime,
    providerName: provider,
    organizer: provider,
    organiser: provider,
    meetingPoint: meetingPoint,
    meetingpoint: meetingPoint,
    location: meetingPoint,
    meetingPointName: meetingPoint,
    addressLine: address,
    arrival: arrival,
    arrivalMinutes: arrival,
    arrival_minutes: arrival,
    cancelHours: cancellationHours,
    cancellationHours: cancellationHours,
    cancel_hours: cancellationHours,
    cancelHoursBefore: cancellationHours,
    refund_hours: cancellationHours,
    mapLink: mapLink
  };

  const response = await fetch(
    "https://api.emailjs.com/api/v1.0/email/send",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        accessToken: privateKey,
        template_params: params
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `EmailJS ${response.status}: ${text.slice(
        0,
        500
      )}`
    );
  }
}

function resolveMeetingDefaults(experienceName) {
  const source = String(
    experienceName || ""
  ).toLowerCase();

  if (
    /old town|story walk|universitate|national theatre/.test(
      source
    )
  ) {
    return {
      providerName: "FiiViu City Guides",
      name: "Universitate – National Theatre",
      address: "Piața Universității 2",
      city: "București",
      country: "Romania",
      instructions:
        "Please arrive 15 minutes before the start. Look for the FiiViu guide with a FiiViu sign near the main entrance.",
      arrivalMinutes: 15,
      latitude: "44.4354",
      longitude: "26.1027"
    };
  }

  if (
    /bike|cycling|pedal|fahrrad/.test(source)
  ) {
    return {
      providerName: "Urban Pedal Bucharest",
      name: "Piața Unirii Fountain",
      address: "Piața Unirii",
      city: "București",
      country: "Romania",
      instructions:
        "Please arrive 15 minutes before the start. Your guide will wait beside the main fountain with the bicycles.",
      arrivalMinutes: 15,
      latitude: "44.4279",
      longitude: "26.1025"
    };
  }

  if (
    /therme|spa|wellness|vip/.test(source)
  ) {
    return {
      providerName: "FiiViu Travel Experiences",
      name: "Therme Bucharest – Main Entrance",
      address: "Calea București 1K",
      city: "Balotești",
      country: "Romania",
      instructions:
        "Please arrive 20 minutes before the scheduled start. Meet the FiiViu representative at the main entrance.",
      arrivalMinutes: 20,
      latitude: "44.6568",
      longitude: "26.0774"
    };
  }

  if (
    /night out|nightlife|club|after dark/.test(
      source
    )
  ) {
    return {
      providerName: "Bucharest After Dark",
      name: "Manuc’s Inn – Main Courtyard",
      address: "Strada Franceză 62",
      city: "București",
      country: "Romania",
      instructions:
        "Please arrive 15 minutes before the start. Meet your guide in the main courtyard near the entrance.",
      arrivalMinutes: 15,
      latitude: "44.4305",
      longitude: "26.1014"
    };
  }

  if (/kart|grand prix/.test(source)) {
    return {
      providerName: "Bucharest Karting Club",
      name: "Karting Arena – Reception",
      address: "Șoseaua Pipera 4",
      city: "București",
      country: "Romania",
      instructions:
        "Please arrive 20 minutes before the start for registration and safety briefing. Bring your booking ID.",
      arrivalMinutes: 20,
      latitude: "44.4900",
      longitude: "26.1200"
    };
  }

  return {
    providerName: "FiiViu",
    name: "",
    address: "",
    city: "",
    country: "",
    instructions: "",
    arrivalMinutes: null,
    latitude: "",
    longitude: ""
  };
}

function makeMeetingMapLink(booking) {
  const latitude = clean(
    booking.meeting_latitude
  );

  const longitude = clean(
    booking.meeting_longitude
  );

  const query =
    latitude && longitude
      ? `${latitude},${longitude}`
      : [
          booking.meeting_point_name,
          booking.meeting_address,
          booking.meeting_city,
          booking.meeting_country
        ]
          .map(clean)
          .filter(Boolean)
          .join(", ");

  return query
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        query
      )}`
    : "";
}

function extractTime(value) {
  const match = String(value || "").match(
    /\b([01]?\d|2[0-3]):[0-5]\d\b/
  );

  return match ? match[0] : "";
}

async function stripeGet(env, path) {
  const response = await fetch(
    `https://api.stripe.com${path}`,
    {
      headers: {
        Authorization:
          `Bearer ${env.STRIPE_SECRET_KEY}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        "Stripe request failed"
    );
  }

  return data;
}

async function ensureBookingColumns(env) {
  await env.DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id TEXT NOT NULL UNIQUE,
        payment_intent_id TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        payment_status TEXT NOT NULL DEFAULT 'pending',
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        customer_phone TEXT,
        customer_language TEXT NOT NULL DEFAULT 'en',
        experience_name TEXT NOT NULL,
        booking_date TEXT,
        booking_time TEXT,
        guests INTEGER NOT NULL DEFAULT 1,
        amount_cents INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'eur',
        meeting_point_name TEXT,
        meeting_address TEXT,
        meeting_city TEXT,
        meeting_country TEXT,
        meeting_instructions TEXT,
        arrival_minutes_before INTEGER,
        meeting_latitude TEXT,
        meeting_longitude TEXT,
        partner_ref TEXT,
        provider_name TEXT,
        provider_connect_account_id TEXT,
        confirmation_email_sent_at TEXT,
        confirmation_email_error TEXT,
        cancellation_token TEXT,
        cancelled_at TEXT,
        cancellation_refund_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    )
    .run();

  for (const statement of [
    "ALTER TABLE bookings ADD COLUMN provider_name TEXT",
    "ALTER TABLE bookings ADD COLUMN provider_connect_account_id TEXT",
    "ALTER TABLE bookings ADD COLUMN confirmation_email_error TEXT",
    "ALTER TABLE bookings ADD COLUMN cancellation_token TEXT",
    "ALTER TABLE bookings ADD COLUMN cancelled_at TEXT",
    "ALTER TABLE bookings ADD COLUMN cancellation_refund_id TEXT"
  ]) {
    try {
      await env.DB.prepare(statement).run();
    } catch (_) {}
  }

  await env.DB
    .prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_cancellation_token ON bookings(cancellation_token)"
    )
    .run();
}

function normalizeLanguage(value) {
  const language = String(value || "en")
    .toLowerCase()
    .slice(0, 2);

  return ["de", "en", "ro"].includes(language)
    ? language
    : "en";
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function integerOrNull(value) {
  const number = Number(value);

  return Number.isInteger(number) && number >= 0
    ? number
    : null;
}
