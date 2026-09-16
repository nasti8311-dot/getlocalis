-- FiiViu marketplace database schema
-- Keeps distribution/referral partners separate from experience providers.

CREATE TABLE IF NOT EXISTS partner_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_ref TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  payout_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'cancelled')),
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner_ref ON partner_payouts(partner_ref);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_payout_date ON partner_payouts(payout_date);

CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legal_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  cui TEXT,
  vat_number TEXT,
  stripe_account_id TEXT UNIQUE,
  stripe_onboarding_status TEXT NOT NULL DEFAULT 'not_started',
  stripe_payouts_enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_providers_status ON providers(status);
CREATE INDEX IF NOT EXISTS idx_providers_stripe_account ON providers(stripe_account_id);

CREATE TABLE IF NOT EXISTS experience_providers (
  experience_id TEXT PRIMARY KEY,
  provider_id INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

CREATE INDEX IF NOT EXISTS idx_experience_providers_provider ON experience_providers(provider_id);

CREATE TABLE IF NOT EXISTS booking_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT NOT NULL UNIQUE,
  experience_id TEXT NOT NULL,
  provider_id INTEGER NOT NULL,
  payment_intent_id TEXT UNIQUE,
  gross_cents INTEGER NOT NULL,
  provider_cents INTEGER NOT NULL,
  platform_cents INTEGER NOT NULL,
  partner_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'eur',
  partner_ref TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

CREATE INDEX IF NOT EXISTS idx_booking_settlements_provider ON booking_settlements(provider_id);
CREATE INDEX IF NOT EXISTS idx_booking_settlements_experience ON booking_settlements(experience_id);
CREATE INDEX IF NOT EXISTS idx_booking_settlements_partner ON booking_settlements(partner_ref);
