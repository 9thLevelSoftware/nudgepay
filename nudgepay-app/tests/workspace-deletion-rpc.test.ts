import { expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";

test("delete_workspace purges the org, writes a tombstone, and is not callable by JWT", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient(`ws-del-own-${Math.random()}@example.com`);
  const member = await makeUserClient(`ws-del-mem-${Math.random()}@example.com`);
  const { data: org, error: orgErr } = await svc.from("organizations")
    .insert({ name: "Delete Me Co" }).select("id").single();
  expect(orgErr).toBeNull();
  const orgId = org!.id as string;
  const { error: memErr } = await svc.from("memberships").insert([
    { org_id: orgId, user_id: owner.userId, role: "owner" },
    { org_id: orgId, user_id: member.userId, role: "member" },
  ]);
  expect(memErr).toBeNull();
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, name: "Cust", qbo_id: `c-${Math.random()}` })
    .select("id").single();
  await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "working",
  });

  const jwt = await member.client.rpc("delete_workspace", {
    p_org_id: orgId,
    p_deleted_by: member.userId,
    p_org_name: "Delete Me Co",
    p_member_count: 2,
  });
  expect(jwt.error).not.toBeNull();

  const { error: rpcErr } = await svc.rpc("delete_workspace", {
    p_org_id: orgId,
    p_deleted_by: owner.userId,
    p_org_name: "Delete Me Co",
    p_member_count: 2,
  });
  expect(rpcErr).toBeNull();

  const { data: gone } = await svc.from("organizations").select("id").eq("id", orgId);
  expect(gone ?? []).toHaveLength(0);
  const { data: cases } = await svc.from("collection_cases").select("id").eq("org_id", orgId);
  expect(cases ?? []).toHaveLength(0);
  const { data: tomb } = await svc.from("workspace_deletions")
    .select("org_id, org_name, member_count, deleted_by").eq("org_id", orgId).maybeSingle();
  expect(tomb).toMatchObject({
    org_id: orgId,
    org_name: "Delete Me Co",
    member_count: 2,
    deleted_by: owner.userId,
  });
});
