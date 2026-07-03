import { beforeAll, expect, test, vi } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { runBulkSms } from "../app/lib/bulk-send.server";
import type { MessagingDeps } from "../app/lib/twilio-messaging.server";
import { MAX_BATCH } from "../app/lib/bulk";
import { DEFAULT_ORG_CONFIG, type OrgConfig } from "../app/lib/org-config";

let userId: string;
beforeAll(async () => { ({ userId } = await makeUserClient("bulk-sms@example.com")); });

const svc = serviceClient();
const today = "2026-06-25";

function withBatchLimit(limit: number): OrgConfig {
  return { ...DEFAULT_ORG_CONFIG, workflow: { ...DEFAULT_ORG_CONFIG.workflow, smsBatchLimit: limit } };
}

function jsonResponse(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
// Fixed "now" inside the default quiet-hours window (8-21, America/New York)
// so these tests are deterministic regardless of wall-clock time — mirrors
// the api.bulk-sms.tsx production path, which threads a pre-fetched window
// through deps.quietHoursWindow (set explicitly here too, to also cover the
// no-repeat-read behavior the route relies on for a ≤50-case batch).
const DAYTIME_NOW = new Date("2026-06-15T18:00:00Z");
function deps(fetchFn: any): MessagingDeps {
  return {
    fetchFn, service: svc, twilio: { accountSid: "AC1", authToken: "tok" }, defaultSender: { from: "+15005550006" },
    statusCallback: null, now: DAYTIME_NOW,
    quietHoursWindow: { timezone: "America/New_York", startHour: 8, endHour: 21 },
  };
}
async function seedCase(orgId: string, o: { name: string; phone: string | null; consent: boolean; doc: string; due: string; balance: number }) {
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `q-${o.name}`, name: o.name, phone: o.phone, sms_consent: o.consent }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: `i-${o.name}`, qbo_doc_number: o.doc, customer_id: cust!.id, balance: o.balance, due_date: o.due }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();
  return { customerId: cust!.id as string, invoiceId: inv!.id as string, caseId: cse!.id as string };
}

test("runBulkSms sends to eligible cases, skips no-consent/no-phone, records one row each", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "Bulk SMS Org" }).select("id").single();
  const orgId = org!.id as string;
  const yes = await seedCase(orgId, { name: "Yes Co", phone: "+12295550100", consent: true, doc: "1001", due: "2026-05-01", balance: 100 });
  const noConsent = await seedCase(orgId, { name: "NoConsent Co", phone: "+12295550101", consent: false, doc: "1002", due: "2026-05-01", balance: 100 });
  const noPhone = await seedCase(orgId, { name: "NoPhone Co", phone: null, consent: true, doc: "1003", due: "2026-05-01", balance: 100 });

  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-BULK", status: "queued" }));
  const res = await runBulkSms(deps(fetchFn), {
    orgId, userId, caseIds: [yes.caseId, noConsent.caseId, noPhone.caseId], today,
    templateBody: "Hi {customer}, you owe {balance}.", orgConfig: DEFAULT_ORG_CONFIG,
  });

  expect(res).toEqual({ sent: 1, failed: 0, skipped: 2 });
  expect(fetchFn).toHaveBeenCalledOnce();
  const { data: rows } = await svc.from("text_messages").select("case_id, invoice_id, body").eq("case_id", yes.caseId);
  expect(rows).toHaveLength(1);
  expect(rows![0].invoice_id).toBe(yes.invoiceId);
  expect(rows![0].body).toBe("Hi Yes Co, you owe $100.00.");
  const { data: skippedRows } = await svc.from("text_messages").select("id").in("case_id", [noConsent.caseId, noPhone.caseId]);
  expect(skippedRows).toHaveLength(0);
});

test("runBulkSms tallies a failed send without aborting siblings", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "Bulk SMS Fail Org" }).select("id").single();
  const orgId = org!.id as string;
  const a = await seedCase(orgId, { name: "A Co", phone: "+12295550110", consent: true, doc: "2001", due: "2026-05-01", balance: 100 });
  const b = await seedCase(orgId, { name: "B Co", phone: "+12295550111", consent: true, doc: "2002", due: "2026-05-01", balance: 100 });
  let n = 0;
  const fetchFn = vi.fn(async () => { n++; if (n === 1) throw new Error("twilio down"); return jsonResponse({ sid: "SM-OK", status: "queued" }); });
  const res = await runBulkSms(deps(fetchFn), { orgId, userId, caseIds: [a.caseId, b.caseId], today, templateBody: "Hi {customer}", orgConfig: DEFAULT_ORG_CONFIG });
  expect(res.sent).toBe(1);
  expect(res.failed).toBe(1);
  expect(res.skipped).toBe(0);
});

