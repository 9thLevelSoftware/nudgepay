// Scheduled CDC catch-up across all connected orgs. Invoked from the Worker's
// `scheduled` handler. Uses the global fetch (top of the call stack); all
// lower layers stay injectable for tests.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEnv, getQboEnv, getEmailEnvOrNull, resendTransport } from "./env.server";
import { createSupabaseServiceClient } from "./supabase.server";
import { qboApiBaseUrl } from "./qbo-api.server";
import { runCdcCatchup, syncOverdueInvoices, type SyncDeps } from "./qbo-sync.server";
import { recordSyncError, resolveSyncErrors } from "./sync-errors.server";
import { orderPage, pageAll, PAGE_ALL_MAX_ROWS } from "./page-all";
import { sendBrokenPromiseAlerts } from "./notifications.server";
import {
  CDC_CHECKPOINT_JOB,
  nextCdcLoopStep,
  parseCdcBudgetMs,
  planOrderedOrgIds,
} from "./cdc-budget";

export type RunScheduledCdcOpts = {
  nowMs?: () => number;
  startedAtMs?: number;
  budgetMs?: number;
};

export type RunScheduledCdcResult = {
  orgs: number;
  processed: number;
  nextOrgId: string | null;
};

async function loadCdcCheckpoint(service: SupabaseClient): Promise<string | null> {
  const { data, error } = await service.from("cron_checkpoints")
    .select("next_org_id").eq("job", CDC_CHECKPOINT_JOB).maybeSingle();
  if (error) throw error;
  return (data?.next_org_id as string | null) ?? null;
}

async function writeCdcCheckpoint(
  service: SupabaseClient, nextOrgId: string | null,
): Promise<void> {
  const { error } = await service.from("cron_checkpoints").upsert({
    job: CDC_CHECKPOINT_JOB,
    next_org_id: nextOrgId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function runScheduledCdc(
  cfEnv: Record<string, string>,
  opts: RunScheduledCdcOpts = {},
): Promise<RunScheduledCdcResult> {
  const nowMs = opts.nowMs ?? Date.now;
  const budgetMs = opts.budgetMs ?? parseCdcBudgetMs(cfEnv.CDC_CRON_BUDGET_MS);
  const startedAtMs = opts.startedAtMs ?? nowMs();

  const context = { cloudflare: { env: cfEnv } } as any;
  const env = getEnv(context);
  const qbo = getQboEnv(context);
  const service = createSupabaseServiceClient(env);

  const conns = await pageAll<{ org_id: string; last_sync_at: string | null }>(
    (from, to) =>
      orderPage(
        service.from("qbo_connections")
          .select("org_id, last_sync_at", { count: "exact" })
          .eq("status", "connected"),
      ).range(from, to),
    { maxRows: PAGE_ALL_MAX_ROWS },
  );
  if (conns.truncated) throw new Error("connected orgs truncated: page is incomplete");

  const orgIds = conns.rows.map((c) => c.org_id as string);
  const lastSyncByOrg = new Map(
    conns.rows.map((c) => [c.org_id as string, c.last_sync_at as string | null]),
  );
  const checkpoint = await loadCdcCheckpoint(service);
  const ordered = planOrderedOrgIds(orgIds, checkpoint);

  // Wire broken-promise notification when email secrets are available.
  const emailEnv = getEmailEnvOrNull(context);
  const notify = emailEnv
    ? (orgId: string, brokenDetails: any[], today: string) =>
        sendBrokenPromiseAlerts(
          { fetchFn: fetch, service, email: resendTransport(emailEnv), appUrl: emailEnv.APP_PUBLIC_BASE_URL ?? "" },
          orgId, brokenDetails, today,
        )
    : undefined;

  const deps: SyncDeps = {
    fetchFn: fetch,
    service,
    cfg: { clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI },
    api: { baseUrl: qboApiBaseUrl(qbo.QBO_SANDBOX) },
    key: qbo.QBO_ENCRYPTION_KEY,
    notify,
    errorSource: "cron",
  };

  let processed = 0;
  for (let i = 0; ; i++) {
    const step = nextCdcLoopStep(ordered, i, startedAtMs, nowMs(), budgetMs);
    if (step.action === "complete") {
      if (checkpoint !== null) await writeCdcCheckpoint(service, null);
      return { orgs: orgIds.length, processed, nextOrgId: null };
    }
    if (step.action === "checkpoint") {
      await writeCdcCheckpoint(service, step.nextOrgId);
      return { orgs: orgIds.length, processed, nextOrgId: step.nextOrgId };
    }
    const orgId = step.orgId;
    if (!lastSyncByOrg.get(orgId)) {
      try {
        await syncOverdueInvoices(deps, orgId);
      } catch (err) {
        console.error(`[cron] overdue backfill failed for org ${orgId}:`, err);
        await recordSyncError(service, {
          orgId, source: "cron", scope: "backfill",
          message: err instanceof Error ? err.message : String(err),
        }).catch(() => {});
        processed += 1;
        continue;
      }
    }
    try {
      await runCdcCatchup(deps, orgId);
      await resolveSyncErrors(service, { orgId }); // CDC catch-up heals all prior errors
    } catch (err) {
      // Isolate per-org failures so one bad connection doesn't abort the batch,
      // and record it so the org's dashboard surfaces the failed sync.
      // Do not resolveSyncErrors for a thrown catch-up.
      console.error(`[cron] CDC catch-up failed for org ${orgId}:`, err);
      await recordSyncError(service, {
        orgId, source: "cron", scope: "cdc",
        message: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    }
    processed += 1;
  }
}
