import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SYSTEM_JOBS,
  SYSTEM_JOB_POLICY,
  buildSystemMonitorBody,
  monitorBearerAuthorized,
  operatorAlertState,
  systemJobState,
  type SystemJobHealthRow,
} from "../app/lib/system-health";
import { loader as monitorLoader } from "../app/routes/monitorz";

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const DESTINATION_HASH = "a".repeat(64);

function row(job: SystemJobHealthRow["job"], overrides: Partial<SystemJobHealthRow> = {}): SystemJobHealthRow {
  return {
    job,
    last_started_at: "2026-09-05T11:59:00.000Z",
    last_succeeded_at: "2026-09-05T11:59:30.000Z",
    last_failed_at: null,
    last_alert_attempted_at: "2026-09-05T11:50:00.000Z",
    last_alert_succeeded_at: "2026-09-05T11:50:00.000Z",
    last_alert_failed_at: null,
    last_alert_succeeded_destination_hash: DESTINATION_HASH,
    ...overrides,
  };
}

describe("scheduled job health policy", () => {
  it("keeps completion deadlines below each interval and uses a distinct stale grace", () => {
    for (const job of SYSTEM_JOBS) {
      expect(SYSTEM_JOB_POLICY[job].completionDeadlineMs).toBeLessThan(SYSTEM_JOB_POLICY[job].intervalMs);
      expect(SYSTEM_JOB_POLICY[job].staleGraceMs).toBeGreaterThan(0);
    }
  });

  it("fails missing, latest-failed, overdue, and stale jobs", () => {
    expect(systemJobState(undefined, NOW)).toBe("fail");
    expect(systemJobState(row("cdc", {
      last_failed_at: "2026-09-05T11:59:45.000Z",
    }), NOW)).toBe("fail");
    expect(systemJobState(row("cdc", {
      last_started_at: new Date(NOW - SYSTEM_JOB_POLICY.cdc.completionDeadlineMs).toISOString(),
      last_succeeded_at: "2026-09-05T10:00:00.000Z",
    }), NOW)).toBe("fail");
    const staleBoundary = NOW - SYSTEM_JOB_POLICY.provider_monitor.intervalMs - SYSTEM_JOB_POLICY.provider_monitor.staleGraceMs;
    expect(systemJobState(row("provider_monitor", {
      last_succeeded_at: new Date(staleBoundary).toISOString(),
    }), NOW)).toBe("ok");
    expect(systemJobState(row("provider_monitor", {
      last_succeeded_at: new Date(staleBoundary - 1).toISOString(),
    }), NOW)).toBe("fail");
  });

  it("keeps a pager failure sticky until a later confirmed delivery", () => {
    const failed = row("cdc", {
      last_alert_succeeded_at: "2026-09-05T10:00:00.000Z",
      last_alert_failed_at: "2026-09-05T11:00:00.000Z",
      last_succeeded_at: "2026-09-05T11:59:59.000Z",
    });
    expect(operatorAlertState([failed], DESTINATION_HASH)).toBe("fail");
    expect(operatorAlertState([
      failed,
      row("provider_monitor", { last_alert_succeeded_at: "2026-09-05T11:30:00.000Z" }),
    ], DESTINATION_HASH)).toBe("ok");
  });

  it("requires confirmation for the currently configured pager destination", () => {
    expect(operatorAlertState([row("cdc")], "b".repeat(64))).toBe("fail");
    expect(operatorAlertState([row("cdc")], DESTINATION_HASH)).toBe("ok");
  });

  it("returns status only, without counts, timestamps, or record identifiers", () => {
    const rows = SYSTEM_JOBS.map((job) => row(job));
    const body = buildSystemMonitorBody({
      rows,
      nowMs: NOW,
      databaseOk: true,
      digestConfigured: true,
      cdcCheckpointOk: true,
      qboSyncOk: true,
      operatorAlertDestinationHash: DESTINATION_HASH,
    });
    expect(body.ok).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/count|_at|timestamp|org.?id/i);
  });
});

describe("monitor bearer authorization", () => {
  const token = "test-monitor-token-".repeat(3);

  it("requires one exact, sufficiently long bearer token", async () => {
    await expect(monitorBearerAuthorized(`Bearer ${token}`, token)).resolves.toBe(true);
    await expect(monitorBearerAuthorized(`bearer ${token}x`, token)).resolves.toBe(false);
    await expect(monitorBearerAuthorized(token, token)).resolves.toBe(false);
    await expect(monitorBearerAuthorized(`Bearer short`, "short")).resolves.toBe(false);
  });

  it("rejects before required database configuration is read", async () => {
    const response = await monitorLoader({
      request: new Request("https://app.example/monitorz", { headers: { Authorization: "Bearer wrong" } }),
      context: { cloudflare: { env: { MONITOR_TOKEN: token } } },
      params: {},
    } as never);
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false });
  });
});

it("wires service-only monotonic storage and monitored Worker jobs", () => {
  const migration = readFileSync(fileURLToPath(new URL("../supabase/migrations/0066_system_job_health.sql", import.meta.url)), "utf8");
  const worker = readFileSync(fileURLToPath(new URL("../workers/app.ts", import.meta.url)), "utf8");
  const routes = readFileSync(fileURLToPath(new URL("../app/routes.ts", import.meta.url)), "utf8");
  expect(migration).toContain("create table public.system_job_health");
  expect(migration).toContain("greatest(existing.");
  expect(migration).toMatch(/revoke all on table public\.system_job_health from anon, authenticated/);
  expect(migration).toMatch(/grant execute[\s\S]*to service_role/);
  for (const job of SYSTEM_JOBS) expect(worker).toContain(`scheduleJob("${job}"`);
  expect(routes).toContain('route("monitorz", "routes/monitorz.tsx")');
});
