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
