export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();

    const amount = Number(body.amount);
    const currency = String(body.currency || "eur").toLowerCase();
    const bookingId = String(body.bookingId || "").trim();
    const tourName = String(body.tourName || "").trim();
    const guests = Number(body.guests || 1);

    if (!Number.isInteger(amount) || amount < 50) {
      return json({ error: "Invalid amount" }, 400);
    }

    if (!env.STRIPE_SECRET_KEY) {
      return json({ error: "Stripe secret not configured" }, 500);
    }

    if (!bookingId || !tourName || !Number.isInteger(guests) || guests < 1) {
      return json({ error: "Invalid booking data" }, 400);
    }

    const params = new URLSearchParams();
    params.set("amount", String(amount));
    params.set("currency", currency);
    params.set("metadata[booking_id]", bookingId);
    params.set("metadata[tour_name]", tourName);
    params.set("metadata[guests]", String(guests));

    const metadata = {
      customer_name: body.customerName,
      customer_email: body.customerEmail,
      customer_phone: body.customerPhone,
      customer_language: body.customerLanguage,
      booking_date: body.bookingDate,
      booking_time: body.bookingTime,
      meeting_point_name: body.meetingPointName,
      meeting_address: body.meetingAddress,
      meeting_city: body.meetingCity,
      meeting_country: body.meetingCountry,
      meeting_instructions: body.meetingInstructions,
      arrival_minutes_before: body.arrivalMinutesBefore,
      meeting_latitude: body.meetingLatitude,
      meeting_longitude: body.meetingLongitude
    };

    for (const [key, value] of Object.entries(metadata)) {
      const normalized = String(value ?? "").trim();
      if (normalized) params.set(`metadata[${key}]`, normalized.slice(0, 500));
    }

    params.set("automatic_payment_methods[enabled]", "true");

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/payment_intents",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params
      }
    );

    const data = await stripeResponse.json();

    if (!stripeResponse.ok) {
      return json({ error: data?.error?.message || "Stripe error" }, stripeResponse.status);
    }

    return json({
      clientSecret: data.client_secret,
      paymentIntentId: data.id
    }, 200);

  } catch (error) {
    return json({ error: error?.message || "Server error" }, 500);
  }
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
