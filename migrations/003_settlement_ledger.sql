-- Canonical settlement/webhook ledger tables used by stripe-webhook.js.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stripe_payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_intent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  amount_cents INTEGER,
  currency TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(payment_intent_id, event_type)
);

CREATE TABLE IF NOT EXISTS stripe_refund_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_id TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT,
  charge_id TEXT,
  amount_cents INTEGER,
  currency TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stripe_transfer_reversal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reversal_id TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT,
  transfer_id TEXT,
  amount_cents INTEGER,
  currency TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stripe_partner_reversal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_intent_id TEXT NOT NULL,
  partner_ref TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(payment_intent_id, partner_ref)
);

CREATE TABLE IF NOT EXISTS booking_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT UNIQUE,
  total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents > 0),
  provider_amount_cents INTEGER NOT NULL CHECK (provider_amount_cents >= 0),
  fiiviu_amount_cents INTEGER NOT NULL CHECK (fiiviu_amount_cents >= 0),
  partner_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (partner_amount_cents >= 0),
  partner_ref TEXT,
  provider_connect_account_id TEXT,
  transfer_id TEXT,
  transfer_currency TEXT,
  settlement_status TEXT NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending','ready','transferred','failed','refunded','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_booking_settlements_payment_intent ON booking_settlements(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_booking_settlements_partner_ref ON booking_settlements(partner_ref);
CREATE INDEX IF NOT EXISTS idx_booking_settlements_provider ON booking_settlements(provider_connect_account_id);
CREATE INDEX IF NOT EXISTS idx_booking_settlements_status ON booking_settlements(settlement_status);
