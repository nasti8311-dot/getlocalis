ALTER TABLE bookings ADD COLUMN offer_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_bookings_offer_id ON bookings(offer_id);