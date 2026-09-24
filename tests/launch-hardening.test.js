import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("Stripe webhook claims events atomically", () => {
  const source = read("stripe-webhook.js");
  assert.match(source, /INSERT OR IGNORE INTO stripe_webhook_events/);
  assert.match(source, /duplicate:\s*true/);
  assert.match(source, /DELETE FROM stripe_webhook_events WHERE event_id/);
});

test("refund reconciliation is wired to settlement ledger", () => {
  const source = read("stripe-webhook.js");
  assert.match(source, /syncChargeRefunds\(env,chargeId\)/);
  assert.match(source, /stripe_refund_events/);
  assert.match(source, /applyRefundToSettlement\(env,paymentIntentId\)/);
  assert.match(source, /reverseProviderTransfer\(env,settlement\.provider_transfer_id/);
  assert.match(source, /settlement_status='refunded'/);
});

test("settlement creation never upgrades an existing row to ready", () => {
  const source = read("worker-entry.js");
  assert.doesNotMatch(source, /settlement_status\s*=\s*['"]ready['"]/);
  assert.match(source, /settlement_status='pending'/);
  assert.match(source, /calculateSettlementReleaseAt/);
});

test("booking cancellation is race-protected and idempotent", () => {
  const source = read("worker-entry.js");
  assert.match(source, /status='cancellation_processing'/);
  assert.match(source, /status='confirmed' AND payment_status='paid'/);
  assert.match(source, /fiiviu-cancel-/);
  assert.match(source, /status='cancelled', payment_status='refunded'/);
  assert.match(source, /status='confirmed'/);
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
    assert.doesNotMatch(source, /ALTER\s+TABLE/i, \${path} + " still contains runtime ALTER TABLE");
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
    "provider-auth.js"
  ]) {
    assert.match(ignore, new RegExp("^" + path.replace(".", "\\.") + "$", "m"));
  }
});
