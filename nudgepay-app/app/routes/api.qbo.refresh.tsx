import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getQboEnv, getEmailEnvOrNull } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { qboApiBaseUrl } from "../lib/qbo-api.server";
import { syncOverdueInvoices, type SyncDeps } from "../lib/qbo-sync.server";
import { sendBrokenPromiseAlerts } from "../lib/notifications.server";
import { recordSyncError, resolveSyncErrors } from "../lib/sync-errors.server";
import { safeReturnTo } from "../lib/return-to";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const qbo = getQboEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const sep = returnTo.includes("?") ? "&" : "?";

  const service = createSupabaseServiceClient(env);

  // Wire broken-promise notification so manual refresh doesn't silently
  // consume the one-shot promise transition without alerting.
  const emailEnv = getEmailEnvOrNull(context as any);
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
  try {
    await syncOverdueInvoices(deps, org.org_id);
    // Resolve ONLY this path's own scope. A manual refresh pulls overdue invoices
    // (Balance>0 AND DueDate<today) + their payments — it is NOT a full catch-up,
    // so it must not clear webhook/cdc errors for entities it never re-fetched
    // (e.g. a payment that zeroed an invoice). Those clear on the next cron CDC
    // catch-up (a true re-pull) or a successful webhook retry.
    await resolveSyncErrors(service, { orgId: org.org_id, scope: "full" });
    return redirect(`${returnTo}${sep}sync=ok`, { headers });
  } catch (err) {
    // Log before recording (mirrors the cron + webhook paths) so a failure is
    // visible to operators even if the DB record itself fails.
    console.error("[refresh] sync failed for org", org.org_id, ":", err);
    await recordSyncError(service, {
      orgId: org.org_id, source: "manual", scope: "full",
      message: err instanceof Error ? err.message : String(err),
    }).catch(() => {}); // best-effort: never mask the original failure
    // e.g. QBO not connected, or a transient API error.
    return redirect(`${returnTo}${sep}sync=error`, { headers });
  }
}

export function loader() {
  return redirect("/dashboard");
}
