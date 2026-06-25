import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

// Mirrors the RLS + guard paths the /api/assign action relies on.
test("a member assigns and unassigns an own-org customer via RLS", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Assign Org A" }).select("id").single();
  const orgId = org!.id;
  const a = await makeUserClient("assign-a@example.com");
  const b = await makeUserClient("assign-b@example.com");
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: a.userId, role: "owner" },
    { org_id: orgId, user_id: b.userId, role: "member" },
  ]);
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "as-c1", name: "Assignable Co" }).select("id").single();

  // membership guard query (the route runs this before assigning)
  const { data: isMember } = await a.client.from("memberships")
    .select("user_id").eq("org_id", orgId).eq("user_id", b.userId).maybeSingle();
  expect(isMember?.user_id).toBe(b.userId);

  await a.client.from("customers").update({ owner: b.userId }).eq("id", cust!.id);
  let { data: after } = await svc.from("customers").select("owner").eq("id", cust!.id).single();
  expect(after!.owner).toBe(b.userId);

  await a.client.from("customers").update({ owner: null }).eq("id", cust!.id);
  ({ data: after } = await svc.from("customers").select("owner").eq("id", cust!.id).single());
  expect(after!.owner).toBe(null);
});

test("a member of another org cannot reassign the customer (RLS blocks)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Assign Org B" }).select("id").single();
  const orgId = org!.id;
  const owner = await makeUserClient("assign-owner@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "asb-c1", name: "Private Co", owner: owner.userId }).select("id").single();

  const outsider = await makeUserClient("assign-outsider@example.com"); // no membership in Org B
  await outsider.client.from("customers").update({ owner: outsider.userId }).eq("id", cust!.id);
  const { data: after } = await svc.from("customers").select("owner").eq("id", cust!.id).single();
  expect(after!.owner).toBe(owner.userId); // unchanged — RLS blocked it
});

test("the membership guard rejects a non-member target", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Assign Org C" }).select("id").single();
  const orgId = org!.id;
  const a = await makeUserClient("assign-c-a@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: a.userId, role: "owner" });
  const stranger = await makeUserClient("assign-c-stranger@example.com"); // not a member of Org C

  const { data: isMember } = await a.client.from("memberships")
    .select("user_id").eq("org_id", orgId).eq("user_id", stranger.userId).maybeSingle();
  expect(isMember).toBeNull(); // route would reject and not assign
});

test("the owner update is org-scoped: a customer in another org is not reassigned", async () => {
  const svc = serviceClient();
  // Org A: caller's resolved org, with member to assign.
  const { data: orgA } = await svc.from("organizations").insert({ name: "Assign Scope A" }).select("id").single();
  const a = await makeUserClient("assign-scope-a@example.com");
  await svc.from("memberships").insert({ org_id: orgA!.id, user_id: a.userId, role: "owner" });
  // Org B: the caller is ALSO a member (so RLS alone would permit the write).
  const { data: orgB } = await svc.from("organizations").insert({ name: "Assign Scope B" }).select("id").single();
  await svc.from("memberships").insert({ org_id: orgB!.id, user_id: a.userId, role: "member" });
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgB!.id, qbo_id: "scope-b1", name: "Org B Co" }).select("id").single();

  // The route binds the update to the RESOLVED org (A). A customer in org B must
  // not be updated even though RLS would allow it.
  const { error } = await a.client.from("customers")
    .update({ owner: a.userId }).eq("org_id", orgA!.id).eq("id", custB!.id);
  expect(error).toBeNull(); // update matched 0 rows, not an error
  const { data: after } = await svc.from("customers").select("owner").eq("id", custB!.id).single();
  expect(after!.owner).toBe(null); // unchanged — org scope prevented the cross-org write
});
