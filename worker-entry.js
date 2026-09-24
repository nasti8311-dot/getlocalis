import legacyWorker from "./worker.js";
import {hashProviderPassword,hashProviderSession,providerRandomHex,ensureProviderAuthTables,createProviderSession,providerSessionCookie,authenticateProviderSession,providerSessionFromRequest} from "./provider-auth.js";
// FiiViu deployment sync: EmailJS private-key sender

const EMAILJS_SERVICE_ID = "service_0fqphlf";
const EMAILJS_TEMPLATE_ID = "template_x2mmo2p";
const EMAILJS_PUBLIC_KEY = "Q_tJ6LhJkeMcVE0U4";
const DEFAULT_APP_URL = "https://fiiviu.ro";
const CANCELLATION_HOURS = 24;
const BOOKING_TIME_ZONE = "Europe/Bucharest";

export { authenticateProviderSession, providerSessionFromRequest, getCancellationState, parseBookingDateTime };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/cancel-booking") return handleCancellation(request, env);

    // Admin UI is served from Pages and calls this Worker cross-origin.
    if (
      request.method === "OPTIONS" &&
      (url.pathname === "/api/admin/providers" ||
        url.pathname === "/api/admin/provider-payout" ||
        url.pathname === "/api/admin/resend-confirmation" ||
        url.pathname === "/api/admin/offers" ||
        url.pathname === "/api/admin/translate-offers")
    ) {
      const origin = String(request.headers.get("Origin") || "").trim();
      const allowedOrigins = new Set([
        String(env.PUBLIC_APP_URL || "https://fiiviu.ro").replace(/\/$/, ""),
        "https://fiiviu.ro",
        "https://www.fiiviu.ro",
      ]);
      const headers = {
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Vary": "Origin",
      };
      if (origin && allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
      return new Response(null, { status: 204, headers });
    }

    if (request.method === "POST" && url.pathname === "/api/admin/resend-confirmation") {
      return handleAdminResendConfirmation(request, env);
    }

    if (url.pathname === "/api/admin/offers") {
      return legacyWorker.fetch(request, env, ctx);
    }

    if (url.pathname === "/api/admin/providers") {
      return handleAdminProviders(request, env);
    }

    if (url.pathname === "/api/admin/provider-password") {
      return handleAdminProviderPassword(request, env);
    }

    if (url.pathname === "/api/provider-login") return handleProviderLogin(request, env);
    if (url.pathname === "/api/provider-session") return handleProviderSession(request, env);
    if (url.pathname === "/api/provider-logout") return handleProviderLogout(request, env);
    if (url.pathname === "/api/provider-test-booking") return handleProviderTestBooking(request, env);
    if (url.pathname === "/api/provider/experiences") return handleProviderExperiences(request, env);
    if (url.pathname === "/api/provider/overview") return handleProviderOverview(request, env);
    if (url.pathname === "/api/provider/connect-status") return handleProviderConnectStatus(request, env);
    if (url.pathname === "/api/provider/connect-onboarding") return handleProviderConnectOnboarding(request, env);

    if (url.pathname === "/api/admin/provider-payout") {
      return handleAdminProviderPayout(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/finalize-booking") {
      try {
        const body = await request.json();
        const paymentIntentId = String(body?.paymentIntentId || body?.payment_intent || body?.id || "").trim();
        const clientSecret = String(body?.clientSecret || body?.client_secret || "").trim();

        if (!paymentIntentId || !clientSecret) {
          return json({ error: "paymentIntentId and clientSecret are required." }, 400);
        }

        if (!env.DB || !env.STRIPE_SECRET_KEY) {
          return json({ error: "Booking finalization is not configured." }, 500);
        }

        const paymentIntent = await stripeGet(
          env,
          "/v1/payment_intents/" + encodeURIComponent(paymentIntentId)
        );

        if (paymentIntent?.status !== "succeeded") {
          return json({
            error: "Payment is not completed.",
            status: paymentIntent?.status || "unknown"
          }, 409);
        }

        if (String(paymentIntent?.client_secret || "") !== clientSecret) {
          return json({ error: "Payment confirmation credentials do not match." }, 403);
        }

        await finalizePaidBooking(env, paymentIntent);

        const booking = await env.DB
          .prepare("SELECT booking_id,confirmation_email_sent_at,confirmation_email_error FROM bookings WHERE payment_intent_id=? LIMIT 1")
          .bind(paymentIntentId)
          .first();

        if (!booking) {
          return json({ error: "Paid booking could not be finalized." }, 500);
        }

        return json({
          success: true,
          booking_id: booking.booking_id,
          confirmation_email_sent: !!booking.confirmation_email_sent_at,
          confirmation_email_error: booking.confirmation_email_error || ""
        });
      } catch (error) {
        console.error("FiiViu direct booking finalization failed", error);
        return json({ error: error?.message || "Booking finalization failed." }, 500);
      }
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

        if (!env.STRIPE_SECRET_KEY) {
          return json({error:"Stripe secret not configured"},500);
        }

        const amount=Number(data.amount);
        const currency=String(data.currency||"eur").toLowerCase();
        if (!Number.isInteger(amount) || amount < 50) {
          return json({error:"Invalid amount"},400);
        }

        const params=new URLSearchParams();
        params.set("amount",String(amount));
        params.set("currency",currency);
        params.set("metadata[booking_id]",String(data.bookingId||""));
        params.set("metadata[tour_name]",String(data.tourName||data.experienceName||""));
        params.set("metadata[experience_id]",String(data.experienceId||""));
        params.set("metadata[guests]",String(data.guests||1));
        params.set("metadata[offer_id]",String(data.offerId||""));
        params.set("metadata[customer_name]",String(data.customerName||""));
        params.set("metadata[customer_email]",String(data.customerEmail||""));
        params.set("metadata[booking_date]",String(data.bookingDate||""));
        params.set("metadata[booking_time]",String(data.bookingTime||""));
        params.set("metadata[provider_connect_account_id]",String(data.providerConnectAccountId||""));
        params.set("automatic_payment_methods[enabled]","true");

        const stripeResponse=await fetch("https://api.stripe.com/v1/payment_intents",{
          method:"POST",
          headers:{"Authorization":"Bearer "+env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded"},
          body:params
        });
        const stripeData=await stripeResponse.json();
        if(!stripeResponse.ok){
          return json({error:stripeData?.error?.message||"Stripe error"},stripeResponse.status);
        }

        const response=json({
          clientSecret:stripeData.client_secret,
          paymentIntentId:stripeData.id,
          partnerRef:""
        },200);

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
                  provider_connect_account_id: data.providerConnectAccountId,
                  offer_id: String(data.offerId || "")
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
    tour_title: booking.experience_name || "",
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
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
  let bookingCreated = false;

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
          ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
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

    bookingCreated = true;

    const booking = await env.DB
      .prepare(
        "SELECT * FROM bookings WHERE payment_intent_id=? LIMIT 1"
      )
      .bind(paymentIntent.id)
      .first();

    await recordBookingSettlement(env, booking);

    // Notify the organizer independently from the customer confirmation.
    // A provider notification failure must never block the booking itself.
    try {
      await sendProviderBookingNotification(env, booking);
    } catch (error) {
      console.error("FiiViu provider booking notification failed", error);
    }

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

    // If the booking row itself could not be created, do not hide the
    // database/schema error behind the generic finalization message.
    if (!bookingCreated) {
      throw error;
    }
  }
}

async function sendProviderBookingNotification(env, booking) {
  if (!env.DB || !booking) return;

  const alreadySent = booking.provider_notification_email_sent_at;
  if (alreadySent) return;

  const provider = await env.DB.prepare(
    "SELECT provider_ref,name,contact_email,active FROM providers WHERE (provider_ref=? OR name=?) AND active=1 LIMIT 1"
  ).bind(
    clean(booking.partner_ref) || "",
    clean(booking.provider_name) || ""
  ).first();

  const recipient = clean(provider?.contact_email);
  if (!recipient) {
    await env.DB.prepare(
      "UPDATE bookings SET provider_notification_email_error=?,updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id=?"
    ).bind(
      "Keine Veranstalter-E-Mail hinterlegt.",
      booking.payment_intent_id
    ).run();
    return;
  }

  const safe = value => String(value ?? "").replace(/[&<>"]/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"
  }[c]));
  const amount = (Number(booking.amount_cents || 0) / 100).toFixed(2) + " " + String(booking.currency || "eur").toUpperCase();
  const subject = "Neue Buchung – " + String(booking.experience_name || "FiiViu-Erlebnis");
  const text = [
    "Neue Buchung bei FiiViu",
    "",
    "Erlebnis: " + (booking.experience_name || ""),
    "Buchung: " + (booking.booking_id || ""),
    "Datum: " + (booking.booking_date || ""),
    "Uhrzeit: " + (booking.booking_time || ""),
    "Personen: " + (booking.guests || 1),
    "Gast: " + (booking.customer_name || ""),
    "E-Mail des Gastes: " + (booking.customer_email || ""),
    "Telefon: " + (booking.customer_phone || ""),
    "Umsatz: " + amount,
    "",
    "Treffpunkt: " + (booking.meeting_point_name || ""),
    "Adresse: " + [booking.meeting_address, booking.meeting_city, booking.meeting_country].filter(Boolean).join(", "),
    "",
    "FiiViu"
  ].join("\n");

  const html = "<h2>Neue Buchung bei FiiViu</h2>" +
    "<p><strong>Erlebnis:</strong> " + safe(booking.experience_name) + "<br>" +
    "<strong>Buchung:</strong> " + safe(booking.booking_id) + "<br>" +
    "<strong>Datum:</strong> " + safe(booking.booking_date) + "<br>" +
    "<strong>Uhrzeit:</strong> " + safe(booking.booking_time) + "<br>" +
    "<strong>Personen:</strong> " + safe(booking.guests) + "<br>" +
    "<strong>Umsatz:</strong> " + safe(amount) + "</p>" +
    "<p><strong>Gast:</strong> " + safe(booking.customer_name) + "<br>" +
    "<strong>E-Mail:</strong> " + safe(booking.customer_email) + "<br>" +
    "<strong>Telefon:</strong> " + safe(booking.customer_phone) + "</p>" +
    "<p><strong>Treffpunkt:</strong> " + safe(booking.meeting_point_name) + "<br>" +
    "<strong>Adresse:</strong> " + safe([booking.meeting_address, booking.meeting_city, booking.meeting_country].filter(Boolean).join(", ")) + "</p>";

  if (!env.RESEND_API_KEY) {
    await env.DB.prepare(
      "UPDATE bookings SET provider_notification_email_error=?,updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id=?"
    ).bind("RESEND_API_KEY ist nicht konfiguriert.", booking.payment_intent_id).run();
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "FiiViu <noreply@fiiviu.ro>",
      to: [recipient],
      subject,
      html,
      text
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(result?.message || result?.error || ("Resend HTTP " + response.status)).slice(0, 1000);
    await env.DB.prepare(
      "UPDATE bookings SET provider_notification_email_error=?,updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id=?"
    ).bind(message, booking.payment_intent_id).run();
    throw new Error(message);
  }

  await env.DB.prepare(
    "UPDATE bookings SET provider_notification_email_sent_at=CURRENT_TIMESTAMP,provider_notification_email_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id=? AND provider_notification_email_sent_at IS NULL"
  ).bind(booking.payment_intent_id).run();
}

async function sendConfirmationWithRetry(
  env,
  booking
) {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Customer confirmations use the existing EmailJS template so the
      // branded FiiViu HTML design is preserved. Resend remains a fallback.
      if (String(env.EMAILJS_PRIVATE_KEY || "").trim()) {
        await sendEmailJsConfirmation(env, booking);
      } else if (String(env.RESEND_API_KEY || "").trim()) {
        await sendResendConfirmation(env, booking);
      } else {
        throw new Error("Kein E-Mail-Versand ist konfiguriert.");
      }
      return;
    } catch (error) {
      lastError = error;

      // If EmailJS is configured but unavailable, fall back to Resend before
      // retrying. This keeps confirmations deliverable without losing the
      // preferred branded template.
      if (
        String(env.RESEND_API_KEY || "").trim() &&
        String(env.EMAILJS_PRIVATE_KEY || "").trim()
      ) {
        try {
          await sendResendConfirmation(env, booking);
          return;
        } catch (fallbackError) {
          lastError = fallbackError;
        }
      }

      if (attempt < 2) {
        await new Promise(resolve =>
          setTimeout(resolve, 750 * (attempt + 1))
        );
      }
    }
  }

  throw lastError || new Error("Confirmation email failed");
}

