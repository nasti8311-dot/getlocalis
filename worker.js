export default {
  async fetch(request, env) {

    const url = new URL(request.url);

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

        return json({
          partnerRef,
          bookings: successful.length,
          revenue: revenueCents / 100,
          commission: revenueCents * 0.03 / 100,
          currency: "eur"
        }, 200, corsHeaders);

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
