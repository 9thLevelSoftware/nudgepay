import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { listOrgMembers } from "../app/lib/orgs.server";

test("listOrgMembers returns the org roster with email-local-part labels", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Roster Org" }).select("id").single();
  const orgId = org!.id;
  const a = await makeUserClient("roster-alice@example.com");
  const b = await makeUserClient("roster-bob@example.com");
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: a.userId, role: "owner" },
    { org_id: orgId, user_id: b.userId, role: "member" },
  ]);

  const members = await listOrgMembers(svc, orgId);
  const byId = new Map(members.map((m) => [m.userId, m]));
  expect(members.length).toBe(2);
  expect(byId.get(a.userId)!.label).toBe("roster-alice");
  expect(byId.get(a.userId)!.email).toBe("roster-alice@example.com");
  expect(byId.get(b.userId)!.label).toBe("roster-bob");
  // sorted by label ascending
  expect(members.map((m) => m.label)).toEqual([...members.map((m) => m.label)].sort());
});

test("listOrgMembers returns empty for an org with no members", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Empty Roster Org" }).select("id").single();
  expect(await listOrgMembers(svc, org!.id)).toEqual([]);
});
