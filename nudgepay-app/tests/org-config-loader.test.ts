import { expect, test } from "vitest";
import { serviceClient } from "./helpers";
import { loadOrgConfig } from "../app/lib/org-config.server";

const svc = serviceClient();

test("loadOrgConfig returns defaults for an org with no settings/holiday rows", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "C7 defaults" }).select("id").single();
  const orgId = org!.id as string;
  const cfg = await loadOrgConfig(svc, orgId);
  expect(cfg.promiseGraceDays).toBe(2);
  expect([...cfg.workingDays].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  expect(cfg.holidays.size).toBe(0);
  expect(cfg.cadenceDays).toEqual({ Critical: 2, High: 3, Medium: 7, Low: 14 });
});

test("org_settings rejects an empty working_days array", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "C7 empty-wd" }).select("id").single();
  const orgId = org!.id as string;
  const { error } = await svc.from("org_settings").insert({ org_id: orgId, working_days: [] });
  expect(error).not.toBeNull();
  // A valid non-empty array must still be accepted
  const { error: okErr } = await svc.from("org_settings").insert({ org_id: orgId, working_days: [1, 2, 3] });
  expect(okErr).toBeNull();
});

test("loadOrgConfig reflects stored settings and holidays", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "C7 custom" }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("org_settings").insert({
    org_id: orgId, promise_grace_days: 3, working_days: [1, 2, 3, 4, 5, 6],
    cadence_critical: 1, cadence_high: 2, cadence_medium: 5, cadence_low: 10,
  });
  await svc.from("org_holidays").insert({ org_id: orgId, holiday_date: "2026-12-25", label: "Christmas" });
  const cfg = await loadOrgConfig(svc, orgId);
  expect(cfg.promiseGraceDays).toBe(3);
  expect([...cfg.workingDays].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(cfg.holidays.has("2026-12-25")).toBe(true);
  expect(cfg.cadenceDays.Critical).toBe(1);
});
