import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadLocalE2EEnv } from "./local-env";

const port = 5173;
const baseURL = `http://127.0.0.1:${port}`;
const localEnv = loadLocalE2EEnv();

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "github" : "list",
  outputDir: join(tmpdir(), "nudgepay-playwright", "authenticated"),
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "firefox-desktop", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } } },
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
    { name: "chromium-tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 } } },
    { name: "chromium-mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${baseURL}/healthz`,
    env: { ...process.env, ...localEnv },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
