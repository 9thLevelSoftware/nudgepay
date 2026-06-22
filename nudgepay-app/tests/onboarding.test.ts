import { expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";
import { createOrgForUser, acceptInvite } from "../app/lib/orgs.server";

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

test("acceptInvite adds the invited user to the org", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient("owner2@example.com");
  const orgId = await createOrgForUser(svc, owner.userId, "Invite Org");
  const { data: inv } = await svc.from("invites")
    .insert({ org_id: orgId, email: "invitee@example.com" }).select("token").single();

  const invitee = await makeUserClient("invitee@example.com");
  await acceptInvite(svc, inv!.token, invitee.userId);

  const { data: mem } = await svc.from("memberships")
    .select("role").eq("org_id", orgId).eq("user_id", invitee.userId).single();
  expect(mem?.role).toBe("member");
});
