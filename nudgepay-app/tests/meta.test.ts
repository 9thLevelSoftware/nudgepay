import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PAGE_DESCRIPTION, pageTitle } from "../app/lib/meta";

const description = { name: "description", content: PAGE_DESCRIPTION };

test("pageTitle with a section returns the qualified title and description", () => {
  expect(pageTitle("Log in")).toEqual([{ title: "Log in · NudgePay" }, description]);
});

test("pageTitle with no section falls back to the bare brand and description", () => {
  expect(pageTitle()).toEqual([{ title: "NudgePay" }, description]);
  expect(pageTitle(undefined)).toEqual([{ title: "NudgePay" }, description]);
});

test("pageTitle includes a site description", () => {
  const result = pageTitle("Settings");
  expect(Array.isArray(result)).toBe(true);
  expect(result).toHaveLength(2);
  expect(result[0]).toEqual({ title: "Settings · NudgePay" });
  expect(result[1]).toEqual(description);
  expect(PAGE_DESCRIPTION).toBe("NudgePay is collections software for trades and small businesses.");
});

const robots = readFileSync(fileURLToPath(new URL("../public/robots.txt", import.meta.url)), "utf8");

test("robots.txt allows public pages and disallows authenticated app paths", () => {
  expect(robots).toMatch(/^User-agent: \*$/m);
  expect(robots).toMatch(/^Allow: \/$/m);
  for (const path of ["/privacy", "/eula", "/login", "/signup"]) {
    expect(robots).toContain(`Allow: ${path}`);
  }
  for (const path of ["/dashboard", "/settings", "/accounts", "/focus", "/api/", "/webhooks/"]) {
    expect(robots).toContain(`Disallow: ${path}`);
  }
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

test("home meta includes Open Graph title and description", async () => {
  const mod = await import("../app/routes/home");
  const tags = (mod.meta as () => Array<Record<string, string>>)();
  expect(tags).toContainEqual({ property: "og:title", content: "NudgePay" });
  expect(tags).toContainEqual({ property: "og:description", content: PAGE_DESCRIPTION });
});
