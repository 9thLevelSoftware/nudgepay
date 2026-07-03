import { test, expect } from "vitest";
import { todayInTz, hourInTz, shouldSendDigestNow } from "../app/lib/tz";

// ---------------------------------------------------------------------------
// todayInTz — UTC-midnight rollover
// ---------------------------------------------------------------------------

test("todayInTz rolls forward past UTC midnight for zones ahead of UTC", () => {
  // 2026-01-01T15:00:00Z is 2026-01-02T00:00:00 in Tokyo (UTC+9).
  const now = new Date("2026-01-01T15:00:00Z");
  expect(todayInTz("Asia/Tokyo", now)).toBe("2026-01-02");
  expect(todayInTz("UTC", now)).toBe("2026-01-01");
});

test("todayInTz stays on the previous day for zones behind UTC", () => {
  // 2026-01-01T03:00:00Z is 2025-12-31T19:00:00 in Los Angeles (UTC-8).
  const now = new Date("2026-01-01T03:00:00Z");
  expect(todayInTz("America/Los_Angeles", now)).toBe("2025-12-31");
  expect(todayInTz("UTC", now)).toBe("2026-01-01");
});

// ---------------------------------------------------------------------------
// hourInTz / todayInTz — DST spring-forward (America/New_York, 2026-03-08)
// ---------------------------------------------------------------------------

test("hourInTz jumps across the spring-forward gap (2am local never occurs)", () => {
  // 06:59Z = 01:59 EST (UTC-5, pre-transition).
  expect(hourInTz("America/New_York", new Date("2026-03-08T06:59:00Z"))).toBe(1);
  // 07:00Z = 03:00 EDT (UTC-4) — clocks sprang forward straight from 2am to 3am.
  expect(hourInTz("America/New_York", new Date("2026-03-08T07:00:00Z"))).toBe(3);
});

// ---------------------------------------------------------------------------
// hourInTz — DST fall-back (America/New_York, 2026-11-01): local hour 1 repeats
// ---------------------------------------------------------------------------

test("hourInTz repeats the fall-back hour once for each UTC offset", () => {
  // 05:00Z = 01:00 EDT (UTC-4, still pre-transition).
  expect(hourInTz("America/New_York", new Date("2026-11-01T05:00:00Z"))).toBe(1);
  // 06:00Z = 01:00 EST (UTC-5, post-transition) — same local hour occurs again.
  expect(hourInTz("America/New_York", new Date("2026-11-01T06:00:00Z"))).toBe(1);
  // 07:00Z = 02:00 EST — clock has moved on.
  expect(hourInTz("America/New_York", new Date("2026-11-01T07:00:00Z"))).toBe(2);
});

// ---------------------------------------------------------------------------
// Explicit `now` injection (no reliance on real wall-clock time)
// ---------------------------------------------------------------------------

test("todayInTz and hourInTz use the injected `now`, not the real clock", () => {
  const now = new Date("2030-05-17T12:34:00Z");
  expect(todayInTz("UTC", now)).toBe("2030-05-17");
  expect(hourInTz("UTC", now)).toBe(12);
});

test("todayInTz/hourInTz default to the real clock when `now` is omitted", () => {
  const beforeToday = new Date().toISOString().slice(0, 10);
  const today = todayInTz("UTC");
  const afterToday = new Date().toISOString().slice(0, 10);
  // today must equal whichever UTC calendar day the call landed on — either
  // side of the call, immune to a midnight flip mid-test.
  expect([beforeToday, afterToday]).toContain(today);

  const hour = hourInTz("UTC");
  expect(hour).toBeGreaterThanOrEqual(0);
  expect(hour).toBeLessThanOrEqual(23);
});

// ---------------------------------------------------------------------------
// shouldSendDigestNow — the per-org gate used by the hourly digest cron
// ---------------------------------------------------------------------------

const NY = "America/New_York";

test("does not fire before the configured local hour", () => {
  // 11:00Z = 06:00 EST — before an 8am local send hour.
  const now = new Date("2026-01-15T11:00:00Z");
  expect(shouldSendDigestNow(NY, 8, null, now)).toBe(false);
});

test("fires once local time reaches the configured hour", () => {
  // 13:00Z = 08:00 EST — exactly the configured send hour.
  const now = new Date("2026-01-15T13:00:00Z");
  expect(shouldSendDigestNow(NY, 8, null, now)).toBe(true);
});

test("self-heals a missed hourly invocation (fires well after the hour too)", () => {
  // 16:00Z = 11:00 EST — three hours past the configured 8am hour, never sent.
  const now = new Date("2026-01-15T16:00:00Z");
  expect(shouldSendDigestNow(NY, 8, null, now)).toBe(true);
});

test("does not fire twice on the same org-local day", () => {
  const now = new Date("2026-01-15T16:00:00Z"); // 11:00 EST
  expect(shouldSendDigestNow(NY, 8, "2026-01-15", now)).toBe(false);
});

test("catches up the day after a missed send", () => {
  const now = new Date("2026-01-16T13:00:00Z"); // 08:00 EST, next day
  expect(shouldSendDigestNow(NY, 8, "2026-01-15", now)).toBe(true);
});
