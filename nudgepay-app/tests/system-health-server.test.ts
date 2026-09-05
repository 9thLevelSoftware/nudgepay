import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  alert: vi.fn(),
}));

vi.mock("../app/lib/env.server", () => ({
  getEnv: () => ({ SUPABASE_URL: "https://db.example", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_KEY: "service" }),
  getEmailEnvOrNull: () => ({ RESEND_API_KEY: "key", UNSUBSCRIBE_SECRET: "secret", RESEND_WEBHOOK_SECRET: "webhook" }),
}));

vi.mock("../app/lib/supabase.server", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("../app/lib/operator-alert.server", () => ({
  alertFromWorkerError: mocks.alert,
}));

import { loadSystemMonitorBody, runMonitoredSystemJob } from "../app/lib/system-health.server";
import { SYSTEM_JOBS, operatorAlertDestinationFingerprint } from "../app/lib/system-health";

function monitorService(input: { checkpointAt?: string; qboStale?: number; errorTable?: string }) {
  return {
    from(table: string) {
      if (table === "system_job_health") {
        return {
          select: async () => input.errorTable === table
            ? { data: null, error: { code: "DB_DOWN" } }
            : { data: inputRows, error: null },
        };
      }
      if (table === "cron_checkpoints") {
        const result = input.errorTable === table
          ? { data: null, error: { code: "DB_DOWN" } }
          : { data: input.checkpointAt ? { updated_at: input.checkpointAt } : null, error: null };
        const builder: any = { select: () => builder, eq: () => builder, not: () => builder, maybeSingle: async () => result };
        return builder;
      }
      if (table === "qbo_connections") {
        const result = input.errorTable === table
          ? { count: null, error: { code: "DB_DOWN" } }
          : { count: input.qboStale ?? 0, error: null };
        const builder: any = { select: () => builder, eq: () => builder, not: () => builder, or: async () => result };
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const monitorNow = new Date("2026-09-05T12:00:00.000Z");
const pagerUrl = "https://pager.example/hook";
let inputRows: Record<string, unknown>[] = [];

describe("runMonitoredSystemJob", () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ error: null });
    mocks.alert.mockReset().mockResolvedValue(true);
  });

  it("records start and successful completion", async () => {
    await expect(runMonitoredSystemJob({
      cfEnv: {},
      job: "cdc",
      cron: "*/30 * * * *",
      run: async () => 7,
      now: (() => {
        const times = [new Date("2026-09-05T12:00:00Z"), new Date("2026-09-05T12:00:01Z")];
        return () => times.shift()!;
      })(),
    })).resolves.toBe(7);
    expect(mocks.rpc.mock.calls.map((call) => call[1].p_event)).toEqual(["started", "succeeded"]);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it("preserves the job failure and records the failed pager delivery", async () => {
    const error = new Error("job failed");
    mocks.alert.mockResolvedValue(false);
    await expect(runMonitoredSystemJob({
      cfEnv: {},
      job: "retention",
      cron: "0 * * * *",
      run: async () => { throw error; },
    })).rejects.toBe(error);
    expect(mocks.rpc.mock.calls.map((call) => call[1].p_event)).toEqual([
      "started", "failed", "alert_failed",
    ]);
    expect(mocks.alert).toHaveBeenCalledOnce();
  });

  it("does not fail a successful business job when heartbeat storage fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ error: { code: "DB_DOWN" } });
    await expect(runMonitoredSystemJob({
      cfEnv: {},
      job: "digest",
      cron: "0 * * * *",
      run: async () => "sent",
    })).resolves.toBe("sent");
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "system_health_write_failed" }));
    log.mockRestore();
  });
});

describe("loadSystemMonitorBody", () => {
  beforeEach(async () => {
    const destinationHash = await operatorAlertDestinationFingerprint(pagerUrl);
    inputRows = SYSTEM_JOBS.map((job) => ({
      job,
      last_started_at: "2026-09-05T11:59:00.000Z",
      last_succeeded_at: "2026-09-05T11:59:30.000Z",
      last_failed_at: null,
      last_alert_attempted_at: "2026-09-05T11:50:00.000Z",
      last_alert_succeeded_at: "2026-09-05T11:50:00.000Z",
      last_alert_failed_at: null,
      last_alert_succeeded_destination_hash: destinationHash,
    }));
  });

  it("returns a healthy status for fresh jobs, checkpoint, sync, and current pager", async () => {
    await expect(loadSystemMonitorBody(
      monitorService({ checkpointAt: "2026-09-05T11:50:00.000Z" }) as never,
      { OPERATOR_ALERT_WEBHOOK: pagerUrl }, monitorNow,
    )).resolves.toMatchObject({ ok: true });
  });

  it("fails stale checkpoints and stale connected-QBO aggregates without returning counts", async () => {
    const body = await loadSystemMonitorBody(
      monitorService({ checkpointAt: "2026-09-05T10:00:00.000Z", qboStale: 2 }) as never,
      { OPERATOR_ALERT_WEBHOOK: pagerUrl }, monitorNow,
    );
    expect(body).toMatchObject({ ok: false, checks: { cdc_checkpoint: "fail", qbo_sync: "fail" } });
    expect(JSON.stringify(body)).not.toContain("2");
  });

  it("rejects any aggregate query error", async () => {
    await expect(loadSystemMonitorBody(
      monitorService({ errorTable: "qbo_connections" }) as never,
      { OPERATOR_ALERT_WEBHOOK: pagerUrl }, monitorNow,
    )).rejects.toThrow("system monitor query failed");
  });
});
