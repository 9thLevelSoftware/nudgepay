import { expect, test } from "vitest";
import { DEFAULT_ORG_CONFIG, resolveOrgConfig } from "../app/lib/org-config";

test("DEFAULT_ORG_CONFIG carries the canonical defaults", () => {
  expect(DEFAULT_ORG_CONFIG.promiseGraceDays).toBe(2);
  expect([...DEFAULT_ORG_CONFIG.workingDays].sort()).toEqual([1, 2, 3, 4, 5]);
  expect(DEFAULT_ORG_CONFIG.holidays.size).toBe(0);
  expect(DEFAULT_ORG_CONFIG.cadenceDays).toEqual({ Critical: 2, High: 3, Medium: 7, Low: 14 });
  expect(DEFAULT_ORG_CONFIG.priority).toEqual({ highValue: 5000, criticalMin: 80, highMin: 50, mediumMin: 25 });
  expect(DEFAULT_ORG_CONFIG.workflow).toEqual({ comingDueDays: 7, dueSoonBusinessDays: 3, smsBatchLimit: 50 });
});

test("resolveOrgConfig with null settings returns defaults plus holiday set", () => {
  const cfg = resolveOrgConfig(null, [{ holiday_date: "2026-12-25" }]);
  expect(cfg.promiseGraceDays).toBe(2);
  expect([...cfg.workingDays].sort()).toEqual([1, 2, 3, 4, 5]);
  expect(cfg.holidays.has("2026-12-25")).toBe(true);
  expect(cfg.cadenceDays).toEqual({ Critical: 2, High: 3, Medium: 7, Low: 14 });
  expect(cfg.priority).toEqual({ highValue: 5000, criticalMin: 80, highMin: 50, mediumMin: 25 });
  expect(cfg.workflow).toEqual({ comingDueDays: 7, dueSoonBusinessDays: 3, smsBatchLimit: 50 });
});

test("resolveOrgConfig applies workflow knob row overrides", () => {
  const cfg = resolveOrgConfig({
    promise_grace_days: 2,
    working_days: [1, 2, 3, 4, 5],
    cadence_critical: 2, cadence_high: 3, cadence_medium: 7, cadence_low: 14,
    coming_due_days: 14,
    due_soon_business_days: 5,
    sms_batch_limit: 100,
  } as any, []);
  expect(cfg.workflow).toEqual({ comingDueDays: 14, dueSoonBusinessDays: 5, smsBatchLimit: 100 });
});

test("resolveOrgConfig falls back to workflow defaults when the columns are null", () => {
  const cfg = resolveOrgConfig({
    promise_grace_days: 2,
    working_days: [1, 2, 3, 4, 5],
    cadence_critical: 2, cadence_high: 3, cadence_medium: 7, cadence_low: 14,
    coming_due_days: null,
    due_soon_business_days: null,
    sms_batch_limit: null,
  } as any, []);
  expect(cfg.workflow).toEqual({ comingDueDays: 7, dueSoonBusinessDays: 3, smsBatchLimit: 50 });
});

test("resolveOrgConfig applies priority threshold row overrides", () => {
  const cfg = resolveOrgConfig({
    promise_grace_days: 2,
    working_days: [1, 2, 3, 4, 5],
    cadence_critical: 2, cadence_high: 3, cadence_medium: 7, cadence_low: 14,
    high_value_threshold: 8000,
    priority_critical_min: 90,
    priority_high_min: 60,
    priority_medium_min: 30,
  } as any, []);
  expect(cfg.priority).toEqual({ highValue: 8000, criticalMin: 90, highMin: 60, mediumMin: 30 });
});

test("resolveOrgConfig falls back to priority defaults when the columns are null", () => {
  const cfg = resolveOrgConfig({
    promise_grace_days: 2,
    working_days: [1, 2, 3, 4, 5],
    cadence_critical: 2, cadence_high: 3, cadence_medium: 7, cadence_low: 14,
    high_value_threshold: null,
    priority_critical_min: null,
    priority_high_min: null,
    priority_medium_min: null,
  } as any, []);
  expect(cfg.priority).toEqual({ highValue: 5000, criticalMin: 80, highMin: 50, mediumMin: 25 });
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
