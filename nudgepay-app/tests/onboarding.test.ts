import { expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";
import { createOrgForUser } from "../app/lib/orgs.server";

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
