import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { reportsNavLabel } from "../app/components/AppShell";

test("reportsNavLabel is Reports for owners", () => {
  expect(reportsNavLabel(true)).toBe("Reports");
});

test("reportsNavLabel is Admin only for members", () => {
  expect(reportsNavLabel(false)).toBe("Reports (Admin only)");
  expect(reportsNavLabel(false)).not.toMatch(/coming soon/i);
});

test("account menu includes Support next to Settings", () => {
  const src = readFileSync(new URL("../app/components/AppShell.tsx", import.meta.url), "utf8");
  const settings = src.indexOf("Settings");
  const support = src.indexOf("Support");
  expect(settings).toBeGreaterThan(-1);
  expect(support).toBeGreaterThan(settings);
  expect(src).toContain("SUPPORT_MAILTO");
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
