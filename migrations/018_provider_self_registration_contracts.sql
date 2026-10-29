-- Provider self-registration and click-through contract evidence.
-- Existing provider identity and session tables remain the single source of truth.
ALTER TABLE providers ADD COLUMN company_name TEXT;
ALTER TABLE providers ADD COLUMN cui TEXT;
ALTER TABLE providers ADD COLUMN representative_name TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_cui ON providers(cui) WHERE cui IS NOT NULL AND trim(cui) <> '';

CREATE TABLE IF NOT EXISTS vendor_contract_logs (
  id TEXT PRIMARY KEY,
  provider_ref TEXT NOT NULL REFERENCES providers(provider_ref),
  accepted_at TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  contract_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vendor_contract_logs_provider_ref ON vendor_contract_logs(provider_ref);
CREATE INDEX IF NOT EXISTS idx_vendor_contract_logs_accepted_at ON vendor_contract_logs(accepted_at);
