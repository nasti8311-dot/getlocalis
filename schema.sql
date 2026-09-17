-- FiiViu partner payout ledger
-- Run this once against the production Cloudflare D1 database.

CREATE TABLE IF NOT EXISTS partner_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_ref TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  payout_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'cancelled')),
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner_ref
  ON partner_payouts(partner_ref);

CREATE INDEX IF NOT EXISTS idx_partner_payouts_payout_date
  ON partner_payouts(payout_date);

-- Confirmed customer bookings. The confirmation email timestamp makes
-- confirmation-mail delivery idempotent and prevents duplicate sends.
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'refunded')),
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  customer_language TEXT NOT NULL DEFAULT 'en'
    CHECK (customer_language IN ('de', 'en', 'ro')),
  experience_name TEXT NOT NULL,
  booking_date TEXT,
  booking_time TEXT,
  guests INTEGER NOT NULL DEFAULT 1 CHECK (guests > 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
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
  confirmation_email_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer_email
  ON bookings(customer_email);

CREATE INDEX IF NOT EXISTS idx_bookings_status
  ON bookings(status);

CREATE INDEX IF NOT EXISTS idx_bookings_booking_date
  ON bookings(booking_date);

CREATE INDEX IF NOT EXISTS idx_bookings_confirmation_email
  ON bookings(confirmation_email_sent_at);
