import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

test("secret scanning covers the repository and every pull-request commit", () => {
  expect(workflow).toContain('$GITHUB_WORKSPACE:/repo');
  expect(workflow).toContain("fetch-depth: 0");
  expect(workflow).toContain('git . --config nudgepay-app/.gitleaks.toml --log-opts="$BASE_SHA..$HEAD_SHA"');
  expect(workflow).not.toContain('$GITHUB_WORKSPACE/nudgepay-app:/repo');
});

test("authenticated PR smoke and scheduled cross-browser runs retain only local failure evidence", () => {
  expect(workflow).toContain("node e2e/authenticated/run.mjs --project=chromium-desktop");
  expect(workflow).toContain("authenticated-e2e-full:");
  expect(workflow).toContain("npx playwright install --with-deps chromium firefox webkit");
  expect(workflow).toContain("/tmp/nudgepay-playwright/authenticated/**/*.png");
  expect(workflow).toContain("/tmp/NudgePay/e2e-evidence/**/*.png");
  expect(workflow).toContain("!/tmp/nudgepay-playwright/authenticated/**/trace.zip");
  expect(workflow).toContain("!/tmp/nudgepay-playwright/authenticated/**/raw-console*");
  expect(workflow).not.toMatch(/storageState|cookie-file/);
  expect(workflow).toMatch(/actions\/upload-artifact@[0-9a-f]{40}/);
});
