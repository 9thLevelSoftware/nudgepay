import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { recordHeartbeat } from "../app/lib/presence.server";

test("a member's heartbeat upserts their own presence row (route happy path)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "HB Route OK" }).select("id").single();
  const u = await makeUserClient("hb-route-ok@example.com");
  await svc.from("memberships").insert({ org_id: org!.id, user_id: u.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org!.id, qbo_id: "hbr-1", name: "HBR Co" }).select("id").single();

  // The route resolves org from membership then calls recordHeartbeat with user.id.
  const { data: resolved } = await u.client.from("memberships")
    .select("org_id").eq("user_id", u.userId).order("created_at", { ascending: true }).limit(1).maybeSingle();
  expect(resolved!.org_id).toBe(org!.id);

  await recordHeartbeat(u.client, { orgId: resolved!.org_id, customerId: cust!.id, userId: u.userId });
  const { data: rows } = await svc.from("case_presence")
    .select("user_id").eq("org_id", org!.id).eq("customer_id", cust!.id);
  expect(rows!.map((r) => r.user_id)).toEqual([u.userId]);
});

test("a non-member cannot write presence for a foreign org's customer (route membership guard / RLS)", async () => {
  const svc = serviceClient();
  const { data: orgA } = await svc.from("organizations").insert({ name: "HB Route A" }).select("id").single();
  const { data: orgB } = await svc.from("organizations").insert({ name: "HB Route B" }).select("id").single();
  const a = await makeUserClient("hb-route-a@example.com");
  await svc.from("memberships").insert({ org_id: orgA!.id, user_id: a.userId, role: "owner" });
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgB!.id, qbo_id: "hbr-b1", name: "B Co" }).select("id").single();

  // Even if a forged body named org B, the user client's RLS rejects the write.
  await expect(
    recordHeartbeat(a.client, { orgId: orgB!.id, customerId: custB!.id, userId: a.userId }),
  ).rejects.toBeTruthy();
});
