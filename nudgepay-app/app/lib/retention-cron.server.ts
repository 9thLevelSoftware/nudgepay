// Hourly retention: expire oauth_states, old notification_log, resolved
// sync_errors, and pending invites. Per-table try/catch so one failure
// does not skip the rest.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "./env.server";
import { createSupabaseServiceClient } from "./supabase.server";

export const RETENTION_DAYS = 90;
export const STRIPE_WEBHOOK_RETENTION_DAYS = 90;
export const BILLING_ATTEMPT_RETENTION_DAYS = 90;
export const PROVIDER_RECONCILIATION_RETENTION_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function retentionCutoffIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

export type RetentionCounts = {
  oauthStates: number;
  notificationLog: number;
  syncErrors: number;
  invites: number;
  stripeWebhookEvents: number;
  billingCheckoutAttempts: number;
  providerReconciliations: number;
  failures: number;
};

async function purgeTable(
  label: string,
  run: () => PromiseLike<{ count: number | null; error: { message?: string } | null }>,
): Promise<{ count: number; failed: boolean }> {
  try {
    const { count, error } = await run();
    if (error) throw error;
    return { count: count ?? 0, failed: false };
  } catch (err) {
    console.error(`[retention] ${label} failed:`, err);
    return { count: 0, failed: true };
  }
}

export async function runRetention(
  service: SupabaseClient,
  now: Date = new Date(),
): Promise<RetentionCounts> {
  const nowIso = now.toISOString();
  const cutoff90 = retentionCutoffIso(now, RETENTION_DAYS);
  const stripeWebhookCutoff = retentionCutoffIso(now, STRIPE_WEBHOOK_RETENTION_DAYS);
  const billingAttemptCutoff = retentionCutoffIso(now, BILLING_ATTEMPT_RETENTION_DAYS);
  const reconciliationCutoff = retentionCutoffIso(now, PROVIDER_RECONCILIATION_RETENTION_DAYS);

  const oauthStatesResult = await purgeTable("oauth_states", () =>
    service.from("oauth_states").delete({ count: "exact" }).lt("expires_at", nowIso),
  );
  const notificationLogResult = await purgeTable("notification_log", () =>
    service.from("notification_log").delete({ count: "exact" }).lt("sent_at", cutoff90),
  );
  const syncErrorsResult = await purgeTable("sync_errors", () =>
    service
      .from("sync_errors")
      .delete({ count: "exact" })
      .not("resolved_at", "is", null)
      .lt("resolved_at", cutoff90),
  );
  const invitesResult = await purgeTable("invites", () =>
    service
      .from("invites")
      .delete({ count: "exact" })
      .is("accepted_at", null)
      .lt("expires_at", nowIso),
  );

  const stripeWebhookEventsResult = await purgeTable("stripe_webhook_events", () =>
    service.from("stripe_webhook_events").delete({ count: "exact" })
      .lt("received_at", stripeWebhookCutoff),
  );
  const billingCheckoutAttemptsResult = await purgeTable("billing_checkout_attempts", () =>
    service.from("billing_checkout_attempts").delete({ count: "exact" })
      .in("state", ["failed", "completed"])
      .lt("updated_at", billingAttemptCutoff),
  );
  const providerReconciliationsResult = await purgeTable("provider_reconciliation_audit", () =>
    service.from("provider_reconciliation_audit").delete({ count: "exact" })
      .lt("reconciled_at", reconciliationCutoff),
  );

  const results = [
    oauthStatesResult, notificationLogResult, syncErrorsResult, invitesResult,
    stripeWebhookEventsResult, billingCheckoutAttemptsResult, providerReconciliationsResult,
  ];
  return {
    oauthStates: oauthStatesResult.count,
    notificationLog: notificationLogResult.count,
    syncErrors: syncErrorsResult.count,
    invites: invitesResult.count,
    stripeWebhookEvents: stripeWebhookEventsResult.count,
    billingCheckoutAttempts: billingCheckoutAttemptsResult.count,
    providerReconciliations: providerReconciliationsResult.count,
    failures: results.filter((result) => result.failed).length,
  };
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
