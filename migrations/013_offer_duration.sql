-- Duration and guide language for legacy organizer offers.
ALTER TABLE offers ADD COLUMN duration TEXT;
ALTER TABLE offers ADD COLUMN guide_language TEXT;
