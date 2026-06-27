import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { getEnv, getQboEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { getOptionalUser, requireUser, resolveOrg } from "../lib/session.server";
import { disconnectConnection } from "../lib/qbo-connection.server";
import { intuitDisconnectPlan } from "../lib/auth-flow.server";
import { safeReturnTo } from "../lib/return-to";

function qboCfg(qbo: ReturnType<typeof getQboEnv>) {
  return { clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI };
}

// In-app "Disconnect" button: owner-gated POST.
export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const qbo = getQboEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org || org.role !== "owner") return redirect("/dashboard?qbo=forbidden", { headers });
  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const sep = returnTo.includes("?") ? "&" : "?";
  const service = createSupabaseServiceClient(env);
  await disconnectConnection(fetch, service, qboCfg(qbo), qbo.QBO_ENCRYPTION_KEY, org.org_id);
  return redirect(`${returnTo}${sep}qbo=disconnected`, { headers });
}

// Intuit Disconnect URL landing: Intuit redirects the user's browser here after
// they disconnect from Intuit's My Apps. Intuit has already revoked on their
// side, so clear our now-stale tokens for the caller's org and render a
// confirmation (no redirect — the user may not be in an app session flow).
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const qbo = getQboEnv(context as any);
  // Intuit's browser likely lacks our session cookie, so we must NOT throw a
  // redirect to /login here (that would defeat the endpoint). Use the optional
  // primitive: clear tokens only when we can resolve a session to an org,
  // otherwise just render the confirmation.
  const { supabase, headers, user } = await getOptionalUser(request, env);
  const org = user ? await resolveOrg(supabase, user.id) : null;
  const plan = intuitDisconnectPlan(org);
  if (plan.clear && plan.orgId) {
    const service = createSupabaseServiceClient(env);
    await disconnectConnection(fetch, service, qboCfg(qbo), qbo.QBO_ENCRYPTION_KEY, plan.orgId);
  }
  const html =
    "<!doctype html><meta charset=utf-8><title>Disconnected</title>" +
    "<main style=\"max-width:480px;margin:64px auto;font-family:sans-serif\">" +
    "<h1>QuickBooks disconnected</h1><p>Your QuickBooks Online connection has been " +
    "removed and stored tokens were cleared. You can reconnect any time from your " +
    "NudgePay dashboard.</p></main>";
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(html, { status: 200, headers });
}
