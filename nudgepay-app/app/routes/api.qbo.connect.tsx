import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getQboEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createOAuthState } from "../lib/oauth-state.server";
import { buildAuthorizeUrl } from "../lib/qbo-client.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const qbo = getQboEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org || org.role !== "owner") {
    return redirect("/dashboard?qbo=forbidden", { headers });
  }
  const service = createSupabaseServiceClient(env);
  const state = await createOAuthState(service, org.org_id);
  const url = buildAuthorizeUrl(
    { clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI },
    state,
  );
  return redirect(url, { headers });
}

// No loader/component: this is a POST-only action endpoint.
export function loader() {
  return redirect("/dashboard");
}
