import { expect, test } from "vitest";
import { DEFAULT_ORG_CONFIG, resolveOrgConfig } from "../app/lib/org-config";

test("DEFAULT_ORG_CONFIG carries the canonical defaults", () => {
  expect(DEFAULT_ORG_CONFIG.promiseGraceDays).toBe(2);
  expect([...DEFAULT_ORG_CONFIG.workingDays].sort()).toEqual([1, 2, 3, 4, 5]);
  expect(DEFAULT_ORG_CONFIG.holidays.size).toBe(0);
  expect(DEFAULT_ORG_CONFIG.cadenceDays).toEqual({ Critical: 2, High: 3, Medium: 7, Low: 14 });
});

test("resolveOrgConfig with null settings returns defaults plus holiday set", () => {
  const cfg = resolveOrgConfig(null, [{ holiday_date: "2026-12-25" }]);
  expect(cfg.promiseGraceDays).toBe(2);
  expect([...cfg.workingDays].sort()).toEqual([1, 2, 3, 4, 5]);
  expect(cfg.holidays.has("2026-12-25")).toBe(true);
  expect(cfg.cadenceDays).toEqual({ Critical: 2, High: 3, Medium: 7, Low: 14 });
});

test("resolveOrgConfig applies row overrides", () => {
  const cfg = resolveOrgConfig({
    promise_grace_days: 5,
    working_days: [1, 2, 3, 4, 5, 6],
    cadence_critical: 1,
    cadence_high: 2,
    cadence_medium: 5,
    cadence_low: 10,
  }, []);
  expect(cfg.promiseGraceDays).toBe(5);
  expect([...cfg.workingDays].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  expect(cfg.cadenceDays).toEqual({ Critical: 1, High: 2, Medium: 5, Low: 10 });
});

test("resolveOrgConfig falls back to default working days when the column is empty", () => {
  const cfg = resolveOrgConfig({
    promise_grace_days: 2,
    working_days: [],
    cadence_critical: 2, cadence_high: 3, cadence_medium: 7, cadence_low: 14,
  }, []);
  expect([...cfg.workingDays].sort()).toEqual([1, 2, 3, 4, 5]);
});
