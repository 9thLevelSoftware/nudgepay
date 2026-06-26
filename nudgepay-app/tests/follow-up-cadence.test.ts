import { expect, test } from "vitest";
import { CADENCE_DAYS, suggestFollowUpDate } from "../app/lib/follow-up-cadence";

test("CADENCE_DAYS maps each level to its interval and is frozen", () => {
  expect(CADENCE_DAYS).toEqual({ Critical: 2, High: 3, Medium: 7, Low: 14 });
  expect(Object.isFrozen(CADENCE_DAYS)).toBe(true);
});

test("suggestFollowUpDate uses default cadence + weekend roll when no config", () => {
  // 2026-06-22 is a Monday.
  expect(suggestFollowUpDate({ level: "Critical", today: "2026-06-22" }))
    .toEqual({ date: "2026-06-24", intervalDays: 2 });
  expect(suggestFollowUpDate({ level: "Low", today: "2026-06-22" }))
    .toEqual({ date: "2026-07-06", intervalDays: 14 });
  // Weekend roll: Fri 2026-06-26 + 2 = Sun 28 -> Mon 29.
  expect(suggestFollowUpDate({ level: "Critical", today: "2026-06-26" }).date)
    .toBe("2026-06-29");
});

test("suggestFollowUpDate honors per-org cadence override", () => {
  const config = {
    cadenceDays: { Critical: 1, High: 3, Medium: 7, Low: 14 },
    workingDays: new Set([1, 2, 3, 4, 5]),
    holidays: new Set<string>(),
  };
  // Mon 2026-06-22 + 1 = Tue 2026-06-23; intervalDays reflects the org value.
  expect(suggestFollowUpDate({ level: "Critical", today: "2026-06-22", config }))
    .toEqual({ date: "2026-06-23", intervalDays: 1 });
});

test("suggestFollowUpDate rolls off a configured holiday", () => {
  const config = {
    cadenceDays: { Critical: 2, High: 3, Medium: 7, Low: 14 },
    workingDays: new Set([1, 2, 3, 4, 5]),
    holidays: new Set(["2026-06-24"]),
  };
  // Mon 2026-06-22 + 2 = Wed 2026-06-24 (holiday) -> Thu 2026-06-25.
  expect(suggestFollowUpDate({ level: "Critical", today: "2026-06-22", config }).date)
    .toBe("2026-06-25");
});
