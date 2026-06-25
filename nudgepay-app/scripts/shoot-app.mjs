import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:5174";
const DIR = "C:/Users/dasbl/WebstormProjects/nudgepay/nudgepay-app/demo-recording/";

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
try {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', "diskin@chancey.test");
  await page.fill('input[name="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard**", { timeout: 15000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: DIR + "app-dashboard.png" });
  console.log("shot: app-dashboard.png");

  await page.getByRole("link", { name: "Open Riverside Apartments LLC" }).first().click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: DIR + "app-case-detail.png" });
  console.log("shot: app-case-detail.png");

  // Waiting / exception case (Summit = on_hold, disputed) — verify exception panel tokens.
  const rx = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  await page.getByRole("tab", { name: rx("Waiting") }).first().click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
  await page.getByRole("link", { name: "Open Summit Restaurant Group" }).first().click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(900);
  await page.screenshot({ path: DIR + "app-exception-detail.png" });
  console.log("shot: app-exception-detail.png");
} catch (e) {
  console.error("ERR:", e.message);
} finally {
  await browser.close();
}
