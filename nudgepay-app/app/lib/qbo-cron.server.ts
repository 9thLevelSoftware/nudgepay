// Scheduled CDC catch-up across all connected orgs. Invoked from the Worker's
// `scheduled` handler. Uses the global fetch (top of the call stack); all
// lower layers stay injectable for tests.
import { getEnv, getQboEnv, getEmailEnvOrNull } from "./env.server";
import { createSupabaseServiceClient } from "./supabase.server";
import { qboApiBaseUrl } from "./qbo-api.server";
import { runCdcCatchup, type SyncDeps } from "./qbo-sync.server";
import { recordSyncError, resolveSyncErrors } from "./sync-errors.server";
import { sendBrokenPromiseAlerts } from "./notifications.server";

export async function runScheduledCdc(
  cfEnv: Record<string, string>,
): Promise<{ orgs: number }> {
  const context = { cloudflare: { env: cfEnv } } as any;
  const env = getEnv(context);
  const qbo = getQboEnv(context);
  const service = createSupabaseServiceClient(env);

  const { data: conns, error } = await service.from("qbo_connections")
    .select("org_id").eq("status", "connected");
  if (error) throw error;

  // Wire broken-promise notification when email secrets are available.
  const emailEnv = getEmailEnvOrNull(context);
  const notify = emailEnv
    ? (orgId: string, brokenDetails: any[], today: string) =>
        sendBrokenPromiseAlerts(
          { fetchFn: fetch, service, email: { apiKey: emailEnv.RESEND_API_KEY }, appUrl: emailEnv.APP_PUBLIC_BASE_URL ?? "" },
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
  };

  for (const c of conns ?? []) {
    const orgId = c.org_id as string;
    try {
      await runCdcCatchup(deps, orgId);
      await resolveSyncErrors(service, { orgId }); // CDC catch-up heals all prior errors
    } catch (err) {
      // Isolate per-org failures so one bad connection doesn't abort the batch,
      // and record it so the org's dashboard surfaces the failed sync.
      console.error(`[cron] CDC catch-up failed for org ${orgId}:`, err);
      await recordSyncError(service, {
        orgId, source: "cron", scope: "cdc",
        message: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    }
  }
  return { orgs: (conns ?? []).length };
}
