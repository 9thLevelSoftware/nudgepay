// Daily digest cron handler — runs once per day (0 13 * * * ≈ 8am ET).
// Iterates over all connected orgs and sends per-member follow-up digests.
// Mirrors runScheduledCdc's per-org try/catch pattern.

import { getEnv, getEmailEnvOrNull } from "./env.server";
import { createSupabaseServiceClient } from "./supabase.server";
import { runDailyDigest } from "./notifications.server";
import { recordSyncError } from "./sync-errors.server";

export async function runScheduledDigest(
  cfEnv: Record<string, string>,
): Promise<{ orgs: number }> {
  const context = { cloudflare: { env: cfEnv } } as any;
  const env = getEnv(context);
  const emailEnv = getEmailEnvOrNull(context);
  if (!emailEnv) {
    console.warn("[digest] Email env not configured; skipping digest.");
    return { orgs: 0 };
  }

  const service = createSupabaseServiceClient(env);
  const today = new Date().toISOString().slice(0, 10);

  // All orgs with a connected QBO are candidates for digests.
  const { data: conns, error } = await service.from("qbo_connections")
    .select("org_id").eq("status", "connected");
  if (error) throw error;

  for (const c of conns ?? []) {
    const orgId = c.org_id as string;
    try {
      await runDailyDigest(
        { fetchFn: fetch, service, email: { apiKey: emailEnv.RESEND_API_KEY }, appUrl: emailEnv.APP_PUBLIC_BASE_URL ?? "" },
        orgId,
        today,
      );
    } catch (err) {
      console.error(`[digest] daily digest failed for org ${orgId}:`, err);
      await recordSyncError(service, {
        orgId, source: "cron", scope: "digest",
        message: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    }
  }
  return { orgs: (conns ?? []).length };
}