test("runBulkSms ignores a foreign-org case id (org-scoped reads drop it)", async () => {
  const { data: orgA } = await svc.from("organizations").insert({ name: "Bulk Scope A" }).select("id").single();
  const { data: orgB } = await svc.from("organizations").insert({ name: "Bulk Scope B" }).select("id").single();
  const inB = await seedCase(orgB!.id as string, { name: "B Only", phone: "+12295550120", consent: true, doc: "3001", due: "2026-05-01", balance: 100 });
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-X", status: "queued" }));
  // Caller resolved to org A but passes org B's case id.
  const res = await runBulkSms(deps(fetchFn), { orgId: orgA!.id as string, userId, caseIds: [inB.caseId], today, templateBody: "Hi {customer}", orgConfig: DEFAULT_ORG_CONFIG });
  expect(res).toEqual({ sent: 0, failed: 0, skipped: 0 });
  expect(fetchFn).not.toHaveBeenCalled();
});

test("runBulkSms clamps to MAX_BATCH (50) when given 51 eligible cases", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "Bulk Cap Org" }).select("id").single();
  const orgId = org!.id as string;
  const caseIds: string[] = [];
  for (let i = 0; i < 51; i++) {
    const idx = String(i).padStart(3, "0");
    const { caseId } = await seedCase(orgId, {
      name: `CapCo ${idx}`,
      phone: `+1229555${idx.padStart(4, "0")}`,
      consent: true,
      doc: `cap-${idx}`,
      due: "2026-05-01",
      balance: 100,
    });
    caseIds.push(caseId);
  }
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-CAP", status: "queued" }));
  const res = await runBulkSms(deps(fetchFn), { orgId, userId, caseIds, today, templateBody: "Hi {customer}", orgConfig: DEFAULT_ORG_CONFIG });
  expect(res.sent).toBe(MAX_BATCH);
  expect(res.sent + res.failed + res.skipped).toBe(MAX_BATCH);
  expect(fetchFn).toHaveBeenCalledTimes(MAX_BATCH);
});

// ---------------------------------------------------------------------------
// Quiet hours (Phase 7) — bulk path
// ---------------------------------------------------------------------------

// The route-level fast-fail (api.bulk-sms.tsx redirects with bulkSms=quiet
// before calling runBulkSms) uses the same isWithinSendWindow gate covered by
// quiet-hours.test.ts. This test instead proves the DEFENSE IN DEPTH: even if
// the route's pre-check were ever bypassed, sendInvoiceText's own quiet-hours
// gate (which runBulkSms sends every case through) still blocks — no case
// silently sends outside the window.
test("runBulkSms tallies every case as failed when outside quiet hours, even though eligible", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "Bulk Quiet Hours Org" }).select("id").single();
  const orgId = org!.id as string;
  const a = await seedCase(orgId, { name: "Quiet A", phone: "+12295550210", consent: true, doc: "q001", due: "2026-05-01", balance: 100 });
  const b = await seedCase(orgId, { name: "Quiet B", phone: "+12295550211", consent: true, doc: "q002", due: "2026-05-01", balance: 100 });

  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-SHOULD-NOT-SEND", status: "queued" }));
  const outsideDeps: MessagingDeps = {
    ...deps(fetchFn),
    now: new Date("2026-06-15T04:00:00Z"), // midnight America/New_York — outside 8-21
  };
  const res = await runBulkSms(outsideDeps, {
    orgId, userId, caseIds: [a.caseId, b.caseId], today, templateBody: "Hi {customer}", orgConfig: DEFAULT_ORG_CONFIG,
  });
  expect(res).toEqual({ sent: 0, failed: 2, skipped: 0 });
  expect(fetchFn).not.toHaveBeenCalled();
});

// Server/client batch-limit drift guard (Phase 5): both MUST source the same
// org value. This proves the server clamp actually uses orgConfig.workflow
// .smsBatchLimit rather than a hardcoded MAX_BATCH — a non-default limit (5,
// well below MAX_BATCH's 50) sends to only the first 5 eligible cases.
test("runBulkSms clamps to the org-configured smsBatchLimit, not the hardcoded MAX_BATCH default", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "Bulk Custom Limit Org" }).select("id").single();
  const orgId = org!.id as string;
  const caseIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const idx = String(i).padStart(3, "0");
    const { caseId } = await seedCase(orgId, {
      name: `LimitCo ${idx}`,
      phone: `+1229556${idx.padStart(4, "0")}`,
      consent: true,
      doc: `lim-${idx}`,
      due: "2026-05-01",
      balance: 100,
    });
    caseIds.push(caseId);
  }
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-LIM", status: "queued" }));
  const res = await runBulkSms(deps(fetchFn), {
    orgId, userId, caseIds, today, templateBody: "Hi {customer}", orgConfig: withBatchLimit(5),
  });
  expect(res.sent).toBe(5);
  expect(res.sent + res.failed + res.skipped).toBe(5);
  expect(fetchFn).toHaveBeenCalledTimes(5);
});
