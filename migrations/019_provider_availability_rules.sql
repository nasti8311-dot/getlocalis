-- Provider experience availability calendar rules.
-- Applied before the Worker is deployed; request handlers only validate schema.
ALTER TABLE offers ADD COLUMN availability_rules TEXT;
