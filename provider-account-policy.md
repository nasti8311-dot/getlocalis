# FiiViu Provider Account Policy

Provider Connect accounts are authoritative server-side data. Customer checkout must never accept a provider Connect account supplied by the browser. The marketplace resolves the published experience in D1 and copies its `provider_connect_account_id` into the PaymentIntent metadata.

## Provider identity

The provider pages accept only a provider bearer credential. The public marketplace entrypoint resolves that credential through the server-side `PROVIDER_ACCOUNT_MAP_JSON` secret and obtains the corresponding Stripe Connect account ID. The browser cannot choose or override the Connect account.

`PROVIDER_ACCOUNT_MAP_JSON` is a secret mapping of provider credentials to `acct_...` Connect account IDs. It must never be committed to Git, exposed to frontend JavaScript, or placed in public configuration. `PROVIDER_ADMIN_KEY` (or the legacy `ADMIN_PAYOUT_KEY`) remains an internal worker credential used only when the marketplace entrypoint forwards an authenticated provider request to the base worker.

Until a real provider authentication/onboarding system replaces this mapping, each provider credential must be treated as privileged access to exactly one provider account. Do not reuse one credential for multiple providers.

## Settlement

Settlement must fail closed when a PaymentIntent has no valid provider Connect account. No default/fallback provider account is permitted.

Marketplace checkout resolves the provider from the published experience in D1, not from customer input. The Stripe webhook also rejects a successful payment that lacks a valid provider Connect account in metadata.

## Required production configuration

The following values must exist in the deployed Worker environment before provider management and settlement are enabled:

- `DB` — the production D1 binding.
- `STRIPE_SECRET_KEY` — Stripe secret API key.
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret.
- `PROVIDER_ADMIN_KEY` — internal worker-to-worker provider authorization key.
- `PROVIDER_ACCOUNT_MAP_JSON` — secret JSON object mapping provider bearer credentials to their `acct_...` Connect accounts.

Cloudflare secret values must be configured outside the repository. The repository intentionally contains no real provider credentials.

## Launch acceptance checks

1. A provider request without a valid mapped credential returns `401`.
2. A provider cannot read another provider's experiences or bookings by changing a query parameter.
3. Publishing an experience stores the server-resolved Connect account.
4. Customer checkout ignores any browser-supplied provider account and resolves it from the published experience.
5. A successful Stripe payment without a valid provider account is rejected and no provider transfer is created.
6. A normal booking settles 85% to the provider and 15% to FiiViu.
7. A valid partner booking settles 85% to the provider, 12% to FiiViu and 3% to the partner ledger.
8. Refunds proportionally reverse provider transfers and the partner commission ledger, with idempotent webhook handling.
9. Provider Connect credentials are never rendered into customer-facing HTML or JavaScript.

The provider mapping is an interim authentication mechanism. A production onboarding flow should eventually persist a one-to-one mapping between an authenticated provider identity and its Stripe Connect account and retire static bearer credentials.