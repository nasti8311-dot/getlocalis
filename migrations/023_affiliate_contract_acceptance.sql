-- Explicit acceptance evidence for the affiliate partner agreement.
-- Applications are still reviewed and approved manually; accepting the terms
-- does not itself activate a partner account.
CREATE TABLE IF NOT EXISTS affiliate_contract_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  contract_version TEXT NOT NULL,
  contract_blob_sha TEXT NOT NULL,
  contract_language TEXT NOT NULL DEFAULT 'ro',
  accepted_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  privacy_notice_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (privacy_notice_acknowledged IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES partner_applications(id)
);
CREATE INDEX IF NOT EXISTS idx_affiliate_contract_acceptances_application_id
  ON affiliate_contract_acceptances(application_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_contract_acceptances_accepted_at
  ON affiliate_contract_acceptances(accepted_at);
