import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("DetailPanel consent posts customerId (NP-AUD-2026-109)", () => {
  const src = read("../app/components/DetailPanel.tsx");
  const form = src.match(/<form method="post" action="\/api\/sms-consent">[\s\S]*?<\/form>/);
  expect(form, "sms-consent form missing").toBeTruthy();
  expect(form![0]).toMatch(/name="customerId"/);
  expect(form![0]).toMatch(/selected\.customerId/);
  expect(form![0]).not.toMatch(/name="assign"/);
});

test("invite flash is generic, not raw DB (NP-AUD-2026-126)", () => {
  const action = read("../app/routes/api.members.tsx");
  expect(action).toContain('flag(returnTo, "error", "invite")');
  expect(action).not.toMatch(/error\.message/);
  const ui = read("../app/routes/settings.tsx");
  expect(ui).toMatch(/Could not create that invite/);
});

test("pending invites unique per org+email (NP-AUD-2026-130)", () => {
  const sql = read("../supabase/migrations/0036_memberships_offboarding.sql");
  expect(sql).toContain("invites_pending_email_idx");
  expect(sql).toMatch(/accepted_at is null/i);
});

test("dashboard scoring uses cases.ts not worklist.priorityOf (NP-AUD-2026-124)", () => {
  const dash = read("../app/routes/dashboard.tsx");
  expect(dash).toContain("buildCaseItems");
  expect(dash).not.toContain("priorityOf");
  const cases = read("../app/lib/cases.ts");
  expect(cases).toContain("scorePriority");
});

test("priority form min matches parser (NP-AUD-2026-045-VALIDATION-RANGE)", () => {
  const form = read("../app/components/PriorityThresholdsForm.tsx");
  const parser = read("../app/lib/org-settings.ts");
  expect(parser).toContain("HIGH_VALUE_THRESHOLD_MIN = 1_000");
  expect(form).toContain("HIGH_VALUE_THRESHOLD_MIN");
  expect(form).not.toMatch(/min=\{0\.01\}/);
});

test("QBO webhook returns 200 via waitUntil (NP-AUD-2026-031)", () => {
  const src = read("../app/routes/webhooks.qbo.tsx");
  expect(src).toContain("waitUntil");
  expect(src).toContain('return new Response("ok", { status: 200 })');
});

test("storeConnection refuses a realm switch (NP-AUD-2026-027)", () => {
  const src = read("../app/lib/qbo-connection.server.ts");
  expect(src).toContain("realm mismatch");
});

test("queue.csv is registered (NP-AUD-2026-048-CSV)", () => {
  const routes = read("../app/routes.ts");
  expect(routes).toContain('"routes/queue.csv.tsx"');
  const queue = read("../app/components/WorkQueue.tsx");
  expect(queue).toContain("/queue.csv");
});

test("LICENSE exists (NP-AUD-2026-133)", () => {
  const license = readFileSync(fileURLToPath(new URL("../../LICENSE", import.meta.url)), "utf8");
  expect(license).toMatch(/9th Level Software/);
});

test("npm metadata is not the RR starter (NP-AUD-2026-132-STARTER)", () => {
  const pkg = JSON.parse(read("../package.json"));
  expect(pkg.description).not.toMatch(/Build a full-stack web application/i);
  expect(pkg.cloudflare.publish).toBe(false);
  expect(pkg.cloudflare.label).toBe("NudgePay");
});

test("AGENTS.md lists migrations through 0041 (NP-AUD-2026-132-AGENTS)", () => {
  const agents = readFileSync(fileURLToPath(new URL("../../AGENTS.md", import.meta.url)), "utf8");
  expect(agents).toMatch(/0001\.\.0041|0001–0041/);
});

test("app README is NudgePay not the starter (NP-AUD-2026-132-README)", () => {
  const readme = read("../README.md");
  expect(readme).toMatch(/NudgePay/);
  expect(readme).not.toMatch(/Welcome to Remix/i);
});

test("email_config upsert stamps updated_at (NP-AUD-2026-128)", () => {
  const src = read("../app/routes/api.org-settings.tsx");
  expect(src).toContain("emailConfigUpsertRow");
});

test("case-queue throws on truncated PostgREST pages (NP-AUD-2026-007-TRUNCATION)", () => {
  const src = read("../app/lib/case-queue.server.ts");
  expect(src).toContain("assertNotTruncated");
  expect(src).toContain('count: "exact"');
});

test("sync pages Intuit queries and does not advance truncated CDC (NP-AUD-2026-028)", () => {
  const src = read("../app/lib/qbo-sync.server.ts");
  expect(src).toContain("qboQueryAll");
  expect(src).toContain("CDC truncated");
});
