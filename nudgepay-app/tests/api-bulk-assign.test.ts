import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { clampBatch, MAX_BATCH } from "../app/lib/bulk";

test("bulk owner update sets every selected customer in one org-scoped query", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Bulk Assign A" }).select("id").single();
  const orgId = org!.id as string;
  const a = await makeUserClient("bulk-assign-a@example.com");
  const b = await makeUserClient("bulk-assign-b@example.com");
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: a.userId, role: "owner" },
    { org_id: orgId, user_id: b.userId, role: "member" },
  ]);
  const mk = async (name: string) => {
    const { data: cust } = await svc.from("customers").insert({ org_id: orgId, qbo_id: `ba-${name}`, name }).select("id").single();
    const { data: cse } = await svc.from("collection_cases").insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();
    return { customerId: cust!.id as string, caseId: cse!.id as string };
  };
  const c1 = await mk("One");
  const c2 = await mk("Two");

  // Route: membership guard for the target owner.
  const { data: member } = await a.client.from("memberships").select("user_id").eq("org_id", orgId).eq("user_id", b.userId).maybeSingle();
  expect(member?.user_id).toBe(b.userId);

  // Route: map case ids -> customer ids (org-scoped).
  const caseIds = clampBatch([c1.caseId, c2.caseId]);
  const { data: caseRows } = await a.client.from("collection_cases").select("customer_id").eq("org_id", orgId).in("id", caseIds);
  const customerIds = [...new Set((caseRows ?? []).map((r) => r.customer_id))];
  expect(customerIds.sort()).toEqual([c1.customerId, c2.customerId].sort());

  // Route: one bulk update.
  const { error } = await a.client.from("customers").update({ owner: b.userId }).eq("org_id", orgId).in("id", customerIds);
  expect(error).toBeNull();
  const { data: after } = await svc.from("customers").select("id, owner").in("id", customerIds);
  expect(after!.every((r) => r.owner === b.userId)).toBe(true);
});

test("a foreign-org case id is dropped by the org-scoped case read", async () => {
  const svc = serviceClient();
  const { data: orgA } = await svc.from("organizations").insert({ name: "Bulk Assign Scope A" }).select("id").single();
  const a = await makeUserClient("bulk-assign-scope-a@example.com");
  await svc.from("memberships").insert({ org_id: orgA!.id, user_id: a.userId, role: "owner" });
  // Org B: caller is also a member (RLS alone would permit reads).
  const { data: orgB } = await svc.from("organizations").insert({ name: "Bulk Assign Scope B" }).select("id").single();
  await svc.from("memberships").insert({ org_id: orgB!.id, user_id: a.userId, role: "member" });
  const { data: custB } = await svc.from("customers").insert({ org_id: orgB!.id, qbo_id: "bscope-b1", name: "Org B Co" }).select("id").single();
  const { data: caseB } = await svc.from("collection_cases").insert({ org_id: orgB!.id, customer_id: custB!.id, status: "working" }).select("id").single();

  // Route resolved org = A; binds the case read to A -> B's case id returns nothing.
  const { data: caseRows } = await a.client.from("collection_cases").select("customer_id").eq("org_id", orgA!.id).in("id", [caseB!.id]);
  expect(caseRows).toEqual([]);
});

test("clampBatch caps a bulk-assign id list at MAX_BATCH", () => {
  const ids = Array.from({ length: MAX_BATCH + 10 }, (_, i) => `case-${i}`);
  expect(clampBatch(ids)).toHaveLength(MAX_BATCH);
});

test("clampBatch caps a bulk-assign id list at an org-configured limit", () => {
  const ids = Array.from({ length: MAX_BATCH + 10 }, (_, i) => `case-${i}`);
  // The route reads orgConfig.workflow.smsBatchLimit and passes it here —
  // same clamp helper as api.bulk-sms.tsx, so both bulk routes agree.
  expect(clampBatch(ids, 10)).toHaveLength(10);
});
