import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { applyPromiseEvaluation } from "../app/lib/promise-evaluation.server";

test("promises: RLS isolates by org and one-active-per-case index holds", async () => {
  const svc = serviceClient();
  const a = await makeUserClient("promises-rls-a@example.com");
  const b = await makeUserClient("promises-rls-b@example.com");

  const { data: orgA } = await svc.from("organizations").insert({ name: `PromOrgA ${a.userId}` }).select("id").single();
  const { data: orgB } = await svc.from("organizations").insert({ name: `PromOrgB ${b.userId}` }).select("id").single();
  await svc.from("memberships").insert([
    { org_id: orgA!.id, user_id: a.userId, role: "owner" },
    { org_id: orgB!.id, user_id: b.userId, role: "owner" },
  ]);
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgA!.id, qbo_id: `prc-${a.userId}`, name: "Acme" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgA!.id, customer_id: cust!.id, status: "promised" }).select("id").single();

  const { error: insErr } = await svc.from("promises").insert({
    org_id: orgA!.id, case_id: cse!.id, customer_id: cust!.id,
    status: "pending", promised_amount: 500, promised_date: "2026-07-01",
    grace_until: "2026-07-03", baseline_balance: 1200,
  });
  expect(insErr).toBeNull();

  // Member A reads its own promise; member B sees nothing.
  const { data: seenByA } = await a.client.from("promises").select("id").eq("org_id", orgA!.id);
  expect(seenByA!.length).toBe(1);
  const { data: seenByB } = await b.client.from("promises").select("id").eq("org_id", orgA!.id);
  expect(seenByB!.length).toBe(0);

  // Second pending promise on the same case violates the partial-unique index.
  const { error: dupErr } = await svc.from("promises").insert({
    org_id: orgA!.id, case_id: cse!.id, customer_id: cust!.id,
    status: "pending", promised_amount: 100, promised_date: "2026-07-05",
    grace_until: "2026-07-07", baseline_balance: 1200,
  });
  expect((dupErr as any)?.code).toBe("23505");
});

test("applyPromiseEvaluation: kept on payment, broken at deadline, case reflection", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `EvalOrg ${Math.random()}` }).select("id").single();
  const orgId = org!.id;

  async function makeCaseWithPromise(qboSuffix: string, balance: number, graceUntil: string) {
    const { data: cust } = await svc.from("customers")
      .insert({ org_id: orgId, qbo_id: `ev-${qboSuffix}`, name: `C-${qboSuffix}` }).select("id").single();
    const { data: inv } = await svc.from("invoices").insert({
      org_id: orgId, qbo_id: `evi-${qboSuffix}`, qbo_doc_number: qboSuffix, customer_id: cust!.id,
      amount: 1200, balance, due_date: "2026-03-01", status: "overdue",
    }).select("id").single();
    const { data: cse } = await svc.from("collection_cases")
      .insert({ org_id: orgId, customer_id: cust!.id, status: "promised", next_action_type: "promise", next_action_at: graceUntil })
      .select("id").single();
    const { data: prom } = await svc.from("promises").insert({
      org_id: orgId, case_id: cse!.id, customer_id: cust!.id, status: "pending",
      promised_amount: 500, promised_date: "2026-07-01", grace_until: graceUntil, baseline_balance: 1200,
    }).select("id").single();
    await svc.from("promise_invoices").insert({ promise_id: prom!.id, invoice_id: inv!.id, org_id: orgId, baseline_balance: 1200 });
    return { caseId: cse!.id, promiseId: prom!.id };
  }

  // KEPT: balance dropped 1200 -> 700 (received 500 >= 500).
  const kept = await makeCaseWithPromise("kept", 700, "2026-07-03");
  // BROKEN: balance still 1200, today past grace.
  const broken = await makeCaseWithPromise("broken", 1200, "2026-07-03");

  const res = await applyPromiseEvaluation(svc, orgId, "2026-07-06");
  expect(res.kept).toBe(1);
  expect(res.broken).toBe(1);

  const { data: keptRow } = await svc.from("promises").select("status, amount_received").eq("id", kept.promiseId).single();
  expect(keptRow!.status).toBe("kept");
  expect(Number(keptRow!.amount_received)).toBe(500);

  const { data: brokenCase } = await svc.from("collection_cases").select("status, next_action_type, next_action_at").eq("id", broken.caseId).single();
  expect(brokenCase!.status).toBe("working");
  expect(brokenCase!.next_action_type).toBe("follow_up");
  expect(brokenCase!.next_action_at).toBe("2026-07-06");
});

// F-scenario (high-risk) coverage — five invoices / one payment.
// Exercises the multi-invoice aggregation in applyPromiseEvaluation: a promise
// links FIVE invoices, and the received amount is derived from the SUM of their
// current balances (baseline 5000 − Σ current). The other applier tests link a
// single invoice, so this is the only test covering the per-promise balance sum.
test("F: five invoices / one payment — promise kept on the aggregated linked balance", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `F1 ${Math.random()}` }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `f1-${Math.random()}`, name: "Multi-Invoice Co" }).select("id").single();

  // Five overdue invoices, $1,000 each → $5,000 total linked balance.
  const invIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const { data: inv } = await svc.from("invoices").insert({
      org_id: orgId, qbo_id: `f1-inv-${i}-${Math.random()}`, qbo_doc_number: `F1-${i}`, customer_id: cust!.id,
      amount: 1000, balance: 1000, due_date: "2026-03-01", status: "overdue",
    }).select("id").single();
    invIds.push(inv!.id as string);
  }
  const { data: cse } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "promised", next_action_type: "promise", next_action_at: "2026-07-03",
  }).select("id").single();
  // Promise $2,000 against the $5,000 baseline, linked to all five invoices.
  const { data: prom } = await svc.from("promises").insert({
    org_id: orgId, case_id: cse!.id, customer_id: cust!.id, status: "pending",
    promised_amount: 2000, promised_date: "2026-07-01", grace_until: "2026-07-03", baseline_balance: 5000,
  }).select("id").single();
  await svc.from("promise_invoices").insert(
    invIds.map((id) => ({ promise_id: prom!.id, invoice_id: id, org_id: orgId, baseline_balance: 1000 })),
  );

  // One $2,000 payment lands across two invoices → both drop to 0.
  // Σ current = 0 + 0 + 1000*3 = 3000 → received = 5000 − 3000 = 2000 ≥ promised 2000 → kept,
  // even though three invoices (and $3,000) remain open. Evaluated BEFORE grace.
  await svc.from("invoices").update({ balance: 0 }).in("id", [invIds[0], invIds[1]]);

  const res = await applyPromiseEvaluation(svc, orgId, "2026-07-02");
  expect(res.kept).toBe(1);
  const { data: pr } = await svc.from("promises").select("status, amount_received").eq("id", prom!.id).single();
  expect(pr!.status).toBe("kept");
  expect(Number(pr!.amount_received)).toBe(2000);
});
