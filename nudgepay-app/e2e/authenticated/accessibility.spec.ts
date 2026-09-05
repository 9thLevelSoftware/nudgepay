import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { captureEvidence, expect, signIn, test } from "./fixtures";
import { E2E_IDS, E2E_LABELS } from "./seed-data";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

type AxeViolation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number];

function summarizeViolation(violation: AxeViolation): string {
  const nodes = violation.nodes.slice(0, 5);
  const targets = nodes
    .flatMap((node) => node.target.map((target) => String(target)))
    .slice(0, 5)
    .join(", ");
  const details = nodes
    .map((node) => node.failureSummary?.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" | ");
  return `${violation.impact ?? "unknown"}: ${violation.id} — ${violation.help} (${targets})${details ? ` — ${details}` : ""}`;
}

async function auditPage(page: Page, surface: string): Promise<string[]> {
  // Theme changes transition foregrounds and backgrounds. Audit their settled
  // rendered state instead of sampling mismatched intermediate colors.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) =>
    (animation.playState === "running" || animation.pending) &&
    Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
  ).length)).toBe(0);
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();
  return results.violations.map((violation) => `${surface}: ${summarizeViolation(violation)}`);
}

test("@auth WCAG A and AA audit covers the dashboard, settings, and selected account", async ({ page }, testInfo) => {
  test.skip(
    !["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name),
    "The bounded accessibility audit runs at desktop and mobile widths.",
  );

  await signIn(page, "owner");
  const violations = await auditPage(page, "Dashboard");

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  violations.push(...await auditPage(page, "Settings"));

  const query = new URLSearchParams({
    q: E2E_LABELS.mutationCustomer,
    customerId: E2E_IDS.mutationCustomer,
  });
  await page.goto(`/accounts?${query}`);
  await expect(page.getByRole("heading", { name: E2E_LABELS.mutationCustomer })).toBeVisible();
  if (testInfo.project.name === "chromium-mobile") {
    await expect(page.getByRole("dialog", { name: new RegExp(`Account.*${E2E_LABELS.mutationCustomer}`) })).toBeVisible();
  }
  violations.push(...await auditPage(page, "Selected account"));

  await page.goto("/dashboard");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  await expect(page.locator("#account-menu")).toHaveCount(0);
  violations.push(...await auditPage(page, "Dark dashboard"));
  await captureEvidence(page, testInfo, `${testInfo.project.name}-dark-dashboard`);

  await page.goto("/settings");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  violations.push(...await auditPage(page, "Dark settings"));

  await page.goto(`/accounts?${query}`);
  await expect(page.getByRole("heading", { name: E2E_LABELS.mutationCustomer })).toBeVisible();
  if (testInfo.project.name === "chromium-mobile") {
    await expect(page.getByRole("dialog", { name: new RegExp(`Account.*${E2E_LABELS.mutationCustomer}`) })).toBeVisible();
  }
  violations.push(...await auditPage(page, "Dark selected account"));
  await captureEvidence(page, testInfo, `${testInfo.project.name}-dark-selected-account`);

  expect(violations, "Authenticated surfaces have automated WCAG A/AA violations").toEqual([]);
});
