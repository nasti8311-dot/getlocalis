-- Compatibility migration for columns used by stripe-webhook.js.
-- Migration 003 already provides the canonical base columns. This migration
-- only adds fields that older 003/runtime table variants are missing.
-- All compatibility columns are nullable so existing rows remain valid.

-- booking_settlements: runtime settlement/transfer reconciliation fields.
ALTER TABLE booking_settlements ADD COLUMN provider_transfer_amount_cents INTEGER;
ALTER TABLE booking_settlements ADD COLUMN provider_transfer_currency TEXT;
ALTER TABLE booking_settlements ADD COLUMN provider_transfer_id TEXT;
ALTER TABLE booking_settlements ADD COLUMN partner_reversal_amount_cents INTEGER NOT NULL DEFAULT 0;

-- stripe_payment_events: runtime uses event_id, booking_id, partner_ref,
-- amount and payment_status in addition to migration 003's base fields.
ALTER TABLE stripe_payment_events ADD COLUMN event_id TEXT;
ALTER TABLE stripe_payment_events ADD COLUMN booking_id TEXT;
ALTER TABLE stripe_payment_events ADD COLUMN partner_ref TEXT;
ALTER TABLE stripe_payment_events ADD COLUMN amount INTEGER;
ALTER TABLE stripe_payment_events ADD COLUMN payment_status TEXT;

-- stripe_refund_events: runtime records status/event_type and uses amount.
ALTER TABLE stripe_refund_events ADD COLUMN amount INTEGER;
ALTER TABLE stripe_refund_events ADD COLUMN status TEXT;
ALTER TABLE stripe_refund_events ADD COLUMN event_type TEXT;

-- stripe_transfer_reversal_events: runtime records status/event_type and uses amount.
ALTER TABLE stripe_transfer_reversal_events ADD COLUMN amount INTEGER;
ALTER TABLE stripe_transfer_reversal_events ADD COLUMN status TEXT;
ALTER TABLE stripe_transfer_reversal_events ADD COLUMN event_type TEXT;

-- stripe_partner_reversal_events: runtime records a deterministic reversal_id,
-- status/event_type and uses amount.
ALTER TABLE stripe_partner_reversal_events ADD COLUMN reversal_id TEXT;
ALTER TABLE stripe_partner_reversal_events ADD COLUMN amount INTEGER;
ALTER TABLE stripe_partner_reversal_events ADD COLUMN status TEXT;
ALTER TABLE stripe_partner_reversal_events ADD COLUMN event_type TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_payment_events_event_id
  ON stripe_payment_events(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_partner_reversal_events_reversal_id
  ON stripe_partner_reversal_events(reversal_id);
CREATE INDEX IF NOT EXISTS idx_booking_settlements_provider_transfer
  ON booking_settlements(provider_transfer_id);
