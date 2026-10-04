ALTER TABLE offers ADD COLUMN capacity INTEGER;
CREATE INDEX IF NOT EXISTS idx_offers_capacity ON offers(id, capacity);