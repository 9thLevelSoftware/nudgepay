import { captureEvidence, expect, signIn, test } from "./fixtures";
import { E2E_LABELS } from "./seed-data";

async function useMainNavigation(page: Parameters<typeof signIn>[0], label: string, width: number): Promise<void> {
  if (width < 768) await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: label }).click();
}

test("@auth owner signs in through the real form and navigates core workspaces", async ({ page }, testInfo) => {
  await signIn(page, "owner");
  const width = testInfo.project.use.viewport?.width ?? 1440;
  await expect(page.getByRole("main")).not.toBeEmpty();
  await expect(page.locator("vite-error-overlay, react-router-error-boundary")).toHaveCount(0);
  await captureEvidence(page, testInfo, `${testInfo.project.name}-dashboard`);

  await useMainNavigation(page, "Accounts", width);
  await expect(page).toHaveURL(/\/accounts/);
  await expect(page.getByText(E2E_LABELS.mutationCustomer, { exact: true }).filter({ visible: true })).toBeVisible();

  await useMainNavigation(page, "Promises", width);
  await expect(page).toHaveURL(/\/promises/);
  await page.getByLabel("Promises summary metrics").getByRole("link", { name: /^Active/ }).click();
  await expect(page.getByText(E2E_LABELS.promiseCustomer, { exact: true }).filter({ visible: true })).toBeVisible();

  await useMainNavigation(page, "Messages", width);
  await expect(page).toHaveURL(/\/messages/);
  await page.getByLabel("Messages summary metrics").getByRole("link", { name: /^Active threads/ }).click();
  await expect(page.getByText(E2E_LABELS.messageCustomer, { exact: true }).filter({ visible: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await captureEvidence(page, testInfo, `${testInfo.project.name}-settings`);
});

test("@auth seeded ledgers render without contacting real providers", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto(`/messages?tab=active&q=${encodeURIComponent(E2E_LABELS.messageCustomer)}`);
  const customer = page.getByRole("link", { name: new RegExp(`^${E2E_LABELS.messageCustomer} Email`) });
  await expect(customer).toBeVisible();
  await customer.click();
  await expect(page.getByRole("region", { name: "Message history" })).toContainText("Synthetic");
  await expect(page.getByText(/(?:Email|Text messaging) is turned off for this workspace/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Send (?:email|text)/i })).toBeDisabled();
});
