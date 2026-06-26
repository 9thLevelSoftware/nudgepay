import { expect, test } from "vitest";
import { CADENCE_DAYS, suggestFollowUpDate } from "../app/lib/follow-up-cadence";

test("CADENCE_DAYS maps each level to its interval and is frozen", () => {
  expect(CADENCE_DAYS).toEqual({ Critical: 2, High: 3, Medium: 7, Low: 14 });
  expect(Object.isFrozen(CADENCE_DAYS)).toBe(true);
});

test("suggestFollowUpDate returns the pre-roll interval for the level", () => {
  // 2026-06-22 is a Monday, so none of these land on a weekend.
  expect(suggestFollowUpDate({ level: "Critical", today: "2026-06-22" }))
    .toEqual({ date: "2026-06-24", intervalDays: 2 }); // Mon + 2 = Wed
  expect(suggestFollowUpDate({ level: "High", today: "2026-06-22" }))
    .toEqual({ date: "2026-06-25", intervalDays: 3 }); // Mon + 3 = Thu
  expect(suggestFollowUpDate({ level: "Medium", today: "2026-06-22" }))
    .toEqual({ date: "2026-06-29", intervalDays: 7 }); // Mon + 7 = next Mon
  expect(suggestFollowUpDate({ level: "Low", today: "2026-06-22" }))
    .toEqual({ date: "2026-07-06", intervalDays: 14 }); // Mon + 14 = Mon
});

test("suggestFollowUpDate rolls a weekend landing forward to Monday", () => {
  // 2026-06-25 (Thu) + 2 = 2026-06-27 (Sat) -> Monday 2026-06-29.
  expect(suggestFollowUpDate({ level: "Critical", today: "2026-06-25" }).date)
    .toBe("2026-06-29");
  // 2026-06-26 (Fri) + 2 = 2026-06-28 (Sun) -> Monday 2026-06-29.
  expect(suggestFollowUpDate({ level: "Critical", today: "2026-06-26" }).date)
    .toBe("2026-06-29");
});

test("suggestFollowUpDate is a pure string transform (timezone-independent)", () => {
  // Same input -> same output, no Date-locale dependence.
  const a = suggestFollowUpDate({ level: "Medium", today: "2026-01-30" });
  const b = suggestFollowUpDate({ level: "Medium", today: "2026-01-30" });
  expect(a).toEqual(b);
  expect(a.date).toBe("2026-02-06"); // Jan 30 (Fri) + 7 = Feb 6 (Fri)
});
