-- Link paid bookings to the legacy offer used for slot capacity accounting.
ALTER TABLE bookings ADD COLUMN offer_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_bookings_offer_slot ON bookings(offer_id,booking_date,booking_time,status,payment_status);
