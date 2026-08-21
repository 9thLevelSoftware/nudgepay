import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACCOUNTS_DENSITY_IDS,
  DENSITY_IDS,
  DENSITY_STORAGE_KEY,
  VALID_SORTS,
  accountsSearchParams,
  dashboardHref,
  dashboardSearchParams,
  parseAccountsDensity,
  parseDensity,
  parseEntityMode,
  parseSort,
} from "../app/lib/queue-chrome";

test("parseDensity accepts general/detailed/risk and falls back to general", () => {
  expect(parseDensity("general")).toBe("general");
  expect(parseDensity("detailed")).toBe("detailed");
  expect(parseDensity("risk")).toBe("risk");
  expect(parseDensity(null)).toBe("general");
  expect(parseDensity(undefined)).toBe("general");
  expect(parseDensity("nope")).toBe("general");
});

test("parseAccountsDensity maps detailed to general so Accounts never carries Detailed", () => {
  expect(parseAccountsDensity("risk")).toBe("risk");
  expect(parseAccountsDensity("detailed")).toBe("general");
  expect(parseAccountsDensity("general")).toBe("general");
  expect(parseAccountsDensity(null)).toBe("general");
});

test("parseSort accepts due-date and parseEntityMode defaults to customers", () => {
  expect(VALID_SORTS).toEqual(["recommended", "most-overdue", "highest-balance", "customer", "due-date"]);
  expect(parseSort("highest-balance")).toBe("highest-balance");
  expect(parseSort("due-date")).toBe("due-date");
  expect(parseSort(null)).toBe("recommended");
  expect(parseEntityMode("invoices")).toBe("invoices");
  expect(parseEntityMode("customers")).toBe("customers");
  expect(parseEntityMode(null)).toBe("customers");
});

test("dashboardSearchParams always emits density when set, including general", () => {
  expect(dashboardSearchParams({
    view: "all-open", sort: "recommended", density: "general",
  }).toString()).toBe("view=all-open&sort=recommended&density=general");
  expect(dashboardSearchParams({
    view: "30-plus", sort: "customer", q: "acme", density: "risk", case: "c1",
    tab: "messages", invoice: "inv-1",
  }).toString()).toBe("view=30-plus&sort=customer&q=acme&density=risk&case=c1&invoice=inv-1&tab=messages");
});

test("dashboardSearchParams omits default entity and emits entity=invoices", () => {
  expect(dashboardSearchParams({
    view: "all-open", sort: "recommended", entity: "customers",
  }).toString()).toBe("view=all-open&sort=recommended");
  expect(dashboardSearchParams({
    view: "all-open", sort: "due-date", entity: "invoices", density: "general",
  }).toString()).toBe("view=all-open&sort=due-date&entity=invoices&density=general");
});

test("dashboardSearchParams omits density only when undefined", () => {
  expect(dashboardSearchParams({
    view: "all-open", sort: "recommended",
  }).toString()).toBe("view=all-open&sort=recommended");
  expect(dashboardHref({ view: "all-open", sort: "recommended" })).toBe("?view=all-open&sort=recommended");
});

test("clicking General cannot look like a missing param", () => {
  const afterGeneral = dashboardSearchParams({
    view: "all-open", sort: "recommended", density: "general",
  });
  expect(afterGeneral.get("density")).toBe("general");
  expect(afterGeneral.has("density")).toBe(true);
});

test("accountsSearchParams preserves density on tabs and row links", () => {
  expect(accountsSearchParams({
    filter: "all", sort: "name", density: "risk", customerId: "c1",
  }).toString()).toBe("filter=all&sort=name&density=risk&customerId=c1");
  expect(accountsSearchParams({
    filter: "open-balance", sort: "balance", q: "acme", density: "general",
  }).toString()).toBe("filter=open-balance&sort=balance&q=acme&density=general");
});

test("accounts density control is General | Risk only", () => {
  expect(DENSITY_IDS).toEqual(["general", "detailed", "risk"]);
  expect(ACCOUNTS_DENSITY_IDS).toEqual(["general", "risk"]);
  expect(DENSITY_STORAGE_KEY).toBe("np.queue.density");
  const src = readFileSync(new URL("../app/components/AccountsDirectory.tsx", import.meta.url), "utf8");
  expect(src).toContain("ACCOUNTS_DENSITY_IDS");
  expect(src).toContain("General");
  expect(src).toContain("Risk");
  expect(src).toContain("aria-pressed");
  expect(src).not.toContain('role="tablist"');
});

test("WorkQueue density Links sit outside the GET form and hide view+entity+density only", () => {
  const src = readFileSync(new URL("../app/components/WorkQueue.tsx", import.meta.url), "utf8");
  expect(src).toContain("persistDensity(id)");
  expect(src).toContain('<input type="hidden" name="view" value={view} />');
  expect(src).toContain('name="entity" value={entity}');
  expect(src).toContain('name="density" value={hrefDensity}');
  expect(src).not.toMatch(/<input type="hidden" name="sort"/);
  expect(src).toContain("value={sortSelectValue}");
  expect(src).toContain("case: selectedCaseId, tab, invoice");
  const entityBeforeForm = src.indexOf("aria-label=\"Queue entity\"");
  const densityBeforeForm = src.indexOf("aria-label=\"Queue density\"");
  const formAt = src.indexOf('<Form method="get"');
  expect(entityBeforeForm).toBeGreaterThan(-1);
  expect(densityBeforeForm).toBeGreaterThan(-1);
  expect(formAt).toBeGreaterThan(densityBeforeForm);
  expect(formAt).toBeGreaterThan(entityBeforeForm);
});

test("queue consumers build hrefs through dashboardSearchParams, not ad-hoc view/sort/q", () => {
  const files = [
    "../app/components/WorkQueue.tsx",
    "../app/components/KpiBand.tsx",
    "../app/components/TriageStrip.tsx",
    "../app/components/DetailPanel.tsx",
  ];
  for (const rel of files) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    expect(src, rel).toContain("dashboardHref");
    expect(src, rel).not.toMatch(/new URLSearchParams\(\{\s*view,\s*sort/);
  }
});
