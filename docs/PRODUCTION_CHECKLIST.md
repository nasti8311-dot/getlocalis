# FiiViu production checklist

## Cloudflare Worker

Deploy `wrangler.jsonc` with `marketplace-entry.js` as the Worker entrypoint. The D1 binding is `DB` and must point to the configured FiiViu database.

Required Worker secrets/variables:

- `STRIPE_SECRET_KEY` — Stripe secret key for the environment being deployed.
- `STRIPE_WEBHOOK_SECRET` — signing secret for the `/api/stripe/webhook` endpoint.
- `PROVIDER_ADMIN_KEY` — internal bearer credential used only by the marketplace layer when forwarding provider management requests.
- `PROVIDER_ACCOUNT_MAP_JSON` — server-side JSON mapping of provider credentials to their Stripe Connect `acct_...` account IDs.

Do not put any of these values in HTML, JavaScript shipped to customers, Git, or D1 rows that are exposed to customers.

## Stripe Connect

Before publishing an experience, the provider must have a valid Stripe Connect account ID stored server-side. The marketplace checkout resolves the provider from the published experience; the browser must not be trusted for settlement routing.

For every provider account used for settlement, verify in Stripe that the account is active and has the capability required to receive transfers. The Worker fails closed when the payment metadata does not contain a valid `acct_...` account ID.

## Webhook

Configure one Stripe webhook endpoint:

`POST /api/stripe/webhook`

The endpoint must use the matching `STRIPE_WEBHOOK_SECRET`. It verifies Stripe signatures and records processed event IDs for deduplication.

The settlement flow is:

1. Customer payment succeeds.
2. The Worker resolves the provider from the published experience.
3. Provider receives the business share: 85% of the customer amount.
4. FiiViu retains 15%, or 12% when a valid partner reference exists.
5. A valid partner reference receives 3%.
6. Refunds proportionally reverse the provider transfer and partner commission, idempotently.

## Provider credentials

Provider-facing requests require a bearer token that maps server-side through `PROVIDER_ACCOUNT_MAP_JSON`. The provider UI does not accept a Stripe Connect account ID from the browser.

Use a unique, high-entropy provider credential per provider. Rotate credentials by updating the server-side mapping. Never reuse the internal `PROVIDER_ADMIN_KEY` as a provider credential.

## D1

Apply the canonical `schema.sql` to the production D1 database before launch. Runtime table creation is defensive only; it is not a substitute for controlled database migrations.

Verify that published experiences contain:

- a unique `experience_id`
- a valid provider Connect account ID
- required meeting-point data
- `status = 'published'`

## End-to-end test in Stripe test mode

Run a complete test booking before switching to live mode:

1. Open a published experience.
2. Complete checkout with a Stripe test payment method.
3. Confirm `payment_intent.succeeded` reaches the Worker.
4. Confirm a booking and settlement ledger row exist in D1.
5. Confirm the provider transfer is created for 85% of the customer amount (subject to Stripe fees as implemented by the settlement calculation).
6. Test a partner booking and confirm the 85/12/3 split.
7. Issue a partial refund and confirm proportional provider and partner reversals.
8. Issue the remaining refund and confirm the settlement reaches `refunded`.
9. Replay the same webhook event and confirm it is treated as a duplicate.
10. Open the emailed booking link and verify the access token is required.

## Go-live boundary

Code and repository configuration can be validated in GitHub, but Cloudflare Worker secrets, D1 production state, Stripe Dashboard configuration, and the live end-to-end payment test require access to the corresponding accounts. Those external account actions must be performed by an authorized operator.