async function sendResendConfirmation(env, booking) {
  const recipient = clean(booking.customer_email);
  if (!recipient) throw new Error("Keine Kunden-E-Mail-Adresse vorhanden.");

  const language = normalizeLanguage(booking.customer_language);
  const experience = String(booking.experience_name || "FiiViu Erlebnis");
  const bookingDate = String(booking.booking_date || "");
  const bookingTime = clean(booking.booking_time) || extractTime(experience) || "";
  const guests = String(booking.guests || 1);
  const total = (Number(booking.amount_cents || 0) / 100).toFixed(2) + " " + String(booking.currency || "eur").toUpperCase();
  const bookingId = String(booking.booking_id || "");
  const provider = String(booking.provider_name || "FiiViu");
  const meetingPoint = String(booking.meeting_point_name || "");
  const address = String(booking.meeting_address || "");
  const cancellationHours = String(CANCELLATION_HOURS);
  const appUrl = String(env.PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/$/, "");
  const cancellationUrl = booking.cancellation_token
    ? appUrl + "/cancel.html?token=" + encodeURIComponent(booking.cancellation_token)
    : "";

  const subject = language === "de"
    ? "Buchung bestätigt – " + experience
    : language === "ro"
      ? "Rezervare confirmată – " + experience
      : "Booking confirmed – " + experience;

  const greeting = language === "de" ? "Hallo" : language === "ro" ? "Bună" : "Hello";
  const labels = language === "de"
    ? {confirmed:"Buchung bestätigt",date:"Datum",time:"Beginn",guests:"Personen",total:"Gesamtpreis",id:"Buchungs-ID",meeting:"Treffpunkt",address:"Adresse",provider:"Angeboten von",cancel:"Buchung stornieren",policy:"Kostenlose Stornierung bis " + cancellationHours + " Stunden vor Beginn."}
    : language === "ro"
      ? {confirmed:"Rezervare confirmată",date:"Data",time:"Ora",guests:"Persoane",total:"Preț total",id:"ID rezervare",meeting:"Punct de întâlnire",address:"Adresă",provider:"Oferit de",cancel:"Anulează rezervarea",policy:"Anulare gratuită până la " + cancellationHours + " ore înainte de începere."}
      : {confirmed:"Booking confirmed",date:"Date",time:"Start time",guests:"Guests",total:"Total price",id:"Booking ID",meeting:"Meeting point",address:"Address",provider:"Provided by",cancel:"Cancel booking",policy:"Free cancellation up to " + cancellationHours + " hours before the start."};

  const text = [
    greeting + " " + String(booking.customer_name || "") + ",",
    "",
    labels.confirmed,
    "",
    experience,
    labels.date + ": " + bookingDate,
    labels.time + ": " + bookingTime,
    labels.guests + ": " + guests,
    labels.total + ": " + total,
    labels.id + ": " + bookingId,
    "",
    labels.provider + ": " + provider,
    labels.meeting + ": " + meetingPoint,
    labels.address + ": " + address,
    "",
    cancellationUrl ? labels.cancel + ": " + cancellationUrl : "",
    labels.policy,
    "",
    "FiiViu"
  ].filter(Boolean).join("\\n");

  const html = text.split("\\n").map(line => line ? '<p style="margin:0 0 8px">' + String(line).replace(/[&<>]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[ch])) + "</p>" : "<br>").join("");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "FiiViu <noreply@fiiviu.ro>",
      to: [recipient],
      subject,
      html,
      text
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(result?.message || result?.error || ("Resend HTTP " + response.status)).slice(0, 1000));
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

  const localizedOffer = await getLocalizedEmailOffer(env, booking, language);
  const localizedTitle = localizedOffer?.title || booking.experience_name || "";
  const meetingPoint =
    localizedOffer?.meetingPoint || booking.meeting_point_name || "";

  const address =
    booking.meeting_address || "";

  const localizedInstructions =
    localizedOffer?.instructions || booking.meeting_instructions || "";

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
    mail_language: language,
    mail_greeting: language === "de" ? "Hallo" : language === "ro" ? "Bună" : "Hello",
    mail_confirmation_title: language === "de" ? "Buchung bestätigt" : language === "ro" ? "Rezervare confirmată" : "Booking confirmed",
    mail_date_label: language === "de" ? "Datum" : language === "ro" ? "Data" : "Date",
    mail_time_label: language === "de" ? "Beginn" : language === "ro" ? "Ora" : "Start time",
    mail_guests_label: language === "de" ? "Personen" : language === "ro" ? "Persoane" : "Guests",
    mail_total_label: language === "de" ? "Gesamtpreis" : language === "ro" ? "Preț total" : "Total price",
    mail_booking_id_label: language === "de" ? "Buchungs-ID" : language === "ro" ? "ID rezervare" : "Booking ID",
    mail_meeting_label: language === "de" ? "Treffpunkt" : language === "ro" ? "Punct de întâlnire" : "Meeting point",
    mail_address_label: language === "de" ? "Adresse" : language === "ro" ? "Adresă" : "Address",
    mail_arrival_label: language === "de" ? "Bitte " + arrival + " Minuten vorher treffen" : language === "ro" ? "Te rugăm să ajungi cu " + arrival + " minute înainte" : "Please arrive " + arrival + " minutes before the start",
    mail_cancel_label: language === "de" ? "Buchung stornieren" : language === "ro" ? "Anulează rezervarea" : "Cancel booking",
    mail_cancel_policy: language === "de" ? "Kostenlose Stornierung bis " + cancellationHours + " Stunden vor Beginn." : language === "ro" ? "Anulare gratuită până la " + cancellationHours + " ore înainte de începere." : "Free cancellation up to " + cancellationHours + " hours before the start.",
    mail_provider_label: language === "de" ? "Angeboten von" : language === "ro" ? "Oferit de" : "Provided by",
    mail_provider_text: language === "de" ? "Dieses Erlebnis wird von " + provider + " durchgeführt." : language === "ro" ? "Această experiență este organizată de " + provider + "." : "This experience is operated by " + provider + ".",
    provider_name: provider,
    meeting_point_name: meetingPoint,
    meeting_address: address,
    meeting_city: booking.meeting_city || "",
    meeting_country:
      booking.meeting_country || "",
    meeting_instructions:
      localizedInstructions,
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
    cancelHours: cancellationHours,
    cancellationHours: cancellationHours,
    cancel_hours: cancellationHours,
    cancelHoursBefore: cancellationHours,
    refund_hours: cancellationHours,
    mapLink
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

