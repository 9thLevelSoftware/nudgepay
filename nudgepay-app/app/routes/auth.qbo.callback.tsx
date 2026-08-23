import { redirect, type LoaderFunctionArgs } from "react-router";
import { getEnv, getQboEnv, getEmailEnvOrNull, resendTransport } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { consumeOAuthState } from "../lib/oauth-state.server";
import { exchangeCodeForTokens } from "../lib/qbo-client.server";
import { storeConnection, disconnectConnection } from "../lib/qbo-connection.server";
import { qboApiBaseUrl, qboReadCompanyInfo } from "../lib/qbo-api.server";
import { isSupportedQboCompany } from "../lib/qbo-company";
import { syncOverdueInvoices, type SyncDeps } from "../lib/qbo-sync.server";
import { sendBrokenPromiseAlerts } from "../lib/notifications.server";
import { recordSyncError } from "../lib/sync-errors.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const qbo = getQboEnv(context as any);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError || !code || !realmId || !state) {
    return redirect("/dashboard?qbo=error");
  }
  const cfg = {
    clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI,
  };
  const { supabase, headers, user } = await requireUser(request, env);
  try {
    const service = createSupabaseServiceClient(env);
    const oauthState = await consumeOAuthState(service, state); // throws on invalid/expired/replay
    const org = await resolveOrg(supabase, user.id);
    if (!org || org.role !== "owner" || org.org_id !== oauthState.orgId || user.id !== oauthState.userId) {
      return redirect("/dashboard?qbo=forbidden", { headers });
    }
    const tokens = await exchangeCodeForTokens(fetch, cfg, code);
    await storeConnection(service, qbo.QBO_ENCRYPTION_KEY, oauthState.orgId, realmId, tokens);
    const orgId = oauthState.orgId;
    const api = { baseUrl: qboApiBaseUrl(qbo.QBO_SANDBOX) };
    const key = qbo.QBO_ENCRYPTION_KEY;
    try {
      const company = await qboReadCompanyInfo(fetch, api, tokens.accessToken, realmId);
      if (!company || !isSupportedQboCompany(company)) {
        await disconnectConnection(fetch, service, cfg, key, orgId).catch(() => {});
        return redirect(company ? "/dashboard?qbo=unsupported" : "/dashboard?qbo=error", { headers });
      }
    } catch {
      await disconnectConnection(fetch, service, cfg, key, orgId).catch(() => {});
      return redirect("/dashboard?qbo=error", { headers });
    }
    const ctx = (context as { cloudflare?: { ctx?: { waitUntil?: (p: Promise<unknown>) => void } } })
      .cloudflare?.ctx;
    const emailEnv = getEmailEnvOrNull(context as any);
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
      cfg,
      api,
      key,
      notify,
      errorSource: "manual",
    };
    const backfill = syncOverdueInvoices(deps, orgId).catch(async (err) => {
      console.error("[qbo-callback] first sync failed for org", orgId, err);
      await recordSyncError(service, {
        orgId, source: "manual", scope: "full",
        message: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    });
    if (ctx?.waitUntil) ctx.waitUntil(backfill);
    else await backfill;
    return redirect("/dashboard?qbo=connected", { headers });
  } catch {
    return redirect("/dashboard?qbo=error");
  }
}
