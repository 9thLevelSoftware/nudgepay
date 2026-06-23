// Timezone-safe date formatting shared by the work queue and detail panel.
//
// Postgres `date` columns (due_date, follow_up_at, promised_date,
// next_action_at) arrive as date-only strings like "2026-07-01". Passing those
// straight to `new Date(...)` parses them as UTC midnight, so in any negative-UTC
// timezone toLocaleDateString renders the PRIOR calendar day ("Jun 30"). We read
// the Y/M/D components and build a *local* date instead, so the calendar date
// renders unchanged in every timezone.
//
// Full ISO timestamps (timestamptz: created_at, last-contact date) are genuine
// instants — we parse them normally and render in the viewer's local zone, which
// is the intended behavior.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const MEDIUM_DATE: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

/**
 * Format a date-only string OR a full ISO timestamp as "Mon D, YYYY".
 * Date-only strings render the exact calendar date regardless of timezone.
 * Returns "—" for null/empty/unparseable input.
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
