import { expect, test } from "vitest";
import { serviceClient } from "./helpers";
import { upsertPayments, applyPaymentsAndEvaluate, type SyncDeps } from "../app/lib/qbo-sync.server";
import { qboApiBaseUrl } from "../app/lib/qbo-api.server";

test("upsertPayments is idempotent on (org_id, qbo_id, type)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `PaySync ${Math.random()}` }).select("id").single();
  const orgId = org!.id;
  const row = {
    org_id: orgId, qbo_id: "501", type: "payment" as const, customer_id: null,
    amount: 100, txn_date: "2026-06-20", qbo_sync_at: new Date().toISOString(),
  };
  await upsertPayments(svc, [row]);
  await upsertPayments(svc, [{ ...row, amount: 150 }]); // same key — updates, no dup
  const { data } = await svc.from("payments").select("amount").eq("org_id", orgId).eq("qbo_id", "501");
  expect(data!.length).toBe(1);
  expect(Number(data![0].amount)).toBe(150);
});

test("applyPaymentsAndEvaluate upserts payments, re-pulls invoices, and marks the promise kept", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `PayEval ${Math.random()}` }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "9", name: "Acme" }).select("id").single();
  const { data: inv } = await svc.from("invoices").insert({
    org_id: orgId, qbo_id: "inv-9", qbo_doc_number: "1001", customer_id: cust!.id,
    amount: 1200, balance: 1200, due_date: "2026-03-01", status: "overdue",
  }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "promised", next_action_type: "promise", next_action_at: "2026-07-03" })
    .select("id").single();
  const { data: prom } = await svc.from("promises").insert({
    org_id: orgId, case_id: cse!.id, customer_id: cust!.id, status: "pending",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03", baseline_balance: 1200,
  }).select("id").single();
  await svc.from("promise_invoices").insert({ promise_id: prom!.id, invoice_id: inv!.id, org_id: orgId, baseline_balance: 1200 });

  // fetchFn mock: the re-pull query returns the invoice now paid down to 700.
  const fetchFn = (async () => ({
    ok: true,
    json: async () => ({ QueryResponse: { Invoice: [{ Id: "inv-9", DocNumber: "1001", CustomerRef: { value: "9" }, TotalAmt: 1200, Balance: 700, DueDate: "2026-03-01" }] } }),
  } as any)) as unknown as typeof fetch;

  const deps: SyncDeps = {
    fetchFn, service: svc,
    cfg: { clientId: "x", clientSecret: "x", redirectUri: "x" },
    api: { baseUrl: "https://x" }, key: "x",
  };
  const paymentRaws = [{ raw: { Id: "501", TotalAmt: 500, TxnDate: "2026-07-02", CustomerRef: { value: "9" } }, type: "payment" as const }];

  await applyPaymentsAndEvaluate(deps, orgId, "tok", "RID", paymentRaws, "2026-07-06", new Date("2026-07-06T00:00:00Z"));

  const { data: pay } = await svc.from("payments").select("amount").eq("org_id", orgId).eq("qbo_id", "501");
  expect(pay!.length).toBe(1);
  const { data: invRow } = await svc.from("invoices").select("balance").eq("id", inv!.id).single();
  expect(Number(invRow!.balance)).toBe(700);
  const { data: pr } = await svc.from("promises").select("status").eq("id", prom!.id).single();
  expect(pr!.status).toBe("kept");
});

