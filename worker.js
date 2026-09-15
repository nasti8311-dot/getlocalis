export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (url.pathname === "/api/create-payment-intent") {

      if (request.method !== "POST") {
        return json({ error: "Method Not Allowed" }, 405, corsHeaders);
      }

      try {
        const body = await request.json();
        const amount = Number(body.amount);
        const currency = String(body.currency || "eur").toLowerCase();
        const bookingId = String(body.bookingId || "");
        const tourName = String(body.tourName || "");
        const guests = Number(body.guests || 1);

        const bodyPartnerRef =
          typeof body.partnerRef === "string" ? body.partnerRef.trim() : "";
        const urlPartnerRef = url.searchParams.get("ref")?.trim() || "";
        const partnerRef = bodyPartnerRef || urlPartnerRef;

        if (!Number.isInteger(amount) || amount < 50) {
          return json({ error: "Invalid amount" }, 400, corsHeaders);
        }

        if (!env.STRIPE_SECRET_KEY) {
          return json({ error: "Stripe secret not configured" }, 500, corsHeaders);
        }

        const params = new URLSearchParams();
        params.set("amount", String(amount));
        params.set("currency", currency);
        params.set("metadata[booking_id]", bookingId);
        params.set("metadata[tour_name]", tourName);
        params.set("metadata[guests]", String(guests));

        if (partnerRef) {
          params.set("metadata[partner_ref]", partnerRef);
        }

        params.set("automatic_payment_methods[enabled]", "true");

        const stripeResponse = await fetch(
          "https://api.stripe.com/v1/payment_intents",
          {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + env.STRIPE_SECRET_KEY,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            body: params
          }
        );

        const data = await stripeResponse.json();

        if (!stripeResponse.ok) {
          return json({
            error: data?.error?.message || "Stripe error"
          }, stripeResponse.status, corsHeaders);
        }

        return json({
          clientSecret: data.client_secret,
          paymentIntentId: data.id,
          partnerRef: data.metadata?.partner_ref || ""
        }, 200, corsHeaders);

      } catch (error) {
        return json({ error: error?.message || "Server error" }, 500, corsHeaders);
      }
    }

    if (url.pathname === "/api/partner-stats") {

      if (request.method !== "GET") {
        return json({ error: "Method Not Allowed" }, 405, corsHeaders);
      }

      try {
        const partnerRef = url.searchParams.get("ref")?.trim() || "";

        if (!partnerRef) {
          return json({ error: "Partner-Code fehlt" }, 400, corsHeaders);
        }

        if (!env.STRIPE_SECRET_KEY) {
          return json({ error: "Stripe secret not configured" }, 500, corsHeaders);
        }

        const query = "metadata['partner_ref']:'" + partnerRef.replace(/'/g, "\\'") + "'";
        const stripeUrl =
          "https://api.stripe.com/v1/payment_intents/search?query=" + encodeURIComponent(query) + "&limit=100";

        const stripeResponse = await fetch(stripeUrl, {
          method: "GET",
          headers: {
            "Authorization": "Bearer " + env.STRIPE_SECRET_KEY
          }
        });

        const data = await stripeResponse.json();

        if (!stripeResponse.ok) {
          return json({
            error: data?.error?.message || "Stripe error"
          }, stripeResponse.status, corsHeaders);
        }

        const successful = (data.data || []).filter(
          payment => payment.status === "succeeded"
        );

        const revenueCents = successful.reduce(
          (sum, payment) => sum + Number(payment.amount_received || payment.amount || 0),
          0
        );

        const commissionCents = Math.round(revenueCents * 0.03);

        let paidCents = 0;

        if (env.DB) {
          const payoutResult = await env.DB.prepare(
            "SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents FROM partner_payouts WHERE partner_ref = ? AND status = 'paid'"
          ).bind(partnerRef).first();

          paidCents = Number(payoutResult?.paid_cents || 0);
        }

        const openCommissionCents = Math.max(
          commissionCents - paidCents,
          0
        );

        return json({
          partnerRef,
          bookings: successful.length,
          revenue: revenueCents / 100,
          commission: commissionCents / 100,
          openCommission: openCommissionCents / 100,
          paidCommission: paidCents / 100,
          currency: "eur"
        }, 200, corsHeaders);

      } catch (error) {
        return json({ error: error?.message || "Server error" }, 500, corsHeaders);
      }
    }

    if (url.pathname === "/api/admin/partner-payout") {

      if (request.method !== "POST") {
        return json({ error: "Method Not Allowed" }, 405, corsHeaders);
      }

      if (!env.ADMIN_PAYOUT_KEY) {
        return json({ error: "Payout admin key not configured" }, 500, corsHeaders);
      }

      const authorization = request.headers.get("Authorization") || "";
      const expected = "Bearer " + env.ADMIN_PAYOUT_KEY;

      if (authorization !== expected) {
        return json({ error: "Unauthorized" }, 401, corsHeaders);
      }

      if (!env.DB) {
        return json({ error: "D1 database not configured" }, 500, corsHeaders);
      }

      try {
        const body = await request.json();
        const partnerRef = String(body.partnerRef || "").trim();
        const amountCents = Number(body.amountCents);
        const payoutDate = String(body.payoutDate || "").trim();
        const reference = String(body.reference || "").trim();

        if (!partnerRef) {
          return json({ error: "Partner-Code fehlt" }, 400, corsHeaders);
        }

        if (!Number.isInteger(amountCents) || amountCents <= 0) {
          return json({ error: "Invalid payout amount" }, 400, corsHeaders);
        }

        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(payoutDate)) {
          return json({ error: "Invalid payout date" }, 400, corsHeaders);
        }

        const result = await env.DB.prepare(
          "INSERT INTO partner_payouts (partner_ref, amount_cents, payout_date, status, reference) VALUES (?, ?, ?, 'paid', ?)"
        ).bind(
          partnerRef,
          amountCents,
          payoutDate,
          reference || null
        ).run();

        return json({
          success: true,
          payoutId: result.meta?.last_row_id || null,
          partnerRef,
          amount: amountCents / 100,
          payoutDate,
          reference: reference || null
        }, 201, corsHeaders);

      } catch (error) {
        return json({ error: error?.message || "Server error" }, 500, corsHeaders);
      }
    }

    return env.ASSETS.fetch(request);
  }
};

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}