async function getLocalizedEmailOffer(env, booking, language) {
  if (!env.DB || language === "de") {
    return {
      title: booking.experience_name || "",
      meetingPoint: booking.meeting_point_name || "",
      instructions: booking.meeting_instructions || ""
    };
  }

  try {
    const source = String(booking.experience_name || "").trim();
    let offerId = "";
    try {
      if (booking.payment_intent_id && env.STRIPE_SECRET_KEY) {
        const paymentIntent = await stripeGet(
          env,
          "/v1/payment_intents/" + encodeURIComponent(String(booking.payment_intent_id))
        );
        offerId = String(paymentIntent?.metadata?.offer_id || "").trim();
      }
    } catch (_) {}

    const row = offerId
      ? await env.DB.prepare(
          "SELECT title,title_en,title_ro,meeting_point_name,meeting_point_name_en,meeting_point_name_ro,meeting_instructions,meeting_instructions_en,meeting_instructions_ro FROM offers WHERE id=? LIMIT 1"
        ).bind(Number(offerId)).first()
      : await env.DB.prepare(
          "SELECT title,title_en,title_ro,meeting_point_name,meeting_point_name_en,meeting_point_name_ro,meeting_instructions,meeting_instructions_en,meeting_instructions_ro FROM offers WHERE title=? OR title_en=? OR title_ro=? LIMIT 1"
        ).bind(source, source, source).first();

    if (!row) return {
      title: source,
      meetingPoint: booking.meeting_point_name || "",
      instructions: booking.meeting_instructions || ""
    };

    return {
      title: language === "ro"
        ? (row.title_ro || row.title_en || row.title)
        : (row.title_en || row.title_ro || row.title),
      meetingPoint: language === "ro"
        ? (row.meeting_point_name_ro || row.meeting_point_name_en || row.meeting_point_name)
        : (row.meeting_point_name_en || row.meeting_point_name_ro || row.meeting_point_name),
      instructions: language === "ro"
        ? (row.meeting_instructions_ro || row.meeting_instructions_en || row.meeting_instructions)
        : (row.meeting_instructions_en || row.meeting_instructions_ro || row.meeting_instructions)
    };
  } catch (error) {
    console.error("FiiViu localized email offer lookup failed", error);
    return {
      title: booking.experience_name || "",
      meetingPoint: booking.meeting_point_name || "",
      instructions: booking.meeting_instructions || ""
    };
  }
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


async function handleAdminProviderPassword(request,env){
  if(!env.ADMIN_PAYOUT_KEY)return json({error:"Admin key is not configured."},500);
  if(!isAdminRequest(request,env))return json({error:"Unauthorized"},401);
  if(request.method!=="POST")return json({error:"Method Not Allowed"},405);
  if(!env.DB)return json({error:"D1 database not configured."},500);
  try{
    await ensureProvidersTable(env);
    await ensureProviderAuthTables(env);

    const body=await request.json();
    const providerRef=clean(body.providerRef).toUpperCase();
    const provider=await env.DB.prepare("SELECT provider_ref,name,contact_email,active FROM providers WHERE provider_ref=? LIMIT 1").bind(providerRef).first();
    if(!provider)return json({error:"Veranstalter nicht gefunden."},404);
    if(Number(provider.active)!==1)return json({error:"Dieser Veranstalter ist deaktiviert."},400);

    const email=String(clean(body.email||provider.contact_email)||"").toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"Eine gültige Veranstalter-E-Mail-Adresse ist erforderlich."},400);

    const existing=await env.DB.prepare("SELECT provider_ref FROM provider_accounts WHERE lower(email)=? AND provider_ref<>? LIMIT 1").bind(email,providerRef).first();
    if(existing)return json({error:"Diese E-Mail-Adresse ist bereits einem anderen Veranstalter zugeordnet."},409);

    const salt=providerRandomHex(16);
    const password=providerRandomHex(9);
    const hash=await hashProviderPassword(password,salt);

    await env.DB.prepare("INSERT INTO provider_accounts (provider_ref,email,password_salt,password_hash,active,updated_at) VALUES (?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(provider_ref) DO UPDATE SET email=excluded.email,password_salt=excluded.password_salt,password_hash=excluded.password_hash,active=1,updated_at=CURRENT_TIMESTAMP").bind(providerRef,email,salt,hash).run();

    // A password reset replaces the previous session. This prevents an old
    // organizer session from remaining valid after an admin reset.
    await env.DB.prepare("DELETE FROM provider_sessions WHERE provider_ref=?").bind(providerRef).run();

    const safe=(value)=>String(value??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
    const subject="Accesul dumneavoastră de organizator FiiViu";
    const text=[
      "Bun venit la FiiViu.",
      "",
      "Accesul dumneavoastră personal de organizator a fost creat.",
      "Organizator: "+provider.name,
      "E-mail: "+email,
      "Parolă temporară: "+password,
      "",
      "Autentificare: https://fiiviu.ro/provider.html",
      "",
      "FiiViu"
    ].join("\n");
    const html="<p>Bun venit la FiiViu.</p><p>Accesul dumneavoastră personal de organizator a fost creat.</p><p><strong>Organizator:</strong> "+safe(provider.name)+"<br><strong>E-mail:</strong> "+safe(email)+"<br><strong>Parolă temporară:</strong> "+safe(password)+"</p><p><a href=\"https://fiiviu.ro/provider.html\">Accesați pagina de autentificare pentru organizatori</a></p><p>FiiViu</p>";

    try{
      if(env.RESEND_API_KEY){
        const response=await fetch("https://api.resend.com/emails",{
          method:"POST",
          headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},
          body:JSON.stringify({from:"FiiViu <noreply@fiiviu.ro>",to:[email],subject,html,text})
        });
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(result?.message||result?.error||("Resend HTTP "+response.status));
      }else if(env.EMAIL){
        await env.EMAIL.send({from:"noreply@fiiviu.ro",to:email,subject,text,html});
      }else{
        throw new Error("Kein E-Mail-Versand konfiguriert.");
      }
      return json({success:true,providerRef,email,emailSent:true,message:"Zugang wurde erstellt und per E-Mail versendet."});
    }catch(emailError){
      console.error("FiiViu provider access email delivery failed",{code:emailError?.code||"",message:emailError?.message||"",providerRef,email});
      return json({success:true,providerRef,email,emailSent:false,emailErrorCode:emailError?.code||"EMAIL_SEND_FAILED",emailError:String(emailError?.message||"E-Mail konnte nicht versendet werden."),temporaryPassword:password,message:"Zugang wurde erstellt, aber die E-Mail konnte nicht versendet werden. Das temporäre Passwort wird einmalig angezeigt."});
    }
  }catch(error){
    console.error("FiiViu provider password setup failed",error);
    return json({error:error?.message||"Zugang konnte nicht erstellt werden."},500);
  }
}