// Shared helpers for the F-scenario resolution tests below.
function repullFetch(qboId: string, docNumber: string, custQboId: string, balance: number) {
  return (async () => ({
    ok: true,
    json: async () => ({ QueryResponse: { Invoice: [{ Id: qboId, DocNumber: docNumber, CustomerRef: { value: custQboId }, TotalAmt: 1200, Balance: balance, DueDate: "2026-03-01" }] } }),
  } as any)) as unknown as typeof fetch;
}
function depsWith(svc: any, fetchFn: typeof fetch): SyncDeps {
  return { fetchFn, service: svc, cfg: { clientId: "x", clientSecret: "x", redirectUri: "x" }, api: { baseUrl: "https://x" }, key: "x" };
}
async function seedOverdueCaseForResolution(svc: any, tag: string, status: string, nextActionType: string, nextActionAt: string | null) {
  const { data: org } = await svc.from("organizations").insert({ name: `${tag} ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `${tag}-9`, name: `${tag} Co` }).select("id").single();
  const { data: inv } = await svc.from("invoices").insert({
    org_id: orgId, qbo_id: `${tag}-inv-9`, qbo_doc_number: `${tag}-5001`, customer_id: cust!.id,
    amount: 1200, balance: 1200, due_date: "2026-03-01", status: "overdue",
  }).select("id").single();
  const { data: cse } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status, next_action_type: nextActionType, next_action_at: nextActionAt,
  }).select("id").single();
  return { orgId, invId: inv!.id as string, caseId: cse!.id as string, custQboId: `${tag}-9`, invQboId: `${tag}-inv-9`, docNumber: `${tag}-5001` };
}

// F-scenario: payment after a follow-up was created. A case with a scheduled
// future follow-up is auto-resolved when the payment zeroes the invoice — the
// payment supersedes the pending follow-up. applyPaymentsAndEvaluate runs the
// re-pull → reconciliation, so the case closes end-to-end.
test("F: payment after a follow-up resolves the case (follow-up superseded)", async () => {
  const svc = serviceClient();
  const s = await seedOverdueCaseForResolution(svc, "f5", "working", "follow_up", "2026-07-20");
  const fetchFn = repullFetch(s.invQboId, s.docNumber, s.custQboId, 0); // paid in full → balance 0
  const paymentRaws = [{ raw: { Id: "f5-pay", TotalAmt: 1200, TxnDate: "2026-07-05", CustomerRef: { value: s.custQboId } }, type: "payment" as const }];

  await applyPaymentsAndEvaluate(depsWith(svc, fetchFn), s.orgId, "tok", "RID", paymentRaws, "2026-07-06", new Date("2026-07-06T00:00:00Z"));

  const { data: invRow } = await svc.from("invoices").select("balance").eq("id", s.invId).single();
  expect(Number(invRow!.balance)).toBe(0);
  const { data: caseRow } = await svc.from("collection_cases").select("status, closed_at, next_action_at").eq("id", s.caseId).single();
  expect(caseRow!.status).toBe("resolved");
  expect(caseRow!.closed_at).not.toBeNull();
  expect(caseRow!.next_action_at).toBeNull(); // the scheduled follow-up is cleared
});

// F-scenario: void / credit in QBO. A credit memo (not a cash payment) that
// zeroes the balance resolves the case the same way — exercising the otherwise
// untested type: "credit_memo" path through mapQboPayment + reconciliation.
test("F: a QBO credit memo that zeroes the balance resolves the case", async () => {
  const svc = serviceClient();
  const s = await seedOverdueCaseForResolution(svc, "f6", "working", "follow_up", "2026-07-15");
  const fetchFn = repullFetch(s.invQboId, s.docNumber, s.custQboId, 0); // credit zeroes the balance
  const paymentRaws = [{ raw: { Id: "f6-cm", TotalAmt: 1200, TxnDate: "2026-07-05", CustomerRef: { value: s.custQboId } }, type: "credit_memo" as const }];

  await applyPaymentsAndEvaluate(depsWith(svc, fetchFn), s.orgId, "tok", "RID", paymentRaws, "2026-07-06", new Date("2026-07-06T00:00:00Z"));

  const { data: credit } = await svc.from("payments").select("type, amount").eq("org_id", s.orgId).eq("qbo_id", "f6-cm").single();
  expect(credit!.type).toBe("credit_memo");
  const { data: invRow } = await svc.from("invoices").select("balance").eq("id", s.invId).single();
  expect(Number(invRow!.balance)).toBe(0);
  const { data: caseRow } = await svc.from("collection_cases").select("status, closed_at").eq("id", s.caseId).single();
  expect(caseRow!.status).toBe("resolved");
  expect(caseRow!.closed_at).not.toBeNull();
});
