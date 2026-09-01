import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { acceptInvite, createOrgForUser, listOrgMembers } from "../app/lib/orgs.server";

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
  expect(byId.get(a.userId)!.role).toBe("owner");
  expect(byId.get(b.userId)!.label).toBe("roster-bob");
  expect(byId.get(b.userId)!.role).toBe("member");
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

test("acceptInvite of the same org is success when the user is already a member", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient("invite-same-owner@example.com");
  const orgId = await createOrgForUser(svc, owner.userId, "Same Org Invite");
  const invitee = await makeUserClient("invite-same-member@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: invitee.userId, role: "member" });
  const { data: inv } = await svc.from("invites")
    .insert({ org_id: orgId, email: "invite-same-member@example.com" }).select("id, token").single();

  await expect(acceptInvite(svc, inv!.token as string, invitee.userId, "invite-same-member@example.com"))
    .resolves.toBe(orgId);

  const { data: mems } = await svc.from("memberships").select("org_id").eq("user_id", invitee.userId);
  expect(mems).toHaveLength(1);
  const { data: stamped } = await svc.from("invites").select("accepted_at").eq("id", inv!.id).single();
  expect(stamped?.accepted_at).toBeTruthy();
});

test("acceptInvite adds a second workspace", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient("invite-other-owner@example.com");
  const orgA = await createOrgForUser(svc, owner.userId, "Invite Other A");
  const invitee = await makeUserClient("invite-other-member@example.com");
  const ownOrg = await createOrgForUser(svc, invitee.userId, "Invitee Own Workspace");
  const { data: inv } = await svc.from("invites")
    .insert({ org_id: orgA, email: "invite-other-member@example.com" }).select("token").single();

  await expect(
    acceptInvite(svc, inv!.token as string, invitee.userId, "invite-other-member@example.com"),
  ).resolves.toBe(orgA);

  const { data: mems } = await svc.from("memberships")
    .select("org_id").eq("user_id", invitee.userId);
  expect((mems ?? []).map((m) => m.org_id).sort()).toEqual([ownOrg, orgA].sort());
});

test("memberships unique on (org_id, user_id) rejects a duplicate membership", async () => {
  const svc = serviceClient();
  const user = await makeUserClient("one-membership@example.com");
  const { data: orgA } = await svc.from("organizations").insert({ name: "Unique Mem A" }).select("id").single();
  const { error: firstErr } = await svc.from("memberships")
    .insert({ org_id: orgA!.id, user_id: user.userId, role: "owner" });
  expect(firstErr).toBeNull();
  const { data: orgB } = await svc.from("organizations").insert({ name: "Unique Mem B" }).select("id").single();
  const { error: secondOrgErr } = await svc.from("memberships")
    .insert({ org_id: orgB!.id, user_id: user.userId, role: "member" });
  expect(secondOrgErr).toBeNull();
  const { error } = await svc.from("memberships")
    .insert({ org_id: orgA!.id, user_id: user.userId, role: "member" });
  expect(error).not.toBeNull();
  expect(error!.code).toBe("23505");
});
