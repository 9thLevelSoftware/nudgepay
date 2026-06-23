import { expect, test, beforeAll } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { applyCaseReconciliation } from "../app/lib/case-lifecycle.server";

test("collection_cases enforces one open case per customer", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Cases Org A" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "cs-c1", name: "Riverside" }).select("id").single();

  const first = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "new", next_action_type: "contact" });
  expect(first.error).toBeNull();

  // Second OPEN case for the same customer must violate the partial unique index.
  const second = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "new" });
  expect(second.error).not.toBeNull();

  // But a resolved (closed) case may coexist with a new open one.
  await svc.from("collection_cases")
    .update({ status: "resolved", closed_at: new Date().toISOString() })
    .eq("org_id", orgId).eq("customer_id", cust!.id);
  const third = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "new" });
  expect(third.error).toBeNull();
});

test("RLS: a member reads only their own org's cases", async () => {
  const svc = serviceClient();
  const a = await makeUserClient("cases-rls-a@example.com");
  const { data: orgA } = await svc.from("organizations").insert({ name: "RLS Org A" }).select("id").single();
  await svc.from("memberships").insert({ org_id: orgA!.id, user_id: a.userId, role: "owner" });
  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgA!.id, qbo_id: "rls-c1", name: "A Cust" }).select("id").single();
  await svc.from("collection_cases").insert({ org_id: orgA!.id, customer_id: custA!.id, status: "new" });

  // A foreign org + case the member is NOT in.
  const { data: orgB } = await svc.from("organizations").insert({ name: "RLS Org B" }).select("id").single();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgB!.id, qbo_id: "rls-c2", name: "B Cust" }).select("id").single();
  await svc.from("collection_cases").insert({ org_id: orgB!.id, customer_id: custB!.id, status: "new" });

  const { data: visible, error } = await a.client.from("collection_cases").select("id, org_id");
  expect(error).toBeNull();
  expect(visible!.every((r) => r.org_id === orgA!.id)).toBe(true);
  expect(visible!.length).toBe(1);
});

test("applyCaseReconciliation opens, then resolves, a case as balances change", async () => {
  const svc = serviceClient();
  const today = "2026-06-22";
  const { data: org } = await svc.from("organizations").insert({ name: "Lifecycle Org" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "lc-c1", name: "Lifecycle Co" }).select("id").single();
  const { data: inv } = await svc.from("invoices").insert({
    org_id: orgId, qbo_id: "lc-i1", qbo_doc_number: "7001", customer_id: cust!.id,
    amount: 900, balance: 900, due_date: "2026-03-01", status: "overdue",
  }).select("id").single();

  const opened = await applyCaseReconciliation(svc, orgId, today);
  expect(opened.opened).toBe(1);
  const { data: openCases } = await svc.from("collection_cases")
    .select("id, status").eq("org_id", orgId).is("closed_at", null);
  expect(openCases!.length).toBe(1);
  expect(openCases![0].status).toBe("new");

  // Re-run with no change → idempotent (no duplicate open case).
  const noop = await applyCaseReconciliation(svc, orgId, today);
  expect(noop.opened).toBe(0);

  // Pay the invoice → case resolves.
  await svc.from("invoices").update({ balance: 0, status: "paid" }).eq("id", inv!.id);
  const resolved = await applyCaseReconciliation(svc, orgId, today);
  expect(resolved.resolved).toBe(1);
  const { data: stillOpen } = await svc.from("collection_cases")
    .select("id").eq("org_id", orgId).is("closed_at", null);
  expect(stillOpen!.length).toBe(0);
});
