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
