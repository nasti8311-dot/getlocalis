```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /*
     * Stripe PaymentIntent API
     */
    if (url.pathname === "/api/create-payment-intent") {
      if (request.method !== "POST") {
        return new Response(
          JSON.stringify({
            error: "Method Not Allowed"
          }),
          {
            status: 405,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      try {
        const body = await request.json();

        console.log(
          "FIIVIU PARTNER REF:",
          body.partnerRef
        );

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

        const partnerRef = String(
          body.partnerRef || ""
        );

        /*
         * Validate amount
         */
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
                "Content-Type": "application/json"
              }
            }
          );
        }

        /*
         * Check Stripe secret
         */
        if (!env.STRIPE_SECRET_KEY) {
          return new Response(
            JSON.stringify({
              error: "Stripe secret not configured"
            }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json"
              }
            }
          );
        }

        /*
         * Stripe PaymentIntent parameters
         */
        const params =
          new URLSearchParams();

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

        params.set(
          "metadata[partner_ref]",
          partnerRef
        );

        params.set(
          "automatic_payment_methods[enabled]",
          "true"
        );

        /*
         * Create Stripe PaymentIntent
         */
        const stripeResponse =
          await fetch(
            "https://api.stripe.com/v1/payment_intents",
            {
              method: "POST",

              headers: {
  "Authorization": "Bearer " + env.STRIPE_SECRET_KEY,
  "Content-Type":
    "application/x-www-form-urlencoded"
},

              body: params
            }
          );

        const data =
          await stripeResponse.json();

        /*
         * Stripe error
         */
        if (!stripeResponse.ok) {
          return new Response(
            JSON.stringify({
              error:
                data?.error?.message ||
                "Stripe error"
            }),
            {
              status:
                stripeResponse.status,

              headers: {
                "Content-Type":
                  "application/json"
              }
            }
          );
        }

        /*
         * Successful response
         */
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
              "Content-Type":
                "application/json"
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
              "Content-Type":
                "application/json"
            }
          }
        );
      }
    }

    /*
     * Everything else:
     * serve the existing website.
     */
    return env.ASSETS.fetch(request);
  }
};
```
