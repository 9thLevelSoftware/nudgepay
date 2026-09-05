import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getQboEnvOrNull } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { disconnectConnection } from "../lib/qbo-connection.server";
import {
  billingBlocksWorkspaceDeletion,
  workspaceDeletionDecision,
  workspaceDeletionQboPlan,
  workspaceDeletionRpcError,
  type WorkspaceDeletionProviderError,
} from "../lib/workspace-deletion";
import { safeReturnTo } from "../lib/return-to";

function flag(returnTo: string, key: string, val: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}${key}=${val}`;
}

async function providerDeletionBlocker(
  service: ReturnType<typeof createSupabaseServiceClient>,
  orgId: string,
): Promise<WorkspaceDeletionProviderError | null> {
  const [billing, checkout, sms, email] = await Promise.all([
    service.from("org_billing")
      .select("status, stripe_subscription_id")
      .eq("org_id", orgId)
      .maybeSingle(),
    service.from("billing_checkout_attempts")
      .select("id")
      .eq("org_id", orgId)
      .in("state", ["reserved", "ready", "unknown"])
      .limit(1),
    service.from("text_messages")
      .select("id")
      .eq("org_id", orgId)
      .eq("direction", "outbound")
      .in("status", ["sending", "unknown"])
      .limit(1),
    service.from("email_messages")
      .select("id")
      .eq("org_id", orgId)
      .eq("direction", "outbound")
      .in("status", ["sending", "unknown"])
      .limit(1),
  ]);

  if (billing.error || checkout.error || sms.error || email.error) return "workspace";
  if (billingBlocksWorkspaceDeletion(billing.data)) return "billing";
  if (checkout.data?.length || sms.data?.length || email.data?.length) return "pending";
  return null;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id, request, headers);
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

  // Avoid disconnecting QuickBooks when current provider state already makes
  // deletion ineligible. The RPC repeats this check under provider locks.
  const providerBlocker = await providerDeletionBlocker(service, org.org_id);
  if (providerBlocker) {
    return redirect(flag(returnTo, "deleteError", providerBlocker), { headers });
  }

  const { data: qboConnection, error: qboConnectionError } = await service
    .from("qbo_connections")
    .select("access_token_enc, refresh_token_enc")
    .eq("org_id", org.org_id)
    .maybeSingle();
  if (qboConnectionError) {
    return redirect(flag(returnTo, "deleteError", "workspace"), { headers });
  }
  const hasAccessToken = Boolean(qboConnection?.access_token_enc);
  const hasRefreshToken = Boolean(qboConnection?.refresh_token_enc);
  const qbo = getQboEnvOrNull(context as any);
  const qboPlan = workspaceDeletionQboPlan({
    hasAccessToken,
    hasRefreshToken,
    configured: Boolean(qbo),
  });
  if (qboPlan === "blocked") {
    return redirect(flag(returnTo, "deleteError", "qbo-revoke"), { headers });
  }
  if (qboPlan === "disconnect") {
    if (!qbo) {
      return redirect(flag(returnTo, "deleteError", "qbo-revoke"), { headers });
    }
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
      return redirect(flag(returnTo, "deleteError", "qbo-revoke"), { headers });
    }
  }

  const { error } = await service.rpc("delete_workspace", {
    p_org_id: org.org_id,
    p_deleted_by: user.id,
    p_org_name: orgName,
    p_member_count: 0,
  });
  if (error) {
    return redirect(flag(returnTo, "deleteError", workspaceDeletionRpcError(error)), { headers });
  }

  await supabase.auth.signOut();
  return redirect("/login", { headers });
}

export function loader() {
  return redirect("/settings");
}
