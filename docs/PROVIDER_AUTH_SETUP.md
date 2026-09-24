# Provider authentication setup

FiiViu uses a D1-backed provider identity and session model.

## Provider login

Providers authenticate with their FiiViu provider account:

- POST /api/provider-login accepts the provider email address and password.
- The Worker validates the account against the migration-owned provider_accounts table.
- A random session token is generated after successful authentication.
- Only a SHA-256 hash of that token is stored in provider_sessions.
- The browser receives the raw session token only as an HttpOnly, Secure, SameSite=Lax cookie.
- Provider API requests derive the provider identity from that session; callers cannot select another provider by supplying a provider reference or Stripe account ID.

The browser must not send a provider bearer token and must not rely on PROVIDER_ACCOUNT_MAP_JSON or PROVIDER_ADMIN_KEY. Those are not part of the current authentication architecture.

## Stripe Connect

Stripe Connect onboarding is provider-scoped:

1. The authenticated provider requests /api/provider/connect-onboarding.
2. The Worker creates or reuses the provider's Connect account server-side.
3. The Connect account ID is stored in the provider record.
4. The Worker returns a server-generated Stripe account-link URL for onboarding.

Marketplace checkout resolves the provider and Connect account from D1. A browser-supplied Connect account ID is not trusted for provider settlement.

## Settlement

Provider settlement is recorded in the booking_settlements ledger.

- The provider share and release time are calculated server-side.
- release_at is tied to the experience start time.
- Webhook and booking-finalization races keep the settlement pending until the release time.
- Settlement release is scheduler-driven.
- Refund reconciliation runs against the settlement ledger before provider transfer.
- Test-mode Stripe uses the test-transfer path and does not move live money.
- Manual provider payouts remain disabled.

## Required production configuration

Provider authentication and settlement require the migration-owned D1 schema plus the production Worker configuration documented in the repository's launch checklist.

Do not add runtime CREATE TABLE, CREATE INDEX, or ALTER TABLE operations to request paths. Production schema changes must be applied through reviewed migrations and verified against the production D1 schema before deployment.

## Launch acceptance

A provider launch check should verify:

1. Provider login creates a session cookie without returning the raw session token in JSON.
2. Provider overview and experience endpoints return only the authenticated provider's data.
3. Connect onboarding is scoped to the authenticated provider.
4. Checkout resolves the provider Connect account server-side.
5. Settlement rows remain pending until release_at.
6. The scheduled settlement worker is enabled.
7. Stripe remains in sandbox/test mode until live activation is explicitly approved.
