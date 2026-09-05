import { expect, test as base, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { E2E_PASSWORD, E2E_USERS } from "./seed-data";

export type E2ERole = keyof typeof E2E_USERS;

let syntheticClientSequence = 0;

export async function signIn(page: Page, role: E2ERole): Promise<void> {
  const user = E2E_USERS[role];
  // Wrangler's local rate-limit binding persists for the whole matrix. Give
  // each synthetic browser session its own documentation-range client IP, as
  // separate users would receive at the Cloudflare edge, while still running
  // the real login action and limiter.
  syntheticClientSequence = (syntheticClientSequence % 250) + 1;
  await page.context().setExtraHTTPHeaders({
    "CF-Connecting-IP": `198.51.100.${syntheticClientSequence}`,
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  await expect(page.getByRole("button", { name: new RegExp(`Account menu.*${user.label}`) })).toBeVisible();
}

export async function captureEvidence(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const evidenceDir = join(process.env.LOCALAPPDATA ?? tmpdir(), "NudgePay", "e2e-evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const path = join(evidenceDir, `${name.replace(/[^a-z0-9_.-]+/gi, "-")}.png`);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(name, {
    path,
    contentType: "image/png",
  });
}

export const test = base.extend<{ consoleHealth: void }>({
  consoleHealth: [async ({ page, browserName }, use, testInfo) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      // React Router's development server manifest request is rejected by
      // Playwright WebKit on loopback before the app handles any navigation.
      // Keep this exception exact; every app/runtime console error still fails.
      if (browserName === "webkit" && text === "Failed to fetch manifest patches TypeError: Load failed") return;
      errors.push(`console: ${text}`);
    });
    page.on("pageerror", (error) => {
      if (
        browserName === "webkit" &&
        /^\/127\.0\.0\.1:5173\/__manifest\?.+ due to access control checks\.$/.test(error.message)
      ) return;
      errors.push(`pageerror: ${error.message}`);
    });
    await use();
    if (errors.length > 0) {
      await testInfo.attach("browser-errors", { body: errors.join("\n"), contentType: "text/plain" });
    }
    expect(errors, "authenticated workflow emitted browser errors").toEqual([]);
  }, { auto: true }],
});

export { expect } from "@playwright/test";
