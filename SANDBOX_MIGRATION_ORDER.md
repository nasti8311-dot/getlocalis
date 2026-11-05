# D1 migration plan for the isolated Revolut preview

This file documents dependencies and duplicate-column conflicts discovered in
`migrations/001`–`021`. It is **not** an instruction to replay migrations
against an existing database.

## Fresh empty database: safe schema bootstrap

Apply these table-creating migrations first:

1. `001_experience_meeting_points.sql`
2. `003_settlement_ledger.sql`
3. `007_provider_auth.sql`
4. `008_provider_marketplace_schema.sql`
5. `009_launch_runtime_schemas.sql`
6. `010_legacy_partner_schema.sql`

Then apply these additive migrations, after confirming each target table exists:

7. `004_settlement_ledger_compat.sql` — requires ledger tables from 003.
8. `011_settlement_runtime_fields.sql` — requires `booking_settlements` from 003.
9. `012_fiiviu_direct_provider_payment.sql` — requires `bookings` from 009.
10. `013_offer_duration.sql` — requires `offers` from 008.
11. `014_stripe_fee_shared_settlement.sql` — requires `booking_settlements` from 003.
12. `015_cancellation_notifications.sql` — requires `bookings` from 009.
13. `016_offer_capacity.sql` — requires `offers` from 008.
14. `017_booking_offer_id.sql` — requires `bookings` from 009.
15. `018_provider_self_registration_contracts.sql` — requires providers/offers from 008; duration is owned by 013.
16. `019_provider_availability_rules.sql` — requires `offers` from 008.
17. `020_booking_deposit_proof.sql` — requires `bookings` from 009.
18. `021_offer_approval_status.sql` — requires `offers` from 008.

## Excluded / redundant migrations

- `002_experience_pricing.sql` is redundant and must be skipped: migration 009
  already creates `experiences.price_cents` and `experiences.currency`.
- `005_seed_marketplace_experiences.sql` is demo/catalog seed data and is not
  part of the payment Sandbox bootstrap.
- `006_demo_meeting_details.sql` must be skipped: it adds `provider_name`
  to `experiences` and `bookings`, but 009 already creates those columns;
  it also contains demo-only UPDATE statements.
- Migration 018 no longer adds `offers.duration`; migration 013 owns that column.

## Existing partially initialized preview database

The Cloudflare D1 database `getlocalis-preview` has already received some schema
changes manually. Do not replay the list above against it. First compare
`PRAGMA table_info(...)` and `sqlite_master` for every required table/index,
then apply only missing, verified statements. Keep all checks and writes scoped
to preview database ID `dae6a949-a2d2-45e2-8ce2-961d9806282c`.

No production database, Worker route, secrets, or live Stripe settings are part
of this plan.
