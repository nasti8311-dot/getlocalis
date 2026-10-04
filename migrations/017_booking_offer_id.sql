-- Link paid bookings to the FiiViu offer so capacity is counted reliably.
ALTER TABLE bookings ADD COLUMN offer_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_bookings_offer_id ON bookings(offer_id);
