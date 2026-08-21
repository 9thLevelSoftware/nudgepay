// Timezone-safe date formatting shared by the work queue and detail panel.
//
// Postgres `date` columns (due_date, follow_up_at, promised_date,
// next_action_at) arrive as date-only strings like "2026-07-01". Passing those
// straight to `new Date(...)` parses them as UTC midnight, so in any negative-UTC
// timezone toLocaleDateString renders the PRIOR calendar day ("Jun 30"). We read
// the Y/M/D components and build a *local* date instead, so the calendar date
// renders unchanged in every timezone.
//
// Timestamptz columns (created_at, last-contact, SMS/email times) are genuine
// instants. During SSR the Worker zone is UTC, so viewer-local toLocaleString
// hydrates to a different calendar day. Format those with formatDateTime in
// the org IANA zone (companyProfile.timezone).

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const MEDIUM_DATE: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

const MEDIUM_DATETIME: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

const DATETIME_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = DATETIME_FORMATTERS.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { ...MEDIUM_DATETIME, timeZone: tz });
    DATETIME_FORMATTERS.set(tz, fmt);
  }
  return fmt;
}

/**
 * Format a date-only string OR a full ISO timestamp as "Mon D, YYYY".
 * Date-only strings render the exact calendar date regardless of timezone.
 * Returns "—" for null/empty/unparseable input.
 *
 * Instants (timestamptz) should use formatDateTime with the org zone so SSR
 * and the browser agree. This path remains the no-zone fallback.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = DATE_ONLY.exec(value);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", MEDIUM_DATE);
}

/**
 * Format an ISO instant in a given IANA zone, including time-of-day
 * (e.g. "Aug 20, 2026, 3:04 PM"). Date-only columns should use formatDate.
 * Returns "—" for null/empty/unparseable input or an invalid timezone.
 */
export function formatDateTime(value: string | null | undefined, timeZone: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    // ICU may emit NNBSP between time and AM/PM; keep a regular space.
    return dateTimeFormatter(timeZone).format(d).replace(/\u202f|\u00a0/g, " ");
  } catch {
    return "—";
  }
}

/**
 * Timestamptz display: org zone when known, otherwise the date-only fallback.
 */
export function formatInstant(value: string | null | undefined, timeZone?: string | null): string {
  return timeZone ? formatDateTime(value, timeZone) : formatDate(value);
}
