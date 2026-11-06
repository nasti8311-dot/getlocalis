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
