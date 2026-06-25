import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

// Mirrors the RLS + guard paths /api/sync-errors/dismiss relies on.
test("a member dismisses an own-org sync error via RLS", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Dismiss Org A" }).select("id").single();
  const orgId = org!.id;
  const a = await makeUserClient("dismiss-a@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: a.userId, role: "owner" });
  const { data: se } = await svc.from("sync_errors")
    .insert({ org_id: orgId, source: "cron", scope: "cdc", message: "boom" }).select("id").single();

  const { error } = await a.client.from("sync_errors")
    .update({ resolved_at: new Date().toISOString(), resolved_by: a.userId })
    .eq("org_id", orgId).eq("id", se!.id);
  expect(error).toBeNull();

  const { data: after } = await svc.from("sync_errors")
    .select("resolved_at, resolved_by").eq("id", se!.id).single();
  expect(after!.resolved_at).not.toBe(null);
  expect(after!.resolved_by).toBe(a.userId);
});

test("a member of another org cannot dismiss the error (RLS blocks)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Dismiss Org B" }).select("id").single();
  const orgId = org!.id;
  const { data: se } = await svc.from("sync_errors")
    .insert({ org_id: orgId, source: "cron", scope: "cdc", message: "private" }).select("id").single();

  const outsider = await makeUserClient("dismiss-outsider@example.com"); // no membership in Org B
  await outsider.client.from("sync_errors")
    .update({ resolved_at: new Date().toISOString(), resolved_by: outsider.userId }).eq("id", se!.id);
  const { data: after } = await svc.from("sync_errors").select("resolved_at").eq("id", se!.id).single();
  expect(after!.resolved_at).toBe(null); // unchanged — RLS blocked it
});
