import { expect, test, beforeAll } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

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
