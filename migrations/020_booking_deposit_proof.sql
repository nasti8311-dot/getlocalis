-- Private token for public verification of a paid 20/80 booking deposit.
ALTER TABLE bookings ADD COLUMN proof_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_proof_token ON bookings(proof_token) WHERE proof_token IS NOT NULL;
