import { expect, test } from "vitest";
import { formatDate } from "../app/lib/dates";

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
// viewer's timezone, which is the intended behavior.
test("full ISO timestamp formats to a medium date", () => {
  expect(formatDate("2026-06-20T15:00:00Z")).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
});
