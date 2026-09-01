import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getQboEnvOrNull } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { disconnectConnection, getConnectionStatus } from "../lib/qbo-connection.server";
import { workspaceDeletionDecision } from "../lib/workspace-deletion";
import { safeReturnTo } from "../lib/return-to";

function flag(returnTo: string, key: string, val: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}${key}=${val}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id, request);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"), "/settings");
  const service = createSupabaseServiceClient(env);

  const { data: orgRow } = await service
    .from("organizations")
    .select("name")
    .eq("id", org.org_id)
    .maybeSingle();
  const orgName = typeof orgRow?.name === "string" ? orgRow.name : "";
  const decision = workspaceDeletionDecision({
    isOwner: org.role === "owner",
    typedName: form.get("confirm"),
    orgName,
  });
  if (!decision.ok) {
    return redirect(flag(returnTo, "deleteError", decision.error), { headers });
  }

  // Re-check owner immediately before QBO revoke (closes demotion TOCTOU vs resolveOrg).
  const { data: stillOwner, error: ownerErr } = await service
    .from("memberships")
    .select("user_id")
    .eq("org_id", org.org_id)
    .eq("user_id", user.id)
    .eq("role", "owner")
    .maybeSingle();
  if (ownerErr) {
    return redirect(flag(returnTo, "deleteError", "workspace"), { headers });
  }
  if (!stillOwner) {
    return redirect(flag(returnTo, "deleteError", "forbidden"), { headers });
  }

  const conn = await getConnectionStatus(service, org.org_id);
  // Revoke whenever a connection row exists (connected or error with
  // refresh_token_enc still stored). disconnectConnection no-ops if tokens
  // are already gone. Fail-open: never skip revoke because status is error.
  if (conn) {
    const qbo = getQboEnvOrNull(context as any);
    if (qbo) {
      try {
        await disconnectConnection(
          fetch,
          service,
          {
            clientId: qbo.QBO_CLIENT_ID,
            clientSecret: qbo.QBO_CLIENT_SECRET,
            redirectUri: qbo.QBO_REDIRECT_URI,
          },
          qbo.QBO_ENCRYPTION_KEY,
          org.org_id,
        );
      } catch {
        // Best-effort revoke; tenant purge still proceeds.
      }
    }
  }

  const { error } = await service.rpc("delete_workspace", {
    p_org_id: org.org_id,
    p_deleted_by: user.id,
    p_org_name: orgName,
    p_member_count: 0,
  });
  if (error) {
    return redirect(flag(returnTo, "deleteError", "workspace"), { headers });
  }

  await supabase.auth.signOut();
  return redirect("/login", { headers });
}

export function loader() {
  return redirect("/settings");
}
