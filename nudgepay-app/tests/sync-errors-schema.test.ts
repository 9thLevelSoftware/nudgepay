import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

test("service inserts a sync_error and a member reads it via RLS; outsider cannot", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "SyncErr Org A" }).select("id").single();
  const orgId = org!.id;
  const member = await makeUserClient("syncerr-a@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: member.userId, role: "owner" });

  const { error: insErr } = await svc.from("sync_errors")
    .insert({ org_id: orgId, source: "cron", scope: "cdc", message: "boom" });
  expect(insErr).toBeNull();

  // member reads own-org error
  const { data: mine } = await member.client.from("sync_errors")
    .select("id, source, scope, message, resolved_at").eq("org_id", orgId);
  expect(mine!.length).toBe(1);
  expect(mine![0].source).toBe("cron");
  expect(mine![0].resolved_at).toBe(null);

  // outsider sees nothing
  const outsider = await makeUserClient("syncerr-outsider@example.com");
  const { data: theirs } = await outsider.client.from("sync_errors").select("id").eq("org_id", orgId);
  expect(theirs ?? []).toEqual([]);
});

test("the source check constraint rejects an invalid source", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "SyncErr Org B" }).select("id").single();
  const { error } = await svc.from("sync_errors")
    .insert({ org_id: org!.id, source: "bogus", scope: "x", message: "y" });
  expect(error).not.toBeNull(); // check constraint violation
  expect(error!.code).toBe("23514");
});
