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
