import { redirect, type LoaderFunctionArgs } from "react-router";
import { getEnv, getQboEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { consumeOAuthState } from "../lib/oauth-state.server";
import { exchangeCodeForTokens } from "../lib/qbo-client.server";
import { storeConnection } from "../lib/qbo-connection.server";

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
  try {
    const service = createSupabaseServiceClient(env);
    const orgId = await consumeOAuthState(service, state); // throws on invalid/expired/replay
    const tokens = await exchangeCodeForTokens(fetch, cfg, code);
    await storeConnection(service, qbo.QBO_ENCRYPTION_KEY, orgId, realmId, tokens);
    return redirect("/dashboard?qbo=connected");
  } catch {
    return redirect("/dashboard?qbo=error");
  }
}
