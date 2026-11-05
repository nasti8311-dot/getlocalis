# D1 migration order for the isolated Revolut preview

This file documents dependencies discovered by reviewing `migrations/001`–`021`.
It is **not** an instruction to replay migrations against an existing database.

## Fresh empty database: dependency-safe order

1. `001_experience_meeting_points.sql`
2. `003_settlement_ledger.sql`
3. `007_provider_auth.sql`
4. `008_provider_marketplace_schema.sql`
5. `009_launch_runtime_schemas.sql`
6. `010_legacy_partner_schema.sql`
7. `002_experience_pricing.sql` — requires `experiences` from 009.
8. `004_settlement_ledger_compat.sql` — requires ledger tables from 003.
9. `011_settlement_runtime_fields.sql` — requires `booking_settlements` from 003.
10. `012_fiiviu_direct_provider_payment.sql` — requires `bookings` from 009.
11. `013_offer_duration.sql` — requires `offers` from 008.
12. `014_stripe_fee_shared_settlement.sql` — requires `booking_settlements` from 003.
13. `015_cancellation_notifications.sql` — requires `bookings` from 009.
14. `016_offer_capacity.sql` — requires `offers` from 008.
15. `017_booking_offer_id.sql` — requires `bookings` from 009.
16. `018_provider_self_registration_contracts.sql` — requires providers/offers from 008; duration is owned by 013.
17. `019_provider_availability_rules.sql` — requires `offers` from 008.
18. `020_booking_deposit_proof.sql` — requires `bookings` from 009.
19. `021_offer_approval_status.sql` — requires `offers` from 008.

## Do not run automatically

- `005_seed_marketplace_experiences.sql` and `006_demo_meeting_details.sql` contain demo/catalog data updates. They are intentionally excluded from the payment Sandbox bootstrap.
- Migration 006 also alters `experiences` and `bookings`; it must not run before 009.
- Migration 002 must not run before 009.
- Migration 018 no longer adds `offers.duration`; migration 013 owns that column.

## Existing partially initialized preview database

The Cloudflare D1 database `getlocalis-preview` has already received some schema changes manually.
Do not replay the list above against it. First compare `PRAGMA table_info(...)` and
`sqlite_master` for every required table/index, then apply only missing, verified
statements. Keep all checks and writes scoped to the preview database ID
`dae6a949-a2d2-45e2-8ce2-961d9806282c`.

No production database, Worker route, secrets, or live Stripe settings are part of this plan.
