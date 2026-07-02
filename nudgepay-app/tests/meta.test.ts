import { expect, test } from "vitest";
import { pageTitle } from "../app/lib/meta";

test("pageTitle with a section returns the qualified title", () => {
  expect(pageTitle("Log in")).toEqual([{ title: "Log in · NudgePay" }]);
});

test("pageTitle with no section falls back to the bare brand", () => {
  expect(pageTitle()).toEqual([{ title: "NudgePay" }]);
  expect(pageTitle(undefined)).toEqual([{ title: "NudgePay" }]);
});

test("pageTitle returns a single-entry meta descriptor array", () => {
  const result = pageTitle("Settings");
  expect(Array.isArray(result)).toBe(true);
  expect(result).toHaveLength(1);
  expect(result[0]).toHaveProperty("title");
});

// Every user-facing route must export a `meta` function so the document title
// is always set (F-008). This is a static import check — it does not invoke
// loaders — so it's safe to run without seeding the database or Cloudflare env.
const routeModules = {
  root: () => import("../app/root"),
  home: () => import("../app/routes/home"),
  login: () => import("../app/routes/login"),
  signup: () => import("../app/routes/signup"),
  onboarding: () => import("../app/routes/onboarding"),
  invite: () => import("../app/routes/invite"),
  "accept.$token": () => import("../app/routes/accept.$token"),
  dashboard: () => import("../app/routes/dashboard"),
  accounts: () => import("../app/routes/accounts"),
  "accounts.$id": () => import("../app/routes/accounts.$id"),
  promises: () => import("../app/routes/promises"),
  messages: () => import("../app/routes/messages"),
  reports: () => import("../app/routes/reports"),
  settings: () => import("../app/routes/settings"),
  privacy: () => import("../app/routes/privacy"),
  eula: () => import("../app/routes/eula"),
  unsubscribe: () => import("../app/routes/unsubscribe"),
};

for (const [name, load] of Object.entries(routeModules)) {
  test(`${name} exports a meta function`, async () => {
    const mod = await load();
    expect(typeof mod.meta).toBe("function");
  });
}
