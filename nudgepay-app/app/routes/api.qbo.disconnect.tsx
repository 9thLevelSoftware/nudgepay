import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getQboEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { disconnectConnection } from "../lib/qbo-connection.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const qbo = getQboEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org || org.role !== "owner") return redirect("/dashboard?qbo=forbidden", { headers });
  const service = createSupabaseServiceClient(env);
  const cfg = {
    clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI,
  };
  await disconnectConnection(fetch, service, cfg, qbo.QBO_ENCRYPTION_KEY, org.org_id);
  return redirect("/dashboard?qbo=disconnected", { headers });
}

export function loader() {
  return redirect("/dashboard");
}
