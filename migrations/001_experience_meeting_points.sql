-- FiiViu: reusable meeting-point data for experiences.
-- The frontend currently keeps experiences in index.html; this table prepares the
-- provider/admin data model so meeting points can later be managed centrally.

CREATE TABLE IF NOT EXISTS experience_meeting_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experience_id TEXT NOT NULL UNIQUE,
  meeting_point_name TEXT NOT NULL,
  meeting_address TEXT NOT NULL,
  meeting_city TEXT NOT NULL DEFAULT 'Bucharest',
  meeting_country TEXT NOT NULL DEFAULT 'Romania',
  meeting_instructions TEXT,
  arrival_minutes_before INTEGER,
  meeting_latitude TEXT,
  meeting_longitude TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_experience_meeting_points_experience_id
  ON experience_meeting_points(experience_id);

CREATE INDEX IF NOT EXISTS idx_experience_meeting_points_active
  ON experience_meeting_points(active);
