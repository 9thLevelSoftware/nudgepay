import { expect, test } from "vitest";
import { addBusinessDays, GRACE_BUSINESS_DAYS } from "../app/lib/business-days";

test("GRACE_BUSINESS_DAYS is 2", () => {
  expect(GRACE_BUSINESS_DAYS).toBe(2);
});

test("addBusinessDays skips weekends", () => {
  // 2026-07-01 is a Wednesday. +2 business days = Friday 2026-07-03.
  expect(addBusinessDays("2026-07-01", 2)).toBe("2026-07-03");
  // 2026-07-02 is a Thursday. +2 = Monday 2026-07-06 (skips Sat/Sun).
  expect(addBusinessDays("2026-07-02", 2)).toBe("2026-07-06");
  // 2026-07-03 is a Friday. +2 = Tuesday 2026-07-07.
  expect(addBusinessDays("2026-07-03", 2)).toBe("2026-07-07");
});

test("addBusinessDays with 0 returns the same date", () => {
  expect(addBusinessDays("2026-07-01", 0)).toBe("2026-07-01");
});

import { addCalendarDays, rollToWeekday } from "../app/lib/business-days";

test("addCalendarDays adds calendar days including weekends", () => {
  // 2026-06-25 (Thu) + 2 calendar days = 2026-06-27 (Sat), no skipping.
  expect(addCalendarDays("2026-06-25", 2)).toBe("2026-06-27");
  // n = 0 is identity.
  expect(addCalendarDays("2026-06-25", 0)).toBe("2026-06-25");
  // Crosses a month boundary.
  expect(addCalendarDays("2026-06-29", 7)).toBe("2026-07-06");
});

test("rollToWeekday leaves weekdays unchanged", () => {
  expect(rollToWeekday("2026-06-26")).toBe("2026-06-26"); // Friday
  expect(rollToWeekday("2026-06-25")).toBe("2026-06-25"); // Thursday
});

test("rollToWeekday rolls Saturday and Sunday forward to Monday", () => {
  expect(rollToWeekday("2026-06-27")).toBe("2026-06-29"); // Sat -> Mon
  expect(rollToWeekday("2026-06-28")).toBe("2026-06-29"); // Sun -> Mon
});
