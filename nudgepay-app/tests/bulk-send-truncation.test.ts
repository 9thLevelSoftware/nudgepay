import { beforeAll, expect, test, vi } from "vitest";

vi.mock("../app/lib/page-all", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/page-all")>();
  return {
    ...actual,
    pageAll: (run: Parameters<typeof actual.pageAll>[0], opts?: Parameters<typeof actual.pageAll>[1]) =>
      actual.pageAll(run, { ...opts, maxRows: 1 }),
  };
});

import { serviceClient, makeUserClient } from "./helpers";
import { runBulkSms } from "../app/lib/bulk-send.server";
import type { MessagingDeps } from "../app/lib/twilio-messaging.server";
import { DEFAULT_ORG_CONFIG } from "../app/lib/org-config";

let userId: string;
beforeAll(async () => { ({ userId } = await makeUserClient("bulk-sms-trunc@example.com")); });

const svc = serviceClient();
const today = "2026-06-25";
const DAYTIME_NOW = new Date("2026-06-15T18:00:00Z");

function jsonResponse(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function deps(fetchFn: ReturnType<typeof vi.fn>): MessagingDeps {
  return {
    fetchFn, service: svc, twilio: { accountSid: "AC1", authToken: "tok" }, defaultSender: { from: "+15005550006" },
    statusCallback: null, now: DAYTIME_NOW,
    quietHoursWindow: { timezone: "America/New_York", startHour: 8, endHour: 21 },
  };
}

test("runBulkSms fails a case rather than sending a truncated {balance} total", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "Bulk Trunc Org" }).select("id").single();
  const orgId = org!.id as string;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "q-trunc", name: "Trunc Co", phone: "+12295550999", sms_consent: true })
    .select("id").single();
  await svc.from("invoices").insert([
    { org_id: orgId, qbo_id: "i-trunc-1", qbo_doc_number: "t1", customer_id: cust!.id, balance: 100, due_date: "2026-05-01" },
    { org_id: orgId, qbo_id: "i-trunc-2", qbo_doc_number: "t2", customer_id: cust!.id, balance: 50, due_date: "2026-05-02" },
  ]);
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();

  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-TRUNC", status: "queued" }));
  const res = await runBulkSms(deps(fetchFn), {
    orgId, userId, caseIds: [cse!.id as string], today,
    templateBody: "Hi {customer}, you owe {balance}.", orgConfig: DEFAULT_ORG_CONFIG,
  });
  expect(res.sent).toBe(0);
  expect(res.failed).toBe(1);
  expect(res.failed).toBe(res.failures.length);
  expect(res.failures[0]?.caseId).toBe(cse!.id);
  expect(fetchFn).not.toHaveBeenCalled();
});
