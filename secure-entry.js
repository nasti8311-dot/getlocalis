const originalFetch = globalThis.fetch.bind(globalThis);

if (!globalThis.__fiiviuSecureEmailPatch) {
  globalThis.__fiiviuSecureEmailPatch = true;
  globalThis.fetch = async function(input, init) {
    try {
      const target = typeof input === "string" ? input : input?.url || "";
      if (target === "https://api.emailjs.com/api/v1.0/email/send" && init?.body && globalThis.__fiiviuDB) {
        const payload = JSON.parse(init.body);
        const params = payload?.template_params || {};
        const bookingId = String(params.booking_id || "").trim();
        if (bookingId) {
          try {
            await globalThis.__fiiviuDB
              .prepare("ALTER TABLE bookings ADD COLUMN booking_access_token TEXT")
              .run();
          } catch (_) {}
          const booking = await globalThis.__fiiviuDB
            .prepare("SELECT id,booking_id,booking_access_token FROM bookings WHERE booking_id=? LIMIT 1")
            .bind(bookingId)
            .first();
          if (booking) {
            let token = String(booking.booking_access_token || "").trim();
            if (!token) {
              const bytes = new Uint8Array(32);
              crypto.getRandomValues(bytes);
              token = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
              await globalThis.__fiiviuDB
                .prepare("UPDATE bookings SET booking_access_token=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND booking_access_token IS NULL")
                .bind(token, booking.id)
                .run();
            }
            const base = String(globalThis.__fiiviuPublicAppUrl || "https://fiiviu.ro").replace(/\/$/, "");
            const bookingUrl = `${base}/booking.html?id=${encodeURIComponent(booking.booking_id)}&token=${encodeURIComponent(token)}`;
            params.booking_url = bookingUrl;
            params.booking_link = bookingUrl;
            payload.template_params = params;
            init = { ...init, body: JSON.stringify(payload) };
          }
        }
      }
    } catch (error) {
      console.error("FiiViu secure EmailJS booking URL injection failed", error);
    }
    return originalFetch(input, init);
  };
}

const { default: marketplaceWorker } = await import("./marketplace-entry.js");
const { default: adminWorker } = await import("./worker-entry.js");
const { releaseDueProviderSettlements } = await import("./stripe-webhook.js");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

export default {
  async scheduled(controller, env, ctx) {
    try { await releaseDueProviderSettlements(env); } catch (error) { console.error("FiiViu settlement cron failed", error); }
  },

  async fetch(request, env, ctx) {
    globalThis.__fiiviuDB = env.DB || null;
    globalThis.__fiiviuPublicAppUrl = env.PUBLIC_APP_URL || "https://fiiviu.ro";
    const url = new URL(request.url);

    if (url.pathname === "/api/admin/settlement-run") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS });
      }
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
          status: 405,
          headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
        });
      }
      if (!env.ADMIN_PAYOUT_KEY || request.headers.get("Authorization") !== "Bearer " + String(env.ADMIN_PAYOUT_KEY)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
        });
      }
      try {
        const result = await releaseDueProviderSettlements(env);
        return new Response(JSON.stringify({ success: true, ...result }), {
          status: 200,
          headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
        });
      } catch (error) {
        console.error("FiiViu manual settlement run failed", error);
        return new Response(JSON.stringify({ error: error?.message || "Settlement run failed." }), {
          status: 500,
          headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
        });
      }
    }

    if (url.pathname === "/api/admin/settlement-status") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS });
      }
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
          status: 405,
          headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
        });
      }
      if (!env.ADMIN_PAYOUT_KEY || request.headers.get("Authorization") !== "Bearer " + String(env.ADMIN_PAYOUT_KEY)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
        });
      }
      if (!env.DB) {
        return new Response(JSON.stringify({ error: "D1 database not configured" }), {
          status: 500,
          headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
        });
      }
      const bookingId = String(url.searchParams.get("booking_id") || "").trim();
      if (!bookingId) {
        return new Response(JSON.stringify({ error: "booking_id is required" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
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
            headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
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
          headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
        });
      } catch (error) {
        console.error("FiiViu settlement status lookup failed", error);
        return new Response(JSON.stringify({ error: error?.message || "Settlement status lookup failed" }), {
          status: 500,
          headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
        });
      }
    }

    if (url.pathname.startsWith("/api/admin/") || url.pathname === "/api/provider-login" || url.pathname === "/api/provider-session" || url.pathname === "/api/provider-logout") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS });
      }
      return adminWorker.fetch(request, env, ctx);
    }

    return marketplaceWorker.fetch(request, env, ctx);
  }
};
