import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { AppShell, reportsNavLabel } from "../app/components/AppShell";

test("server renders the current route, organization, and user markers on main", () => {
  const shell = createElement(AppShell, {
    orgName: "Pilot workspace",
    orgId: "a4f2fdb8-02e8-4f29-9cd9-3a4c0b8b70d7",
    userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    qualificationRoute: "/messages",
    qualificationReady: true,
    userInitials: "PU",
    syncLabel: "Connected",
    connected: true,
    isOwner: false,
    children: "Messages",
  });
  const router = createMemoryRouter([{ path: "*", element: shell }], { initialEntries: ["/wrong-route"] });
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));

  expect(html).toContain('id="main-content" data-org-id="a4f2fdb8-02e8-4f29-9cd9-3a4c0b8b70d7" data-user-id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" data-route-path="/messages"');
  expect(html).toContain('data-load-complete="true"');
});

test("does not render a qualification completion marker for an errored route", () => {
  const shell = createElement(AppShell, { orgName: "Pilot workspace", orgId: "a4f2fdb8-02e8-4f29-9cd9-3a4c0b8b70d7", userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", qualificationRoute: "/messages", qualificationReady: false, userInitials: "PU", syncLabel: "Connected", connected: true, isOwner: false, children: "Could not load inbox" });
  const router = createMemoryRouter([{ path: "*", element: shell }], { initialEntries: ["/messages"] });
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));

  expect(html).not.toContain('data-load-complete="true"');
});

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

test("section navigation prefetches loaders on hover", () => {
  const src = readFileSync(new URL("../app/components/AppShell.tsx", import.meta.url), "utf8");
  expect(src).toContain('const NAV_PREFETCH = "intent"');
  expect(src).toMatch(/to="\/dashboard"[\s\S]*prefetch=\{NAV_PREFETCH\}/);
  expect(src).toMatch(/to="\/settings"[\s\S]*prefetch=\{NAV_PREFETCH\}/);
  expect(src).toMatch(/to="\/focus"[\s\S]*prefetch=\{NAV_PREFETCH\}/);
  expect(src).toContain("prefetch={NAV_PREFETCH}");
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
