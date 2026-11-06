import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const viewports = [
  { width: 360, height: 800 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
];

await mkdir("artifacts/fiiviu-visual-review", { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.stack || error.message));

    await page.goto("http://127.0.0.1:4173/index.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);

    const consentPanel = page.locator("#fiiviu-consent-root .fc-panel");
    await consentPanel.waitFor({ state: "visible", timeout: 5000 });
    await page.locator('#fiiviu-consent-root [data-action="reject"]').click();
    const rejected = await page.evaluate(() => JSON.parse(localStorage.getItem("fiiviu_consent_v1") || "null"));
    assert.equal(rejected?.necessary, true, "Necessary storage remains enabled");
    assert.equal(rejected?.statistics, false, "Reject all must disable statistics");
    assert.equal(rejected?.marketing, false, "Reject all must disable marketing");
    await page.locator("#fiiviu-consent-root .fc-manage").waitFor({ state: "visible" });
    await page.locator("#fiiviu-consent-root .fc-manage").click();
    await page.locator("#fc-statistics").check();
    await page.locator('#fiiviu-consent-root [data-action="save"]').click();
    const configured = await page.evaluate(() => JSON.parse(localStorage.getItem("fiiviu_consent_v1") || "null"));
    assert.equal(configured?.statistics, true, "Custom statistics choice must be saved");
    assert.equal(configured?.marketing, false, "Unselected marketing must remain disabled");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#fiiviu-consent-root .fc-manage").waitFor({ state: "visible" });
    assert.equal(await page.locator("#fiiviu-consent-root .fc-panel").count(), 0, "Saved consent must suppress the first-visit banner");

    const metrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      manropeReady: document.fonts.check("16px Manrope"),
      categoryCards: [...document.querySelectorAll("#moments .category-card")].length,
    }));

    assert.ok(
      metrics.documentWidth <= metrics.viewportWidth + 1 &&
      metrics.bodyWidth <= metrics.viewportWidth + 1,
      `Horizontal overflow at ${viewport.width}px: ${JSON.stringify(metrics)}`
    );
    assert.equal(metrics.manropeReady, true, "Locally hosted Manrope font must load");
    assert.equal(metrics.categoryCards, 6, "All six existing discovery categories remain present");
    await page.screenshot({
      path: `artifacts/fiiviu-visual-review/home-${viewport.width}.png`,
      fullPage: true,
    });
    assert.deepEqual(pageErrors, [], `Browser page errors at ${viewport.width}px`);
    await page.close();
  }
} finally {
  await browser.close();
}
