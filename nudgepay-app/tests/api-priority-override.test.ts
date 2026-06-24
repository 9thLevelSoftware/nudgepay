import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

// Mirrors the RLS + guard paths the /api/priority-override action relies on.
test("a member sets and clears a priority override on an own-org case via RLS", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Override Org A" }).select("id").single();
  const orgId = org!.id;
  const a = await makeUserClient("override-a@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: a.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "ov-c1", name: "Override Co" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();

  // set
  await a.client.from("collection_cases").update({
    priority_override: "critical", priority_override_reason: "CEO escalation",
    priority_override_by: a.userId, priority_override_at: new Date().toISOString(),
  }).eq("id", cse!.id);
  let { data: after } = await svc.from("collection_cases")
    .select("priority_override, priority_override_reason, priority_override_by").eq("id", cse!.id).single();
  expect(after!.priority_override).toBe("critical");
  expect(after!.priority_override_reason).toBe("CEO escalation");
  expect(after!.priority_override_by).toBe(a.userId);

  // clear
  await a.client.from("collection_cases").update({
    priority_override: null, priority_override_reason: null, priority_override_by: null, priority_override_at: null,
  }).eq("id", cse!.id);
  ({ data: after } = await svc.from("collection_cases")
    .select("priority_override, priority_override_reason, priority_override_by").eq("id", cse!.id).single());
  expect(after!.priority_override).toBe(null);
});

test("a member of another org cannot override the case (RLS blocks)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Override Org B" }).select("id").single();
  const orgId = org!.id;
  const owner = await makeUserClient("override-owner@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "ovb-c1", name: "Private Co" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();

  const outsider = await makeUserClient("override-outsider@example.com"); // no membership in Org B
  await outsider.client.from("collection_cases").update({ priority_override: "low" }).eq("id", cse!.id);
  const { data: after } = await svc.from("collection_cases").select("priority_override").eq("id", cse!.id).single();
  expect(after!.priority_override).toBe(null); // unchanged — RLS blocked it
});

test("the check constraint rejects an invalid level", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Override Org C" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "ovc-c1", name: "C Co" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();

  const { error } = await svc.from("collection_cases").update({ priority_override: "urgent" }).eq("id", cse!.id);
  expect(error).not.toBeNull(); // check constraint violation
});
