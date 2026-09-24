-- Legacy partner/booking schemas used by compatibility routes are migration-owned.

CREATE TABLE IF NOT EXISTS partner_scan_events (id INTEGER PRIMARY KEY AUTOINCREMENT,partner_ref TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_partner_scan_events_partner_ref ON partner_scan_events(partner_ref);
CREATE TABLE IF NOT EXISTS partner_visitors (id INTEGER PRIMARY KEY AUTOINCREMENT,partner_ref TEXT NOT NULL,visitor_id TEXT NOT NULL,first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(partner_ref,visitor_id));
CREATE INDEX IF NOT EXISTS idx_partner_visitors_partner_ref ON partner_visitors(partner_ref);
CREATE TABLE IF NOT EXISTS partners (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'Hotel',partner_ref TEXT NOT NULL UNIQUE,contact_name TEXT,contact_email TEXT,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS partner_auth_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT,partner_ref TEXT NOT NULL UNIQUE,token_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (partner_ref) REFERENCES partners(partner_ref));
CREATE INDEX IF NOT EXISTS idx_partner_auth_tokens_hash ON partner_auth_tokens(token_hash);
CREATE TABLE IF NOT EXISTS partner_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT,partner_ref TEXT NOT NULL UNIQUE,email TEXT NOT NULL UNIQUE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (partner_ref) REFERENCES partners(partner_ref));
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_accounts_email ON partner_accounts(email);
CREATE TABLE IF NOT EXISTS partner_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT,partner_ref TEXT NOT NULL,session_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (partner_ref) REFERENCES partners(partner_ref));
CREATE INDEX IF NOT EXISTS idx_partner_sessions_partner ON partner_sessions(partner_ref);
CREATE INDEX IF NOT EXISTS idx_partner_sessions_expires ON partner_sessions(expires_at);
CREATE TABLE IF NOT EXISTS partner_payouts (id INTEGER PRIMARY KEY AUTOINCREMENT,partner_ref TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),payout_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'cancelled')),reference TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner_ref ON partner_payouts(partner_ref);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_payout_date ON partner_payouts(payout_date);
