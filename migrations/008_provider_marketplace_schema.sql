-- Provider/admin marketplace tables used by the provider portal.
-- Apply explicitly to each D1 database before enabling these endpoints.

CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_ref TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  connect_account_id TEXT,
  contact_email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_providers_connect_account
  ON providers(connect_account_id);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_ref TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 50),
  currency TEXT NOT NULL DEFAULT 'eur',
  available_times TEXT,
  meeting_point_name TEXT,
  meeting_address TEXT,
  meeting_city TEXT,
  meeting_country TEXT,
  meeting_instructions TEXT,
  arrival_minutes_before INTEGER,
  title_en TEXT,
  title_ro TEXT,
  description_en TEXT,
  description_ro TEXT,
  meeting_point_name_en TEXT,
  meeting_point_name_ro TEXT,
  meeting_instructions_en TEXT,
  meeting_instructions_ro TEXT,
  image_url TEXT,
  gallery_urls TEXT,
  category TEXT NOT NULL DEFAULT 'explore',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_offers_provider_ref ON offers(provider_ref);

CREATE TABLE IF NOT EXISTS provider_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT NOT NULL UNIQUE,
  provider_ref TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  payout_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','failed','cancelled')),
  provider_transfer_id TEXT UNIQUE,
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_provider_payouts_provider_ref
  ON provider_payouts(provider_ref);
