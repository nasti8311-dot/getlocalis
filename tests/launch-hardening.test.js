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
  assert.match(source, /syncChargeRefunds\(env,\s*chargeId\)/);
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
    assert.match(
      ignore,
      new RegExp("^" + path.replace(".", "\\.") + "$", "m")
    );
  }
});
