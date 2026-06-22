import { beforeAll, expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";

let orgA: string, orgB: string, userA: Awaited<ReturnType<typeof makeUserClient>>, userB: Awaited<ReturnType<typeof makeUserClient>>;

beforeAll(async () => {
  const svc = serviceClient();
  userA = await makeUserClient("a@example.com");
  userB = await makeUserClient("b@example.com");

  const { data: a } = await svc.from("organizations").insert({ name: "Org A" }).select().single();
  const { data: b } = await svc.from("organizations").insert({ name: "Org B" }).select().single();
  orgA = a!.id; orgB = b!.id;
  await svc.from("memberships").insert({ org_id: orgA, user_id: userA.userId, role: "owner" });
  await svc.from("memberships").insert({ org_id: orgB, user_id: userB.userId, role: "owner" });
  await svc.from("customers").insert({ org_id: orgA, name: "A-Customer" });
  await svc.from("customers").insert({ org_id: orgB, name: "B-Customer" });
});

test("user A sees only org A customers", async () => {
  const { data } = await userA.client.from("customers").select("name");
  expect(data?.map((r) => r.name)).toEqual(["A-Customer"]);
});

test("user A cannot read org B customers even when filtering by org B id", async () => {
  const { data } = await userA.client.from("customers").select("*").eq("org_id", orgB);
  expect(data).toEqual([]);
});

test("user A cannot insert a row into org B", async () => {
  const { error } = await userA.client.from("customers").insert({ org_id: orgB, name: "Sneaky" });
  expect(error).not.toBeNull();
});
