-- Recurring availability and date exceptions for provider-created offers.
-- The worker also adds this column automatically for existing D1 databases.
ALTER TABLE offers ADD COLUMN availability_rules TEXT;
