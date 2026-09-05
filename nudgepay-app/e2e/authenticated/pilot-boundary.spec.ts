import { existsSync, readFileSync } from "node:fs";
import { captureEvidence, expect, test } from "./fixtures";

type PilotCredentials = {
  target: string;
  users: Array<{ email: string; password: string; role: string; workspace?: string }>;
};

const pilotWorkspace = process.env.PILOT_BOUNDARY_WORKSPACE ?? "pilot-workspace-03";
const workspaceMatch = /^pilot-workspace-(\d{2})$/.exec(pilotWorkspace);
if (!workspaceMatch) throw new Error("PILOT_BOUNDARY_WORKSPACE must be a pilot-workspace-## label.");
const pilotWorkspaceNumber = Number(workspaceMatch[1]);

function localPilotOwner(): { email: string; password: string } | null {
  const path = process.env.PILOT_BOUNDARY_CREDENTIALS_FILE;
  if (!path || !existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as PilotCredentials;
  const owner = parsed.users?.find((user) => user.role === "owner" && user.workspace === pilotWorkspace);
  if (!owner || typeof owner.email !== "string" || typeof owner.password !== "string") {
    throw new Error(`PILOT_BOUNDARY_CREDENTIALS_FILE does not contain a local pilot owner for ${pilotWorkspace}.`);
  }
  if (parsed.target !== "http://127.0.0.1:54321/") {
    throw new Error("PILOT_BOUNDARY_CREDENTIALS_FILE must target the local Supabase API.");
  }
  return owner;
}

const pilotOwner = localPilotOwner();
const truncationCopy = "This list is incomplete (over 5,000 rows). Totals may under-count.";
const rowCount = process.env.PILOT_BOUNDARY_ROW_COUNT ?? "5001";
if (!/^(4999|5000|5001)$/.test(rowCount)) throw new Error("PILOT_BOUNDARY_ROW_COUNT must be 4999, 5000, or 5001.");
const expectsTruncation = Number(rowCount) > 5000;

test.describe("pilot list boundary", () => {
  test.skip(!pilotOwner, "Set PILOT_BOUNDARY_CREDENTIALS_FILE to a local-only fixture credential artifact.");

  test("renders honest truncation states through the real login and route loaders", async ({ page }, testInfo) => {
    await page.context().setExtraHTTPHeaders({ "CF-Connecting-IP": "198.51.100.251" });
    await page.goto("/login");
    await page.getByLabel("Email").fill(pilotOwner!.email);
    await page.getByLabel("Password").fill(pilotOwner!.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);

    for (const [path, renderedCustomer] of [["/accounts", `Pilot Customer ${pilotWorkspaceNumber}-0001`], ["/messages", `Pilot Customer ${pilotWorkspaceNumber}-0005`]] as const) {
      await page.goto(path);
      const truncation = page.locator('[role="status"]').filter({ hasText: truncationCopy });
      if (expectsTruncation) await expect(truncation).toBeVisible();
      else await expect(truncation).toHaveCount(0);
      await expect(page.locator("#main-content")).toContainText(/Accounts|Messages/);
      await expect(page.locator("#main-content")).toContainText(renderedCustomer);
      await captureEvidence(page, testInfo, `pilot-${rowCount}-${path.slice(1)}-${expectsTruncation ? "truncated" : "complete"}`);
    }
  });
});
