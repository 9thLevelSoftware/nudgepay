import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { cancelPromise } from "../app/lib/promise-cancel.server";
import { createPromiseForLog } from "../app/lib/promise-create.server";

async function seedOrg(opts: { ownerEmail: string; memberEmail?: string }) {
  const svc = serviceClient();
  const owner = await makeUserClient(opts.ownerEmail);
  const { data: org } = await svc.from("organizations")
    .insert({ name: `PRLS ${owner.userId}` }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });
  let member: Awaited<ReturnType<typeof makeUserClient>> | null = null;
  if (opts.memberEmail) {
    member = await makeUserClient(opts.memberEmail);
    await svc.from("memberships").insert({ org_id: orgId, user_id: member.userId, role: "member" });
  }
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `prls-${owner.userId}`, name: "Acme" }).select("id").single();
  const { data: inv } = await svc.from("invoices").insert({
    org_id: orgId, qbo_id: `prlsi-${owner.userId}`, qbo_doc_number: "1",
    customer_id: cust!.id, amount: 1200, balance: 1200, due_date: "2026-03-01", status: "overdue",
  }).select("id").single();
  const { data: cse } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "promised",
    next_action_type: "promise", next_action_at: "2026-07-03",
  }).select("id").single();
  return {
    svc, orgId, owner, member,
    customerId: cust!.id as string,
    invoiceId: inv!.id as string,
    caseId: cse!.id as string,
  };
}

async function insertPending(
  svc: ReturnType<typeof serviceClient>,
  orgId: string, caseId: string, customerId: string,
) {
  const { data, error } = await svc.from("promises").insert({
    org_id: orgId, case_id: caseId, customer_id: customerId, status: "pending",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03",
    baseline_balance: 1200,
  }).select("id").single();
  expect(error).toBeNull();
  return data!.id as string;
}

test("1: member cannot PATCH pending → kept", async () => {
  const { svc, orgId, member, customerId, caseId } = await seedOrg({
    ownerEmail: "promises-rls-kept-o@example.com",
    memberEmail: "promises-rls-kept-m@example.com",
  });
  const promiseId = await insertPending(svc, orgId, caseId, customerId);

  const { error } = await member!.client.from("promises")
    .update({ status: "kept" })
    .eq("org_id", orgId)
    .eq("id", promiseId);
  expect(error).not.toBeNull();

  const { data: row } = await svc.from("promises").select("status").eq("id", promiseId).single();
  expect(row!.status).toBe("pending");
});

test("2: member cannot DELETE a promise", async () => {
  const { svc, orgId, member, customerId, caseId } = await seedOrg({
    ownerEmail: "promises-rls-del-o@example.com",
    memberEmail: "promises-rls-del-m@example.com",
  });
  const promiseId = await insertPending(svc, orgId, caseId, customerId);

  await member!.client.from("promises")
    .delete()
    .eq("org_id", orgId)
    .eq("id", promiseId);

  const { data: row } = await svc.from("promises").select("id").eq("id", promiseId).maybeSingle();
  expect(row).not.toBeNull();
});

test("3: member cancelPromise still succeeds", async () => {
  const { svc, orgId, member, customerId, caseId } = await seedOrg({
    ownerEmail: "promises-rls-cancel-o@example.com",
    memberEmail: "promises-rls-cancel-m@example.com",
  });
  const promiseId = await insertPending(svc, orgId, caseId, customerId);

  const res = await cancelPromise(member!.client, promiseId, orgId, "2026-06-23");
  expect(res.ok).toBe(true);

  const { data: p } = await svc.from("promises").select("status").eq("id", promiseId).single();
  expect(p!.status).toBe("cancelled");
});

