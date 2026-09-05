import { beforeAll, expect, test } from "vitest";
import { makeUserClient, runLocalTestSql, serviceClient } from "./helpers";
import { createOrgForUser, acceptInvite, listUserWorkspaces } from "../app/lib/orgs.server";

beforeAll(() => {
  runLocalTestSql("truncate table public.pilot_workspace_admissions;\n");
});

test("createOrgForUser creates an org and an owner membership", async () => {
  const svc = serviceClient();
  const user = await makeUserClient("onboard@example.com");
  const orgId = await createOrgForUser(svc, user.userId, "Acme AR");

  const { data: org } = await svc.from("organizations").select("name").eq("id", orgId).single();
  expect(org?.name).toBe("Acme AR");

  const { data: mem } = await svc.from("memberships")
    .select("role").eq("org_id", orgId).eq("user_id", user.userId).single();
  expect(mem?.role).toBe("owner");
});

test("acceptInvite adds a user who already owns another workspace", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient("owner-multi@example.com");
  const orgId = await createOrgForUser(svc, owner.userId, "Invite Multi Org");
  const { data: inv } = await svc.from("invites")
    .insert({ org_id: orgId, email: "already-owner@example.com" }).select("token").single();

  const invitee = await makeUserClient("already-owner@example.com");
  const first = await createOrgForUser(svc, invitee.userId, "Invitee First Org");
  const joined = await acceptInvite(svc, inv!.token, invitee.userId, "already-owner@example.com");
  expect(joined).toBe(orgId);
  const { data: mems } = await svc.from("memberships").select("org_id").eq("user_id", invitee.userId);
  expect((mems ?? []).map((m) => m.org_id).sort()).toEqual([first, orgId].sort());
});

test("acceptInvite adds the invited user to the org", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient("owner2@example.com");
  const orgId = await createOrgForUser(svc, owner.userId, "Invite Org");
  const { data: inv } = await svc.from("invites")
    .insert({ org_id: orgId, email: "invitee@example.com" }).select("token").single();

  const invitee = await makeUserClient("invitee@example.com");
  await acceptInvite(svc, inv!.token, invitee.userId, "invitee@example.com");

  const { data: mem } = await svc.from("memberships")
    .select("role").eq("org_id", orgId).eq("user_id", invitee.userId).single();
  expect(mem?.role).toBe("member");
});

test("acceptInvite rejects when the user's email differs from the invite", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient("owner3@example.com");
  const orgId = await createOrgForUser(svc, owner.userId, "Mismatch Org");
  const { data: inv } = await svc.from("invites")
    .insert({ org_id: orgId, email: "someone@example.com" }).select("token").single();

  const wrongUser = await makeUserClient("different@example.com");
  await expect(
    acceptInvite(svc, inv!.token, wrongUser.userId, "different@example.com")
  ).rejects.toThrow();

  const { data: mem } = await svc.from("memberships")
    .select("role").eq("org_id", orgId).eq("user_id", wrongUser.userId).maybeSingle();
  expect(mem).toBeNull();
});

test("createOrgForUser allows a second org for the same user", async () => {
  const svc = serviceClient();
  const user = await makeUserClient("onboard-second@example.com");
  const firstId = await createOrgForUser(svc, user.userId, "First Workspace");
  const secondName = `Second Workspace ${user.userId}`;
  const secondId = await createOrgForUser(svc, user.userId, secondName);

  expect(secondId).not.toBe(firstId);
  const { data: mems } = await svc.from("memberships").select("org_id").eq("user_id", user.userId);
  expect((mems ?? []).map((m) => m.org_id).sort()).toEqual([firstId, secondId].sort());
  const listed = await listUserWorkspaces(svc, user.userId);
  expect(listed.map((w) => w.orgId).sort()).toEqual([firstId, secondId].sort());
});

test("acceptInvite rejects when either email is empty (no empty-string bypass)", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient("owner4@example.com");
  const orgId = await createOrgForUser(svc, owner.userId, "Empty Email Org");
  // An invite row with an empty email (NOT NULL still permits "") paired with a
  // user passing "" would slip past `"" !== ""` (false) without an explicit guard.
  const { data: inv } = await svc.from("invites")
    .insert({ org_id: orgId, email: "" }).select("token").single();

  const noEmailUser = await makeUserClient("hasemail@example.com");
  await expect(
    acceptInvite(svc, inv!.token, noEmailUser.userId, "")
  ).rejects.toThrow();

  const { data: mem } = await svc.from("memberships")
    .select("role").eq("org_id", orgId).eq("user_id", noEmailUser.userId).maybeSingle();
  expect(mem).toBeNull();
});
