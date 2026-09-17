-- Canonical migration for server-side marketplace experience pricing.
-- Safe to run once; ADD COLUMN is intentionally guarded by migration ordering.

ALTER TABLE experiences ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE experiences ADD COLUMN currency TEXT NOT NULL DEFAULT 'eur';

CREATE INDEX IF NOT EXISTS idx_experiences_price_currency ON experiences(price_cents, currency);
