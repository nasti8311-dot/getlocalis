-- Existing offers remain published; new and edited provider offers require admin approval.
ALTER TABLE offers ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved';
