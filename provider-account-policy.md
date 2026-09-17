# FiiViu Provider Account Policy

Provider Connect accounts are authoritative server-side data. Customer checkout must never accept a provider Connect account supplied by the browser. The marketplace resolves the published experience in D1 and copies its provider_connect_account_id into the payment-intent metadata.

Provider management currently uses a shared administrative bearer key. Until provider identity/onboarding is implemented, that key must be treated as privileged administrative access and provider account IDs must not be considered user-owned identity claims.

Settlement must fail closed when a payment intent has no valid provider Connect account. No default/fallback provider account is permitted.

Before production settlement is enabled, provider onboarding should persist a one-to-one mapping between an authenticated provider identity and its Stripe Connect account, and provider APIs should derive the account from that mapping instead of accepting an arbitrary account ID from the caller.
