import { captureEvidence, expect, signIn, test } from "./fixtures";
import { E2E_IDS, E2E_LABELS } from "./seed-data";

function futureDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("@auth owner logs a contact with a promise and sees it in the ledger", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "This shared-state mutation runs once.");
  await signIn(page, "owner");
  await page.goto(`/dashboard?case=${E2E_IDS.mutationCase}&invoice=${E2E_IDS.mutationInvoice}&log=1`);

  const drawer = page.getByRole("dialog", { name: "Log a contact" });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Outcome").selectOption("promise-to-pay");
  await drawer.getByLabel("Next step").selectOption("promise");
  await drawer.getByLabel("Promised amount").fill("600");
  await drawer.getByLabel("Promised by").fill(futureDate(10));
  await drawer.getByLabel("Notes").fill("Synthetic E2E call: customer committed to payment.");
  await drawer.getByRole("button", { name: "Save contact" }).click();

  await expect(page.getByRole("status")).toContainText("Contact logged successfully.");
  await expect(drawer).toHaveCount(0);
  await page.goto(`/promises?tab=active&q=${encodeURIComponent(E2E_LABELS.mutationCustomer)}`);
  await expect(page.getByText(E2E_LABELS.mutationCustomer, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$600.00", { exact: true }).first()).toBeVisible();
  await captureEvidence(page, testInfo, "created-promise-ledger");
});
