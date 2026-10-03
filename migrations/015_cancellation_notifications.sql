-- Cancellation notification delivery tracking.
-- Safe to apply when bookings already exist.

ALTER TABLE bookings ADD COLUMN cancellation_customer_email_sent_at TEXT;
ALTER TABLE bookings ADD COLUMN cancellation_customer_email_error TEXT;
ALTER TABLE bookings ADD COLUMN cancellation_provider_email_sent_at TEXT;
ALTER TABLE bookings ADD COLUMN cancellation_provider_email_error TEXT;
ALTER TABLE bookings ADD COLUMN cancellation_admin_email_sent_at TEXT;
ALTER TABLE bookings ADD COLUMN cancellation_admin_email_error TEXT;
