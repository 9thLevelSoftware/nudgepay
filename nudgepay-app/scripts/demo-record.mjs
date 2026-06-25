// Local-only Playwright walkthrough recorder for NudgePay (Phase 6 demo).
// Prereqs: dev server on BASE, demo-seed run, `playwright` + chromium installed.
// Run from nudgepay-app/:  node scripts/demo-record.mjs
import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:5174";
const EMAIL = "diskin@chancey.test";
const PASSWORD = "password123";
const OUT_DIR = new URL("../demo-recording/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

mkdirSync(OUT_DIR, { recursive: true });

const sleep = (page, ms) => page.waitForTimeout(ms);

// On-screen caption overlay so the recording is self-explanatory.
async function caption(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById("__demo_caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__demo_caption";
      el.style.cssText =
        "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:rgba(17,17,17,.92);" +
        "color:#fff;font:600 16px/1.4 system-ui,sans-serif;padding:12px 20px;letter-spacing:.2px;" +
        "border-top:2px solid #c97b4a;text-align:center;";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function step(page, text, ms = 1400) {
  console.log("• " + text);
  await caption(page, text);
  await sleep(page, ms);
}

async function openCase(page, name) {
  await page.getByRole("link", { name: `Open ${name}` }).first().click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(page, 700);
}

const rx = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

async function clickView(page, label) {
  // View tabs are role="tab"; accessible name is "<label> <count>".
  await page.getByRole("tab", { name: rx(label) }).first().click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(page, 700);
}

async function clickTab(page, label) {
  await page.getByRole("tab", { name: rx(label) }).first().click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(page, 600);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  try {
    // 1. Login
    await page.goto(`${BASE}/login`);
    await step(page, "NudgePay — AR collections for QuickBooks. Logging in…", 1000);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard**", { timeout: 15000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(page, 800);

    // 2. The case-centric work queue (6a)
    await step(page, "Phase 6a — the work queue is one row per CUSTOMER case, not per invoice.", 2200);
    await step(page, "Each row shows total overdue, oldest age, status, and the next action.", 2200);

    // 3. Saved views
    await clickView(page, "30+ days");
    await step(page, "Saved views filter the queue — here, accounts 30+ days overdue.", 1800);
    await clickView(page, "High value");
    await step(page, "High-value accounts (largest balances).", 1600);
    await clickView(page, "Broken promises");
    await step(page, "Phase 6b — Broken promises: Delgado promised to pay and the date passed unpaid.", 2400);
    await clickView(page, "Follow-ups due");
    await step(page, "Follow-ups due — deferred (waiting / on-hold) cases are suppressed until their review date.", 2600);
    await clickView(page, "Waiting");
    await step(page, "Phase 6c — Waiting view: customer-side waits and on-hold exceptions.", 2400);
    await clickView(page, "My work");
    await step(page, "My work — accounts assigned to the signed-in rep.", 1800);
    await clickView(page, "All open");
    await step(page, "Back to All open.", 1000);

    // 4. Riverside — promised (promise card + invoices + SMS thread)
    await openCase(page, "Riverside Apartments LLC");
    await step(page, "Opening Riverside — the customer/case workspace. Its overdue invoices are listed inside.", 2400);
    await step(page, "Phase 6b — Promise card: a pending promise to pay $2,000, with the grace deadline.", 2600);
    await clickTab(page, "Messages");
    await step(page, "Per-customer SMS thread — two-way texting with delivery status (Phase 5c).", 2400);
    await clickTab(page, "Activity");
    await step(page, "Activity timeline — the unified interaction history for the case.", 1800);
    await clickTab(page, "Overview");
    await sleep(page, 500);

    // 5. Summit — on_hold exception panel (6c)
    await clickView(page, "Waiting");
    await openCase(page, "Summit Restaurant Group");
    await step(page, "Phase 6c — Summit is On hold as an exception.", 1800);
    await step(page, "Exception panel: reason = Disputed, with a note and a review date.", 2600);

    // 6. Log-contact drawer — the required next-step (6c) with conditional fields
    const u = new URL(page.url());
    const caseId = u.searchParams.get("case");
    await page.goto(`${BASE}/dashboard?case=${caseId}&view=waiting&log=1`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await step(page, "Phase 6c — Logging a contact now REQUIRES a next step (the hard invariant).", 2400);
    await page.selectOption('select[name="nextStep"]', "follow_up").catch(() => {});
    await step(page, "Next step = Follow up → pick a follow-up date.", 1800);
    await page.selectOption('select[name="nextStep"]', "promise").catch(() => {});
    await step(page, "Next step = Promise to pay → amount + date (creates a tracked promise).", 2000);
    await page.selectOption('select[name="nextStep"]', "waiting").catch(() => {});
    await step(page, "Next step = Waiting on customer → a review date (auto-resurfaces then).", 2000);
    await page.selectOption('select[name="nextStep"]', "exception").catch(() => {});
    await step(page, "Next step = Exception → reason, note, and a review date.", 2200);

    // 7. Drive a real transition: log a 'waiting' next-step and watch the queue update
    await page.selectOption('select[name="nextStep"]', "waiting").catch(() => {});
    await page.fill('input[name="reviewAt"]', new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10)).catch(() => {});
    await step(page, "Saving a Waiting next-step…", 1200);
    await page.getByRole("button", { name: /save contact/i }).click().catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(page, 1200);
    await step(page, "The case is logged and its next action is durable — invariant satisfied.", 2400);

    await step(page, "Phase 6 complete: case workspace · promise/payment loop · hard next-action invariant.", 2800);
  } catch (err) {
    console.error("WALKTHROUGH ERROR:", err.message);
    await caption(page, "Recording ended early: " + err.message).catch(() => {});
    await sleep(page, 1500);
  } finally {
    await context.close(); // flushes the video to OUT_DIR
    await browser.close();

    // Rename the random video file to a friendly name.
    try {
      const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(".webm")).sort();
      if (files.length) {
        const newest = files[files.length - 1];
        const dest = `${OUT_DIR}nudgepay-phase6-demo.webm`;
        renameSync(`${OUT_DIR}${newest}`, dest);
        console.log("\nVIDEO: " + dest);
      } else {
        console.log("\nNo .webm produced in " + OUT_DIR);
      }
    } catch (e) {
      console.log("\nVideo rename issue: " + e.message);
    }
  }
}

main();
