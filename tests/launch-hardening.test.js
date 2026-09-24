import { calculateSettlementReleaseAt } from "../stripe-webhook.js";
import { getCancellationState, parseBookingDateTime } from "../worker-entry.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("Stripe webhook claims events atomically", () => {
  const source = read("stripe-webhook.js");
  assert.match(source, /INSERT\s+OR\s+IGNORE\s+INTO\s+stripe_webhook_events/);
  assert.match(source, /duplicate:\s*true/);
  assert.match(source, /DELETE\s+FROM\s+stripe_webhook_events\s+WHERE\s+event_id\s*=/);
});

test("refund reconciliation is wired to settlement ledger", () => {
  const source = read("stripe-webhook.js");
  assert.match(source, /syncChargeRefunds\(env,\s*(?:latest)?ChargeId\)/);
  assert.match(source, /stripe_refund_events/);
  assert.match(source, /applyRefundToSettlement\(env,\s*paymentIntentId\)/);
  assert.match(source, /reverseProviderTransfer\(env,\s*settlement\.provider_transfer_id/);
  assert.match(source, /settlement_status\s*=\s*['"]refunded['"]/);
});

test("settlement creation keeps existing rows pending and release-dated", () => {
  const source = read("stripe-webhook.js");
  assert.match(source, /settlement_status\s*=\s*['"]pending['"]/);
  assert.match(source, /release_at/);
  assert.doesNotMatch(
    source,
    /UPDATE\s+booking_settlements\s+SET[^;]*settlement_status\s*=\s*['"]ready['"]/is
  );
});

test("booking cancellation is race-protected and idempotent", () => {
  const source = read("worker-entry.js");
  assert.match(source, /status\s*=\s*['"]cancellation_processing['"]/);
  assert.match(source, /status\s*=\s*['"]confirmed['"]\s+AND\s+payment_status\s*=\s*['"]paid['"]/);
  assert.match(source, /fiiviu-cancel-/);
  assert.match(source, /status\s*=\s*['"]cancelled['"],\s*payment_status\s*=\s*['"]refunded['"]/);
  assert.match(source, /status\s*=\s*['"]confirmed['"]/);
});

test("runtime schema evolution is not used by launch paths", () => {
  for (const path of [
    "stripe-webhook.js",
    "worker-entry.js",
    "worker.js",
    "marketplace-entry.js",
    "worker-entry-v2.js",
    "secure-entry.js"
  ]) {
    const source = read(path);
    assert.doesNotMatch(
      source,
      /\bALTER\s+TABLE\b/i,
      path + " still contains runtime ALTER TABLE"
    );
  }
});

test("production D1 audit workflow checks migration history", () => {
  const source = read(".github/workflows/audit-d1-schema.yml");
  assert.match(source, /SELECT \* FROM d1_migrations ORDER BY id/);
  assert.match(source, /Inspect production D1 schema/);
});

test("launch paths do not mutate D1 schema at request time", () => {
  for (const path of [
    "stripe-webhook.js",
    "worker-entry.js",
    "worker-entry-v2.js",
    "worker.js",
    "marketplace-entry.js",
    "secure-entry.js",
    "provider-auth.js"
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /\\bCREATE\\s+(?:TABLE|INDEX)\\s+IF\\s+NOT\\s+EXISTS\\b/i, path + " still contains runtime CREATE IF NOT EXISTS");
    assert.doesNotMatch(source, /\\bALTER\\s+TABLE\\b/i, path + " still contains runtime ALTER TABLE");
  }
  const migrations = read("migrations/009_launch_runtime_schemas.sql") + read("migrations/010_legacy_partner_schema.sql");
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS bookings/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS experiences/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS partner_sessions/);
  assert.match(read("migrations/003_settlement_ledger.sql"), /CREATE TABLE IF NOT EXISTS stripe_webhook_events/);
  const settlementMigration = read("migrations/011_settlement_runtime_fields.sql");
  for (const column of ["provider_ref","provider_name","release_at","settlement_error","settlement_test_transfer_id","settlement_last_attempt_at"]) {
    assert.match(settlementMigration, new RegExp("ADD COLUMN " + column));
  }
});

test("server-side files are excluded from Cloudflare Static Assets", () => {
  const ignore = read(".assetsignore");
  for (const path of [
    "secure-entry.js",
    "marketplace-entry.js",
    "worker-entry.js",
    "worker.js",
    "stripe-webhook.js",
    "provider-auth.js",
    "worker-entry-v2.js"
  ]) {
    assert.match(
      ignore,
      new RegExp("^" + path.replace(".", "\\.") + "$", "m")
    );
  }
});


test("settlement release helper resolves to experience start", () => {
  assert.equal(
    calculateSettlementReleaseAt("2030-06-15", "14:30"),
    "2030-06-15 11:30:00.000"
  );
});

test("cancellation policy enforces the 24-hour boundary", () => {
  const future = parseBookingDateTime("2030-06-15", "14:30");
  const past = parseBookingDateTime("2020-06-15", "14:30");
  assert.ok(future instanceof Date);
  assert.ok(past instanceof Date);
  assert.equal(getCancellationState({ booking_date: "2030-06-15", booking_time: "14:30" }).allowed, true);
  assert.equal(getCancellationState({ booking_date: "2020-06-15", booking_time: "14:30" }).allowed, false);
  assert.equal(getCancellationState({ booking_date: "not-a-date", booking_time: "14:30" }).allowed, false);
});


test("legacy manual payout path is disabled", () => {
  const source = read("worker-entry.js");
  assert.match(source, /Manual .*Auszahlungen sind deaktiviert/);
  assert.match(source, /}, 410\);/);
});

test("production settlement scheduler is configured", () => {
  const config = read("wrangler.jsonc");
  assert.match(config, /"crons"\s*:\s*\[\s*"\*\/15 \* \* \* \*"/);
  const source = read("secure-entry.js");
  assert.match(source, /async scheduled\(controller, env, ctx\)/);
  assert.match(source, /releaseDueProviderSettlements\(env\)/);
});

test("Stripe mode mismatch is guarded", () => {
  const source = read("worker-entry.js");
  assert.match(source, /configuredTestMode/);
  assert.match(source, /eventIsTestMode/);
  assert.match(source, /mode mismatch/);
});


test("marketplace checkout recalculates price and owns booking identity", () => {
  const source = read("marketplace-entry.js");
  assert.match(source, /const totalAmount=unitPrice\*guests/);
  assert.match(source, /body\.amount=totalAmount/);
  assert.match(source, /body\.bookingId\s*=\s*"FV-"/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /provider_connect_account_id/);
});


test("direct booking finalization requires the PaymentIntent client secret", () => {
  const source = read("worker-entry.js");
  assert.match(source, /clientSecret = String\(body\?\.clientSecret \|\| body\?\.client_secret/);
  assert.match(source, /paymentIntent\?\.client_secret/);
  assert.match(source, /Payment confirmation credentials do not match/);
  const checkout = read("index.html");
  assert.match(checkout, /finalizedClientSecret/);
});


test("marketplace checkout rejects invalid or past booking times", () => {
  const source = read("marketplace-entry.js");
  assert.match(source, /Ein gültiges Buchungsdatum und eine gültige Uhrzeit sind erforderlich/);
  assert.match(source, /bookingStart\.getTime\(\)<=Date\.now\(\)/);
  assert.match(source, /Europe\/Bucharest/);
});


test("settlement release uses an atomic releasing claim and restores pending on failure", () => {
  const source = read("stripe-webhook.js");
  assert.match(source, /settlement_status='releasing'/);
  assert.match(source, /WHERE id=\? AND settlement_status='pending' AND provider_transfer_id IS NULL/);
  assert.match(source, /settlement_status='pending',settlement_error=.*WHERE id=\? AND settlement_status='releasing'/);
  assert.match(source, /Idempotency-Key.*provider-transfer-\$\{paymentIntentId\}/s);
});

test("settlement release checks refunds before provider transfer", () => {
  const source = read("stripe-webhook.js");
  const claim = source.indexOf("settlement_status='releasing'");
  const transfer = source.indexOf("createProviderTransfer", claim);
  const refund = source.indexOf("Refund detected before provider transfer", claim);
  assert.ok(claim >= 0 && refund >= 0 && transfer > refund);
});


test("admin CORS is restricted to configured first-party origins", () => {
  const source = read("secure-entry.js");
  assert.match(source, /function getAdminCors\(request, env\)/);
  assert.match(source, /PUBLIC_APP_URL/);
  assert.ok(source.includes("https://fiiviu.ro"));
  assert.match(source, /headers\[\"Access-Control-Allow-Origin\"\] = origin/);
  assert.doesNotMatch(source, /const CORS = \{[\\s\\S]*Access-Control-Allow-Origin.*\*.*\}/);
});

test("provider sessions do not accept bearer tokens", () => {
  const source = read("provider-auth.js");
  const start = source.indexOf("export function providerSessionFromRequest");
  const end = source.indexOf("export async function createProviderSession", start);
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /Authorization/);
  assert.match(block, /fiiviu_provider_session/);
});

test("provider login keeps the session token cookie-only", () => {
  const source = read("worker-entry.js");
  assert.match(source, /Set-Cookie.*providerSessionCookie/s);
  const loginStart = source.indexOf("async function handleProviderLogin");
  const loginEnd = source.indexOf("async function handleProviderSession", loginStart);
  const loginBlock = source.slice(loginStart, loginEnd);
  assert.doesNotMatch(loginBlock, /sessionToken\s*:/);
});

test("admin CORS is restricted in worker-entry too", () => {
  const source = read("worker-entry.js");
  const adminStart = source.indexOf('request.method === "OPTIONS"');
  const adminEnd = source.indexOf('if (request.method === "POST" && url.pathname === "/api/admin/resend-confirmation")', adminStart);
  const block = source.slice(adminStart, adminEnd);
  assert.match(block, /PUBLIC_APP_URL/);
  assert.ok(block.includes("https://fiiviu.ro"));
  assert.match(block, /Access-Control-Allow-Origin.*origin/s);
  assert.doesNotMatch(block, /Access-Control-Allow-Origin.*\*/s);
});


test("legacy worker payment-intent endpoint is disabled", () => {
  const source = read("worker.js");
  assert.match(source, /Legacy payment endpoint disabled/);
  assert.match(source, /return json\(\s*\{ error: \"Legacy payment endpoint disabled/);
  const legacyStart = source.indexOf('if (url.pathname === "/api/create-payment-intent")');
  const legacyBlock = source.slice(legacyStart, legacyStart + 300);
  assert.ok(legacyStart >= 0);
  assert.doesNotMatch(legacyBlock, /params\.set\(\"amount\",String\(amount\)\)/);
});

test("secure entry routes payment creation through marketplace worker", () => {
  const source = read("secure-entry.js");
  const marketplaceIndex = source.indexOf('const { default: marketplaceWorker }');
  const fallbackIndex = source.indexOf('return marketplaceWorker.fetch(request, env, ctx);');
  assert.ok(marketplaceIndex >= 0 && fallbackIndex > marketplaceIndex);
});
test("provider auth schema is migration-owned, not runtime-created", () => {
  const source = read("provider-auth.js");
  const migration = read("migrations/007_provider_auth.sql");
  assert.doesNotMatch(source, /CREATE TABLE IF NOT EXISTS provider_(?:accounts|sessions)/);
  assert.match(source, /sqlite_master/);
  assert.match(source, /Provider authentication schema is missing/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS provider_accounts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS provider_sessions/);
});
test("provider marketplace schemas are migration-owned", () => {
  const source = read("worker-entry.js");
  const migration = read("migrations/008_provider_marketplace_schema.sql");
  for (const table of ["providers","offers","provider_payouts"]) {
    assert.doesNotMatch(source, new RegExp("CREATE TABLE IF NOT EXISTS " + table));
    assert.match(migration, new RegExp("CREATE TABLE IF NOT EXISTS " + table));
  }
  assert.match(source, /Providers schema is missing/);
  assert.match(source, /Booking settlement schema is incomplete/);
});


test("admin offer deletion is safe around existing bookings", () => {
  const source = read("worker.js");
  assert.match(source, /request\.method==="DELETE"/);
  assert.match(source, /SELECT id,title,provider_ref,active FROM offers/);
  assert.match(source, /FROM bookings WHERE experience_name=\? AND provider_name=\?/);
  assert.match(source, /UPDATE offers SET active=0,updated_at=CURRENT_TIMESTAMP/);
  assert.match(source, /DELETE FROM offers WHERE id=\?/);
  const admin = read("organizer-admin.html");
  assert.match(admin, /deleteOfferById/);
  assert.match(admin, /method:"DELETE"/);
});
