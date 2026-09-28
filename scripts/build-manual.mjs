// Builds docs/Task-Reminder-Manual.pdf from docs/manual/manual.html.
// Needs Playwright with Chromium: npx playwright install chromium (once), then
//   node scripts/build-manual.mjs
import { chromium } from "playwright";

const src = new URL("../docs/manual/manual.html", import.meta.url);
const out = new URL("../docs/Task-Reminder-Manual.pdf", import.meta.url);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(src.href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: out.pathname, format: "A4", printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log("wrote", out.pathname);
