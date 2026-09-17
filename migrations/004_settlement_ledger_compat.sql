-- Compatibility migration for settlement columns used by stripe-webhook.js.
-- Safe to run after migration 003. Existing installations receive the missing columns.

ALTER TABLE booking_settlements ADD COLUMN provider_transfer_amount_cents INTEGER;
ALTER TABLE booking_settlements ADD COLUMN provider_transfer_currency TEXT;
ALTER TABLE booking_settlements ADD COLUMN provider_transfer_id TEXT;
ALTER TABLE booking_settlements ADD COLUMN partner_reversal_amount_cents INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_booking_settlements_provider_transfer ON booking_settlements(provider_transfer_id);
