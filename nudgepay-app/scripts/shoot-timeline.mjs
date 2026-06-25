// Local-only: log a contact on Riverside (exercising a new B4 outcome), then
// screenshot the unified Timeline tab (manual log + SMS interleaved). Run from
// nudgepay-app/ with the dev server up and demo-seed applied. Never committed.
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

  // Open Riverside (has an SMS thread); WAIT for the case param to commit.
  await page.getByRole("link", { name: "Open Riverside Apartments LLC" }).first().click();
  await page.waitForURL("**/dashboard?*case=*", { timeout: 10000 });
  const caseId = new URL(page.url()).searchParams.get("case");
  console.log("caseId:", caseId);
  if (!caseId) throw new Error("no caseId after opening Riverside");

  // Open the log-contact drawer via the panel "Log" button; screenshot the
  // expanded outcome list (B4: 10 manual outcomes).
  await page.getByRole("link", { name: "Log" }).first().click();
  await page.getByRole("dialog", { name: /log a contact/i }).waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: DIR + "app-log-drawer.png" });
  console.log("shot: app-log-drawer.png");

  // Log a contact with a NEW B4 outcome + a follow-up next step.
  await page.selectOption('select[name="method"]', "call");
  await page.selectOption('select[name="outcome"]', "payment-already-sent");
  await page.fill('textarea[name="notes"]', "AP says a check was mailed last week.");
  await page.selectOption('select[name="nextStep"]', "follow_up");
  await page.fill('input[name="followUpAt"]', "2026-07-01");
  await page.getByRole("button", { name: /save contact/i }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);

  // Open the Timeline tab (manual log + SMS interleaved).
  await page.getByRole("tab", { name: /timeline/i }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: DIR + "app-timeline.png" });
  console.log("shot: app-timeline.png");
} catch (e) {
  console.error("ERR:", e.message);
} finally {
  await browser.close();
}
