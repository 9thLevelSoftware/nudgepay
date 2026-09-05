import { expect, test } from "vitest";
import { DEFAULT_DATASET_SIZES, MAX_DATASET_SIZE, PILOT_FIXTURE_PREFIX, assertLocalPilotUrl, assertPilotPlan, buildPilotPlan, fixtureUuid, parseDatasetSize, parseSessionCount, planTotals } from "../scripts/seed-pilot-load-lib.mjs";

test("builds deterministic 10-org, 50-user fixture plans with exact boundary totals", () => {
  const plan = buildPilotPlan({ invoices: 4_999, cases: 5_000, messages: 5_001 });
  expect(assertPilotPlan(plan)).toEqual({ organizations: 10, users: 50, customers: 50_000, invoices: 49_990, cases: 50_000, messages: 50_010 });
  expect(plan.orgs.every((org) => org.users.length === 5)).toBe(true);
  expect(plan.orgs.map((org) => org.invoices)).toEqual(Array(10).fill(4_999));
  expect(plan.orgs.map((org) => org.messages)).toEqual(Array(10).fill(5_001));
  expect(plan.orgs.every((org) => org.customerCount >= org.invoices && org.customerCount >= org.cases)).toBe(true);
  expect(new Set(plan.orgs.flatMap((org) => org.users.map((user) => user.email))).size).toBe(50);
  expect(fixtureUuid("org:1")).toBe(fixtureUuid("org:1"));
  expect(plan.prefix).toBe(PILOT_FIXTURE_PREFIX);
});

test("uses configurable dataset bounds and session limits", () => {
  expect(planTotals(buildPilotPlan(DEFAULT_DATASET_SIZES)).messages).toBe(50_000);
  expect(parseDatasetSize("5001", "messages", 1)).toBe(MAX_DATASET_SIZE);
  expect(() => parseDatasetSize("4998", "messages", 1)).toThrow(/4999 through/);
  expect(() => parseDatasetSize("5002", "messages", 1)).toThrow(/4999 through/);
  expect(parseSessionCount(undefined)).toBe(0);
  expect(parseSessionCount("50")).toBe(50);
  expect(() => parseSessionCount("51")).toThrow(/1 through 50/);
});

test("refuses every non-exact local Supabase target before fixture writes", () => {
  expect(assertLocalPilotUrl("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321/");
  for (const target of ["https://127.0.0.1:54321", "http://localhost:54321", "http://127.0.0.1:54322", "http://staging.example", "http://127.0.0.1:54321/rest/v1"]) {
    expect(() => assertLocalPilotUrl(target)).toThrow(/Refusing|exact local/);
  }
});
