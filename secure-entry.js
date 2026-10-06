import marketplaceWorker from "./marketplace-entry.js";
import adminWorker from "./worker-entry.js";
import { handleStripeWebhook, releaseDueProviderSettlements } from "./stripe-webhook.js";

function getAdminCors(request, env) {
  const origin = String(request.headers.get("Origin") || "").trim();
  const allowed = new Set([
    String(env.PUBLIC_APP_URL || "https://fiiviu.ro").replace(/\/$/, ""),
    "https://fiiviu.ro",
    "https://www.fiiviu.ro"
  ]);
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(self)",
    "Cache-Control": "no-store"
  };
  if (origin && allowed.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}


function underConstructionResponse() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#f4efe7">
  <title>FiiViu — Coming Soon</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --ink: #18221d;
      --muted: #667169;
      --paper: #f7f3ec;
      --accent: #d86f45;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      overflow: hidden;
      color: var(--ink);
      background:
        radial-gradient(circle at 15% 15%, rgba(216,111,69,.18), transparent 32%),
        radial-gradient(circle at 88% 78%, rgba(57,105,78,.15), transparent 34%),
        linear-gradient(135deg, #fbf8f2 0%, var(--paper) 48%, #edf2eb 100%);
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: .32;
      background-image: radial-gradient(rgba(24,34,29,.09) .7px, transparent .7px);
      background-size: 7px 7px;
      mask-image: linear-gradient(to bottom, black, transparent 75%);
    }
    main {
      position: relative;
      min-height: 100vh;
      width: min(920px, 100%);
      margin: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 28px;
      text-align: center;
    }
    .mark {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 48px;
      font-size: 30px;
      font-weight: 800;
      letter-spacing: -1.7px;
    }
    .mark-dot {
      width: 11px;
      height: 11px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 7px rgba(216,111,69,.12);
    }
    .eyebrow {
      margin: 0 0 18px;
      color: var(--accent);
      font-size: 13px;
      font-weight: 800;
      letter-spacing: .18em;
      text-transform: uppercase;
    }
    h1 {
      max-width: 760px;
      margin: 0;
      font-size: clamp(44px, 8vw, 82px);
      line-height: .98;
      letter-spacing: -4px;
      font-weight: 800;
    }
    .lead {
      max-width: 590px;
      margin: 28px auto 0;
      color: var(--muted);
      font-size: clamp(17px, 2.2vw, 20px);
      line-height: 1.65;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      margin-top: 38px;
      padding: 11px 17px;
      border: 1px solid rgba(24,34,29,.1);
      border-radius: 999px;
      background: rgba(255,255,255,.58);
      box-shadow: 0 8px 30px rgba(24,34,29,.06);
      color: #445048;
      font-size: 13px;
      font-weight: 700;
    }
    .pulse {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #5f916d;
      box-shadow: 0 0 0 5px rgba(95,145,109,.13);
    }
    footer {
      position: absolute;
      bottom: 28px;
      color: #89928c;
      font-size: 12px;
      letter-spacing: .04em;
    }
    @media (max-width: 600px) {
      main { padding: 36px 24px; }
      .mark { margin-bottom: 40px; }
      h1 { letter-spacing: -2.5px; }
      footer { bottom: 20px; }
    }
  </style>
</head>
<body>
  <main>
    <div class="mark"><span class="mark-dot"></span>FiiViu</div>
    <p class="eyebrow">Coming soon</p>
    <h1>Bucharest is waiting to be discovered.</h1>
    <p class="lead">We’re putting the finishing touches on FiiViu — your place to discover memorable local experiences in Bucharest.</p>
    <div class="pill"><span class="pulse"></span>We’ll be back soon</div>
    <footer>Discover local. Experience more. &nbsp;·&nbsp; FiiViu</footer>
  </main>
