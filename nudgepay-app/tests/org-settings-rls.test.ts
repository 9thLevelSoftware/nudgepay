import { expect, test } from "vitest";
import { serviceClient } from "./helpers";

test("updating org_settings bumps updated_at via the trigger", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `OS-trig ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  // Insert with a deliberately old updated_at so the post-update value must differ.
  await svc.from("org_settings").insert({
    org_id: orgId, promise_grace_days: 2, updated_at: "2000-01-01T00:00:00Z",
  });
  await svc.from("org_settings").update({ promise_grace_days: 5 }).eq("org_id", orgId);
  const { data: row } = await svc.from("org_settings").select("promise_grace_days, updated_at").eq("org_id", orgId).single();
  expect(row!.promise_grace_days).toBe(5);
  expect(new Date(row!.updated_at as string).getTime()).toBeGreaterThan(new Date("2020-01-01T00:00:00Z").getTime());
});
