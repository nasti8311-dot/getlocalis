export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

        const partnerRef =
  typeof body.partnerRef === "string"
    ? body.partnerRef.trim()
    : "";

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
        "Content-Type":
          "application/json"
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

return env.ASSETS.fetch(request);
  }
};
