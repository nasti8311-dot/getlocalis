-- Settlement runtime fields that are required by the launch settlement scheduler.
-- Apply once after migrations 003 and 004 on databases whose booking_settlements
-- table does not already contain these columns.

ALTER TABLE booking_settlements ADD COLUMN provider_ref TEXT;
ALTER TABLE booking_settlements ADD COLUMN provider_name TEXT;
ALTER TABLE booking_settlements ADD COLUMN release_at TEXT;
ALTER TABLE booking_settlements ADD COLUMN settlement_error TEXT;
ALTER TABLE booking_settlements ADD COLUMN settlement_test_transfer_id TEXT;
ALTER TABLE booking_settlements ADD COLUMN settlement_last_attempt_at TEXT;

CREATE INDEX IF NOT EXISTS idx_booking_settlements_release_status
  ON booking_settlements(settlement_status, release_at);
