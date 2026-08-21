// Hourly retention: expire oauth_states, old notification_log, resolved
// sync_errors, and pending invites. Per-table try/catch so one failure
// does not skip the rest.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "./env.server";
import { createSupabaseServiceClient } from "./supabase.server";

export const RETENTION_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function retentionCutoffIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

export type RetentionCounts = {
  oauthStates: number;
  notificationLog: number;
  syncErrors: number;
  invites: number;
};

async function purgeTable(
  label: string,
  run: () => PromiseLike<{ count: number | null; error: { message?: string } | null }>,
): Promise<number> {
  try {
    const { count, error } = await run();
    if (error) throw error;
    return count ?? 0;
  } catch (err) {
    console.error(`[retention] ${label} failed:`, err);
    return 0;
  }
}

export async function runRetention(
  service: SupabaseClient,
  now: Date = new Date(),
): Promise<RetentionCounts> {
  const nowIso = now.toISOString();
  const cutoff90 = retentionCutoffIso(now, RETENTION_DAYS);

  const oauthStates = await purgeTable("oauth_states", () =>
    service.from("oauth_states").delete({ count: "exact" }).lt("expires_at", nowIso),
  );
  const notificationLog = await purgeTable("notification_log", () =>
    service.from("notification_log").delete({ count: "exact" }).lt("sent_at", cutoff90),
  );
  const syncErrors = await purgeTable("sync_errors", () =>
    service
      .from("sync_errors")
      .delete({ count: "exact" })
      .not("resolved_at", "is", null)
      .lt("resolved_at", cutoff90),
  );
  const invites = await purgeTable("invites", () =>
    service
      .from("invites")
      .delete({ count: "exact" })
      .is("accepted_at", null)
      .lt("expires_at", nowIso),
  );

  return { oauthStates, notificationLog, syncErrors, invites };
}

export async function runScheduledRetention(
  cfEnv: Record<string, string>,
  now: Date = new Date(),
): Promise<RetentionCounts> {
  const env = getEnv({ cloudflare: { env: cfEnv } } as { cloudflare: { env: Record<string, string> } });
  const counts = await runRetention(createSupabaseServiceClient(env), now);
  console.log("[retention]", counts);
  return counts;
}
