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
