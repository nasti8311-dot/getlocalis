-- Provider authentication schema.
-- Apply this migration before enabling provider login on a database.

CREATE TABLE IF NOT EXISTS provider_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_ref TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_provider_accounts_provider_ref
  ON provider_accounts(provider_ref);

CREATE INDEX IF NOT EXISTS idx_provider_accounts_email
  ON provider_accounts(email);

CREATE TABLE IF NOT EXISTS provider_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_ref TEXT NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_provider_sessions_provider_ref
  ON provider_sessions(provider_ref);

CREATE INDEX IF NOT EXISTS idx_provider_sessions_expires_at
  ON provider_sessions(expires_at);
