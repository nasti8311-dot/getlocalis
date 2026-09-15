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
