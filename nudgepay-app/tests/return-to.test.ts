import { expect, test } from "vitest";
import { safeReturnTo } from "../app/lib/return-to";

test("accepts an app-relative path with query", () => {
  expect(safeReturnTo("/dashboard?invoice=i1&tab=messages")).toBe("/dashboard?invoice=i1&tab=messages");
});

test("rejects protocol-relative //host", () => {
  expect(safeReturnTo("//evil.test/x")).toBe("/dashboard");
});

test("rejects an absolute external URL", () => {
  expect(safeReturnTo("https://evil.test")).toBe("/dashboard");
});

test("rejects a query-only string (must be a path)", () => {
  expect(safeReturnTo("?invoice=i1")).toBe("/dashboard");
});

test("rejects null and non-string", () => {
  expect(safeReturnTo(null)).toBe("/dashboard");
});

test("honors a custom fallback", () => {
  expect(safeReturnTo("nope", "/onboarding")).toBe("/onboarding");
});
