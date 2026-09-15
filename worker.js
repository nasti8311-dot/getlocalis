export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
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
        return new Response(
          JSON.stringify({
            error: "Method Not Allowed"
          }),
          {
            status: 405,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }

      try {

        const body = await request.json();

        const amount = Number(body.amount);

        const currency = String(
          body.currency || "eur"
        ).toLowerCase();

        const bookingId = String(
          body.bookingId || ""
        );

        const tourName = String(
          body.tourName || ""
        );

        const guests = Number(
          body.guests || 1
        );

        /*
         * Partner-Code:
         * 1. partnerRef aus dem POST-Body
         * 2. ref aus der API-URL
         */
        const bodyPartnerRef =
          typeof body.partnerRef === "string"
            ? body.partnerRef.trim()
            : "";

        const urlPartnerRef =
          url.searchParams.get("ref")?.trim() || "";

        const partnerRef =
          bodyPartnerRef || urlPartnerRef;

        if (
          !Number.isInteger(amount) ||
          amount < 50
        ) {
          return new Response(
            JSON.stringify({
              error: "Invalid amount"
            }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders
              }
            }
          );
        }

        if (!env.STRIPE_SECRET_KEY) {
          return new Response(
            JSON.stringify({
              error: "Stripe secret not configured"
            }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders
              }
            }
          );
        }

        const params = new URLSearchParams();

        params.set(
          "amount",
          String(amount)
        );

        params.set(
          "currency",
          currency
        );

        params.set(
          "metadata[booking_id]",
          bookingId
        );

        params.set(
          "metadata[tour_name]",
          tourName
        );

        params.set(
          "metadata[guests]",
          String(guests)
        );

        /*
         * Partner immer an Stripe senden,
         * sobald einer vorhanden ist.
         */
        if (partnerRef) {
          params.set(
            "metadata[partner_ref]",
            partnerRef
          );
        }

        params.set(
          "automatic_payment_methods[enabled]",
          "true"
        );

        const stripeResponse = await fetch(
          "https://api.stripe.com/v1/payment_intents",
          {
            method: "POST",
            headers: {
              "Authorization":
                "Bearer " + env.STRIPE_SECRET_KEY,

              "Content-Type":
                "application/x-www-form-urlencoded"
            },
            body: params
          }
        );

        const data =
          await stripeResponse.json();

        if (!stripeResponse.ok) {
          return new Response(
            JSON.stringify({
              error:
                data?.error?.message ||
                "Stripe error"
            }),
            {
              status: stripeResponse.status,
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders
              }
            }
          );
        }

        return new Response(
          JSON.stringify({
            clientSecret:
              data.client_secret,

            paymentIntentId:
              data.id,

            partnerRef:
              data.metadata?.partner_ref || ""
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );

      } catch (error) {

        return new Response(
          JSON.stringify({
            error:
              error?.message ||
              "Server error"
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
