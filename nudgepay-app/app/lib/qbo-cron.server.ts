// Scheduled CDC catch-up across all connected orgs. Invoked from the Worker's
// `scheduled` handler. Uses the global fetch (top of the call stack); all
// lower layers stay injectable for tests.
import { getEnv, getQboEnv } from "./env.server";
import { createSupabaseServiceClient } from "./supabase.server";
import { qboApiBaseUrl } from "./qbo-api.server";
import { runCdcCatchup, type SyncDeps } from "./qbo-sync.server";

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

  const deps: SyncDeps = {
    fetchFn: fetch,
    service,
    cfg: { clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI },
    api: { baseUrl: qboApiBaseUrl(qbo.QBO_SANDBOX) },
    key: qbo.QBO_ENCRYPTION_KEY,
  };

  for (const c of conns ?? []) {
    try {
      await runCdcCatchup(deps, c.org_id as string);
    } catch (err) {
      // Isolate per-org failures so one bad connection doesn't abort the batch.
      console.error(`CDC catch-up failed for org ${c.org_id}`);
    }
  }
  return { orgs: (conns ?? []).length };
}
