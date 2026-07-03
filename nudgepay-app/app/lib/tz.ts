// Pure timezone helpers for org-local "today" and "hour". No I/O, no
// external tz library — Intl.DateTimeFormat with an explicit IANA zone is
// Workers-supported (nodejs_compat) and is the only primitive we need.
//
// Used by: the digest cron gate (shouldSendDigestNow) and by route loaders
// that need the org's local calendar day rather than UTC's (see org-config.ts
// consumers). business-days.ts is deliberately left tz-free — it operates on
// date strings already resolved by the caller.

const DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const HOUR_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = DATE_FORMATTERS.get(tz);
  if (!fmt) {
    // en-CA formats as YYYY-MM-DD, matching this codebase's date-string convention.
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    DATE_FORMATTERS.set(tz, fmt);
  }
  return fmt;
}

function hourFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = HOUR_FORMATTERS.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hourCycle: "h23",
    });
    HOUR_FORMATTERS.set(tz, fmt);
  }
  return fmt;
}

/** Org-local calendar day (YYYY-MM-DD) for the given instant (default: now). */
export function todayInTz(tz: string, now: Date = new Date()): string {
  return dateFormatter(tz).format(now);
}

/** Org-local hour-of-day (0-23) for the given instant (default: now). */
export function hourInTz(tz: string, now: Date = new Date()): number {
  const hour = Number(hourFormatter(tz).format(now));
  // Some Intl implementations emit "24" for midnight even under hourCycle
  // "h23" (a known ICU/V8 quirk) — normalize defensively.
  return hour === 24 ? 0 : hour;
}

/**
 * Digest send gate: fires once the org-local hour reaches digestHourLocal,
 * and at most once per org-local calendar day.
 *
 * `>=` (not `===`) self-heals a missed hourly invocation and covers the lost
 * hour on spring-forward. `lastDigestDate` (the caller persists this after a
 * successful send) blocks same-day re-fires; on fall-back — where the local
 * hour can repeat — the caller's notification_log dedupe is the final guard.
 */
export function shouldSendDigestNow(
  tz: string,
  digestHourLocal: number,
  lastDigestDate: string | null,
  now: Date = new Date(),
): boolean {
  if (hourInTz(tz, now) < digestHourLocal) return false;
  const today = todayInTz(tz, now);
  return lastDigestDate === null || lastDigestDate < today;
}
