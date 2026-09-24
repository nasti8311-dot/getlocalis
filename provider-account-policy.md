# FiiViu Provider Account & Settlement Policy

Provider identity and Stripe Connect accounts are authoritative server-side data. Customer checkout must never trust a provider Connect account supplied by the browser. The marketplace resolves the published experience in D1 and copies the server-side provider Connect account into the PaymentIntent metadata.

## Provider identity

The provider portal now uses a server-side provider account and session model.

- Provider login validates the email/password hash against `provider_accounts`.
- Successful login creates a random session token; only its SHA-256 hash is stored in `provider_sessions`.
- The session is returned as an HttpOnly, Secure, SameSite=Lax cookie.
- Provider endpoints derive the provider identity from that authenticated session and query D1 by `provider_ref`.
- Provider authentication schema is checked, not created at request time.
- The browser cannot select another provider by changing a query parameter or Connect account value.

Provider authentication does not depend on `PROVIDER_ACCOUNT_MAP_JSON` or `PROVIDER_ADMIN_KEY`. Those were part of the former bearer-token architecture and are no longer required by the current provider portal.

## Stripe Connect

Connect onboarding is initiated only for the authenticated provider. The server creates an Express account when the provider has no valid `acct_...` account yet, stores that account ID in `providers.connect_account_id`, and creates the Stripe account-link server-side.

Customer checkout resolves the published experience/provider from D1. A browser-supplied Connect account must not become the source of truth.

## Settlement

Settlement must fail closed when a PaymentIntent has no valid provider Connect account. No default or caller-selected provider account is permitted.

Settlement is driven by the `booking_settlements` ledger:

- provider revenue and payout figures come from settlement rows rather than raw booking totals;
- release is controlled by `release_at` and the settlement scheduler;
- already transferred rows are not paid again;
- cancellation/refund reconciliation is idempotent;
- in Stripe test mode, settlement uses the test-transfer path and does not create a live money movement.

Manual provider payouts are disabled. The admin payout endpoint is read-only for settlement inspection; actual release is handled by the settlement system.

## Required production configuration

The deployed Worker requires:

- `DB` — production D1 binding.
- `STRIPE_SECRET_KEY` — Stripe secret API key (currently intentionally sandbox/test).
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret.
- `ADMIN_PAYOUT_KEY` — internal admin/settlement authorization key.
- `EMAILJS_PRIVATE_KEY` and/or `RESEND_API_KEY` — confirmation-mail delivery.

Provider login additionally requires the provider authentication tables from migration 007.

## Launch acceptance checks

1. A provider request without a valid session returns `401`.
2. A provider cannot read another provider's experiences or bookings by changing a query parameter.
3. Provider Connect onboarding is scoped to the authenticated provider.
4. Customer checkout resolves provider/Connect data server-side from the published experience.
5. A successful Stripe payment without a valid provider Connect account cannot enter a normal provider transfer path.
6. Normal settlement uses the configured provider share from the settlement ledger.
7. Partner bookings use the partner settlement ledger when applicable.
8. Refunds proportionally reconcile settlement state with idempotent webhook handling.
9. Provider Connect credentials are never rendered into customer-facing HTML or JavaScript.
10. Stripe remains in sandbox/test mode until an explicit live-readiness decision is made.

The current provider authentication/onboarding model is persisted in D1 and is the source of truth for provider identity.