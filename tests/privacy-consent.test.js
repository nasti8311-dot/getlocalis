import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(path, "utf8");

test("public storefront has an accessible multilingual consent manager", () => {
  const app = read("assets/js/fiiviu-consent.js");
  const home = read("index.html");
  const cookies = read("legal/politica-cookie.html");

  for (const phrase of ["Accept all", "Reject all", "Alle akzeptieren", "Alle ablehnen", "Acceptă toate", "Respinge toate"]) {
    assert.ok(app.includes(phrase), "missing consent action: " + phrase);
  }
  assert.match(app, /fiiviu_consent_v1/);
  assert.match(app, /statistics:\s*false/);
  assert.match(app, /marketing:\s*false/);
  assert.match(app, /openSettings\(\)/);
  assert.match(home, /\/assets\/js\/fiiviu-consent\.js/);
  assert.match(cookies, /de:\s*\{/);
  assert.match(cookies, /en:\s*\{/);
  assert.match(cookies, /ro:\s*\{/);
});

test("Stripe.js is loaded only after the booking payment flow starts", () => {
  const home = read("index.html");
  assert.doesNotMatch(home, /<script\s+src=["']https:\/\/js\.stripe\.com\/v3\//i);
  assert.match(home, /async function ensureStripeLoaded\(\)/);
  assert.match(home, /await ensureStripeLoaded\(\)/);
  assert.match(home, /script\.src = "https:\/\/js\.stripe\.com\/v3\//);
});

test("consent manager is available across booking, partner, provider and legal surfaces", () => {
  for (const path of [
    "index.html",
    "booking.html",
    "booking-verification.html",
    "cancel.html",
    "anbieter-register.html",
    "partner-werden.html",
    "partner.html",
    "provider.html",
    "organizer-admin.html",
    "legal/impressum.html",
    "legal/index.html",
    "legal/politica-cookie.html",
    "legal/politica-de-confidentialitate.html",
    "legal/termeni-si-conditii.html",
    "legal/anulare-si-rambursare.html"
  ]) {
    assert.match(read(path), /\/assets\/js\/fiiviu-consent\.js/, "missing consent controls on " + path);
  }
});

test("privacy policy contains current multilingual retention and transfer disclosures", () => {
  const policy = read("legal/politica-de-confidentialitate.html");
  assert.match(policy, /Letzte Aktualisierung: 7\\. November 2026/);
  assert.match(policy, /Last updated: 7 November 2026/);
  assert.match(policy, /Ultima actualizare: 7 noiembrie 2026/);
  assert.match(policy, /Art\. 25 des rumänischen Gesetzes Nr\. 82\/1991/);
  assert.match(policy, /Article 25 of Romanian Law No\. 82\/1991/);
  assert.match(policy, /content\.en\.sections=/);
  assert.match(policy, /content\.ro\.sections=/);
});


test("affiliate application requires and records explicit agreement acceptance", () => {
  const application = read("partner-werden.html");
  const worker = read("worker.js");
  const agreement = read("legal/affiliate-bedingungen.html");
  const migration = read("migrations/023_affiliate_contract_acceptance.sql");
  const deploy = read(".github/workflows/deploy-production.yml");
  const migrationWorkflow = read(".github/workflows/apply-booking-email-migration.yml");
  assert.match(application, /name="affiliateTermsAccepted" value="yes"/);
  assert.match(application, /affiliate-bedingungen\.html\?lang=ro/);
  assert.match(worker, /body\.privacyNoticeAcknowledged[^\n]*!==["']yes["']/);
  assert.match(worker, /body\.affiliateTermsAccepted[^\n]*!==["']yes["']/);
  assert.match(worker, /INSERT INTO affiliate_contract_acceptances/);
  assert.match(worker, /affiliateContractVersion="affiliate-v1\.0-2026-11-07"/);
  assert.match(worker, /affiliate_contract_accepted_at/);
  assert.match(worker, /affiliateContractBlobSha=/);
  assert.match(migration, /contract_blob_sha TEXT NOT NULL/);
  assert.match(migrationWorkflow, /--file migrations\\/023_affiliate_contract_acceptance\\.sql/);
  assert.match(deploy, /FROM affiliate_contract_acceptances LIMIT 0/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS affiliate_contract_acceptances/);
  assert.match(agreement, /5%/);
  assert.match(agreement, /14 Tage/);
  assert.match(agreement, /14 zile/);
  assert.match(agreement, /14 days/);
  assert.match(agreement, /No permanent cookie attribution/);
  assert.match(agreement, /Plățile nu sunt efectuate automat/);
});
