import { expect, test, beforeAll } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";
import { resolveOrg } from "../app/lib/session.server";

let user: Awaited<ReturnType<typeof makeUserClient>>;
let orgId: string;

beforeAll(async () => {
  const svc = serviceClient();
  user = await makeUserClient("session-user@example.com");
  const { data: org } = await svc.from("organizations").insert({ name: "Session Org" }).select().single();
  orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });
});

test("resolveOrg returns the user's membership org and role", async () => {
  const result = await resolveOrg(user.client, user.userId);
  expect(result).toEqual({ org_id: orgId, role: "owner" });
});

test("resolveOrg returns null for a user with no membership", async () => {
  const orphan = await makeUserClient("orphan@example.com");
  const result = await resolveOrg(orphan.client, orphan.userId);
  expect(result).toBeNull();
});
