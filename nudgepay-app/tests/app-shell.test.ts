import { expect, test } from "vitest";
import { reportsNavLabel } from "../app/components/AppShell";

test("reportsNavLabel is Reports for owners", () => {
  expect(reportsNavLabel(true)).toBe("Reports");
});

test("reportsNavLabel is Owner only for members", () => {
  expect(reportsNavLabel(false)).toBe("Reports (Owner only)");
  expect(reportsNavLabel(false)).not.toMatch(/coming soon/i);
});
