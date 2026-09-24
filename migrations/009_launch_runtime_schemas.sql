-- Runtime launch schemas are migration-owned. Safe to apply when tables already exist.

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  customer_language TEXT NOT NULL DEFAULT 'en',
  experience_name TEXT NOT NULL,
  booking_date TEXT,
  booking_time TEXT,
  guests INTEGER NOT NULL DEFAULT 1,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'eur',
  meeting_point_name TEXT,
  meeting_address TEXT,
  meeting_city TEXT,
  meeting_country TEXT,
  meeting_instructions TEXT,
  arrival_minutes_before INTEGER,
  meeting_latitude TEXT,
  meeting_longitude TEXT,
  partner_ref TEXT,
  provider_name TEXT,
  provider_connect_account_id TEXT,
  booking_access_token TEXT,
  confirmation_email_sent_at TEXT,
  confirmation_email_error TEXT,
  cancellation_token TEXT,
  cancelled_at TEXT,
  cancellation_refund_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_access_token ON bookings(booking_access_token) WHERE booking_access_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_cancellation_token ON bookings(cancellation_token) WHERE cancellation_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS experiences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experience_id TEXT NOT NULL UNIQUE,
  provider_connect_account_id TEXT,
  provider_name TEXT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'explore',
  image_url TEXT,
  gallery_urls TEXT,
  available_times TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_cents>=0),
  currency TEXT NOT NULL DEFAULT 'eur',
  meeting_point_name TEXT,
  meeting_address TEXT,
  meeting_city TEXT,
  meeting_country TEXT,
  meeting_instructions TEXT,
  arrival_minutes_before INTEGER,
  meeting_latitude TEXT,
  meeting_longitude TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_experiences_provider ON experiences(provider_connect_account_id);
CREATE INDEX IF NOT EXISTS idx_experiences_status ON experiences(status);

CREATE TABLE IF NOT EXISTS partner_scan_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_partner_scan_events_partner_ref ON partner_scan_events(partner_ref);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stripe_payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT,
  event_type TEXT NOT NULL,
  booking_id TEXT,
  partner_ref TEXT,
  amount INTEGER,
  currency TEXT,
  payment_status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stripe_payment_events_payment_intent ON stripe_payment_events(payment_intent_id);

CREATE TABLE IF NOT EXISTS stripe_refund_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_id TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT NOT NULL,
  charge_id TEXT,
  amount INTEGER NOT NULL,
  status TEXT,
  event_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stripe_refund_events_payment_intent ON stripe_refund_events(payment_intent_id);

CREATE TABLE IF NOT EXISTS stripe_transfer_reversal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reversal_id TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT,
  event_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stripe_transfer_reversal_events_payment_intent ON stripe_transfer_reversal_events(payment_intent_id);

CREATE TABLE IF NOT EXISTS stripe_partner_reversal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reversal_id TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT NOT NULL,
  partner_ref TEXT,
  amount INTEGER NOT NULL,
  status TEXT,
  event_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stripe_partner_reversal_events_payment_intent ON stripe_partner_reversal_events(payment_intent_id);
