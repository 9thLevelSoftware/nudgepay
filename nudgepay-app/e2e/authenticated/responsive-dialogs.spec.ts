import { captureEvidence, expect, signIn, test } from "./fixtures";
import { E2E_IDS, E2E_LABELS } from "./seed-data";

test("@auth account selection uses a desktop rail or responsive drawer", async ({ page }, testInfo) => {
  await signIn(page, "owner");
  const width = testInfo.project.use.viewport?.width ?? 1440;
  // External links commonly encode spaces as %20. Keep this form so SSR and
  // client hydration exercise the representation that previously diverged.
  const externalQuery = `q=${encodeURIComponent(E2E_LABELS.mutationCustomer)}`;
  await page.goto(`/accounts?${externalQuery}`);
  await expect(page.getByLabel("Accounts summary metrics")).toContainText("matching accounts");
  const accountLink = page.getByRole("link", { name: new RegExp(E2E_LABELS.mutationCustomer) }).first();
  await accountLink.click();

  if (width >= 1024) {
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: E2E_LABELS.mutationCustomer })).toBeVisible();
    await expect(page.locator("body > [inert]")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Open full profile/ })).toBeVisible();
  } else {
    const drawer = page.getByRole("dialog", { name: new RegExp(`Account.*${E2E_LABELS.mutationCustomer}`) });
    await expect(drawer).toBeVisible();
    expect(await page.locator("body > [inert]").count()).toBeGreaterThan(0);
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await captureEvidence(page, testInfo, `${testInfo.project.name}-selected-account-drawer`);
    await drawer.getByRole("link", { name: new RegExp(`Close Account.*${E2E_LABELS.mutationCustomer}`) }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page.locator("body > [inert]")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    await expect(accountLink).toBeFocused();

    await page.goto(`/accounts?${externalQuery}&customerId=${E2E_IDS.mutationCustomer}`);
    const directDrawer = page.getByRole("dialog", { name: new RegExp(`Account.*${E2E_LABELS.mutationCustomer}`) });
    await expect(directDrawer).toBeVisible();
    await expect(page.locator("body > [inert]")).not.toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(directDrawer).toHaveCount(0);
    await expect(page.getByRole("main")).toBeFocused();
  }
  if (width >= 1024) await captureEvidence(page, testInfo, `${testInfo.project.name}-account-selection`);
});

test("@auth command palette locks and restores the document", async ({ page }, testInfo) => {
  await signIn(page, "owner");
  await page.getByRole("button", { name: /Account menu/ }).click();
  const menu = page.locator("#account-menu");
  const trigger = menu.getByRole("link", { name: "Settings" });
  await trigger.focus();
  await page.keyboard.press("Control+k");

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(palette.getByPlaceholder("Search pages and actions…")).toBeFocused();
  await expect(page.locator("body > [inert]")).not.toHaveCount(0);
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(page.locator("body > [inert]")).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await expect(menu).toBeVisible();
  await expect(trigger).toBeFocused();
});

test("@auth browser history preserves an externally encoded account selection", async ({ page }) => {
  await signIn(page, "owner");
  const externalQuery = `q=${encodeURIComponent(E2E_LABELS.mutationCustomer)}`;
  await page.goto(`/accounts?${externalQuery}`);
  await page.getByRole("link", { name: new RegExp(E2E_LABELS.mutationCustomer) }).first().click();
  await expect(page).toHaveURL(new RegExp(`customerId=${E2E_IDS.mutationCustomer}`));
  const selectedAccount = page.getByRole("heading", { name: E2E_LABELS.mutationCustomer });
  await expect(selectedAccount).toBeVisible();

  await page.goBack();
  await expect(page).not.toHaveURL(/customerId=/);
  await expect(selectedAccount).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`customerId=${E2E_IDS.mutationCustomer}`));
  await expect(selectedAccount).toBeVisible();
});

test("@auth theme choice applies immediately and survives navigation", async ({ page }, testInfo) => {
  await signIn(page, "owner");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/accounts");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("@auth reduced motion and 200% content zoom retain keyboard access", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Accessibility environment coverage runs once.");
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await signIn(page, "owner");
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const collections = page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Collections" });
  await collections.focus();
  await expect(collections).toBeFocused();
  expect(await collections.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("main")).toBeVisible();
});
