import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

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

test("an owner writes org_settings + org_holidays via RLS; a member cannot", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `OS-rls ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const owner = await makeUserClient(`os-owner-${Math.random()}@example.com`);
  const member = await makeUserClient(`os-member-${Math.random()}@example.com`);
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: owner.userId, role: "owner" },
    { org_id: orgId, user_id: member.userId, role: "member" },
  ]);

  // Owner upsert succeeds.
  const { error: ownErr } = await owner.client.from("org_settings")
    .upsert({ org_id: orgId, promise_grace_days: 4, working_days: [1, 2, 3, 4, 5],
      cadence_critical: 1, cadence_high: 2, cadence_medium: 5, cadence_low: 10 }, { onConflict: "org_id" });
  expect(ownErr).toBeNull();
  await owner.client.from("org_holidays").upsert({ org_id: orgId, holiday_date: "2026-07-04" }, { onConflict: "org_id,holiday_date" });

  // Member can READ.
  const { data: seen } = await member.client.from("org_settings").select("promise_grace_days").eq("org_id", orgId).maybeSingle();
  expect(seen?.promise_grace_days).toBe(4);

  // Member write is blocked by RLS (no error thrown, simply 0 rows affected).
  await member.client.from("org_settings").update({ promise_grace_days: 99 }).eq("org_id", orgId);
  const { data: after } = await svc.from("org_settings").select("promise_grace_days").eq("org_id", orgId).single();
  expect(after!.promise_grace_days).toBe(4); // unchanged
});

test("an outsider can neither read nor write another org's settings", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `OS-out ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("org_settings").insert({ org_id: orgId, promise_grace_days: 2 });
  const outsider = await makeUserClient(`os-out-${Math.random()}@example.com`);

  const { data: seen } = await outsider.client.from("org_settings").select("promise_grace_days").eq("org_id", orgId);
  expect(seen ?? []).toHaveLength(0); // RLS hides the row
  await outsider.client.from("org_settings").update({ promise_grace_days: 99 }).eq("org_id", orgId);
  const { data: after } = await svc.from("org_settings").select("promise_grace_days").eq("org_id", orgId).single();
  expect(after!.promise_grace_days).toBe(2);
});
