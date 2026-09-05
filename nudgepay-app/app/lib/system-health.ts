// Pure scheduled-job health policy and status evaluation. No I/O.

export const SYSTEM_JOBS = ["provider_monitor", "cdc", "digest", "retention"] as const;
export type SystemJob = typeof SYSTEM_JOBS[number];

const MINUTE_MS = 60_000;

export type SystemJobPolicy = {
  intervalMs: number;
  completionDeadlineMs: number;
  staleGraceMs: number;
};

// Completion deadlines stay below the next scheduled invocation. Freshness
// has a separate grace window so one delayed trigger does not page operators.
export const SYSTEM_JOB_POLICY: Record<SystemJob, SystemJobPolicy> = {
  provider_monitor: { intervalMs: 5 * MINUTE_MS, completionDeadlineMs: 4 * MINUTE_MS, staleGraceMs: 10 * MINUTE_MS },
  cdc: { intervalMs: 30 * MINUTE_MS, completionDeadlineMs: 25 * MINUTE_MS, staleGraceMs: 45 * MINUTE_MS },
  digest: { intervalMs: 60 * MINUTE_MS, completionDeadlineMs: 55 * MINUTE_MS, staleGraceMs: 90 * MINUTE_MS },
  retention: { intervalMs: 60 * MINUTE_MS, completionDeadlineMs: 55 * MINUTE_MS, staleGraceMs: 90 * MINUTE_MS },
};

export type SystemJobHealthRow = {
  job: string;
  last_started_at: string | null;
  last_succeeded_at: string | null;
  last_failed_at: string | null;
  last_alert_attempted_at: string | null;
  last_alert_succeeded_at: string | null;
  last_alert_failed_at: string | null;
  last_alert_succeeded_destination_hash: string | null;
};

export type HealthState = "ok" | "fail";
export type SystemMonitorChecks = {
  database: HealthState;
  provider_monitor: HealthState;
  cdc: HealthState;
  digest: HealthState;
  retention: HealthState;
  cdc_checkpoint: HealthState;
  qbo_sync: HealthState;
  operator_alert: HealthState;
};

export type SystemMonitorBody = { ok: boolean; checks: SystemMonitorChecks };

function parsedMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function latestFinishedMs(row: SystemJobHealthRow): number | null {
  const succeeded = parsedMs(row.last_succeeded_at);
  const failed = parsedMs(row.last_failed_at);
  if (succeeded === null) return failed;
  if (failed === null) return succeeded;
  return Math.max(succeeded, failed);
}

export function systemJobState(row: SystemJobHealthRow | undefined, nowMs: number): HealthState {
  if (!row || !SYSTEM_JOBS.includes(row.job as SystemJob)) return "fail";
  const policy = SYSTEM_JOB_POLICY[row.job as SystemJob];
  const started = parsedMs(row.last_started_at);
  const succeeded = parsedMs(row.last_succeeded_at);
  const failed = parsedMs(row.last_failed_at);
  if (succeeded === null) return "fail";
  if (failed !== null && failed >= succeeded) return "fail";
  const finished = latestFinishedMs(row);
  if (started !== null && (finished === null || started > finished) && nowMs - started >= policy.completionDeadlineMs) {
    return "fail";
  }
  return nowMs - succeeded <= policy.intervalMs + policy.staleGraceMs ? "ok" : "fail";
}

// Alert delivery is one shared channel. A successful post from any job clears
// an older failure; ordinary job success never changes this result.
export function operatorAlertState(
  rows: readonly SystemJobHealthRow[],
  currentDestinationHash: string | null,
): HealthState {
  if (!currentDestinationHash) return "fail";
  let latestSuccess: number | null = null;
  let latestSuccessDestinationHash: string | null = null;
  let latestFailure: number | null = null;
  for (const row of rows) {
    const succeeded = parsedMs(row.last_alert_succeeded_at);
    const failed = parsedMs(row.last_alert_failed_at);
    if (succeeded !== null && (latestSuccess === null || succeeded > latestSuccess)) {
      latestSuccess = succeeded;
      latestSuccessDestinationHash = row.last_alert_succeeded_destination_hash;
    }
    if (failed !== null && (latestFailure === null || failed > latestFailure)) latestFailure = failed;
  }
  if (latestSuccess === null) return "fail";
  if (latestSuccessDestinationHash !== currentDestinationHash) return "fail";
  return latestFailure !== null && latestFailure >= latestSuccess ? "fail" : "ok";
}

export function buildSystemMonitorBody(input: {
  rows: readonly SystemJobHealthRow[];
  nowMs: number;
  databaseOk: boolean;
  digestConfigured: boolean;
  cdcCheckpointOk: boolean;
  qboSyncOk: boolean;
  operatorAlertDestinationHash: string | null;
}): SystemMonitorBody {
  const byJob = new Map(input.rows.map((row) => [row.job, row]));
  const checks: SystemMonitorChecks = {
    database: input.databaseOk ? "ok" : "fail",
    provider_monitor: systemJobState(byJob.get("provider_monitor"), input.nowMs),
    cdc: systemJobState(byJob.get("cdc"), input.nowMs),
    digest: input.digestConfigured ? systemJobState(byJob.get("digest"), input.nowMs) : "fail",
    retention: systemJobState(byJob.get("retention"), input.nowMs),
    cdc_checkpoint: input.cdcCheckpointOk ? "ok" : "fail",
    qbo_sync: input.qboSyncOk ? "ok" : "fail",
    operator_alert: operatorAlertState(input.rows, input.operatorAlertDestinationHash),
  };
  return { ok: Object.values(checks).every((state) => state === "ok"), checks };
}

export function failedSystemMonitorBody(): SystemMonitorBody {
  return buildSystemMonitorBody({
    rows: [], nowMs: Date.now(), databaseOk: false, digestConfigured: false, cdcCheckpointOk: false,
    qboSyncOk: false, operatorAlertDestinationHash: null,
  });
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function operatorAlertDestinationFingerprint(url: string): Promise<string> {
  const digest = await sha256(url.trim());
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function monitorBearerAuthorized(header: string | null, expectedToken: unknown): Promise<boolean> {
  if (typeof expectedToken !== "string" || expectedToken.length < 32 || expectedToken.length > 512) return false;
  const match = /^Bearer ([^\s]+)$/i.exec(header ?? "");
  if (!match || match[1].length > 1024) return false;
  const [actualHash, expectedHash] = await Promise.all([sha256(match[1]), sha256(expectedToken)]);
  let difference = 0;
  for (let index = 0; index < expectedHash.length; index++) difference |= actualHash[index] ^ expectedHash[index];
  return difference === 0;
}
