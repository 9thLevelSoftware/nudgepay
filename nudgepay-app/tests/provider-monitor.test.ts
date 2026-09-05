import { describe, expect, it, test, vi } from "vitest";
import {
  PROVIDER_MONITOR_LIMIT,
  PROVIDER_MONITOR_STALE_AFTER_MS,
  isStaleProviderAttempt,
  providerMonitorHourBucket,
  staleProviderCandidates,
} from "../app/lib/provider-monitor";
import { monitorStaleProviderAttempts } from "../app/lib/provider-monitor.server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const NOW = new Date("2026-09-05T12:10:00.000Z");
const STALE_ID = "00000000-0000-4000-8000-000000000001";

describe("provider monitor pure boundaries", () => {
  it("uses the five-minute threshold and removes malformed IDs before alerting", () => {
    expect(isStaleProviderAttempt("2026-09-05T12:05:00.000Z", NOW)).toBe(true);
    expect(isStaleProviderAttempt("2026-09-05T12:05:00.001Z", NOW)).toBe(false);
    expect(PROVIDER_MONITOR_STALE_AFTER_MS).toBe(300_000);
    expect(providerMonitorHourBucket(NOW)).toBe("2026-09-05T12:00:00.000Z");
    expect(staleProviderCandidates([
      { channel: "sms", attemptId: STALE_ID, updatedAt: "2026-09-05T12:04:59.999Z" },
      { channel: "email", attemptId: "customer@example.test", updatedAt: "2026-09-05T12:00:00.000Z" },
    ], NOW)).toEqual([{ channel: "sms", attemptId: STALE_ID, updatedAt: "2026-09-05T12:04:59.999Z" }]);
  });
});

test("every Worker environment schedules the five-minute provider monitor", () => {
  const wrangler = readFileSync(fileURLToPath(new URL("../wrangler.toml", import.meta.url)), "utf8");
  const buildsWrangler = readFileSync(fileURLToPath(new URL("../../wrangler.toml", import.meta.url)), "utf8");
  const worker = readFileSync(fileURLToPath(new URL("../workers/app.ts", import.meta.url)), "utf8");
  expect(wrangler.match(/crons = \["\*\/5 \* \* \* \*", "\*\/30 \* \* \* \*", "0 \* \* \* \*"\]/g)).toHaveLength(3);
  expect(buildsWrangler).toContain('crons = ["*/5 * * * *", "*/30 * * * *", "0 * * * *"]');
  expect(worker).toMatch(/cron === "\*\/5 \* \* \* \*"[\s\S]*runScheduledProviderMonitor/);
});

it("dedupes an unclaimed attempt and never marks a failed operator post as sent", async () => {
  const claim = vi.fn(async () => true);
  const complete = vi.fn(async () => undefined);
  const post = vi.fn(async () => false);
  const log = vi.fn();
  await expect(monitorStaleProviderAttempts({
    findCandidates: async () => ({ candidates: [
      { channel: "sms", attemptId: STALE_ID, updatedAt: "2026-09-05T12:00:00.000Z" },
      { channel: "email", attemptId: "00000000-0000-4000-8000-000000000002", updatedAt: "2026-09-05T12:00:00.000Z" },
    ], truncated: false }),
    claim: async (candidate, ...rest) => candidate.channel === "sms" ? false : claim(candidate, ...rest),
    complete,
    post,
    purge: async () => undefined,
    log,
  }, NOW)).resolves.toEqual({ candidates: 2, truncated: false, purgeFailed: false, claimed: 1, sent: 0, postFailed: 1 });
  expect(post).toHaveBeenCalledOnce();
  expect(complete).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "provider_monitor_complete", postFailed: 1 }));
});

it("still posts critical alerts when best-effort receipt retention fails", async () => {
  const post = vi.fn(async () => true);
  const log = vi.fn();
  await expect(monitorStaleProviderAttempts({
    findCandidates: async () => ({ candidates: [{ channel: "sms", attemptId: STALE_ID, updatedAt: "2026-09-05T12:00:00.000Z" }], truncated: false }),
    claim: async () => true,
    complete: async () => undefined,
    post,
    purge: async () => { throw new Error("receipt delete customer@example.test token=secret"); },
    log,
  }, NOW)).resolves.toMatchObject({ sent: 1, purgeFailed: true });
  expect(post).toHaveBeenCalledOnce();
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/customer@example\.test|token=secret/);
});

it("makes page progress after sent SMS are excluded and reports a bounded backlog", async () => {
  const post = vi.fn(async () => true);
  const complete = vi.fn(async () => undefined);
  const smsPage = Array.from({ length: PROVIDER_MONITOR_LIMIT }, (_, index) => ({
    channel: "sms" as const,
    attemptId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    updatedAt: "2026-09-05T12:00:00.000Z",
  }));
  const pages = [
    { candidates: smsPage, truncated: true },
    { candidates: [
      { channel: "email", attemptId: "00000000-0000-4000-8000-000000000002", updatedAt: "2026-09-05T12:00:00.000Z" },
      { channel: "stripe_checkout", attemptId: "00000000-0000-4000-8000-000000000003", updatedAt: "2026-09-05T12:00:00.000Z" },
    ], truncated: false },
  ];
  const deps = {
    // The SQL RPC excludes page one's now-sent receipt rows on the next call.
    findCandidates: async () => pages.shift()!,
    claim: async () => true,
    complete,
    post,
    purge: async () => undefined,
    log: () => {},
  };
  await expect(monitorStaleProviderAttempts(deps, NOW)).resolves.toMatchObject({ candidates: 25, truncated: true, sent: 25 });
  await expect(monitorStaleProviderAttempts(deps, NOW)).resolves.toMatchObject({ candidates: 2, truncated: false, sent: 2 });
  expect(post).toHaveBeenCalledTimes(27);
  expect(complete).toHaveBeenCalledTimes(27);
});
