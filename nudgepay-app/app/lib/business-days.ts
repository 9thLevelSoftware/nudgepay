// Pure business-day arithmetic for promise grace deadlines and follow-up rolls.
// No I/O, no .server. Date-only strings (YYYY-MM-DD) in and out; UTC-component
// math so there is no timezone drift (consistent with app/lib/dates.ts).
// Working days and holidays are configurable per org (C7); the defaults below
// reproduce the original weekend-only behavior.

export const GRACE_BUSINESS_DAYS = 2;
export const DEFAULT_WORKING_DAYS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);
export const NO_HOLIDAYS: ReadonlySet<string> = new Set<string>();

const MAX_ROLL = 366; // safety bound: an org should never block a full year of days

type DayOpts = { workingDays?: ReadonlySet<number>; holidays?: ReadonlySet<string> };

function isWorkingDay(dt: Date, workingDays: ReadonlySet<number>, holidays: ReadonlySet<string>): boolean {
  return workingDays.has(dt.getUTCDay()) && !holidays.has(dt.toISOString().slice(0, 10));
}

function parse(dateISO: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Advance `n` working days, skipping non-working weekdays and holidays.
export function addBusinessDays(dateISO: string, n: number, opts: DayOpts = {}): string {
  const workingDays = opts.workingDays ?? DEFAULT_WORKING_DAYS;
  const holidays = opts.holidays ?? NO_HOLIDAYS;
  const dt = parse(dateISO);
  let added = 0;
  let steps = 0;
  while (added < n) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    if (++steps > (n + 1) * MAX_ROLL) {
      throw new Error(`addBusinessDays: no working day within range for ${dateISO}`);
    }
    if (isWorkingDay(dt, workingDays, holidays)) added += 1;
  }
  return dt.toISOString().slice(0, 10);
}

// Add n calendar days (weekends included). UTC-component math, no drift.
export function addCalendarDays(dateISO: string, n: number): string {
  const dt = parse(dateISO);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// If dateISO is not a working day (weekend or holiday), roll forward to the next
// working, non-holiday day; an already-valid day is returned unchanged.
export function nextWorkingDay(dateISO: string, opts: DayOpts = {}): string {
  const workingDays = opts.workingDays ?? DEFAULT_WORKING_DAYS;
  const holidays = opts.holidays ?? NO_HOLIDAYS;
  const dt = parse(dateISO);
  let steps = 0;
  while (!isWorkingDay(dt, workingDays, holidays)) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    if (++steps > MAX_ROLL) {
      throw new Error(`nextWorkingDay: no working day within a year of ${dateISO}`);
    }
  }
  return dt.toISOString().slice(0, 10);
}
