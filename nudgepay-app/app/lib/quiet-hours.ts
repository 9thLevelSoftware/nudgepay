// Pure module: org-configurable SMS send window ("quiet hours", Phase 7).
// No I/O, no .server suffix — safe in client bundle + tests. Mirrors the
// org-config.ts pattern (resolve* fills defaults from a nullable DB row).
//
// Same-day windows only (DB CHECK sms_send_window_valid: start < end) —
// overnight windows make no sense for collections SMS, so the window math
// below is a simple same-day [start, end) comparison, no midnight wraparound.

import { hourInTz } from "./tz";

// Matches org_settings.sms_send_start_hour / sms_send_end_hour column
// defaults (0030 migration).
export const DEFAULT_QUIET_HOURS_START = 8;
export const DEFAULT_QUIET_HOURS_END = 21;

export type QuietHours = { startHour: number; endHour: number };

export const DEFAULT_QUIET_HOURS: QuietHours = Object.freeze({
  startHour: DEFAULT_QUIET_HOURS_START,
  endHour: DEFAULT_QUIET_HOURS_END,
});

// Nullable to match a SELECT against optional columns / an absent row.
export type QuietHoursRow = {
  sms_send_start_hour?: number | null;
  sms_send_end_hour?: number | null;
};

/** Resolve a nullable org_settings row → a QuietHours window, defaults filled. */
export function resolveQuietHours(row: QuietHoursRow | null | undefined): QuietHours {
  return {
    startHour: row?.sms_send_start_hour ?? DEFAULT_QUIET_HOURS_START,
    endHour: row?.sms_send_end_hour ?? DEFAULT_QUIET_HOURS_END,
  };
}

/**
 * True when `now` (in the org's local timezone) falls inside [startHour, endHour).
 * Same-day only: endHour of 24 means "until midnight" (hourInTz never returns 24).
 */
export function isWithinSendWindow(
  now: Date,
  tz: string,
  startHour: number,
  endHour: number,
): boolean {
  const hour = hourInTz(tz, now);
  return hour >= startHour && hour < endHour;
}

// 12-hour label for a single hour value (0-23), e.g. 0 -> "12:00 AM", 13 -> "1:00 PM".
// Shared by the settings form (hour <select>s) and the amber quiet-hours notices.
export function formatHourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${period}`;
}

/** Human-readable window label, e.g. "8:00 AM – 9:00 PM". */
export function quietHoursWindowLabel(startHour: number, endHour: number): string {
  // endHour=24 means "until midnight" — display it as "12:00 AM" (formatHourLabel
  // only handles 0-23, since that's the full range of hourInTz's return value).
  const endLabel = endHour === 24 ? "12:00 AM" : formatHourLabel(endHour);
  return `${formatHourLabel(startHour)} – ${endLabel}`;
}
