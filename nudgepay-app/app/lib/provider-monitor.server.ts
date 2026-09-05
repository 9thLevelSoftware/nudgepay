import type { SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "./env.server";
import { safeErrorDetails } from "./log-redaction";
import { operatorAlertWebhookOk, providerAttemptStaleAlertPayload } from "./operator-alert";
import { postOperatorAlert } from "./operator-alert.server";
import {
  PROVIDER_MONITOR_LIMIT,
  type ProviderMonitorCandidate,
  type ProviderMonitorChannel,
  providerMonitorHourBucket,
  providerMonitorRetentionCutoff,
  staleProviderCandidates,
} from "./provider-monitor";
import { createSupabaseServiceClient } from "./supabase.server";

export type ProviderMonitorCounts = {
  candidates: number;
  truncated: boolean;
  purgeFailed: boolean;
  claimed: number;
  sent: number;
  postFailed: number;
};

type ProviderMonitorDeps = {
  findCandidates: (now: Date) => Promise<{ candidates: ProviderMonitorCandidate[]; truncated: boolean }>;
  claim: (candidate: ProviderMonitorCandidate, hourBucket: string, claimToken: string, now: Date) => Promise<boolean>;
  complete: (candidate: ProviderMonitorCandidate, hourBucket: string, claimToken: string, now: Date) => Promise<void>;
  post: (candidate: ProviderMonitorCandidate) => Promise<boolean>;
  purge: (now: Date) => Promise<void>;
  log: (event: Record<string, unknown>) => void;
};

export async function monitorStaleProviderAttempts(deps: ProviderMonitorDeps, now = new Date()): Promise<ProviderMonitorCounts> {
  const selection = await deps.findCandidates(now);
  const candidates = staleProviderCandidates(selection.candidates, now);
  let claimed = 0;
  let sent = 0;
  let postFailed = 0;
  const hourBucket = providerMonitorHourBucket(now);

  // Each of the four source queries is capped, so this remains bounded while
  // allowing stale checkout attempts to be observed even during SMS backlog.
  for (const candidate of candidates) {
    const claimToken = crypto.randomUUID();
    if (!await deps.claim(candidate, hourBucket, claimToken, now)) continue;
    claimed += 1;
    if (await deps.post(candidate)) {
      await deps.complete(candidate, hourBucket, claimToken, now);
      sent += 1;
    } else {
      // The receipt stays pending until its short lease expires. A later cron
      // claims and retries it; failed delivery is never recorded as sent.
      postFailed += 1;
    }
  }
  let purgeFailed = false;
  try {
    // Retention is best-effort and runs after alert delivery. A transient
    // DELETE failure must not hide a stale provider attempt from operators.
    await deps.purge(now);
  } catch (error) {
    purgeFailed = true;
    deps.log({ event: "provider_monitor_retention_failed", error: safeErrorDetails(error) });
  }
  const counts = { candidates: candidates.length, truncated: selection.truncated, purgeFailed, claimed, sent, postFailed };
  deps.log({ event: "provider_monitor_complete", ...counts });
  return counts;
}

async function readCandidates(service: SupabaseClient, now: Date): Promise<{ candidates: ProviderMonitorCandidate[]; truncated: boolean }> {
  const { data, error } = await service.rpc("list_provider_monitor_candidates", {
    p_now: now.toISOString(), p_limit: PROVIDER_MONITOR_LIMIT + 1,
  });
  if (error) throw new Error(`provider monitor query failed: ${error.code ?? "unknown"}`);
  const rows = (data ?? []) as { channel: ProviderMonitorChannel; attempt_id: string; observed_at: string }[];
  return {
    candidates: rows.slice(0, PROVIDER_MONITOR_LIMIT).map(({ channel, attempt_id, observed_at }) => ({ channel, attemptId: attempt_id, updatedAt: observed_at })),
    truncated: rows.length > PROVIDER_MONITOR_LIMIT,
  };
}

function serviceMonitorDeps(service: SupabaseClient, webhook: unknown, fetchFn: typeof fetch): ProviderMonitorDeps {
  return {
    findCandidates: (now) => readCandidates(service, now),
    async claim(candidate, hourBucket, claimToken, now) {
      const { data, error } = await service.rpc("claim_provider_monitor_alert", {
        p_channel: candidate.channel, p_attempt_id: candidate.attemptId, p_hour_bucket: hourBucket,
        p_claim_token: claimToken, p_now: now.toISOString(),
      });
      if (error) throw new Error(`provider monitor alert claim failed: ${error.code ?? "unknown"}`);
      return data === true;
    },
    async complete(candidate, hourBucket, claimToken, now) {
      const { data, error } = await service.rpc("complete_provider_monitor_alert", {
        p_channel: candidate.channel, p_attempt_id: candidate.attemptId, p_hour_bucket: hourBucket,
        p_claim_token: claimToken, p_now: now.toISOString(),
      });
      if (error || data !== true) throw new Error(`provider monitor alert completion failed: ${error?.code ?? "claim_lost"}`);
    },
    post: (candidate) => postOperatorAlert(fetchFn, webhook, providerAttemptStaleAlertPayload(candidate)),
    async purge(now) {
      const { error } = await service.from("provider_monitor_alert_receipts").delete().lt("created_at", providerMonitorRetentionCutoff(now));
      if (error) throw new Error(`provider monitor retention failed: ${error.code ?? "unknown"}`);
    },
    log: (event) => console.log(event),
  };
}

export async function runScheduledProviderMonitor(cfEnv: Record<string, string>, fetchFn: typeof fetch = fetch, now = new Date()): Promise<ProviderMonitorCounts> {
  const env = getEnv({ cloudflare: { env: cfEnv } } as { cloudflare: { env: Record<string, string> } });
  if (!operatorAlertWebhookOk(cfEnv.OPERATOR_ALERT_WEBHOOK)) {
    console.error({ event: "provider_monitor_missing_operator_alert_webhook" });
  }
  return monitorStaleProviderAttempts(serviceMonitorDeps(createSupabaseServiceClient(env), cfEnv.OPERATOR_ALERT_WEBHOOK, fetchFn), now);
}
