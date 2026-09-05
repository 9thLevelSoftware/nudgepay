import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BILLING_ATTEMPT_RETENTION_DAYS,
  PROVIDER_RECONCILIATION_RETENTION_DAYS,
  STRIPE_WEBHOOK_RETENTION_DAYS,
  retentionCutoffIso,
} from "../app/lib/retention-cron.server";

test("retentionCutoffIso subtracts whole days from an instant", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  expect(retentionCutoffIso(now, 90)).toBe("2026-05-22T12:00:00.000Z");
  expect(retentionCutoffIso(now, 1)).toBe("2026-08-19T12:00:00.000Z");
  expect(retentionCutoffIso(now, 0)).toBe("2026-08-20T12:00:00.000Z");
});

test("retentionCutoffIso does not mutate the input date", () => {
  const now = new Date("2026-01-15T00:00:00.000Z");
  retentionCutoffIso(now, 90);
  expect(now.toISOString()).toBe("2026-01-15T00:00:00.000Z");
});

test("durable provider receipts have bounded retention while active attempts are excluded", () => {
  expect(STRIPE_WEBHOOK_RETENTION_DAYS).toBe(90);
  expect(BILLING_ATTEMPT_RETENTION_DAYS).toBe(90);
  expect(PROVIDER_RECONCILIATION_RETENTION_DAYS).toBe(90);
  const src = readFileSync(fileURLToPath(new URL("../app/lib/retention-cron.server.ts", import.meta.url)), "utf8");
  expect(src).toContain('.in("state", ["failed", "completed"])');
  expect(src).not.toMatch(/\.in\("state", \[[^\]]*(?:reserved|ready|unknown)/);
});

const workerSrc = readFileSync(fileURLToPath(new URL("../workers/app.ts", import.meta.url)), "utf8");

test("hourly scheduled branch runs only digest and retention", () => {
  expect(workerSrc).toContain('import { runScheduledRetention } from "../app/lib/retention-cron.server"');
  const hourly = workerSrc.slice(
    workerSrc.indexOf('cron === "0 * * * *"'),
    workerSrc.indexOf('} else if (cron === "*/5 * * * *")'),
  );
  expect(hourly).toContain("runScheduledDigest");
  expect(hourly).toContain("runScheduledRetention");
  expect(hourly).not.toContain("runScheduledProviderMonitor");
  expect(hourly.match(/ctx\.waitUntil/g)?.length).toBe(2);
});
