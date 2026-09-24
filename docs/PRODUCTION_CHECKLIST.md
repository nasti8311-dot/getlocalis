# FiiViu production launch checklist

## 1. Worker and routing

The production Worker entrypoint is `secure-entry.js`.

Required runtime bindings:

- D1: `DB` → `fiiviu-payouts`
- Email Service: `EMAIL`
- Cron: `*/15 * * * *` for due provider settlements

Admin/provider routes are session- or admin-key protected. Customer checkout uses the marketplace layer.

## 2. Required production secrets

Keep these server-side only:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `ADMIN_PAYOUT_KEY`
- `EMAILJS_PRIVATE_KEY`
- `RESEND_API_KEY` (fallback)

Do not place secret values in HTML, browser JavaScript, Git, or customer-visible D1 data.

The public Stripe.js key belongs in the customer frontend and must match the same Stripe account and mode as `STRIPE_SECRET_KEY`.

## 3. Stripe mode boundary

Before go-live, use Stripe **test/sandbox mode** for all launch verification.

The current production configuration has deliberately remained in Stripe sandbox mode. Do not switch to live mode until the authorized operator has completed the final live-account configuration and explicitly approved the change.

Never use or modify existing test settlements as part of verification.

## 4. Marketplace checkout

Verify:

- published offers resolve their provider server-side;
- inactive providers are excluded from the public catalog and checkout;
- price, experience, provider and booking identifiers are resolved/validated server-side;
- PaymentIntent creation uses the configured Stripe secret;
- checkout confirmation sends the PaymentIntent ID **and client secret** to server-side finalization;
- finalization accepts only a Stripe PaymentIntent with `status=succeeded` and a matching client secret;
- repeated finalization/webhook delivery is idempotent.

## 5. Booking access and email

Verify:

- successful payment creates one booking;
- the booking receives a high-entropy access token;
- customer booking lookup requires both booking ID and access token;
- cancellation requires the booking's cancellation credentials and respects the 24-hour policy;
- EmailJS confirmation is the primary sender when configured;
- Resend is the fallback;
- the confirmation email contains the booking access link.

## 6. Provider security

Provider-facing management uses the D1-backed cookie session model.

Verify:

- login validates the stored password hash;
- session tokens are stored hashed server-side;
- provider APIs derive provider identity from the authenticated session;
- browser input cannot select another provider's Connect account or bookings;
- inactive providers cannot use the provider dashboard;
- Connect onboarding/status are resolved from the authenticated provider.

No legacy `PROVIDER_ADMIN_KEY`, `PROVIDER_ACCOUNT_MAP_JSON`, or browser-supplied Connect routing is part of the active architecture.

## 7. Settlement hardening

Settlement is scheduler-driven and ledger-backed.

Current runtime split:

- provider: **82.5%**
- partner commission when a valid partner reference exists: **5%**
- FiiViu remainder: **12.5%**

The scheduler:

- releases settlements only when `release_at` is due;
- uses an atomic `releasing` claim;
- skips rows that already have a real provider transfer;
- skips sandbox rows that already have `settlement_test_transfer_id`;
- uses Stripe idempotency keys for provider transfers;
- fails closed without a valid provider Connect account;
- does not perform live money movement while the configured Stripe key is sandbox/test.

Do not manually replay, reset, migrate, or pay existing production test settlements during launch verification.

## 8. D1 schema

Production D1 is already populated with the runtime settlement/provider fields required by the current Worker.

Important:

- Do **not** blindly execute migration 011 against the current production database; its columns already exist there.
- The repository migration files document the intended schema evolution.
- The D1 audit workflow tolerates environments without a `d1_migrations` table and still reports the available schema.

For launch verification, confirm the key tables/fields exist rather than using runtime DDL as a deployment step.

## 9. Organizer admin

Verify:

- provider/offer management requires the admin credential;
- deleting an offer with an existing booking deactivates it instead of deleting it;
- deleting an unreferenced offer removes it;
- DELETE CORS is restricted to the configured application origins.

## 10. Final end-to-end verification

In Stripe test mode:

1. Open a published experience.
2. Complete a fresh test checkout.
3. Confirm the success page shows the booking ID.
4. Confirm the confirmation email arrives.
5. Open the booking link and verify token protection.
6. Verify the booking and settlement ledger row in D1.
7. Verify provider dashboard isolation.
8. Verify cancellation/refund behavior with a dedicated test booking if required.

Avoid altering existing historical test settlements.

## 11. Go-live boundary

Code, GitHub CI and repository configuration can be hardened in the repository.

The following require an authorized operator in the external accounts:

- final Cloudflare route/custom-domain verification;
- production D1 inspection;
- Stripe webhook/dashboard verification;
- final live Stripe account configuration;
- final live payment test.

Live Stripe activation is intentionally **not** part of the current launch-hardening changes.
