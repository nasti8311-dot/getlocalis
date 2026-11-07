-- Add persisted status for organizer and admin booking notification emails.
-- Sent timestamps are written only after Resend accepts the message.
ALTER TABLE bookings ADD COLUMN provider_notification_email_sent_at TEXT;
ALTER TABLE bookings ADD COLUMN provider_notification_email_error TEXT;
ALTER TABLE bookings ADD COLUMN admin_notification_email_sent_at TEXT;
ALTER TABLE bookings ADD COLUMN admin_notification_email_error TEXT;
