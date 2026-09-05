import { captureEvidence, expect, signIn, test } from "./fixtures";
import { E2E_IDS, E2E_LABELS } from "./seed-data";
import { readFile } from "node:fs/promises";

test("@auth member is denied admin routes and member-management mutations", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Role mutation coverage runs once against shared seed data.");
  await signIn(page, "member");

  await page.goto("/reports");
  await expect(page).toHaveURL(/\/dashboard\?denied=reports/);
  await expect(page.getByText("Reports are available to workspace owners and admins.")).toBeVisible();

  const response = await page.request.post("/api/members", {
    form: { intent: "invite", email: "denied@nudgepay-e2e.local", returnTo: "/settings?tab=workspace" },
    headers: { Origin: "http://127.0.0.1:5173", Referer: "http://127.0.0.1:5173/settings?tab=workspace" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toContain("error=forbidden");
  await captureEvidence(page, testInfo, "member-reports-denied");
});

test("@auth RLS hides another tenant's customer and rejects an active-org object id", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Cross-tenant mutation coverage runs once against shared seed data.");
  await signIn(page, "owner");

  await page.goto(`/accounts?q=${encodeURIComponent(E2E_LABELS.otherCustomer)}`);
  await expect(page.getByText(E2E_LABELS.otherCustomer, { exact: true })).toHaveCount(0);

  const response = await page.request.post("/api/contact-logs", {
    form: {
      caseId: E2E_IDS.otherCase,
      customerId: E2E_IDS.otherCustomer,
      invoiceId: E2E_IDS.otherInvoice,
      method: "call",
      outcome: "no-answer",
      nextStep: "follow_up",
      followUpAt: "2026-09-15",
      returnTo: "/dashboard",
    },
    headers: { Origin: "http://127.0.0.1:5173", Referer: "http://127.0.0.1:5173/dashboard" },
  });
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ ok: false, error: "missing-case" });
});

test("@auth admin can reach reports and team controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Role matrix runs once; navigation is cross-browser elsewhere.");
  await signIn(page, "admin");
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Team performance" })).toBeVisible();
  await expect(page.getByText("Contacts logged (30d)")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download CSV", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("nudgepay-report-30d.csv");
  const downloadPath = await download.path();
  expect(downloadPath, "report CSV should be available in Playwright's temporary download directory").not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");
  expect(csv).toContain("E2E Admin");
  await page.goto("/settings?tab=workspace");
  await expect(page.getByPlaceholder("teammate@company.com")).toBeVisible();
});
