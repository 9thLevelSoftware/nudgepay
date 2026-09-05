import type { SupabaseClient } from "@supabase/supabase-js";
import { CDC_CHECKPOINT_JOB } from "./cdc-budget";
import { getEmailEnvOrNull, getEnv } from "./env.server";
import { safeErrorDetails } from "./log-redaction";
import { alertFromWorkerError } from "./operator-alert.server";
import { operatorAlertWebhookOk } from "./operator-alert";
import { createSupabaseServiceClient } from "./supabase.server";
import {
  SYSTEM_JOB_POLICY,
  buildSystemMonitorBody,
  operatorAlertDestinationFingerprint,
  type SystemJob,
  type SystemJobHealthRow,
  type SystemMonitorBody,
} from "./system-health";

export type SystemJobEvent = "started" | "succeeded" | "failed" | "alert_succeeded" | "alert_failed";

const QBO_SYNC_STALE_AFTER_MS = 90 * 60 * 1000;

function monitoringService(cfEnv: Record<string, string>): SupabaseClient | null {
  try {
    const env = getEnv({ cloudflare: { env: cfEnv } });
    return createSupabaseServiceClient(env);
  } catch (error) {
    console.error({ event: "system_health_client_failed", error: safeErrorDetails(error) });
    return null;
  }
}

async function recordEvent(
  service: SupabaseClient | null,
  job: SystemJob,
  event: SystemJobEvent,
  at: Date,
  alertDestinationHash: string | null = null,
): Promise<void> {
  if (!service) return;
  try {
    const { error } = await service.rpc("record_system_job_event", {
      p_job: job,
      p_event: event,
      p_at: at.toISOString(),
      p_alert_destination_hash: alertDestinationHash,
    });
    if (error) throw error;
  } catch (error) {
    console.error({ event: "system_health_write_failed", job, operation: event, error: safeErrorDetails(error) });
  }
}

export async function recordOperatorAlertResult(
  cfEnv: Record<string, string>,
  job: SystemJob,
  delivered: boolean,
  at = new Date(),
): Promise<void> {
  const destinationHash = delivered
    ? await operatorAlertDestinationFingerprint(cfEnv.OPERATOR_ALERT_WEBHOOK)
    : null;
  await recordEvent(
    monitoringService(cfEnv), job, delivered ? "alert_succeeded" : "alert_failed", at, destinationHash,
  );
}

export async function runMonitoredSystemJob<T>(input: {
  cfEnv: Record<string, string>;
  job: SystemJob;
  cron: string;
  run: () => Promise<T>;
  fetchFn?: typeof fetch;
  now?: () => Date;
}): Promise<T> {
  const now = input.now ?? (() => new Date());
  const service = monitoringService(input.cfEnv);
  await recordEvent(service, input.job, "started", now());
  try {
    const result = await input.run();
    await recordEvent(service, input.job, "succeeded", now());
    return result;
  } catch (error) {
    await recordEvent(service, input.job, "failed", now());
    const delivered = await alertFromWorkerError(input.fetchFn ?? fetch, input.cfEnv, {
      handler: "scheduled",
      err: error,
      cron: input.cron,
    });
    const destinationHash = delivered
      ? await operatorAlertDestinationFingerprint(input.cfEnv.OPERATOR_ALERT_WEBHOOK)
      : null;
    await recordEvent(
      service, input.job, delivered ? "alert_succeeded" : "alert_failed", now(), destinationHash,
    );
    throw error;
  }
}

export async function loadSystemMonitorBody(
  service: SupabaseClient,
  cfEnv: Record<string, string>,
  now = new Date(),
): Promise<SystemMonitorBody> {
  const qboCutoff = new Date(now.getTime() - QBO_SYNC_STALE_AFTER_MS).toISOString();
  const [jobResult, checkpointResult, qboResult] = await Promise.all([
    service.from("system_job_health")
      .select("job, last_started_at, last_succeeded_at, last_failed_at, last_alert_attempted_at, last_alert_succeeded_at, last_alert_failed_at, last_alert_succeeded_destination_hash"),
    service.from("cron_checkpoints")
      .select("updated_at")
      .eq("job", CDC_CHECKPOINT_JOB)
      .not("next_org_id", "is", null)
      .maybeSingle(),
    service.from("qbo_connections")
      .select("id", { count: "exact", head: true })
      .eq("status", "connected")
      .not("refresh_token_enc", "is", null)
      .or(`last_sync_at.is.null,last_sync_at.lt.${qboCutoff}`),
  ]);
  if (jobResult.error || checkpointResult.error || qboResult.error) {
    throw new Error("system monitor query failed");
  }

  const checkpointUpdatedAt = checkpointResult.data?.updated_at as string | undefined;
  const checkpointUpdatedMs = checkpointUpdatedAt ? Date.parse(checkpointUpdatedAt) : Number.NaN;
  const checkpointOk = !checkpointResult.data || (
    Number.isFinite(checkpointUpdatedMs)
    && now.getTime() - checkpointUpdatedMs <= SYSTEM_JOB_POLICY.cdc.intervalMs + SYSTEM_JOB_POLICY.cdc.staleGraceMs
  );

  const operatorAlertDestinationHash = operatorAlertWebhookOk(cfEnv.OPERATOR_ALERT_WEBHOOK)
    ? await operatorAlertDestinationFingerprint(cfEnv.OPERATOR_ALERT_WEBHOOK)
    : null;
  return buildSystemMonitorBody({
    rows: (jobResult.data ?? []) as SystemJobHealthRow[],
    nowMs: now.getTime(),
    databaseOk: true,
    digestConfigured: Boolean(getEmailEnvOrNull({ cloudflare: { env: cfEnv } })),
    cdcCheckpointOk: checkpointOk,
    qboSyncOk: (qboResult.count ?? 0) === 0,
    operatorAlertDestinationHash,
  });
}
