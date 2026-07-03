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

  // Member cannot INSERT into org_holidays (RLS blocks non-owner writes).
  await member.client.from("org_holidays").insert({ org_id: orgId, holiday_date: "2026-12-25" });
  const { data: holidays } = await svc.from("org_holidays").select("holiday_date").eq("org_id", orgId).eq("holiday_date", "2026-12-25");
  expect(holidays ?? []).toHaveLength(0); // RLS blocked the insert
});

test("an owner writes priority thresholds via RLS; the ordering CHECK constraint rejects violations", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `OS-priority ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const owner = await makeUserClient(`os-priority-owner-${Math.random()}@example.com`);
  await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });

  const { error: ownErr } = await owner.client.from("org_settings").upsert({
    org_id: orgId, high_value_threshold: 8000,
    priority_critical_min: 90, priority_high_min: 60, priority_medium_min: 30,
  }, { onConflict: "org_id" });
  expect(ownErr).toBeNull();
  const { data: row } = await svc.from("org_settings")
    .select("high_value_threshold, priority_critical_min, priority_high_min, priority_medium_min")
    .eq("org_id", orgId).single();
  expect(Number(row!.high_value_threshold)).toBe(8000);
  expect(row!.priority_critical_min).toBe(90);
  expect(row!.priority_high_min).toBe(60);
  expect(row!.priority_medium_min).toBe(30);

  // DB CHECK constraint rejects an ordering violation (critical <= high) even via service role.
  const { error: orderErr } = await svc.from("org_settings")
    .update({ priority_critical_min: 60, priority_high_min: 60 }).eq("org_id", orgId);
  expect(orderErr).not.toBeNull();

  // DB CHECK constraint rejects a non-positive high_value_threshold.
  const { error: hvErr } = await svc.from("org_settings")
    .update({ high_value_threshold: 0 }).eq("org_id", orgId);
  expect(hvErr).not.toBeNull();
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
