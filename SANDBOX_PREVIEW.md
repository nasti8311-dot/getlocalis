# Isolated Revolut Pay Sandbox Worker

This config is deliberately separate from `wrangler.jsonc` (production).

## Safety properties

- Worker name: `getlocalis-preview`
- Uses the `workers.dev` hostname only; no `fiiviu.ro` route or custom domain.
- No production D1 database ID or D1 binding.
- No R2 bucket binding.
- No Email Service binding.
- No cron trigger (so scheduled settlement jobs cannot run).
- No secrets are committed to Git.

## Required before deployment

The checkout code requires `env.DB`. Create a **new, empty Cloudflare D1 database** for preview, then add its new database name and ID under `d1_databases` in `wrangler.preview.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "<NEW_PREVIEW_DATABASE_NAME>",
    "database_id": "<NEW_PREVIEW_DATABASE_ID>"
  }
]
```

Apply only the schema/migrations needed by the preview app to that new database. Do not copy the production database ID or production customer data.

Set the Stripe secret in Cloudflare Worker secrets for **getlocalis-preview only**, using a Stripe `sk_test_` key from the Sandbox account. Never put the key in this repository, a config file, or chat. Configure any required Stripe webhook separately with a Sandbox endpoint and Sandbox signing secret.

## Deploy after D1 setup

From the repository root, after confirming the new D1 binding is present:

```sh
npx wrangler deploy --config wrangler.preview.jsonc
```

Then verify the deployed URL is the `getlocalis-preview.*.workers.dev` hostname and that no custom domain or production bindings are attached.

## Current limitation

This file is a safety-isolated starting configuration, **not a deployable checkout yet**: it intentionally has no D1 binding until a new preview database is provisioned. Do not deploy before that step. A successful Revolut Pay Sandbox payment test is still required before considering PR #212 production-ready.
