import { test, expect } from "vitest";
import {
  isWithinSendWindow, resolveQuietHours, formatHourLabel, quietHoursWindowLabel,
  DEFAULT_QUIET_HOURS, DEFAULT_QUIET_HOURS_START, DEFAULT_QUIET_HOURS_END,
} from "../app/lib/quiet-hours";

const NY = "America/New_York";

// ---------------------------------------------------------------------------
// isWithinSendWindow — same-day [start, end) window
// ---------------------------------------------------------------------------

test("isWithinSendWindow is true at the start boundary (inclusive)", () => {
  // 13:00Z = 08:00 EDT (DST, June) — exactly the default window's start hour.
  expect(isWithinSendWindow(new Date("2026-06-15T12:00:00Z"), NY, 8, 21)).toBe(true);
});

test("isWithinSendWindow is false at the end boundary (exclusive)", () => {
  // 01:00Z (next day) = 21:00 EDT — exactly the default window's end hour, blocked.
  expect(isWithinSendWindow(new Date("2026-06-16T01:00:00Z"), NY, 8, 21)).toBe(false);
});

test("isWithinSendWindow is true one hour before the end boundary", () => {
  // 00:00Z (next day) = 20:00 EDT — the last allowed hour.
  expect(isWithinSendWindow(new Date("2026-06-16T00:00:00Z"), NY, 8, 21)).toBe(true);
});

test("isWithinSendWindow is false before the window opens", () => {
  // 11:00Z = 07:00 EDT — one hour before the default window opens.
  expect(isWithinSendWindow(new Date("2026-06-15T11:00:00Z"), NY, 8, 21)).toBe(false);
});

test("isWithinSendWindow treats endHour=24 as open until midnight", () => {
  // 03:00Z (next day) = 23:00 EDT — inside a 0-24 (all-day) window.
  expect(isWithinSendWindow(new Date("2026-06-16T03:00:00Z"), NY, 0, 24)).toBe(true);
});

// ---------------------------------------------------------------------------
// isWithinSendWindow — DST edges (America/New_York, mirrors tz.test.ts)
// ---------------------------------------------------------------------------

test("isWithinSendWindow spans the spring-forward gap correctly", () => {
  // 2026-03-08: 06:59Z = 01:59 EST (before window), 07:00Z = 03:00 EDT (inside
  // an 8-21 window it would still be false, but this proves the hour used is
  // the POST-jump local hour, not a naive UTC-offset miscalculation).
  expect(isWithinSendWindow(new Date("2026-03-08T06:59:00Z"), NY, 8, 21)).toBe(false); // 01:59
  expect(isWithinSendWindow(new Date("2026-03-08T07:00:00Z"), NY, 8, 21)).toBe(false); // 03:00, still before 8
  expect(isWithinSendWindow(new Date("2026-03-08T13:00:00Z"), NY, 8, 21)).toBe(true);  // 09:00 EDT
});

test("isWithinSendWindow handles the fall-back repeated hour consistently", () => {
  // 2026-11-01: local hour 1 occurs twice (05:00Z EDT, then 06:00Z EST).
  // Both instants are hour=1, so both are equally "before the 8am window".
  expect(isWithinSendWindow(new Date("2026-11-01T05:00:00Z"), NY, 8, 21)).toBe(false);
  expect(isWithinSendWindow(new Date("2026-11-01T06:00:00Z"), NY, 8, 21)).toBe(false);
});

// ---------------------------------------------------------------------------
// resolveQuietHours — defaults for absent row / absent columns
// ---------------------------------------------------------------------------

test("resolveQuietHours defaults to 8-21 for a null row", () => {
  expect(resolveQuietHours(null)).toEqual({ startHour: DEFAULT_QUIET_HOURS_START, endHour: DEFAULT_QUIET_HOURS_END });
  expect(resolveQuietHours(null)).toEqual(DEFAULT_QUIET_HOURS);
});

test("resolveQuietHours defaults to 8-21 when the row's columns are null", () => {
  expect(resolveQuietHours({ sms_send_start_hour: null, sms_send_end_hour: null })).toEqual(DEFAULT_QUIET_HOURS);
});

test("resolveQuietHours reads a configured window", () => {
  expect(resolveQuietHours({ sms_send_start_hour: 9, sms_send_end_hour: 17 })).toEqual({ startHour: 9, endHour: 17 });
});

test("resolveQuietHours resolves each column independently", () => {
  expect(resolveQuietHours({ sms_send_start_hour: 6, sms_send_end_hour: null })).toEqual({ startHour: 6, endHour: DEFAULT_QUIET_HOURS_END });
  expect(resolveQuietHours({ sms_send_start_hour: null, sms_send_end_hour: 22 })).toEqual({ startHour: DEFAULT_QUIET_HOURS_START, endHour: 22 });
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

test("formatHourLabel renders 12-hour labels including midnight and noon", () => {
  expect(formatHourLabel(0)).toBe("12:00 AM");
  expect(formatHourLabel(8)).toBe("8:00 AM");
  expect(formatHourLabel(12)).toBe("12:00 PM");
  expect(formatHourLabel(13)).toBe("1:00 PM");
  expect(formatHourLabel(23)).toBe("11:00 PM");
});

test("quietHoursWindowLabel renders the default window", () => {
  expect(quietHoursWindowLabel(8, 21)).toBe("8:00 AM – 9:00 PM");
});

test("quietHoursWindowLabel renders endHour=24 as midnight", () => {
  expect(quietHoursWindowLabel(0, 24)).toBe("12:00 AM – 12:00 AM");
});
