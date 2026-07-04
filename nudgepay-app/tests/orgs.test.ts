import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { acceptInvite, listOrgMembers } from "../app/lib/orgs.server";

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

test("acceptInvite rejects expired invite tokens", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Expired Invite Org" }).select("id").single();
  const invited = await makeUserClient("expired-invitee@example.com");
  const { data: inv } = await svc.from("invites").insert({
    org_id: org!.id,
    email: "expired-invitee@example.com",
    expires_at: "2000-01-01T00:00:00Z",
  }).select("token").single();

  await expect(
    acceptInvite(svc, inv!.token as string, invited.userId, "expired-invitee@example.com"),
  ).rejects.toThrow(/expired/i);

  const { data: memberships } = await svc.from("memberships")
    .select("id")
    .eq("org_id", org!.id)
    .eq("user_id", invited.userId);
  expect(memberships ?? []).toHaveLength(0);
});
