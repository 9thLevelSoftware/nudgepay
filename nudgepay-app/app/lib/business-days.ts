// Pure business-day arithmetic for promise grace deadlines. No I/O, no .server.
// Date-only strings (YYYY-MM-DD) in and out; UTC-component math so there is no
// timezone drift (consistent with app/lib/dates.ts). Weekends (Sat/Sun) are
// skipped. Holidays are out of scope for 6b (deferred to C7).

export const GRACE_BUSINESS_DAYS = 2;

export function addBusinessDays(dateISO: string, n: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  let added = 0;
  while (added < n) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    const day = dt.getUTCDay(); // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) added += 1;
  }
  return dt.toISOString().slice(0, 10);
}

// Add n calendar days (weekends included) to a YYYY-MM-DD string. UTC-component
// math, consistent with addBusinessDays — no timezone drift.
export function addCalendarDays(dateISO: string, n: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// If dateISO falls on a weekend, roll forward to the following Monday
// (Sat -> +2, Sun -> +1); weekdays are returned unchanged.
export function rollToWeekday(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0 = Sun, 6 = Sat
  if (day === 6) return addCalendarDays(dateISO, 2);
  if (day === 0) return addCalendarDays(dateISO, 1);
  return dateISO;
}