</body>
</html>`, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Retry-After": "3600"
    }
  });
}

function applyApiSecurityHeaders(response, request, env, restrictCors = false) {
  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)");
  headers.set("Cache-Control", "no-store");
  const requestPath = new URL(request.url).pathname;
  if (requestPath === "/provider.html" || requestPath === "/organizer-admin.html" || requestPath === "/partner.html" || requestPath === "/booking.html") {
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  if (restrictCors) {
    const cors = getAdminCors(request, env);
    headers.delete("Access-Control-Allow-Origin");
    const origin = cors["Access-Control-Allow-Origin"];
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", cors["Access-Control-Allow-Methods"]);
    headers.set("Access-Control-Allow-Headers", cors["Access-Control-Allow-Headers"]);
    headers.set("Vary", cors["Vary"]);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async scheduled(controller, env, ctx) {
    try { await releaseDueProviderSettlements(env); } catch (error) { console.error("FiiViu settlement cron failed", error); }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/admin/settlement-run") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: getAdminCors(request, env) });
      }
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
          status: 405,
          headers: { ...getAdminCors(request, env), "Content-Type": "application/json; charset=utf-8" }
        });
      }
      if (String(env.ADMIN_PAYOUT_KEY || "").trim() === "" || String(request.headers.get("Authorization") || "").trim() !== "Bearer " + String(env.ADMIN_PAYOUT_KEY || "").trim()) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...getAdminCors(request, env), "Content-Type": "application/json; charset=utf-8" }
        });
      }
      try {
        const result = await releaseDueProviderSettlements(env);
        return new Response(JSON.stringify({ success: true, ...result }), {
          status: 200,
          headers: { ...getAdminCors(request, env), "Content-Type": "application/json; charset=utf-8" }
        });
      } catch (error) {
        console.error("FiiViu manual settlement run failed", error);
        return new Response(JSON.stringify({ error: error?.message || "Settlement run failed." }), {
          status: 500,
          headers: { ...getAdminCors(request, env), "Content-Type": "application/json; charset=utf-8" }
        });
      }
    }

    if (url.pathname === "/api/admin/settlement-status") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: getAdminCors(request, env) });
      }
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
          status: 405,
          headers: { ...getAdminCors(request, env), "Content-Type": "application/json; charset=utf-8" }
        });
      }
      if (String(env.ADMIN_PAYOUT_KEY || "").trim() === "" || String(request.headers.get("Authorization") || "").trim() !== "Bearer " + String(env.ADMIN_PAYOUT_KEY || "").trim()) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...getAdminCors(request, env), "Content-Type": "application/json; charset=utf-8" }
        });
      }
      if (!env.DB) {
        return new Response(JSON.stringify({ error: "D1 database not configured" }), {
          status: 500,
          headers: { ...getAdminCors(request, env), "Content-Type": "application/json; charset=utf-8" }
        });
      }
      const bookingId = String(url.searchParams.get("booking_id") || "").trim();
      if (!bookingId) {
        return new Response(JSON.stringify({ error: "booking_id is required" }), {
          status: 400,
          headers: { ...getAdminCors(request, env), "Content-Type": "application/json; charset=utf-8" }
        });
      }
      try {
        const row = await env.DB.prepare(`
          SELECT
            booking_id,
            payment_intent_id,
            settlement_status,
            total_amount_cents,
            provider_amount_cents,
            fiiviu_amount_cents,
            partner_amount_cents,
            provider_transfer_amount_cents,
            provider_transfer_currency,
            provider_transfer_id,
            settlement_test_transfer_id,
            settlement_last_attempt_at,
            settlement_error,
            release_at,
            updated_at
          FROM booking_settlements
          WHERE booking_id=?
          LIMIT 1
        `).bind(bookingId).first();
        if (!row) {
          return new Response(JSON.stringify({ error: "Settlement not found", booking_id: bookingId }), {
            status: 404,
            headers: { ...getAdminCors(request, env), "Content-Type": "application/json; charset=utf-8" }
          });
        }
        return new Response(JSON.stringify({
          success: true,
          settlement: {
            booking_id: row.booking_id,
            payment_intent_id: row.payment_intent_id,
            settlement_status: row.settlement_status,
            total_amount_cents: Number(row.total_amount_cents || 0),
            provider_amount_cents: Number(row.provider_amount_cents || 0),
            fiiviu_amount_cents: Number(row.fiiviu_amount_cents || 0),
            partner_amount_cents: Number(row.partner_amount_cents || 0),
            provider_transfer_amount_cents: Number(row.provider_transfer_amount_cents || 0),
            provider_transfer_currency: row.provider_transfer_currency || null,
            provider_transfer_id: row.provider_transfer_id || null,
            settlement_test_transfer_id: row.settlement_test_transfer_id || null,
            settlement_last_attempt_at: row.settlement_last_attempt_at || null,
            settlement_error: row.settlement_error || null,
            release_at: row.release_at || null,
            updated_at: row.updated_at || null
          }
        }), {
          status: 200,
          headers: { ...getAdminCors(request, env), "Content-Type": "application/json; charset=utf-8" }
        });
      } catch (error) {
        console.error("FiiViu settlement status lookup failed", error);
        return new Response(JSON.stringify({ error: error?.message || "Settlement status lookup failed" }), {
          status: 500,
          headers: { ...getAdminCors(request, env), "Content-Type": "application/json; charset=utf-8" }
        });
      }
    }

    // Serve the admin UI explicitly. Cloudflare Assets can otherwise resolve /admin
    // through the SPA fallback and return index.html instead of admin.html.
    if (request.method === "GET" && (url.pathname === "/admin" || url.pathname === "/admin/")) {
      if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = "/admin.html";
        const assetRequest = new Request(assetUrl.toString(), {
          method: "GET",
          headers: request.headers
        });
        const assetResponse = await env.ASSETS.fetch(assetRequest);
        const headers = new Headers(assetResponse.headers);
        headers.set("Cache-Control", "no-store");
        headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
        return new Response(assetResponse.body, {
          status: assetResponse.status,
          statusText: assetResponse.statusText,
          headers
        });
      }
      return new Response("Admin UI asset is not configured.", { status: 503 });
    }

    if (url.pathname === "/api/stripe/webhook") {
      return handleStripeWebhook(request, env);
    }

    if (url.pathname.startsWith("/api/admin/") || url.pathname === "/api/provider-login" || url.pathname === "/api/provider-session" || url.pathname === "/api/provider-logout" || url.pathname === "/api/provider-test-booking" || url.pathname === "/api/partner-stats" || url.pathname.startsWith("/api/provider/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: getAdminCors(request, env) });
      }
      return applyApiSecurityHeaders(await adminWorker.fetch(request, env, ctx), request, env, true);
    }

    if (String(env.UNDER_CONSTRUCTION || "").trim().toLowerCase() === "true") {
      return underConstructionResponse();
    }

    return applyApiSecurityHeaders(await marketplaceWorker.fetch(request, env, ctx), request, env);
  }
};
