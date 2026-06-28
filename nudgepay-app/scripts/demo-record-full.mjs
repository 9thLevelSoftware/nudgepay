// Local-only Playwright walkthrough recorder for NudgePay — FULL product tour.
// Covers the current feature surface end-to-end: Collections work queue,
// case detail (Activity / SMS / Email composer / comm-prefs), click-to-call
// gating, exceptions, bulk ops, Promises ledger, the channel-aware Messages
// inbox (SMS + Email + Failed), Accounts, owner Reports, Settings (QBO +
// channel + email config), and the public CAN-SPAM unsubscribe page.
//
// Prereqs (run from nudgepay-app/, in order):
//   npx supabase start && npx supabase db reset
//   node scripts/demo-seed.mjs
//   node scripts/demo-seed-promises.mjs
//   node scripts/demo-seed-phase8.mjs
//   node scripts/demo-seed-email.mjs
//   npm run dev               # leave running
//   BASE_URL=http://localhost:5173 node scripts/demo-record-full.mjs
import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const EMAIL = "diskin@chancey.test";
const PASSWORD = "password123";
const OUT_DIR = fileURLToPath(new URL("../demo-recording/", import.meta.url));

mkdirSync(OUT_DIR, { recursive: true });

const sleep = (page, ms) => page.waitForTimeout(ms);
const rx = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

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
  }, text).catch(() => {});
}

async function step(page, text, ms = 2400) {
  console.log("• " + text);
  await caption(page, text);
  await sleep(page, ms);
}

async function settle(page, ms = 700) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(page, ms);
}

async function nav(page, label) {
  await page.getByRole("link", { name: rx(label) }).first().click().catch(() => {});
  await settle(page);
}

async function openCase(page, name) {
  await page.getByRole("link", { name: `Open ${name}` }).first().click();
  await settle(page);
}

async function caseIdFromUrl(page) {
  return new URL(page.url()).searchParams.get("case");
}

