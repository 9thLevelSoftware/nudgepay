import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { retentionCutoffIso } from "../app/lib/retention-cron.server";

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

const workerSrc = readFileSync(fileURLToPath(new URL("../workers/app.ts", import.meta.url)), "utf8");

test("hourly scheduled branch waitUntils digest and retention", () => {
  expect(workerSrc).toContain('import { runScheduledRetention } from "../app/lib/retention-cron.server"');
  const hourly = workerSrc.slice(
    workerSrc.indexOf('cron === "0 * * * *"'),
    workerSrc.indexOf("} else {"),
  );
  expect(hourly).toContain("runScheduledDigest");
  expect(hourly).toContain("runScheduledRetention");
  expect(hourly.match(/ctx\.waitUntil/g)?.length).toBe(2);
});
