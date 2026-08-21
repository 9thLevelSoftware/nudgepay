import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { reportsNavLabel } from "../app/components/AppShell";

test("reportsNavLabel is Reports for owners", () => {
  expect(reportsNavLabel(true)).toBe("Reports");
});

test("reportsNavLabel is Owner only for members", () => {
  expect(reportsNavLabel(false)).toBe("Reports (Owner only)");
  expect(reportsNavLabel(false)).not.toMatch(/coming soon/i);
});

test("mobile drawer includes Focus without adding a sixth activeNav", () => {
  const src = readFileSync(new URL("../app/components/AppShell.tsx", import.meta.url), "utf8");
  expect(src).toContain('to="/focus"');
  expect(src).toContain("md:hidden");
  expect(src).toMatch(/className="relative w-full md:hidden"[\s\S]*to="\/focus"/);
  expect(src).toContain('aria-label="Focus mode"');
  expect(src).toContain('activeNav?: "collections" | "accounts" | "promises" | "messages" | "reports" | "settings"');
  expect(src).not.toMatch(/activeNav\?: "[^"]*focus[^"]*"/);
  const navItems = src.match(/const NAV_ITEMS: NavItem\[] = \[([\s\S]*?)\];/)?.[1] ?? "";
  expect(navItems.toLowerCase()).not.toContain("focus");
});
