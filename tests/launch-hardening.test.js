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
    "worker.js",
    "marketplace-entry.js",
    "secure-entry.js",
    "provider-auth.js"
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /\bCREATE\s+(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\b/i, path + " still contains runtime CREATE IF NOT EXISTS");
    assert.doesNotMatch(source, /\bALTER\s+TABLE\b/i, path + " still contains runtime ALTER TABLE");
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
  ]) {
    assert.match(
      ignore,
      new RegExp("^" + path.replace(".", "\\.") + "$", "m")
    );
  }
});


test("public static pages never embed a Stripe secret key", () => {
  const source = read("index.html");
  const provider = read("provider.html");
  const admin = read("organizer-admin.html");
  for (const html of [source, provider, admin]) {
    assert.doesNotMatch(html, /sk_(?:test|live)_[A-Za-z0-9]+/);
    assert.doesNotMatch(html, /STRIPE_SECRET_KEY/);
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

test("Stripe webhook rejects mode mismatch before ledger writes", () => {
  const source = read("stripe-webhook.js");
  assert.match(source, /const stripeSecretKey = String\(env\.STRIPE_SECRET_KEY \|\| ""\)\.trim\(\)/);
  assert.match(source, /event\?\.livemode === false/);
  assert.match(source, /Stripe webhook mode mismatch/);
  const mismatch = source.indexOf("Stripe webhook mode mismatch; event rejected");
  const ledger = source.indexOf("INSERT OR IGNORE INTO stripe_webhook_events");
  assert.ok(mismatch >= 0 && ledger > mismatch);
});


test("marketplace entrypoint stays wired to the current worker implementation", () => {
  const source = read("marketplace-entry.js");
  assert.match(source, /import baseWorker from ["']\.\/worker-entry\.js["']/);
  assert.doesNotMatch(source, /worker-entry-v2\.js/);
});

test("marketplace checkout recalculates price and owns booking identity", () => {
  const source = read("marketplace-entry.js");
  assert.match(source, /const totalAmount=unitPrice\*guests/);
  assert.match(source, /body\.amount=totalAmount/);
  assert.match(source, /body\.bookingId\s*=\s*"FV-"/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /provider_connect_account_id/);
});


test("paid booking finalization is idempotent and email-send guarded", () => {
  const source = read("worker-entry.js");
  const start = source.indexOf("async function finalizePaidBooking");
  const end = source.indexOf("async function sendProviderBookingNotification", start);
  const block = source.slice(start, end);
  assert.match(block, /ON CONFLICT\(payment_intent_id\) DO UPDATE/);
  assert.match(block, /confirmation_email_sent_at/);
  assert.match(block, /if \(!booking \|\| booking\.confirmation_email_sent_at\)/);
  assert.match(block, /confirmation_email_sent_at IS NULL/);
  assert.match(block, /sendProviderBookingNotification\(env, booking\)/);
  assert.match(block, /provider notification failure must never block the booking/i);
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
  assert.match(source, /WHERE id=\? AND settlement_status='pending' AND provider_transfer_id IS NULL AND settlement_test_transfer_id IS NULL/);
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


test("worker JSON responses do not default to wildcard CORS", () => {
  const source = read("worker-entry.js");
  const jsonStart = source.indexOf("function json(");
  const jsonEnd = source.indexOf("function isHtmlResponse", jsonStart);
  const block = source.slice(jsonStart, jsonEnd);
  assert.doesNotMatch(block, /Access-Control-Allow-Origin": "\*"/);
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
  const entry = read("worker-entry.js");
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
  const fallbackIndex = source.indexOf('return applyApiSecurityHeaders(await marketplaceWorker.fetch(request, env, ctx), request, env);');
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


test("organizer admin key is memory-only", () => {
  const source = read("organizer-admin.html");
  assert.match(source, /let adminKey = ""/);
  assert.doesNotMatch(source, /sessionStorage\.getItem\("fiiviu_admin_key"\)/);
  assert.doesNotMatch(source, /sessionStorage\.setItem\("fiiviu_admin_key"/);
  assert.doesNotMatch(source, /sessionStorage\.removeItem\("fiiviu_admin_key"/);
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


test("admin response CORS is first-party restricted, not wildcard", () => {
  const source = read("worker.js");
  assert.match(source, /const isAdminPath = url\.pathname\.startsWith\("\/api\/admin\/"\)/);
  assert.match(source, /allowedAdminOrigins/);
  assert.match(source, /if \(isAdminPath\)/);
  assert.doesNotMatch(source, /isAdminPath[\\s\\S]{0,800}Access-Control-Allow-Origin.*\\*.*isAdminPath/);
});

test("secure admin CORS permits the organizer DELETE action", () => {
  const source = read("secure-entry.js");
  assert.match(source, /Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"/);
});

test("provider API requires an authenticated cookie session", () => {
  const source = read("worker-entry.js");
  assert.match(source, /authenticateProviderSession\(request,env\)/);
  assert.match(source, /providerRefFromSession\(request,env\)/);
  assert.match(source, /const providerRef=await providerRefFromSession\(request,env\)/);
  assert.match(source, /const provider=await env\.DB\.prepare\("SELECT provider_ref,name,contact_email,connect_account_id,active FROM providers WHERE provider_ref=\? LIMIT 1"\)/);
  assert.doesNotMatch(source, /PROVIDER_ACCOUNT_MAP_JSON/);
  assert.doesNotMatch(source, /PROVIDER_ADMIN_KEY/);
  assert.doesNotMatch(source, /STRIPE_PROVIDER_CONNECT_ACCOUNT_ID/);
});


test("legacy marketplace provider auth fallbacks are disabled", () => {
  const source = read("marketplace-entry.js");
  assert.doesNotMatch(source, /PROVIDER_ACCOUNT_MAP_JSON/);
  assert.doesNotMatch(source, /PROVIDER_ADMIN_KEY/);
  assert.doesNotMatch(source, /STRIPE_PROVIDER_CONNECT_ACCOUNT_ID/);
  assert.doesNotMatch(source, /Authorization.*Bearer/s);
  assert.match(source, /authenticateProviderSession\(request,env\)/);
});

test("marketplace catalog and checkout require an active provider", () => {
  const source = read("marketplace-entry.js");
  assert.match(source, /FROM providers WHERE provider_ref=\? AND active=1 LIMIT 1/);
  assert.match(source, /INNER JOIN providers p ON p\.provider_ref=o\.provider_ref AND p\.active=1 WHERE o\.active=1/);
  assert.match(source, /INNER JOIN providers p ON p\.connect_account_id=e\.provider_connect_account_id AND p\.active=1 WHERE e\.status='published'/);
});


test("sandbox settlement rows with a test transfer are not reprocessed", () => {
  const source = read("stripe-webhook.js");
  assert.match(source, /settlement_status='pending'.*provider_transfer_id IS NULL.*settlement_test_transfer_id IS NULL/);
  assert.match(source, /settlement_test_transfer_id IS NULL ORDER BY id ASC LIMIT 50/);
});


test("Stripe webhook schema checks are read-only and migration-owned", () => {
  const source = read("stripe-webhook.js");
  assert.match(source, /PRAGMA table_info\(/);
  assert.match(source, /Required D1 table is missing/);
  assert.match(source, /D1 table schema is incomplete/);
  assert.doesNotMatch(source, /\bCREATE\s+(?:TABLE|INDEX)\s+/i);
  assert.doesNotMatch(source, /\bALTER\s+TABLE\b/i);
});


test("static assets carry active baseline browser security headers", () => {
  const source = read("_headers");
  assert.match(source, /^Strict-Transport-Security:\s*max-age=31536000; includeSubDomains$/m);
  assert.match(source, /^X-Frame-Options:\s*DENY$/m);
  assert.match(source, /^X-Content-Type-Options:\s*nosniff$/m);
  assert.match(source, /^Referrer-Policy:\s*strict-origin-when-cross-origin$/m);
  assert.match(source, /^Permissions-Policy:\s*camera=\(\), microphone=\(\), geolocation=\(\), payment=\(self\)$/m);
});


test("cancellation CORS is restricted to first-party origins", () => {
  const source = read("worker-entry.js");
  const start = source.indexOf("async function handleCancellation");
  const end = source.indexOf("async function", start + 20);
  const block = source.slice(start, end > start ? end : start + 5000);
  assert.match(block, /PUBLIC_APP_URL/);
  assert.ok(block.includes("https://fiiviu.ro"));
  assert.match(block, /Access-Control-Allow-Origin.*origin/);
  assert.doesNotMatch(block, /Access-Control-Allow-Origin": "\*"/);
  assert.match(block, /"Vary": "Origin"/);
});

test("cancellation API responses are marked non-cacheable", () => {
  const source = read("worker-entry.js");
  const start = source.indexOf("async function handleCancellation");
  const end = source.indexOf("async function", start + 20);
  const block = source.slice(start, end > start ? end : start + 5000);
  assert.match(block, /"Cache-Control": "no-store"/);
});

test("API responses receive baseline transport and browser security headers", () => {
  const source = read("secure-entry.js");
  assert.match(source, /Strict-Transport-Security.*max-age=31536000; includeSubDomains/);
  assert.match(source, /X-Content-Type-Options.*nosniff/);
  assert.match(source, /Referrer-Policy.*strict-origin-when-cross-origin/);
  assert.match(source, /Permissions-Policy.*payment=\(self\)/);
  assert.match(source, /applyApiSecurityHeaders\(await adminWorker\.fetch/);
  assert.match(source, /applyApiSecurityHeaders\(await marketplaceWorker\.fetch/);
  assert.match(source, /"Strict-Transport-Security": "max-age=31536000; includeSubDomains"/);
  assert.match(source, /"X-Content-Type-Options": "nosniff"/);
  assert.match(source, /"Referrer-Policy": "strict-origin-when-cross-origin"/);
  assert.match(source, /"Permissions-Policy": "camera=\(\), microphone=\(\), geolocation=\(\), payment=\(self\)"/);
});

test("admin settlement endpoints inherit a no-store cache policy", () => {
  const source = read("secure-entry.js");
  const corsStart = source.indexOf("function getAdminCors(request, env)");
  const corsEnd = source.indexOf("function applyApiSecurityHeaders", corsStart);
  const block = source.slice(corsStart, corsEnd);
  assert.match(block, /"Cache-Control": "no-store"/);
});

test("JSON API responses are marked non-cacheable", () => {
  for (const path of ["worker-entry.js", "marketplace-entry.js", "worker.js"]) {
    const source = read(path);
    assert.match(source, /Cache-Control[^\n]*no-store/);
  }
});


test("partner sessions are cookie-only", () => {
  const source = read("worker.js");
  const partnerHtml = read("partner.html");
  const authStart = source.indexOf("async function authenticatePartner");
  const authEnd = source.indexOf("function partnerSessionCookie", authStart);
  const authBlock = source.slice(authStart, authEnd);
  assert.doesNotMatch(authBlock, /Authorization/);
  assert.match(authBlock, /fiiviu_partner_session/);
  assert.match(source, /JSON\.stringify\(\{success:true,partnerRef:String\(account\.partner_ref\)\}\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(\{success:true,partnerRef:String\(account\.partner_ref\),sessionToken:/);
  assert.doesNotMatch(partnerHtml, /localStorage\.setItem\(tokenKey/);
  assert.doesNotMatch(partnerHtml, /Authorization:'Bearer '\+token/);
});


test("booking access links are generated in the booking finalization path", () => {
  const worker = read("worker-entry.js");
  const secure = read("secure-entry.js");
  assert.match(worker, /booking_access_token/);
  assert.match(worker, /booking_url:/);
  assert.match(worker, /booking\.html\?id=/);
  assert.doesNotMatch(secure, /globalThis\.fetch\s*=\s*async function/);
  assert.doesNotMatch(secure, /__fiiviuSecureEmailPatch/);
});


test("admin origin normalization uses a valid end-anchored regex", () => {
  const source = read("worker.js");
  assert.ok(source.includes("replace(/\\/$/"));
});

test("secure entry does not persist request-scoped bindings on globalThis", () => {
  const source = read("secure-entry.js");
  assert.doesNotMatch(source, /globalThis\\.__fiiviuDB/);
  assert.doesNotMatch(source, /globalThis\\.__fiiviuPublicAppUrl/);
});


test("provider API responses do not expose wildcard CORS", () => {
  const source = read("secure-entry.js");
  assert.match(source, /restrictCors/);
  assert.match(source, /headers\.delete\("Access-Control-Allow-Origin"\)/);
  assert.match(source, /applyApiSecurityHeaders\(await adminWorker\.fetch\(request, env, ctx\), request, env, true\)/);
  assert.match(source, /Cache-Control.*no-store/);
});


test("public marketplace and partner responses do not default to wildcard CORS", () => {
  const marketplace = read("marketplace-entry.js");
  const worker = read("worker.js");
  assert.doesNotMatch(marketplace, /Access-Control-Allow-Origin": "\*"/);
  assert.doesNotMatch(worker, /corsHeaders\["Access-Control-Allow-Origin"\]\s*=\s*"\*"/);
});

test("marketplace checkout derives the payable amount from the server catalog", () => {
  const source = read("marketplace-entry.js");
  assert.match(source, /const unitPrice=Number\(experience\.price_cents\)/);
  assert.match(source, /const totalAmount=unitPrice\*guests/);
  assert.match(source, /body\.amount=totalAmount/);
  assert.doesNotMatch(source, /body\.amount=Number\(body\.amount/);
});

test("marketplace checkout replaces client booking IDs with a server-generated ID", () => {
  const source = read("marketplace-entry.js");
  assert.match(source, /body\.bookingId = "FV-" \+ crypto\.randomUUID\(\)/);
  assert.match(source, /body\.bookingId = "FV-" \+ crypto\.randomUUID\(\)\.replace\(\/-\/g, ""\)/);
});

test("marketplace checkout requires a published experience and active provider", () => {
  const source = read("marketplace-entry.js");
  assert.match(source, /String\(experience\.status\)!=="published"/);
  assert.match(source, /FROM providers WHERE provider_ref=\? AND active=1 LIMIT 1/);
  assert.match(source, /valid provider Connect account/);
});


test("local Wrangler secret files are excluded from Cloudflare Static Assets", () => {
  const ignore = read(".assetsignore");
  assert.match(ignore, /^\\.dev\\.vars$/m);
  assert.match(ignore, /^\\.dev\\.vars\\.\*$/m);
  assert.match(ignore, /^\\*\.env$/m);
  assert.match(ignore, /^\\*\.env\.\*$/m);
});

test("public static pages never expose server secret names", () => {
  const pages = [
    read("index.html"),
    read("provider.html"),
    read("organizer-admin.html"),
    read("partner.html")
  ].join("\n");
  for (const secretName of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "EMAILJS_PRIVATE_KEY",
    "RESEND_API_KEY",
    "ADMIN_PAYOUT_KEY",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID"
  ]) {
    assert.doesNotMatch(
      pages,
      new RegExp(secretName.replaceAll("_", "[_]"))
    );
  }
});


test("marketplace image URLs are restricted to safe HTTP(S) sources", () => {
  const source = read("index.html");
  assert.match(source, /function safeImageUrl\(value, fallback = ""\)/);
  assert.match(source, /url\.protocol === "https:"/);
  assert.match(source, /url\.origin === window\.location\.origin && url\.protocol === "http:"/);
  assert.match(source, /imageUrl = safeImageUrl\(offer\.image_url\)/);
  assert.match(source, /safeImageUrl\(image\)/);
});


test("organizer access can be provisioned and emailed from admin", () => {
  const source = read("worker-entry.js");
  const admin = read("organizer-admin.html");
  assert.match(source, /async function handleAdminProviderPassword/);
  assert.match(source, /INSERT INTO provider_accounts/);
  assert.match(source, /DELETE FROM provider_sessions WHERE provider_ref=\?/);
  assert.match(source, /fiiviu_provider_session/);
  assert.ok(source.includes("https://fiiviu.ro/provider.html"));
  assert.match(source, /emailSent:true/);
  assert.match(source, /temporaryPassword:password/);
  assert.match(admin, /createProviderLoginById/);
  assert.match(admin, /Zugang per E-Mail/);
  assert.match(admin, /\\/api\\/admin\\/provider-password/);
});


test("provider session cookie is host-only and malformed cookies fail closed", () => {
  const source = read("provider-auth.js");
  assert.match(source, /__Host-fiiviu_provider_session=/);
  assert.match(source, /Path=\\/; Max-Age=/);
  assert.match(source, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(source, /try\\{return decodeURIComponent\\(match\\[1\\]\\);\\}catch\\{return "";\\}/);
  assert.doesNotMatch(source, /(^|[^-])fiiviu_provider_session=/);
});


test("admin auth tolerates accidental whitespace around the configured secret", () => {
  const source = read("worker-entry.js");
  assert.ok(source.includes('String(request.headers.get("Authorization") || "").trim()'));
  assert.ok(source.includes('String(env.ADMIN_PAYOUT_KEY || "").trim()'));
});


test("settlement status admin auth trims configured and incoming credentials", () => {
  const source = read("secure-entry.js");
  const start = source.indexOf('url.pathname === "/api/admin/settlement-status"');
  const end = source.indexOf('if (url.pathname.startsWith("/api/admin/")', start);
  const block = source.slice(start, end);
  assert.match(block, /String\(request\.headers\.get\("Authorization"\) \|\| ""\)\.trim\(\)/);
  assert.match(block, /String\(env\.ADMIN_PAYOUT_KEY \|\| ""\)\.trim\(\)/);
  assert.doesNotMatch(block, /request\.headers\.get\("Authorization"\) !== "Bearer " \+ String\(env\.ADMIN_PAYOUT_KEY\)/);
});

test("all legacy admin auth comparisons trim configured and incoming credentials", () => {
  const worker = read("worker.js");
  const secure = read("secure-entry.js");
  assert.match(worker, /function isAdmin\(request,env\)\{return String\(env\.ADMIN_PAYOUT_KEY\|\|""\)\.trim\(\)!==""&&String\(request\.headers\.get\("Authorization"\)\|\|""\)\.trim\(\)==="Bearer "\+String\(env\.ADMIN_PAYOUT_KEY\|\|""\)\.trim\(\)\}/);
  assert.doesNotMatch(worker, /request\.headers\.get\("Authorization"\)==="Bearer "\+env\.ADMIN_PAYOUT_KEY/);
  assert.doesNotMatch(secure, /request\.headers\.get\("Authorization"\) !== "Bearer " \+ String\(env\.ADMIN_PAYOUT_KEY\)/);
  assert.match(secure, /String\(request\.headers\.get\("Authorization"\) \|\| ""\)\.trim\(\)/);
  assert.match(secure, /String\(env\.ADMIN_PAYOUT_KEY \|\| ""\)\.trim\(\)/);
});

test("marketplace checkout revalidates that the experience provider is active", () => {
  const source = read("marketplace-entry.js");
  assert.match(source, /SELECT provider_ref,name,connect_account_id,active FROM providers WHERE connect_account_id=\? AND active=1 LIMIT 1/);
  assert.match(source, /Experience provider is not currently active/);
  assert.match(source, /body\.providerName=String\(bodyProviderName\|\|experience\.provider_name\|\|""\)/);
});
\ntest("marketplace checkout enforces configured experience time slots", () => {\n  const source = read("marketplace-entry.js");\n  assert.match(source, /const configuredTimes=normalizeAvailableTimes\(experience\.available_times\)/);\n  assert.match(source, /Die gewählte Uhrzeit ist für dieses Erlebnis nicht verfügbar/);\n  assert.match(source, /available_times: String\(offer\.available_times\|\|""\)/);\n  assert.match(source, /function normalizeAvailableTimes\(value\)/);\n});\n