-- Explicit on-site payment methods for legacy provider offers.
-- Existing offers default to neither method until the admin enables them.
ALTER TABLE offers ADD COLUMN accepts_card_onsite INTEGER NOT NULL DEFAULT 0 CHECK (accepts_card_onsite IN (0,1));
ALTER TABLE offers ADD COLUMN accepts_cash_onsite INTEGER NOT NULL DEFAULT 0 CHECK (accepts_cash_onsite IN (0,1));
