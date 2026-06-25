import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getQboEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { qboApiBaseUrl } from "../lib/qbo-api.server";
import { syncOverdueInvoices, type SyncDeps } from "../lib/qbo-sync.server";
import { recordSyncError, resolveSyncErrors } from "../lib/sync-errors.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const qbo = getQboEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return redirect("/onboarding", { headers });

  const service = createSupabaseServiceClient(env);
  const deps: SyncDeps = {
    fetchFn: fetch,
    service,
    cfg: { clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI },
    api: { baseUrl: qboApiBaseUrl(qbo.QBO_SANDBOX) },
    key: qbo.QBO_ENCRYPTION_KEY,
  };
  try {
    await syncOverdueInvoices(deps, org.org_id);
    await resolveSyncErrors(service, { orgId: org.org_id }); // full sync heals all prior errors
    return redirect("/dashboard?sync=ok", { headers });
  } catch (err) {
    await recordSyncError(service, {
      orgId: org.org_id, source: "manual", scope: "full",
      message: err instanceof Error ? err.message : String(err),
    }).catch(() => {}); // best-effort: never mask the original failure
    // e.g. QBO not connected, or a transient API error.
    return redirect("/dashboard?sync=error", { headers });
  }
}

export function loader() {
  return redirect("/dashboard");
}
