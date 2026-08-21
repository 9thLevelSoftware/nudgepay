import { expect, test } from "vitest";
import { shouldSkipBrokenPromiseSend } from "../app/lib/alert-retry";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("only a successful ledger row skips the next send", () => {
  expect(shouldSkipBrokenPromiseSend(0)).toBe(false);
  expect(shouldSkipBrokenPromiseSend(1)).toBe(true);
});

test("hourly digest retries unsent broken-promise alerts", () => {
  const src = readFileSync(fileURLToPath(new URL("../app/lib/digest-cron.server.ts", import.meta.url)), "utf8");
  expect(src).toContain("retryUnsentBrokenPromiseAlerts");
  const notify = readFileSync(fileURLToPath(new URL("../app/lib/notifications.server.ts", import.meta.url)), "utf8");
  expect(notify).toContain("shouldSkipBrokenPromiseSend");
  expect(notify).toContain("retryUnsentBrokenPromiseAlerts");
});