async function handleProviderLogin(request,env){
  if(request.method!=="POST")return json({error:"Method Not Allowed"},405);
  if(!env.DB)return json({error:"D1 database not configured"},500);
  try{
    await ensureProvidersTable(env); await ensureProviderAuthTables(env);
    const body=await request.json(),email=clean(body.email).toLowerCase(),password=String(body.password||"");
    if(!email||!password)return json({error:"E-Mail und Passwort sind erforderlich."},400);
    const account=await env.DB.prepare("SELECT a.provider_ref,a.password_salt,a.password_hash,a.active,p.name,p.connect_account_id,p.active AS provider_active FROM provider_accounts a JOIN providers p ON p.provider_ref=a.provider_ref WHERE lower(a.email)=? LIMIT 1").bind(email).first();
    if(!account||Number(account.active)!==1||Number(account.provider_active)!==1)return json({error:"E-Mail oder Passwort ist falsch."},401);
    if(await hashProviderPassword(password,account.password_salt)!==String(account.password_hash||""))return json({error:"E-Mail oder Passwort ist falsch."},401);
    const session=await createProviderSession(env,String(account.provider_ref));
    const response=json({success:true,providerRef:String(account.provider_ref),provider:{name:account.name,connectAccountId:account.connect_account_id}});
    response.headers.set("Set-Cookie",providerSessionCookie(session.raw));
    return response;
  }catch(error){return json({error:error?.message||"Login fehlgeschlagen."},500)}
}

async function handleProviderSession(request,env){
  if(request.method!=="GET")return json({error:"Method Not Allowed"},405);
  const providerRef=await authenticateProviderSession(request,env);
  if(!providerRef)return json({authenticated:false},401);
  const provider=await env.DB.prepare("SELECT provider_ref,name,contact_email,connect_account_id,active FROM providers WHERE provider_ref=? LIMIT 1").bind(providerRef).first();
  if(!provider||Number(provider.active)!==1)return json({authenticated:false},401);
  return json({authenticated:true,provider});
}

