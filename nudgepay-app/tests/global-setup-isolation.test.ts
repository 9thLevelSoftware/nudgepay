import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("local integration setup clears org-less service ledgers that survive organization cascades", () => {
  const setup = readFileSync(fileURLToPath(new URL("../tests/global-setup.ts", import.meta.url)), "utf8");
  expect(setup).toContain("public.inbound_orphans");
  expect(setup).toContain("public.provider_monitor_alert_receipts");
  expect(setup).toContain("assertSafeTestEnv(env)");
});
