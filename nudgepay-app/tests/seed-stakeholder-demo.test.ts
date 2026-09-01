// Guardrails for the production stakeholder seed. Source-only — no I/O.
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

test("stakeholder seed requires DEMO_PASSWORD and does not print a default secret", () => {
  const src = read("../scripts/seed-stakeholder-demo.mjs");
  expect(src).toContain("DEMO_PASSWORD");
  expect(src).toMatch(/if \(!OWNER_PASSWORD\)/);
  expect(src).not.toMatch(/NudgePay-Demo-2026/);
  const printed = src.slice(src.indexOf("console.log"));
  expect(printed).not.toMatch(/password:/);
});

test("stakeholder seed does not write the dropped email_config.provider column", () => {
  const driver = read("../scripts/seed-stakeholder-demo.mjs");
  const shared = read("../scripts/seed-shared.mjs");
  expect(driver).not.toMatch(/provider:\s*"resend"/);
  expect(shared).not.toMatch(/provider:\s*"resend"/);
});

test("stakeholder seed is a thin driver over shared fixtures", () => {
  const driver = read("../scripts/seed-stakeholder-demo.mjs");
  expect(driver).toContain('from "./seed-shared.mjs"');
  expect(driver).toContain("seedDemoWorklist");
  expect(driver).toContain("seedDemoContactLogs");
  expect(driver).toContain("seedDemoEmailMessages");
  expect(driver).not.toContain("Riverside Apartments LLC");
});

test("shared seed pages listUsers until a match or a short page", () => {
  const shared = read("../scripts/seed-shared.mjs");
  expect(shared).toContain("export async function findUserByEmail");
  expect(shared).toMatch(/for \(let page = 1; ; page\+\+\)/);
  expect(shared).toContain("listUsers({ page, perPage })");
  expect(shared).toContain("users.length < perPage");
  expect(shared).not.toMatch(/page <= 50/);
});
