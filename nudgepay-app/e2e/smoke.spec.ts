import { expect, test } from "@playwright/test";

test("healthz reports process liveness", async ({ request }) => {
  const res = await request.get("/healthz");
  expect(res.ok()).toBeTruthy();
  await expect(res.json()).resolves.toEqual({ ok: true });
});

test("login page renders the sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /log in to nudgepay/i })).toBeVisible();
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /log in/i })).toBeVisible();
});

test("signup page is reachable from login", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: /^sign up$/i }).click();
  await expect(page).toHaveURL(/\/signup/);
  await expect(page.locator('input[name="email"]')).toBeVisible();
});

test("login password field allows password-manager autocomplete", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('input[name="password"]')).toHaveAttribute("autocomplete", "current-password");
  await expect(page.locator('input[name="email"]')).toHaveAttribute("autocomplete", "email");
});

test("login footer Support link uses the operator mailbox", async ({ page }) => {
  await page.goto("/login");
  const support = page.getByRole("link", { name: "Support" });
  await expect(support).toBeVisible();
  await expect(support).toHaveAttribute("href", "mailto:support@nudgepay-ar.app");
});

test("login skip link moves focus to main", async ({ page }) => {
  await page.goto("/login");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await skip.focus();
  await expect(skip).toBeVisible();
  await skip.click();
  await expect(page.locator("#main-content")).toBeFocused();
});

test("unknown public route renders the styled not-found boundary", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible();
});
