const { default: marketplaceWorker } = await import("./marketplace-entry.js");
const { default: adminWorker } = await import("./worker-entry.js");
const { releaseDueProviderSettlements } = await import("./stripe-webhook.js");

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
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(self)",
    "Cache-Control": "no-store"
  };
  if (origin && allowed.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function applyApiSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)");
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
      if (!env.ADMIN_PAYOUT_KEY || request.headers.get("Authorization") !== "Bearer " + String(env.ADMIN_PAYOUT_KEY)) {
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
      if (!env.ADMIN_PAYOUT_KEY || request.headers.get("Authorization") !== "Bearer " + String(env.ADMIN_PAYOUT_KEY)) {
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

    if (url.pathname.startsWith("/api/admin/") || url.pathname === "/api/provider-login" || url.pathname === "/api/provider-session" || url.pathname === "/api/provider-logout" || url.pathname.startsWith("/api/provider/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: getAdminCors(request, env) });
      }
      return applyApiSecurityHeaders(await adminWorker.fetch(request, env, ctx));
    }

    return applyApiSecurityHeaders(await marketplaceWorker.fetch(request, env, ctx));
  }
};
