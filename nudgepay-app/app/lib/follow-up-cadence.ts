// Pure cadence policy for suggested follow-up dates. No I/O, no node:*, no
// .server suffix (imported by cases.ts, the drawer, and tests). Single source
// of truth for the priority -> interval mapping. Per-org tuning is deferred to
// C7; intervals are fixed named constants here.

import type { PriorityLevel } from "./priority";
import { addCalendarDays, rollToWeekday } from "./business-days";

export const CADENCE_DAYS: Readonly<Record<PriorityLevel, number>> = Object.freeze({
  Critical: 2,
  High: 3,
  Medium: 7,
  Low: 14,
});

export type FollowUpSuggestion = { date: string; intervalDays: number };

// Suggest the next follow-up date: add the level's calendar interval to `today`,
// then roll off a weekend. `intervalDays` is the pre-roll interval, used only for
// the human-facing rationale ("3-day cadence").
export function suggestFollowUpDate(input: {
  level: PriorityLevel;
  today: string; // YYYY-MM-DD
}): FollowUpSuggestion {
  const intervalDays = CADENCE_DAYS[input.level];
  const date = rollToWeekday(addCalendarDays(input.today, intervalDays));
  return { date, intervalDays };
}
