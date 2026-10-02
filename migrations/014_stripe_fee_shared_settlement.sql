-- Allocate the actual Stripe processing fee proportionally across provider, FiiViu and partner shares.
-- booking_settlements amounts become net settlement amounts after the Stripe fee.

ALTER TABLE booking_settlements ADD COLUMN stripe_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE booking_settlements ADD COLUMN net_settlement_amount_cents INTEGER;

CREATE INDEX IF NOT EXISTS idx_booking_settlements_stripe_fee
  ON booking_settlements(stripe_fee_cents);
