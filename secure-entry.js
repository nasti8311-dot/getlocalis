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
            const base = String(globalThis.__fiiviuPublicAppUrl || "https://getlocalis.nasti8311.workers.dev").replace(/\/$/, "");
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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

export default {
  async fetch(request, env, ctx) {
    globalThis.__fiiviuDB = env.DB || null;
    globalThis.__fiiviuPublicAppUrl = env.PUBLIC_APP_URL || "https://getlocalis.nasti8311.workers.dev";
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/admin/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS });
      }
      return adminWorker.fetch(request, env, ctx);
    }

    if (url.pathname === "/api/partner-stats") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
          status: 405,
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      const expected = String(env.ADMIN_PAYOUT_KEY || "").trim();
      const provided = String(request.headers.get("Authorization") || "");
      if (!expected || provided !== "Bearer " + expected) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
    }

    return marketplaceWorker.fetch(request, env, ctx);
  }
};
