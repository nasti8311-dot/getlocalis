import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const dashboards = [
  { name: "admin-root", path: "/admin.html" },
  { name: "admin-panel", path: "/admin/index.html" },
  { name: "provider", path: "/provider.html" },
  { name: "partner", path: "/partner.html" },
];
const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 1000 },
];

await mkdir("artifacts/fiiviu-visual-review/dashboards", { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  for (const dashboard of dashboards) {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const response = await page.goto(`http://127.0.0.1:4173${dashboard.path}`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(700);
      assert.ok(response && response.ok(), `Could not load ${dashboard.path}: HTTP ${response?.status()}`);
      const metrics = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        title: document.title,
      }));
      assert.ok(metrics.documentWidth <= metrics.viewportWidth + 1 && metrics.bodyWidth <= metrics.viewportWidth + 1,
        `Horizontal overflow on ${dashboard.name} at ${viewport.width}px: ${JSON.stringify(metrics)}`);
      await page.screenshot({
        path: `artifacts/fiiviu-visual-review/dashboards/${dashboard.name}-${viewport.name}.png`,
        fullPage: true,
      });
      assert.deepEqual(errors, [], `JavaScript errors on ${dashboard.name}: ${errors.join("; ")}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