// A guarded section: a failure inside never kills the whole recording.
async function section(page, label, fn) {
  try { await fn(); }
  catch (err) {
    console.error(`SECTION "${label}" error:`, err.message);
    await caption(page, `(${label} — skipped: ${err.message})`).catch(() => {});
    await sleep(page, 1200);
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  try {
    // ── 1. Login ──────────────────────────────────────────────────────────
    await page.goto(`${BASE}/login`);
    await settle(page);
    await step(page, "NudgePay — a QuickBooks-native collections workspace. A full product tour.", 2600);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await step(page, "Sign in as the workspace owner (Chancey Heating & Cooling).", 1800);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard**", { timeout: 15000 });
    await settle(page, 900);

    // ── 2. Collections work queue ─────────────────────────────────────────
    await section(page, "queue", async () => {
      await step(page, "Collections — the case-centric work queue. Every past-due account, prioritized.", 3000);
      await step(page, "The metrics strip up top: follow-ups due, broken promises, on-hold exceptions, total at risk.", 3000);
      await step(page, "Each row carries the customer's preferred channel and any do-not-contact flags inline (C6).", 3000);
      await step(page, "Saved views segment the queue — My work, Follow-ups due, Promised, Waiting, On hold.", 2800);
    });

    // ── 3. Case detail: Riverside (Activity → SMS → Email composer) ────────
    await section(page, "riverside", async () => {
      await openCase(page, "Riverside Apartments LLC");
      const caseId = await caseIdFromUrl(page);
      await step(page, "Opening Riverside — the account detail panel: balance, aging, invoices, and the activity timeline.", 3200);

      await page.goto(`${BASE}/dashboard?case=${caseId}&tab=activity&view=all`);
      await settle(page);
      await step(page, "Activity — every contact attempt, promise, and status change, in one auditable timeline.", 3000);

      await page.goto(`${BASE}/dashboard?case=${caseId}&tab=messages&view=all`);
      await settle(page);
      await step(page, "The Messages tab — a two-way SMS thread over Twilio, with delivery status per message.", 3200);

      await page.goto(`${BASE}/dashboard?case=${caseId}&tab=email&view=all`);
      await settle(page);
      await step(page, "The Email tab — the same account, the email channel. Riverside is contactable on both.", 3000);
      await step(page, "Pick a template and it fills the subject + body; every send appends a CAN-SPAM footer.", 3000);
      // Best-effort: exercise the template picker + composer (non-fatal).
      try {
        const tmpl = page.getByLabel("Email template");
        if (await tmpl.count()) { await tmpl.selectOption({ index: 1 }).catch(() => {}); await sleep(page, 1200); }
        const subject = page.locator('input[name="subject"], #email-subject').first();
        if (await subject.count()) { await subject.click(); await sleep(page, 600); }
      } catch {}
      await step(page, "The composer is gated on consent — turn email off for a customer and the box disables.", 2800);

      // Comm-preferences drawer (reached from Messages tab).
      await page.goto(`${BASE}/dashboard?case=${caseId}&tab=messages&view=all`);
      await settle(page);
      await page.getByRole("link", { name: rx("Communication preferences") }).first().click().catch(() => {});
      await settle(page);
      await step(page, "Communication preferences (C6): preferred channel + per-channel opt-outs (text / call / email).", 3200);
      await step(page, "do-not-text / do-not-email hard-block a channel; the SMS-consent record is never overwritten here.", 3200);
    });

    // ── 4. Channel gating: Northgate triple-blocked ───────────────────────
    await section(page, "northgate", async () => {
      await page.goto(`${BASE}/dashboard?view=all`);
      await settle(page);
      await openCase(page, "Northgate Property Mgmt");
      const caseId = await caseIdFromUrl(page);
      await step(page, "Northgate is flagged do-not-call, do-not-text, AND do-not-email — every channel is blocked.", 3200);
      await page.goto(`${BASE}/dashboard?case=${caseId}&tab=email&view=all`);
      await settle(page);
      await step(page, "The Email composer is disabled with the reason shown — blocked, not hidden. One rule, enforced everywhere.", 3200);
    });

    // ── 5. Exceptions: Beacon legal hold (Waiting view) ───────────────────
    await section(page, "exceptions", async () => {
      await page.goto(`${BASE}/dashboard?view=waiting`);
      await settle(page);
      await step(page, "Parked exceptions drop out of the open queue — find them in the Waiting view.", 2800);
      await openCase(page, "Beacon Logistics");
      await step(page, "Beacon is on a legal-agency hold (C2): parked indefinitely — an exception, not an open case.", 3200);
      await step(page, "A legal hold blocks every channel and keeps the account out of day-to-day work.", 2800);
    });

    // ── 6. Bulk operations ────────────────────────────────────────────────
    await section(page, "bulk", async () => {
      await page.goto(`${BASE}/dashboard?view=all`);
      await settle(page);
      await step(page, "Bulk operations (C5): select multiple cases straight from the queue.", 2600);
      const boxes = page.locator('main input[type="checkbox"]');
      const n = await boxes.count();
      for (let i = 1; i <= Math.min(3, n - 1); i++) {
        await boxes.nth(i).check({ noWaitAfter: true }).catch(() => {});
        await sleep(page, 350);
      }
      await step(page, "A bulk bar appears: reassign owner, or send one templated SMS to all eligible — opt-outs skipped.", 3400);
    });

    // ── 7. Promises ledger ────────────────────────────────────────────────
    await section(page, "promises", async () => {
      await nav(page, "Promises");
      await page.waitForURL("**/promises**", { timeout: 15000 }).catch(() => {});
      await settle(page, 800);
      await step(page, "Promises — a dedicated ledger of every payment commitment, with its own lifecycle.", 3200);
      await step(page, "Filter by Active, Due soon, Broken, or Kept. Each promise tracks amount received vs promised.", 3200);
      await page.goto(`${BASE}/promises?tab=broken&sort=due-date`);
      await settle(page);
      await step(page, "Broken promises surface automatically once the grace window lapses without payment.", 3000);
      // Open a promise detail (first row).
      await page.goto(`${BASE}/promises?tab=all&sort=due-date`);
      await settle(page);
      const firstRow = page.locator('main ul[role="list"] a').first();
      if (await firstRow.count()) { await firstRow.click().catch(() => {}); await settle(page); }
      await step(page, "Opening a promise: the commitment, the linked invoices, and the running balance baseline.", 3200);
    });

    // ── 8. Channel-aware Messages inbox ───────────────────────────────────
    await section(page, "messages", async () => {
      await nav(page, "Messages");
      await page.waitForURL("**/messages**", { timeout: 15000 }).catch(() => {});
      await settle(page, 800);
      await step(page, "Messages — one unified inbox across both channels. SMS and email threads, side by side.", 3200);
      await step(page, "Filter by channel (All / SMS / Email) and by state — Needs reply, Needs attention, Active.", 3200);

      await page.goto(`${BASE}/messages?tab=all&sort=recent&channel=email`);
      await settle(page);
      await step(page, "The Email channel: Summit replied and is waiting (Needs reply); Delgado's email hard-bounced (Failed).", 3400);

      // Open the Summit email thread.
      const summit = page.getByRole("link", { name: rx("Summit Restaurant Group") }).first();
      if (await summit.count()) { await summit.click().catch(() => {}); await settle(page); }
      await step(page, "Opening the email thread — full subject + body, with a reply composer right in the inbox.", 3200);

      await page.goto(`${BASE}/messages?tab=all&sort=recent&channel=sms`);
      await settle(page);
      await step(page, "Switch to the SMS channel — the same inbox, the Twilio side of the conversation.", 3000);
      const riverside = page.getByRole("link", { name: rx("Riverside Apartments") }).first();
      if (await riverside.count()) { await riverside.click().catch(() => {}); await settle(page); }
      await step(page, "Riverside appears on both channels — every touchpoint with a customer in one place.", 3000);
    });

    // ── 9. Accounts ───────────────────────────────────────────────────────
    await section(page, "accounts", async () => {
      await nav(page, "Accounts");
      await page.waitForURL("**/accounts**", { timeout: 15000 }).catch(() => {});
      await settle(page, 800);
      await step(page, "Accounts — the customer directory: balances, contact info, and channel preferences per account.", 3200);
    });

    // ── 10. Reports (owner-only) ──────────────────────────────────────────
    await section(page, "reports", async () => {
      await nav(page, "Reports");
      await page.waitForURL("**/reports**", { timeout: 15000 }).catch(() => {});
      await settle(page, 800);
      await step(page, "Reports (owner-only): per-rep throughput, promise-kept rate, time-to-first-contact, workload.", 3400);
      await step(page, "Two reps here — Diskin & Avery — over a selectable 7 / 30 / 90-day window.", 3000);
    });

    // ── 11. Settings: QBO + channels + email config ───────────────────────
    await section(page, "settings", async () => {
      await page.goto(`${BASE}/settings`);
      await settle(page, 800);
      await step(page, "Settings — the QuickBooks connection that feeds the whole pipeline, plus sync health.", 3200);
      await step(page, "Text messaging config: the Twilio sender, and an SMS on/off switch for the workspace.", 3000);
      // Scroll to the Email section.
      await page.getByRole("heading", { name: rx("^Email$") }).first().scrollIntoViewIfNeeded().catch(() => {});
      await sleep(page, 600);
      await step(page, "Email config: enable the channel, set the From name + address and the CAN-SPAM postal address.", 3400);
    });

    // ── 12. Public CAN-SPAM unsubscribe page ──────────────────────────────
    await section(page, "unsubscribe", async () => {
      const token = process.env.UNSUB_TOKEN || "";
      await page.goto(`${BASE}/unsubscribe${token ? `?token=${token}` : ""}`);
      await settle(page, 800);
      await step(page, "Every email carries a one-click unsubscribe — the public, signed opt-out page (no login).", 3400);
      await step(page, "RFC 8058: the GET only confirms; the opt-out is recorded on POST — safe from link prefetchers.", 3400);
    });

    await step(page, "That's NudgePay: QBO-synced cases, two-way SMS + email, promises, exceptions, bulk ops, and reporting.", 3600);
  } catch (err) {
    console.error("WALKTHROUGH ERROR:", err.message);
    await caption(page, "Recording ended early: " + err.message);
    await sleep(page, 1500);
  } finally {
    await context.close();
    await browser.close();
    try {
      const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(".webm")).sort();
      if (files.length) {
        const newest = files[files.length - 1];
        const dest = path.join(OUT_DIR, "nudgepay-full-demo.webm");
        renameSync(path.join(OUT_DIR, newest), dest);
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
