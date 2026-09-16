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

CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner_ref
  ON partner_payouts(partner_ref);

CREATE INDEX IF NOT EXISTS idx_partner_payouts_payout_date
  ON partner_payouts(payout_date);

-- Experience providers receive the provider share through Stripe Connect.
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

CREATE INDEX IF NOT EXISTS idx_providers_status
  ON providers(status);

CREATE INDEX IF NOT EXISTS idx_providers_stripe_account
  ON providers(stripe_account_id);
