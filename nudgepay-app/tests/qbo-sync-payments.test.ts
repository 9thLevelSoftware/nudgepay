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