async function handleProviderTestBooking(request, env) {
  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  if (!env.DB) return json({ error: "D1 database not configured" }, 500);

  const providerRef = await providerRefFromSession(request, env);
  if (!providerRef) return json({ error: "Unauthorized provider credentials" }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const customerEmail = clean(body.customerEmail);
    if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return json({ error: "Bitte eine gültige Test-E-Mail-Adresse eingeben." }, 400);
    }

    await ensureBookingColumns(env);
    await ensureProvidersTable(env);

    // Provider test bookings intentionally stay independent of Stripe Connect.
    // They simulate a paid booking while the platform remains in Stripe test mode.
    const provider = await env.DB.prepare(
      "SELECT provider_ref,name,contact_email,connect_account_id,active FROM providers WHERE provider_ref=? AND active=1 LIMIT 1"
    ).bind(providerRef).first();
    if (!provider) return json({ error: "Veranstalter nicht gefunden." }, 404);

    const now = new Date();
    const bookingId = "TEST-" + now.getTime().toString(36).toUpperCase() + "-" + providerRef;
    const paymentIntentId = "test_pi_" + now.getTime().toString(36) + "_" + providerRef.toLowerCase();
    const bookingDate = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
    const bookingTime = "18:00";
    const cancellationToken = providerRandomHex(24);

    const booking = {
      booking_id: bookingId,
      payment_intent_id: paymentIntentId,
      status: "confirmed",
      payment_status: "paid",
      customer_name: "FiiViu Testgast",
      customer_email: customerEmail,
      customer_phone: "",
      customer_language: "de",
      experience_name: "FiiViu Testbuchung",
      booking_date: bookingDate,
      booking_time: bookingTime,
      guests: 2,
      amount_cents: 100,
      currency: "eur",
      meeting_point_name: "Test-Treffpunkt",
      meeting_address: "Teststraße 1",
      meeting_city: "Bucharest",
      meeting_country: "Romania",
      meeting_instructions: "Dies ist eine interne Testbuchung.",
      arrival_minutes_before: 15,
      meeting_latitude: "",
      meeting_longitude: "",
      partner_ref: null,
      provider_name: provider.name,
      provider_connect_account_id: provider.connect_account_id,
      cancellation_token: cancellationToken
    };

    await env.DB.prepare(
      `INSERT INTO bookings (
        booking_id,payment_intent_id,status,payment_status,customer_name,customer_email,customer_phone,
        customer_language,experience_name,booking_date,booking_time,guests,amount_cents,currency,
        meeting_point_name,meeting_address,meeting_city,meeting_country,meeting_instructions,
        arrival_minutes_before,meeting_latitude,meeting_longitude,partner_ref,provider_name,
        provider_connect_account_id,cancellation_token,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(
      booking.booking_id,booking.payment_intent_id,booking.status,booking.payment_status,
      booking.customer_name,booking.customer_email,booking.customer_phone,booking.customer_language,
      booking.experience_name,booking.booking_date,booking.booking_time,booking.guests,booking.amount_cents,
      booking.currency,booking.meeting_point_name,booking.meeting_address,booking.meeting_city,
      booking.meeting_country,booking.meeting_instructions,booking.arrival_minutes_before,
      booking.meeting_latitude,booking.meeting_longitude,booking.partner_ref,booking.provider_name,
      booking.provider_connect_account_id,booking.cancellation_token
    ).run();

    const emailErrors = [];
    try {
      await sendProviderBookingNotification(env, booking);
    } catch (error) {
      emailErrors.push("Veranstalter-Mail: " + String(error?.message || error));
    }

    try {
      await sendConfirmationWithRetry(env, booking);
      await env.DB.prepare(
        "UPDATE bookings SET confirmation_email_sent_at=CURRENT_TIMESTAMP,confirmation_email_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE booking_id=?"
      ).bind(booking.booking_id).run();
    } catch (error) {
      const message = String(error?.message || error).slice(0, 1000);
      emailErrors.push("Kunden-Mail: " + message);
      await env.DB.prepare(
        "UPDATE bookings SET confirmation_email_error=?,updated_at=CURRENT_TIMESTAMP WHERE booking_id=?"
      ).bind(message, booking.booking_id).run();
    }

    return json({
      success: true,
      booking_id: booking.booking_id,
      customer_email: customerEmail,
      provider_email: clean(provider.contact_email),
      email_errors: emailErrors,
      message: emailErrors.length
        ? "Testbuchung erstellt, aber mindestens eine E-Mail konnte nicht gesendet werden."
        : "Testbuchung erstellt und E-Mails wurden versendet."
    });
  } catch (error) {
    console.error("FiiViu provider test booking failed", error);
    return json({ error: error?.message || "Testbuchung konnte nicht erstellt werden." }, 500);
  }
}

async function handleProviderLogout(request,env){
  if(request.method!=="POST")return json({error:"Method Not Allowed"},405);
  try{if(env.DB){await ensureProviderAuthTables(env);const raw=providerSessionFromRequest(request);if(raw)await env.DB.prepare("DELETE FROM provider_sessions WHERE session_hash=?").bind(await hashProviderSession(raw)).run();}}catch(_){}
  const response=json({success:true}); response.headers.set("Set-Cookie",providerSessionCookie("",0)); return response;
}

async function stripePostForm(env,path,params){
  const body=new URLSearchParams();
  for(const [key,value] of Object.entries(params||{})) body.set(key,String(value??""));
  const response=await fetch("https://api.stripe.com"+path,{method:"POST",headers:{Authorization:"Bearer "+String(env.STRIPE_SECRET_KEY||""),"Content-Type":"application/x-www-form-urlencoded"},body});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error?.message||"Stripe request failed");
  return data;
}

async function providerRefFromSession(request,env){
  return await authenticateProviderSession(request,env);
}

async function ensureOffersTable(env){
  const columns=await env.DB.prepare("PRAGMA table_info(offers)").all();
  const required=["provider_ref","title","description","price_cents","currency","available_times","meeting_point_name","meeting_address","meeting_city","meeting_country","meeting_instructions","arrival_minutes_before","title_en","title_ro","description_en","description_ro","meeting_point_name_en","meeting_point_name_ro","meeting_instructions_en","meeting_instructions_ro","image_url","gallery_urls","category","active"];
  const existing=new Set((columns.results||[]).map(row=>String(row.name||"")));
  const missing=required.filter(name=>!existing.has(name));
  if(missing.length)throw new Error("Offers schema is incomplete: "+missing.join(", "));
}
async function handleProviderExperiences(request,env){
  if(!env.DB)return json({error:"D1 database not configured"},500);
  const providerRef=await providerRefFromSession(request,env);
  if(!providerRef)return json({error:"Unauthorized provider credentials"},401);
  try{
    await ensureOffersTable(env);
    const provider=await env.DB.prepare("SELECT provider_ref,name,connect_account_id,active FROM providers WHERE provider_ref=? AND active=1 LIMIT 1").bind(providerRef).first();
    if(!provider)return json({error:"Veranstalter nicht gefunden."},404);
    if(request.method==="GET"){
      const rows=await env.DB.prepare("SELECT * FROM offers WHERE provider_ref=? ORDER BY active DESC,title ASC,id ASC").bind(providerRef).all();
      return json({provider,experiences:(rows.results||[]).map(x=>({...x,status:Number(x.active)===1?"published":"draft"}))});
    }
    if(request.method==="POST"){
      const body=await request.json().catch(()=>({}));
      const experienceId=String(body.experienceId||"").trim();
      const title=String(body.title||"").trim();
      const priceCents=Number(body.priceCents);
      if(!experienceId||!title)return json({error:"Experience-ID und Titel sind erforderlich."},400);
      if(!Number.isInteger(priceCents)||priceCents<50)return json({error:"Bitte einen Preis von mindestens 0,50 eingeben."},400);
      const existing=await env.DB.prepare("SELECT id FROM offers WHERE provider_ref=? AND lower(title)=lower(?) LIMIT 1").bind(providerRef,title).first();
      if(existing)return json({error:"Ein Erlebnis mit diesem Titel existiert bereits."},409);
      const active=body.publish===true?1:0;
      const result=await env.DB.prepare("INSERT INTO offers (provider_ref,title,description,price_cents,currency,available_times,meeting_point_name,meeting_address,meeting_city,meeting_country,meeting_instructions,arrival_minutes_before,category,image_url,gallery_urls,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(
        providerRef,title,String(body.description||"").trim()||null,priceCents,String(body.currency||"eur").toLowerCase(),
        String(body.availableTimes||"").trim()||null,String(body.meetingPointName||"").trim()||null,String(body.meetingAddress||"").trim()||null,
        String(body.meetingCity||"").trim()||null,String(body.meetingCountry||"").trim()||null,String(body.meetingInstructions||"").trim()||null,
        Number.isInteger(Number(body.arrivalMinutesBefore))?Number(body.arrivalMinutesBefore):null,String(body.category||"explore").trim().toLowerCase()||"explore",
        String(body.imageUrl||"").trim()||null,String(body.galleryUrls||"").trim()||null,active
      ).run();
      const experience=await env.DB.prepare("SELECT * FROM offers WHERE id=? LIMIT 1").bind(result.meta?.last_row_id).first();
      return json({success:true,experience:{...experience,status:active?"published":"draft",experience_id:experience?.id?experienceId:null}},201);
    }
    return json({error:"Method Not Allowed"},405);
  }catch(error){
    console.error("FiiViu provider experiences failed",error);
    return json({error:error?.message||"Erlebnis konnte nicht geladen werden."},500);
  }
}

async function handleProviderConnectOnboarding(request,env){
  if(request.method!=="POST")return json({error:"Method Not Allowed"},405);
  if(!env.DB||!env.STRIPE_SECRET_KEY)return json({error:"Stripe Connect ist nicht konfiguriert."},500);
  const providerRef=await providerRefFromSession(request,env);
  if(!providerRef)return json({error:"Unauthorized provider credentials"},401);
  try{
    const provider=await env.DB.prepare("SELECT provider_ref,name,contact_email,connect_account_id,active FROM providers WHERE provider_ref=? LIMIT 1").bind(providerRef).first();
    if(!provider||Number(provider.active)!==1)return json({error:"Veranstalter nicht gefunden oder deaktiviert."},404);
    let accountId=String(provider.connect_account_id||"").trim();
    if(!/^acct_[A-Za-z0-9]+$/.test(accountId)){
      const account=await stripePostForm(env,"/v1/accounts",{
        type:"express",
        country:"RO",
        email:String(provider.contact_email||"").trim(),
        business_type:"individual",
        "capabilities[card_payments][requested]":"true",
        "capabilities[transfers][requested]":"true"
      });
      accountId=String(account.id||"").trim();
      if(!/^acct_[A-Za-z0-9]+$/.test(accountId))throw new Error("Stripe-Konto konnte nicht erstellt werden.");
      await env.DB.prepare("UPDATE providers SET connect_account_id=? WHERE provider_ref=?").bind(accountId,providerRef).run();
    }
    const link=await stripePostForm(env,"/v1/account_links",{
      account:accountId,
      refresh_url:"https://fiiviu.ro/provider.html?connect=refresh",
      return_url:"https://fiiviu.ro/provider.html?connect=return",
      type:"account_onboarding"
    });
    return json({success:true,accountId,onboarding:{url:link.url}});
  }catch(error){
    console.error("FiiViu provider Connect onboarding failed",error);
    return json({error:error?.message||"Stripe-Onboarding konnte nicht gestartet werden."},500);
  }
}

async function handleProviderConnectStatus(request,env){
  if(request.method!=="GET")return json({error:"Method Not Allowed"},405);
  if(!env.DB||!env.STRIPE_SECRET_KEY)return json({error:"Stripe Connect ist nicht konfiguriert."},500);
  const providerRef=await providerRefFromSession(request,env);
  if(!providerRef)return json({error:"Unauthorized provider credentials"},401);
  try{
    const provider=await env.DB.prepare("SELECT connect_account_id FROM providers WHERE provider_ref=? LIMIT 1").bind(providerRef).first();
    const accountId=String(provider?.connect_account_id||"").trim();
    if(!accountId)return json({error:"Noch kein Stripe Connect-Konto angelegt. Bitte zuerst „Stripe-Onboarding öffnen“ wählen."},400);
    const account=await stripeGet(env,"/v1/accounts/"+encodeURIComponent(accountId));
    return json({account:{
      id:account.id,
      detailsSubmitted:!!account.details_submitted,
      payoutsEnabled:!!account.payouts_enabled,
      transfersEnabled:!!account.capabilities?.transfers,
      currentlyDue:Array.isArray(account.requirements?.currently_due)?account.requirements.currently_due:[],
      pastDue:Array.isArray(account.requirements?.past_due)?account.requirements.past_due:[]
    }});
  }catch(error){
    return json({error:error?.message||"Stripe-Status konnte nicht geladen werden."},500);
  }
}

async function handleProviderOverview(request,env){
  if(request.method!=="GET")return json({error:"Method Not Allowed"},405);
  if(!env.DB)return json({error:"D1 database not configured"},500);
  const providerRef=await providerRefFromSession(request,env);
  if(!providerRef)return json({error:"Unauthorized provider credentials"},401);
  try{
    await ensureProvidersTable(env);
    await ensureBookingColumns(env);
    const provider=await env.DB.prepare("SELECT provider_ref,name,connect_account_id FROM providers WHERE provider_ref=? AND active=1 LIMIT 1").bind(providerRef).first();
    if(!provider)return json({error:"Veranstalter nicht gefunden."},404);

    // Financial dashboard values come from the settlement ledger, not raw booking
    // amounts. This keeps provider revenue/payout figures consistent with Stripe.
    const rows=await env.DB.prepare(`
      SELECT b.booking_id,b.booking_date,b.booking_time,b.status,b.payment_status,b.currency,
             b.experience_name,b.customer_name,b.guests,b.amount_cents,
             s.payment_intent_id,s.total_amount_cents,s.provider_amount_cents,
             s.provider_transfer_amount_cents,s.settlement_status,s.provider_transfer_id,
             s.release_at,s.settlement_error,s.settlement_test_transfer_id
      FROM bookings b
      LEFT JOIN booking_settlements s ON s.booking_id=b.booking_id
      WHERE b.provider_name=? OR b.provider_name=(SELECT name FROM providers WHERE provider_ref=? LIMIT 1)
      ORDER BY b.booking_date DESC,b.booking_time DESC,b.id DESC
    `).bind(provider.name,providerRef).all();
    const all=rows.results||[];

    const grossRevenueCents=all.reduce((sum,r)=>sum+Number(r.provider_amount_cents||0),0);
    const paidOutCents=all.filter(r=>r.settlement_status==="transferred"||r.provider_transfer_id)
      .reduce((sum,r)=>sum+Number(r.provider_transfer_amount_cents||0),0);
    const availableCents=all.filter(r=>r.status==="confirmed"&&r.payment_status==="paid"&&
      (r.settlement_status==="pending"||r.settlement_test_transfer_id))
      .reduce((sum,r)=>sum+Number(r.provider_transfer_amount_cents||r.provider_amount_cents||0),0);
    const pendingCents=Math.max(0,grossRevenueCents-availableCents-
      all.filter(r=>r.settlement_status==="transferred"||r.provider_transfer_id)
        .reduce((sum,r)=>sum+Number(r.provider_amount_cents||0),0));
    const today=new Date().toISOString().slice(0,10);
    const upcoming=all.filter(r=>String(r.booking_date||"")>=today&&r.status==="confirmed").slice(0,10);
    return json({
      provider,
      stripeConnectConfigured:Boolean(String(provider.connect_account_id||"").trim()),
      stats:{bookings:all.length,grossRevenueCents,providerRevenueCents:grossRevenueCents,availableCents,pendingCents,paidOutCents},
      upcomingBookings:upcoming,
      recentBookings:all.slice(0,20)
    });
  }catch(error){
    console.error("FiiViu provider overview failed",error);
    return json({error:error?.message||"Dashboard konnte nicht geladen werden."},500);
  }
}

async function handleAdminProviders(request, env) {
  if (!env.ADMIN_PAYOUT_KEY) return json({ error: "Admin key is not configured." }, 500);
  if (!isAdminRequest(request, env)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "D1 database not configured." }, 500);

  await ensureProvidersTable(env);

  try {
    if (request.method === "GET") {
      const result = await env.DB.prepare(
        "SELECT id,provider_ref,name,connect_account_id,contact_email,active,created_at FROM providers ORDER BY name ASC,id ASC"
      ).all();
      return json({ providers: result.results || [] });
    }

    if (request.method === "POST") {
      const body = await request.json();
      const name = clean(body.name);
      const connectAccountId = clean(body.connectAccountId);
      const contactEmail = clean(body.contactEmail);
      let providerRef = clean(body.providerRef).toUpperCase();

      if (!name) return json({ error: "Organizer-Name fehlt." }, 400);
      if (!providerRef) providerRef = providerRefFromName(name);

      const existing = await env.DB.prepare(
        "SELECT id FROM providers WHERE provider_ref=? LIMIT 1"
      ).bind(providerRef).first();
      if (existing) return json({ error: "Dieser Organizer-Code existiert bereits." }, 409);

      const result = await env.DB.prepare(
        "INSERT INTO providers (provider_ref,name,connect_account_id,contact_email,active) VALUES (?,?,?,?,1)"
      ).bind(providerRef,name,connectAccountId || null,contactEmail || null).run();

      const provider = await env.DB.prepare(
        "SELECT id,provider_ref,name,connect_account_id,contact_email,active,created_at FROM providers WHERE id=? LIMIT 1"
      ).bind(result.meta?.last_row_id).first();

      return json({ success: true, provider }, 201);
    }

    if (request.method === "PATCH") {
      const body = await request.json();
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return json({ error: "Ungültige Organizer-ID." }, 400);

      const current = await env.DB.prepare(
        "SELECT * FROM providers WHERE id=? LIMIT 1"
      ).bind(id).first();
      if (!current) return json({ error: "Organizer nicht gefunden." }, 404);

      const name = clean(body.name ?? current.name);
      const connectAccountId = clean(body.connectAccountId ?? current.connect_account_id);
      const contactEmail = clean(body.contactEmail ?? current.contact_email);
      const active = body.active === undefined
        ? Number(current.active) === 1
        : (body.active === true || body.active === 1 || body.active === "1");

      if (!name) return json({ error: "Organizer-Name fehlt." }, 400);

      await env.DB.prepare(
        "UPDATE providers SET name=?,connect_account_id=?,contact_email=?,active=? WHERE id=?"
      ).bind(name,connectAccountId || null,contactEmail || null,active ? 1 : 0,id).run();

      const provider = await env.DB.prepare(
        "SELECT id,provider_ref,name,connect_account_id,contact_email,active,created_at FROM providers WHERE id=? LIMIT 1"
      ).bind(id).first();

      return json({ success: true, provider });
    }

    return json({ error: "Method Not Allowed" }, 405);
  } catch (error) {
    console.error("FiiViu admin providers failed", error);
    return json({ error: error?.message || "Server error" }, 500);
  }
}

async function handleAdminProviderPayout(request, env) {
  if (!env.ADMIN_PAYOUT_KEY) return json({ error: "Payout admin key is not configured." }, 500);
  if (!isAdminRequest(request, env)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB || !env.STRIPE_SECRET_KEY) {
    return json({ error: "Payout service is not configured." }, 500);
  }

  await ensureProvidersTable(env);
  await ensureProviderPayoutsTable(env);
  await ensureBookingSettlementsTable(env);
  await ensureBookingColumns(env);

  try {
    const url = new URL(request.url);
    const providerRef = clean(url.searchParams.get("ref"));

    if (request.method === "GET") {
      if (!providerRef) return json({ error: "Organizer-Code fehlt." }, 400);

      const provider = await env.DB.prepare(
        "SELECT id,provider_ref,name,connect_account_id,contact_email,active,created_at FROM providers WHERE provider_ref=? LIMIT 1"
      ).bind(providerRef).first();

      if (!provider) return json({ error: "Organizer nicht gefunden." }, 404);

      const rows = await env.DB.prepare(`
        SELECT s.booking_id,s.payment_intent_id,s.total_amount_cents,s.provider_amount_cents,
               s.settlement_status,s.provider_transfer_id,b.booking_date,b.booking_time,
               b.status,b.payment_status,b.currency,b.experience_name
        FROM booking_settlements s
        LEFT JOIN bookings b ON b.booking_id=s.booking_id
        WHERE s.provider_ref=?
        ORDER BY b.booking_date DESC,b.booking_time DESC,s.id DESC
      `).bind(providerRef).all();

      const available = (rows.results || [])
        .filter(row => isSettlementEventDue(row) && row.settlement_status === "pending" && row.status === "confirmed" && row.payment_status === "paid")
        .reduce((sum,row) => sum + Number(row.provider_amount_cents || 0), 0);

      const payouts = await env.DB.prepare(
        "SELECT id,booking_id,provider_ref,amount_cents,payout_date,status,stripe_transfer_id,reference,created_at FROM provider_payouts WHERE provider_ref=? ORDER BY payout_date DESC,id DESC"
      ).bind(providerRef).all();

      return json({
        provider,
        availableAmount: available / 100,
        availableAmountCents: available,
        bookings: rows.results || [],
        payouts: (payouts.results || []).map(p => ({ ...p, amount: Number(p.amount_cents) / 100 }))
      });
    }

    if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

    return json({
      error: "Manual Organizer-Auszahlungen sind deaktiviert. Auszahlungen werden ausschließlich über das Settlement-System freigegeben."
    }, 410);

    const body = await request.json();
    const bookingId = clean(body.bookingId);
    const payoutDate = clean(body.payoutDate) || new Date().toISOString().slice(0,10);
    const reference = clean(body.reference);

    if (!providerRef) return json({ error: "Organizer-Code fehlt." }, 400);
    if (!bookingId) return json({ error: "bookingId fehlt." }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payoutDate)) return json({ error: "Ungültiges Auszahlungsdatum." }, 400);

    const provider = await env.DB.prepare(
      "SELECT * FROM providers WHERE provider_ref=? LIMIT 1"
    ).bind(providerRef).first();

    if (!provider) return json({ error: "Organizer nicht gefunden." }, 404);
    if (Number(provider.active) !== 1) return json({ error: "Dieser Organizer ist deaktiviert." }, 400);

    const settlement = await env.DB.prepare(`
      SELECT s.*,b.status AS booking_status,b.payment_status,b.booking_date,b.booking_time,b.currency,b.experience_name
      FROM booking_settlements s
      LEFT JOIN bookings b ON b.booking_id=s.booking_id
      WHERE s.booking_id=? AND s.provider_ref=? LIMIT 1
    `).bind(bookingId,providerRef).first();

    if (!settlement) return json({ error: "Settlement für diese Buchung nicht gefunden." }, 404);
    if (settlement.settlement_status === "transferred" || settlement.provider_transfer_id) {
      return json({ error: "Diese Buchung wurde bereits an den Organizer ausgezahlt.", stripeTransferId: settlement.provider_transfer_id }, 409);
    }
    if (settlement.settlement_status !== "pending") {
      return json({ error: "Diese Buchung ist aktuell nicht auszahlbar.", settlementStatus: settlement.settlement_status }, 409);
    }
    if (settlement.booking_status !== "confirmed" || settlement.payment_status !== "paid") {
      return json({ error: "Nur bestätigte und bezahlte Buchungen können ausgezahlt werden." }, 409);
    }
    if (!isSettlementEventDue(settlement)) {
      return json({ error: "Die Auszahlung wird erst nach dem Ende der gebuchten Experience freigegeben." }, 409);
    }

    const destination = clean(provider.connect_account_id || settlement.provider_connect_account_id);
    if (!destination || !/^acct_[A-Za-z0-9]+$/.test(destination)) {
      return json({ error: "Für diesen Organizer ist noch kein gültiges Stripe Connect Konto hinterlegt." }, 409);
    }

    const amountCents = Number(settlement.provider_amount_cents || 0);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return json({ error: "Ungültiger Organizer-Auszahlungsbetrag." }, 409);
    }

    const existingPayout = await env.DB.prepare(
      "SELECT * FROM provider_payouts WHERE booking_id=? LIMIT 1"
    ).bind(bookingId).first();
    if (existingPayout) {
      return json({ error: "Für diese Buchung existiert bereits ein Auszahlungsvorgang.", payout: existingPayout }, 409);
    }

    const params = new URLSearchParams();
    params.set("amount", String(amountCents));
    params.set("currency", String(settlement.currency || "eur").toLowerCase());
    params.set("destination", destination);
    params.set("description", "FiiViu Organizer-Auszahlung " + bookingId);
    params.set("transfer_group", "FiiViu-" + bookingId);
    params.set("metadata[booking_id]", bookingId);
    params.set("metadata[provider_ref]", providerRef);

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/transfers",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": "fiiviu-provider-payout-" + bookingId
        },
        body: params
      }
    );

    const transfer = await stripeResponse.json().catch(() => ({}));

    if (!stripeResponse.ok) {
      return json({
        error: transfer?.error?.message || "Stripe Organizer-Auszahlung fehlgeschlagen."
      }, stripeResponse.status);
    }

    await env.DB.prepare(
      "INSERT INTO provider_payouts (booking_id,provider_ref,amount_cents,payout_date,status,stripe_transfer_id,reference) VALUES (?,?,?,?,?,?,?)"
    ).bind(
      bookingId,
      providerRef,
      amountCents,
      payoutDate,
      "paid",
      transfer.id,
      reference || null
    ).run();

    await env.DB.prepare(
      "UPDATE booking_settlements SET settlement_status='transferred',provider_transfer_id=?,provider_connect_account_id=?,updated_at=CURRENT_TIMESTAMP WHERE booking_id=?"
    ).bind(transfer.id,destination,bookingId).run();

    return json({
      success: true,
      bookingId,
      providerRef,
      amount: amountCents / 100,
      currency: String(settlement.currency || "eur").toLowerCase(),
      stripeTransferId: transfer.id,
      payoutDate,
      reference: reference || null
    }, 201);
  } catch (error) {
    console.error("FiiViu admin provider payout failed", error);
    return json({ error: error?.message || "Organizer-Auszahlung fehlgeschlagen." }, 500);
  }
}

function isAdminRequest(request, env) {
  return request.headers.get("Authorization") === "Bearer " + String(env.ADMIN_PAYOUT_KEY || "");
}

function isSettlementEventDue(settlement) {
  const start = parseBookingDateTime(settlement?.booking_date, settlement?.booking_time);
  if (!start) return false;
  return Date.now() >= start.getTime();
}

async function ensureProvidersTable(env) {
  const rows = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='providers'").all();
  if (!rows.results?.length) throw new Error("Providers schema is missing. Apply the providers migration.");
  const indexes = await env.DB.prepare("PRAGMA table_info(providers)").all();
  const required = new Set(["provider_ref","name","connect_account_id","contact_email","active"]);
  const missing = [...required].filter(name => !(indexes.results || []).some(row => String(row.name || "") === name));
  if (missing.length) throw new Error("Providers schema is incomplete: " + missing.join(", "));
}

async function ensureProviderPayoutsTable(env) {
  const rows = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='provider_payouts'").all();
  if (!rows.results?.length) throw new Error("Legacy provider_payouts schema is missing.");
}

async function ensureBookingSettlementsTable(env) {
  const rows = await env.DB.prepare("PRAGMA table_info(booking_settlements)").all();
  const required = new Set(["booking_id","payment_intent_id","total_amount_cents","provider_amount_cents","fiiviu_amount_cents","provider_connect_account_id","provider_transfer_id","settlement_status","release_at","settlement_error","settlement_test_transfer_id"]);
  const missing = [...required].filter(name => !(rows.results || []).some(row => String(row.name || "") === name));
  if (missing.length) throw new Error("Booking settlement schema is incomplete: " + missing.join(", "));
}

function providerRefFromName(name) {
  const base = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 16) || "PROVIDER";
  return "ORG-" + base;
}

async function getOrCreateProvider(env, name, connectAccountId = "") {
  const providerName = clean(name);
  const connectId = clean(connectAccountId);
  if (!providerName && !connectId) return null;

  await ensureProvidersTable(env);

  let provider = null;
  if (connectId) {
    provider = await env.DB.prepare(
      "SELECT * FROM providers WHERE connect_account_id=? LIMIT 1"
    ).bind(connectId).first();
  }

  if (!provider && providerName) {
    provider = await env.DB.prepare(
      "SELECT * FROM providers WHERE lower(name)=lower(?) LIMIT 1"
    ).bind(providerName).first();
  }

  if (provider) {
    if (
      (connectId && clean(provider.connect_account_id) !== connectId) ||
      (providerName && clean(provider.name) !== providerName)
    ) {
      await env.DB.prepare(
        "UPDATE providers SET name=?,connect_account_id=COALESCE(NULLIF(?,''),connect_account_id),updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(providerName || provider.name, connectId, provider.id).run().catch(() => {});
      provider = await env.DB.prepare(
        "SELECT * FROM providers WHERE id=? LIMIT 1"
      ).bind(provider.id).first();
    }
    return provider;
  }

  const baseRef = providerRefFromName(providerName || connectId);
  let providerRef = baseRef;
  for (let i = 2; i < 1000; i++) {
    const exists = await env.DB.prepare(
      "SELECT id FROM providers WHERE provider_ref=? LIMIT 1"
    ).bind(providerRef).first();
    if (!exists) break;
    providerRef = baseRef + "-" + i;
  }

  const result = await env.DB.prepare(
    "INSERT INTO providers (provider_ref,name,connect_account_id,active) VALUES (?,?,?,1)"
  ).bind(providerRef, providerName || providerRef, connectId || null).run();

  return await env.DB.prepare(
    "SELECT * FROM providers WHERE id=? LIMIT 1"
  ).bind(result.meta?.last_row_id).first();
}

function calculateSettlementReleaseAt(dateValue, timeValue) {
  const start = parseBookingDateTime(dateValue, timeValue);
  if (!start) return null;
  // Provider settlement is released after the experience starts. The
  // customer cancellation deadline is 24h before start and must never
  // coincide with provider payout.
  return start.toISOString().replace("T", " ").replace("Z", "");
}

async function recordBookingSettlement(env, booking) {
  if (!env.DB || !booking?.booking_id) return;

  await ensureProvidersTable(env);
  await ensureBookingSettlementsTable(env);

  const totalCents = Number(booking.amount_cents || 0);
  if (!Number.isInteger(totalCents) || totalCents <= 0) return;

  const partnerRef = clean(booking.partner_ref);
  const hasPartner = Boolean(partnerRef);
  const providerAmountCents = Math.round(totalCents * 0.825);
  const partnerAmountCents = hasPartner ? Math.round(totalCents * 0.05) : 0;
  const fiiviuAmountCents =
    totalCents - providerAmountCents - partnerAmountCents;

  const provider = await getOrCreateProvider(
    env,
    booking.provider_name,
    booking.provider_connect_account_id
  );

  // Stripe's payment_intent.succeeded webhook creates the authoritative
  // settlement row with a release_at timestamp. Finalization can race that
  // webhook, so never turn an existing pending settlement into "ready" here.
  const existing = await env.DB.prepare(
    "SELECT settlement_status,release_at FROM booking_settlements WHERE booking_id=? LIMIT 1"
  ).bind(booking.booking_id).first();

  if (existing) {
    await env.DB.prepare(`
      UPDATE booking_settlements SET
        payment_intent_id=?,
        total_amount_cents=?,
        provider_amount_cents=?,
        fiiviu_amount_cents=?,
        partner_amount_cents=?,
        partner_ref=?,
        provider_ref=?,
        provider_name=?,
        provider_connect_account_id=?,
        updated_at=CURRENT_TIMESTAMP
      WHERE booking_id=?
    `).bind(
      booking.payment_intent_id,
      totalCents,
      providerAmountCents,
      fiiviuAmountCents,
      partnerAmountCents,
      partnerRef,
      provider?.provider_ref || null,
      provider?.name || clean(booking.provider_name) || null,
      provider?.connect_account_id || clean(booking.provider_connect_account_id) || null,
      booking.booking_id
    ).run();
    return;
  }

  // If finalization wins the race and creates the settlement first, keep it
  // pending and set the same release policy used by the webhook path.
  const releaseAt = calculateSettlementReleaseAt(
    booking.booking_date,
    booking.booking_time
  );

  await env.DB.prepare(`
    INSERT INTO booking_settlements (
      booking_id,
      payment_intent_id,
      total_amount_cents,
      provider_amount_cents,
      fiiviu_amount_cents,
      partner_amount_cents,
      partner_ref,
      provider_ref,
      provider_name,
      provider_connect_account_id,
      settlement_status,
      release_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(booking_id) DO NOTHING
  `).bind(
    booking.booking_id,
    booking.payment_intent_id,
    totalCents,
    providerAmountCents,
    fiiviuAmountCents,
    partnerAmountCents,
    partnerRef,
    provider?.provider_ref || null,
    provider?.name || clean(booking.provider_name) || null,
    provider?.connect_account_id || clean(booking.provider_connect_account_id) || null,
    releaseAt
  ).run();
}

async function ensureBookingColumns(env) {
  const columns=await env.DB.prepare("PRAGMA table_info(bookings)").all();
  const required=["booking_id","payment_intent_id","status","payment_status","customer_name","customer_email","experience_name","booking_date","booking_time","guests","amount_cents","currency","provider_connect_account_id","booking_access_token","cancellation_token"];
  const existing=new Set((columns.results||[]).map(row=>String(row.name||"")));
  const missing=required.filter(name=>!existing.has(name));
  if(missing.length)throw new Error("Bookings schema is missing required columns: "+missing.join(", "));
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