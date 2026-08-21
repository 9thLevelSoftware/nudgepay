import { expect, test } from "vitest";
import { assertNotTruncated, isTruncatedPage, POSTGREST_MAX_ROWS } from "../app/lib/page-all";

test("isTruncatedPage is true when returned rows are fewer than exact count", () => {
  expect(isTruncatedPage(1000, 1001)).toBe(true);
  expect(isTruncatedPage(0, 1)).toBe(true);
});

test("isTruncatedPage is false when the page is complete or count is unknown", () => {
  expect(isTruncatedPage(10, 10)).toBe(false);
  expect(isTruncatedPage(0, 0)).toBe(false);
  expect(isTruncatedPage(1000, 1000)).toBe(false);
  expect(isTruncatedPage(1000, null)).toBe(false);
  expect(isTruncatedPage(1000, undefined)).toBe(false);
});

test("assertNotTruncated throws a labeled error only when truncated", () => {
  expect(() => assertNotTruncated(1000, 1001, "invoices")).toThrow(/invoices truncated/);
  expect(() => assertNotTruncated(3, 3, "cases")).not.toThrow();
});

test("POSTGREST_MAX_ROWS documents the default cap", () => {
  expect(POSTGREST_MAX_ROWS).toBe(1000);
});
