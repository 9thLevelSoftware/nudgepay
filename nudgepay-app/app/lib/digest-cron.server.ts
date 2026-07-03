// Daily digest cron handler — runs hourly (see wrangler.toml "0 * * * *").
// Per org: gate on the org-local hour reaching its configured
// digest_hour_local, at most once per org-local calendar day (last_digest_date).
// Mirrors runScheduledCdc's per-org try/catch pattern.

import { getEnv, getEmailEnvOrNull } from "./env.server";
import { createSupabaseServiceClient } from "./supabase.server";
import { runDailyDigest } from "./notifications.server";
import { recordSyncError } from "./sync-errors.server";
import { todayInTz, shouldSendDigestNow } from "./tz";
import { DEFAULT_COMPANY_PROFILE } from "./org-profile";

type DigestScheduleRow = {
  timezone: string | null;
  digest_hour_local: number | null;
  last_digest_date: string | null;
};

export async function runScheduledDigest(
  cfEnv: Record<string, string>,
  now: Date = new Date(),
): Promise<{ orgs: number; sent: number }> {
  const context = { cloudflare: { env: cfEnv } } as any;
  const env = getEnv(context);
  const emailEnv = getEmailEnvOrNull(context);
  if (!emailEnv) {
    console.warn("[digest] Email env not configured; skipping digest.");
    return { orgs: 0, sent: 0 };
  }

  const service = createSupabaseServiceClient(env);

  // All orgs with a connected QBO are candidates for digests.
  const { data: conns, error } = await service.from("qbo_connections")
    .select("org_id").eq("status", "connected");
  if (error) throw error;

  let sent = 0;
  for (const c of conns ?? []) {
    const orgId = c.org_id as string;
    try {
      const { data: settings } = await service
        .from("org_settings")
        .select("timezone, digest_hour_local, last_digest_date")
        .eq("org_id", orgId)
        .maybeSingle();
      const row = settings as DigestScheduleRow | null;
      const tz = row?.timezone && row.timezone.length > 0 ? row.timezone : DEFAULT_COMPANY_PROFILE.timezone;
      const digestHourLocal = row?.digest_hour_local ?? 8;
      const lastDigestDate = row?.last_digest_date ?? null;

      if (!shouldSendDigestNow(tz, digestHourLocal, lastDigestDate, now)) continue;

      // Org-local "today" — runDailyDigest's follow-up-due comparison
      // (next_action_at <= today) must use the org's calendar day, not UTC's.
      const today = todayInTz(tz, now);
      await runDailyDigest(
        { fetchFn: fetch, service, email: { apiKey: emailEnv.RESEND_API_KEY }, appUrl: emailEnv.APP_PUBLIC_BASE_URL ?? "" },
        orgId,
        today,
      );
      sent += 1;

      // Record after a successful run so a mid-run crash leaves last_digest_date
      // unset and the next hourly tick retries (notification_log dedupe still
      // protects against any partial-send double-charge to members already sent).
      const { error: updateErr } = await service
        .from("org_settings")
        .upsert({ org_id: orgId, last_digest_date: today }, { onConflict: "org_id" });
      if (updateErr) {
        console.error(`[digest] failed to record last_digest_date for org ${orgId}:`, updateErr);
      }
    } catch (err) {
      console.error(`[digest] daily digest failed for org ${orgId}:`, err);
      await recordSyncError(service, {
        orgId, source: "cron", scope: "digest",
        message: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    }
  }
  return { orgs: (conns ?? []).length, sent };
}
