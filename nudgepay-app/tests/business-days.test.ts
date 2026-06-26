import { expect, test } from "vitest";
import {
  addBusinessDays, addCalendarDays, nextWorkingDay,
  GRACE_BUSINESS_DAYS, DEFAULT_WORKING_DAYS, NO_HOLIDAYS,
} from "../app/lib/business-days";

test("GRACE_BUSINESS_DAYS is 2 and defaults are Mon-Fri / no holidays", () => {
  expect(GRACE_BUSINESS_DAYS).toBe(2);
  expect([...DEFAULT_WORKING_DAYS].sort()).toEqual([1, 2, 3, 4, 5]);
  expect(NO_HOLIDAYS.size).toBe(0);
});

test("addBusinessDays skips weekends by default", () => {
  expect(addBusinessDays("2026-07-01", 2)).toBe("2026-07-03"); // Wed +2 = Fri
  expect(addBusinessDays("2026-07-02", 2)).toBe("2026-07-06"); // Thu +2 = Mon
  expect(addBusinessDays("2026-07-03", 2)).toBe("2026-07-07"); // Fri +2 = Tue
});

test("addBusinessDays with 0 returns the same date", () => {
  expect(addBusinessDays("2026-07-01", 0)).toBe("2026-07-01");
});

test("addBusinessDays skips holidays in addition to weekends", () => {
  // Wed 2026-07-01 +2 business days, but Thu 2026-07-02 is a holiday ->
  // Thu(skip holiday) Fri(1) ... actually count: Thu holiday skipped, Fri=1, Mon=2.
  const holidays = new Set(["2026-07-02"]);
  expect(addBusinessDays("2026-07-01", 2, { holidays })).toBe("2026-07-06");
});

test("addBusinessDays honors a custom working-days set (Sat working)", () => {
  // Working week includes Saturday (6). Fri 2026-07-03 +1 = Sat 2026-07-04.
  const workingDays = new Set([1, 2, 3, 4, 5, 6]);
  expect(addBusinessDays("2026-07-03", 1, { workingDays })).toBe("2026-07-04");
});

test("nextWorkingDay leaves working days unchanged and rolls weekends to Monday", () => {
  expect(nextWorkingDay("2026-06-26")).toBe("2026-06-26"); // Fri
  expect(nextWorkingDay("2026-06-27")).toBe("2026-06-29"); // Sat -> Mon
  expect(nextWorkingDay("2026-06-28")).toBe("2026-06-29"); // Sun -> Mon
});

test("nextWorkingDay rolls over a holiday that follows a weekend", () => {
  // Sat 2026-06-27 -> Sun 28 -> Mon 29 is a holiday -> Tue 30.
  const holidays = new Set(["2026-06-29"]);
  expect(nextWorkingDay("2026-06-27", { holidays })).toBe("2026-06-30");
});

test("addCalendarDays adds calendar days including weekends", () => {
  expect(addCalendarDays("2026-06-25", 2)).toBe("2026-06-27");
  expect(addCalendarDays("2026-06-25", 0)).toBe("2026-06-25");
  expect(addCalendarDays("2026-06-29", 7)).toBe("2026-07-06");
});

test("nextWorkingDay throws on an impossible config rather than hanging", () => {
  const workingDays = new Set([1, 2, 3, 4, 5]);
  // Every weekday for a year is a holiday -> no working day reachable.
  const holidays = new Set<string>();
  let d = new Date(Date.UTC(2026, 0, 1));
  for (let i = 0; i < 800; i++) {
    holidays.add(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  expect(() => nextWorkingDay("2026-01-01", { workingDays, holidays })).toThrow();
});
