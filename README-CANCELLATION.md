# FiiViu booking cancellation

The feature branch contains the customer cancellation page and professional confirmation email template. The confirmation email links to `/cancel.html?token=...`; cancellation is limited to the configured 24-hour window and refunds the Stripe PaymentIntent with an idempotency key.