test("4: non-owner member createPromiseForLog supersedes existing pending", async () => {
  const { svc, orgId, member, customerId, caseId, invoiceId } = await seedOrg({
    ownerEmail: "promises-rls-super-o@example.com",
    memberEmail: "promises-rls-super-m@example.com",
  });
  const priorId = await insertPending(svc, orgId, caseId, customerId);

  const res = await createPromiseForLog(member!.client, {
    orgId, caseId, customerId, userId: member!.userId,
    contactLogId: null, promisedAmount: 800, promisedDate: "2026-07-10",
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;

  const { data: rows } = await svc.from("promises")
    .select("id, status, replacement_promise_id, created_by, grace_until, baseline_balance")
    .eq("org_id", orgId);
  const prior = rows!.find((r) => r.id === priorId);
  const next = rows!.find((r) => r.id === res.promiseId);
  expect(prior!.status).toBe("renegotiated");
  expect(prior!.replacement_promise_id).toBe(res.promiseId);
  expect(next!.status).toBe("pending");
  expect(next!.created_by).toBe(member!.userId);
  expect(next!.grace_until).toBe("2026-07-14");
  expect(Number(next!.baseline_balance)).toBe(1200);
  expect(rows!.filter((r) => r.status === "pending")).toHaveLength(1);

  const { data: links } = await svc.from("promise_invoices")
    .select("invoice_id, baseline_balance").eq("promise_id", res.promiseId);
  expect(links).toHaveLength(1);
  expect(links![0].invoice_id).toBe(invoiceId);
  expect(Number(links![0].baseline_balance)).toBe(1200);

  const { data: cse } = await svc.from("collection_cases")
    .select("status, next_action_type, next_action_at").eq("id", caseId).single();
  expect(cse!.status).toBe("promised");
  expect(cse!.next_action_type).toBe("promise");
  expect(cse!.next_action_at).toBe("2026-07-14");
});

test("5: create_promise failure leaves the prior pending untouched", async () => {
  const { orgId, member, customerId, caseId, svc } = await seedOrg({
    ownerEmail: "promises-rls-fail-o@example.com",
    memberEmail: "promises-rls-fail-m@example.com",
  });
  const priorId = await insertPending(svc, orgId, caseId, customerId);

  // Forced check-violation after the case lock / supersede UPDATE.
  const { error } = await member!.client.rpc("create_promise", {
    p_org_id: orgId,
    p_case_id: caseId,
    p_customer_id: customerId,
    p_contact_log_id: null,
    p_promised_amount: 0,
    p_promised_date: "2026-07-10",
  });
  expect(error).not.toBeNull();

  const { data: prior } = await svc.from("promises")
    .select("status, replacement_promise_id").eq("id", priorId).single();
  expect(prior!.status).toBe("pending");
  expect(prior!.replacement_promise_id).toBeNull();
  const { data: pending } = await svc.from("promises")
    .select("id").eq("org_id", orgId).eq("status", "pending");
  expect(pending).toHaveLength(1);
});

test("6: member cannot INSERT promise_invoices", async () => {
  const { svc, orgId, member, customerId, caseId, invoiceId } = await seedOrg({
    ownerEmail: "promises-rls-links-o@example.com",
    memberEmail: "promises-rls-links-m@example.com",
  });
  const promiseId = await insertPending(svc, orgId, caseId, customerId);

  const { error } = await member!.client.from("promise_invoices").insert({
    promise_id: promiseId, invoice_id: invoiceId, org_id: orgId, baseline_balance: 1200,
  });
  expect(error).not.toBeNull();

  const { data: links } = await svc.from("promise_invoices")
    .select("promise_id").eq("promise_id", promiseId);
  expect(links ?? []).toHaveLength(0);
});

test("7: member cannot UPDATE replacement_promise_id on a renegotiated row", async () => {
  const { svc, orgId, member, customerId, caseId } = await seedOrg({
    ownerEmail: "promises-rls-repl-o@example.com",
    memberEmail: "promises-rls-repl-m@example.com",
  });
  const { data: replacement } = await svc.from("promises").insert({
    org_id: orgId, case_id: caseId, customer_id: customerId, status: "pending",
    promised_amount: 800, promised_date: "2026-07-10", grace_until: "2026-07-14",
    baseline_balance: 1200,
  }).select("id").single();
  const { data: prior } = await svc.from("promises").insert({
    org_id: orgId, case_id: caseId, customer_id: customerId, status: "renegotiated",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03",
    baseline_balance: 1200, replacement_promise_id: replacement!.id,
    resolved_at: new Date().toISOString(),
  }).select("id").single();

  await member!.client.from("promises")
    .update({ replacement_promise_id: null })
    .eq("org_id", orgId)
    .eq("id", prior!.id);

  const { data: locked } = await svc.from("promises")
    .select("replacement_promise_id").eq("id", prior!.id).single();
  expect(locked!.replacement_promise_id).toBe(replacement!.id);
});

test("8: member cannot INSERT promises", async () => {
  const { svc, orgId, member, customerId, caseId } = await seedOrg({
    ownerEmail: "promises-rls-ins-o@example.com",
    memberEmail: "promises-rls-ins-m@example.com",
  });

  const { error } = await member!.client.from("promises").insert({
    org_id: orgId, case_id: caseId, customer_id: customerId, status: "pending",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03",
    baseline_balance: 1200,
  });
  expect(error).not.toBeNull();

  const { data: rows } = await svc.from("promises").select("id").eq("org_id", orgId);
  expect(rows ?? []).toHaveLength(0);
});

test("9: owner cannot PATCH pending → kept", async () => {
  const { svc, orgId, owner, customerId, caseId } = await seedOrg({
    ownerEmail: "promises-rls-okpt-o@example.com",
  });
  const promiseId = await insertPending(svc, orgId, caseId, customerId);

  const { error } = await owner.client.from("promises")
    .update({ status: "kept" })
    .eq("org_id", orgId)
    .eq("id", promiseId);
  expect(error).not.toBeNull();

  const { data: row } = await svc.from("promises").select("status").eq("id", promiseId).single();
  expect(row!.status).toBe("pending");
});

test("10: cancel UPDATE cannot rewrite created_by or promised_amount", async () => {
  const { svc, orgId, member, owner, customerId, caseId } = await seedOrg({
    ownerEmail: "promises-rls-trig-o@example.com",
    memberEmail: "promises-rls-trig-m@example.com",
  });
  const promiseId = await insertPending(svc, orgId, caseId, customerId);

  const { error: moneyErr } = await member!.client.from("promises")
    .update({ status: "cancelled", promised_amount: 1, resolved_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", promiseId);
  expect(moneyErr).not.toBeNull();

  const { error: identErr } = await member!.client.from("promises")
    .update({ status: "cancelled", created_by: owner.userId, resolved_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", promiseId);
  expect(identErr).not.toBeNull();

  const { data: row } = await svc.from("promises")
    .select("status, promised_amount, created_by").eq("id", promiseId).single();
  expect(row!.status).toBe("pending");
  expect(Number(row!.promised_amount)).toBe(500);
  expect(row!.created_by).toBeNull();
});

test("11: cross-org SELECT of promises is empty", async () => {
  const a = await seedOrg({ ownerEmail: "promises-rls-xorg-a@example.com" });
  const b = await makeUserClient("promises-rls-xorg-b@example.com");
  const { data: orgB } = await a.svc.from("organizations")
    .insert({ name: `PRLS B ${b.userId}` }).select("id").single();
  await a.svc.from("memberships").insert({ org_id: orgB!.id, user_id: b.userId, role: "owner" });
  await insertPending(a.svc, a.orgId, a.caseId, a.customerId);

  const { data: seen, error } = await b.client.from("promises").select("id").eq("org_id", a.orgId);
  expect(error).toBeNull();
  expect(seen ?? []).toHaveLength(0);
});
