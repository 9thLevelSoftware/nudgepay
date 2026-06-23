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
