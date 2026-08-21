import { expect, test } from "vitest";
import { formatDate, formatDateTime, formatInstant } from "../app/lib/dates";
import { bubbleTimeLabel, lastBubbleId } from "../app/components/MessageBubbles";

// The core regression: a date-only string must render the SAME calendar date in
// every timezone. Building a local date from the components (rather than parsing
// UTC midnight) is what makes this hold regardless of the machine's TZ.
test("date-only string renders its exact calendar date (no UTC shift)", () => {
  expect(formatDate("2026-07-01")).toBe("Jul 1, 2026");
  expect(formatDate("2026-01-31")).toBe("Jan 31, 2026");
  expect(formatDate("2026-12-25")).toBe("Dec 25, 2026");
});

test("null, undefined, and empty render an em dash", () => {
  expect(formatDate(null)).toBe("—");
  expect(formatDate(undefined)).toBe("—");
  expect(formatDate("")).toBe("—");
});

test("unparseable input renders an em dash", () => {
  expect(formatDate("not-a-date")).toBe("—");
});

// Full ISO timestamps are genuine instants — parsed normally. We assert the
// shape (Mon D, YYYY) rather than an exact day, since display depends on the
// viewer's timezone. Prefer formatDateTime with the org zone for UI instants.
test("full ISO timestamp formats to a medium date", () => {
  expect(formatDate("2026-06-20T15:00:00Z")).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
});

// 19:04 UTC on 20 Aug 2026 is 15:04 EDT / 12:04 PDT — a known instant that
// lands on different clock times (and, near midnight, different calendar days).
const INSTANT = "2026-08-20T19:04:00.000Z";
const NEAR_MIDNIGHT = "2026-08-20T03:04:00.000Z";

test("formatDateTime renders a known instant in America/New_York, UTC, and America/Los_Angeles", () => {
  expect(formatDateTime(INSTANT, "America/New_York")).toBe("Aug 20, 2026, 3:04 PM");
  expect(formatDateTime(INSTANT, "UTC")).toBe("Aug 20, 2026, 7:04 PM");
  expect(formatDateTime(INSTANT, "America/Los_Angeles")).toBe("Aug 20, 2026, 12:04 PM");
});

test("formatDateTime uses the org zone for calendar day, not the viewer/Worker zone", () => {
  expect(formatDateTime(NEAR_MIDNIGHT, "UTC")).toBe("Aug 20, 2026, 3:04 AM");
  expect(formatDateTime(NEAR_MIDNIGHT, "America/New_York")).toBe("Aug 19, 2026, 11:04 PM");
  expect(formatDateTime(NEAR_MIDNIGHT, "America/Los_Angeles")).toBe("Aug 19, 2026, 8:04 PM");
});

test("formatDateTime returns an em dash for empty, unparseable, or invalid zone", () => {
  expect(formatDateTime(null, "UTC")).toBe("—");
  expect(formatDateTime(undefined, "UTC")).toBe("—");
  expect(formatDateTime("", "UTC")).toBe("—");
  expect(formatDateTime("not-a-date", "UTC")).toBe("—");
  expect(formatDateTime(INSTANT, "Not/AZone")).toBe("—");
});

test("formatInstant uses the org zone when given, otherwise formatDate", () => {
  expect(formatInstant(INSTANT, "America/New_York")).toBe("Aug 20, 2026, 3:04 PM");
  expect(formatInstant("2026-07-01")).toBe("Jul 1, 2026");
  expect(formatInstant("2026-07-01", null)).toBe("Jul 1, 2026");
});

test("bubbleTimeLabel omits empty/unparseable instants and formats in the org zone", () => {
  expect(bubbleTimeLabel(undefined)).toBeNull();
  expect(bubbleTimeLabel(null, "UTC")).toBeNull();
  expect(bubbleTimeLabel("not-a-date", "UTC")).toBeNull();
  expect(bubbleTimeLabel(INSTANT, "America/New_York")).toBe("Aug 20, 2026, 3:04 PM");
  expect(bubbleTimeLabel("2026-07-01")).toBe("Jul 1, 2026");
});

test("lastBubbleId is the last message id (scroll target); empty thread has none", () => {
  expect(lastBubbleId([])).toBeNull();
  expect(lastBubbleId([{ id: "a" }])).toBe("a");
  expect(lastBubbleId([{ id: "a" }, { id: "b" }, { id: "c" }])).toBe("c");
});
