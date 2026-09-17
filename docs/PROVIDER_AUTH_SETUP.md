# Provider authentication setup

The marketplace edge now derives the provider Stripe Connect account from a server-side token map.

Configure the Worker environment with:

- `PROVIDER_ADMIN_KEY`: privileged key used internally by the provider worker.
- `PROVIDER_ACCOUNT_MAP_JSON`: JSON object mapping each provider's bearer token to exactly one Stripe Connect account.

Example shape (use real secrets/accounts only in Cloudflare secrets/environment configuration):

```json
{"provider-token-1":"acct_...","provider-token-2":"acct_..."}
```

Provider API requests must use the provider token as `Authorization: Bearer <token>`. The browser-supplied `providerConnectAccountId` is overwritten server-side for writes and ignored/replaced for booking reads.

If `PROVIDER_ACCOUNT_MAP_JSON` is missing or invalid, provider API access is denied rather than falling back to arbitrary caller-supplied account IDs.

This is an interim server-side isolation layer. A full provider identity/onboarding system can later replace the token map without changing marketplace settlement rules.
