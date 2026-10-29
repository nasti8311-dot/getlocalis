-- Versioned fields for FiiViu's 20% online fee / 80% direct-to-provider model.
-- Existing rows retain payment_model='legacy_connect'; amount_cents keeps its historical meaning.
ALTER TABLE bookings ADD COLUMN total_amount_cents INTEGER;
ALTER TABLE bookings ADD COLUMN fiiviu_fee_cents INTEGER;
ALTER TABLE bookings ADD COLUMN provider_due_cents INTEGER;
ALTER TABLE bookings ADD COLUMN payment_model TEXT NOT NULL DEFAULT 'legacy_connect';
ALTER TABLE bookings ADD COLUMN cancellation_reason TEXT;
ALTER TABLE bookings ADD COLUMN provider_ref TEXT;
