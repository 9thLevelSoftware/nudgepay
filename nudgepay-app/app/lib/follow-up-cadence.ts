// Pure cadence policy for suggested follow-up dates. No I/O, no node:*, no
// .server suffix. CADENCE_DAYS is the default policy; per-org overrides arrive
// via the optional `config` (C7). Single source of truth for the default
// priority -> interval mapping.

import type { PriorityLevel } from "./priority";
import type { OrgConfig } from "./org-config";
import { addCalendarDays, nextWorkingDay } from "./business-days";

export const CADENCE_DAYS: Readonly<Record<PriorityLevel, number>> = Object.freeze({
  Critical: 2,
  High: 3,
  Medium: 7,
  Low: 14,
});

export type FollowUpSuggestion = { date: string; intervalDays: number };

// Suggest the next follow-up date: add the level's calendar interval to `today`,
// then roll forward off any non-working day (weekend or holiday). `intervalDays`
// is the pre-roll interval, used for the human-facing rationale ("3-day cadence").
export function suggestFollowUpDate(input: {
  level: PriorityLevel;
  today: string; // YYYY-MM-DD
  config?: Pick<OrgConfig, "cadenceDays" | "workingDays" | "holidays">;
}): FollowUpSuggestion {
  const cadence = input.config?.cadenceDays ?? CADENCE_DAYS;
  const intervalDays = cadence[input.level];
  const date = nextWorkingDay(addCalendarDays(input.today, intervalDays), {
    workingDays: input.config?.workingDays,
    holidays: input.config?.holidays,
  });
  return { date, intervalDays };
}
