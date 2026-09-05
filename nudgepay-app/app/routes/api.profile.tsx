import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getQboEnvOrNull } from "../lib/env.server";
import { clearOrgCookieHeader, requireUser, resolveOrg } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { safeReturnTo } from "../lib/return-to";
import { passwordChangeDecision, passwordChangeVerifyFlash } from "../lib/password-change";
import { emailChangeDecision } from "../lib/email-change";
import {
  accountDeletionDecision,
  isLastOwnerMember,
  shouldDisconnectQboOnAccountDelete,
} from "../lib/account-deletion";
import { disconnectConnection, getConnectionStatus } from "../lib/qbo-connection.server";

function flag(returnTo: string, key: string, val: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}${key}=${val}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id, request, headers);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"), "/settings");

  if (form.get("intent") === "email") {
    const decision = emailChangeDecision(form.get("new_email"), user.email ?? "");
    if (!decision.ok) {
      return redirect(flag(returnTo, "error", decision.error), { headers });
    }
    if (decision.noop) {
      return redirect(returnTo, { headers });
    }
    const { error } = await supabase.auth.updateUser({ email: decision.email });
    if (error) {
      return redirect(flag(returnTo, "error", "email"), { headers });
    }
    return redirect(flag(returnTo, "saved", "email"), { headers });
  }

  if (form.get("intent") === "delete") {
    const service = createSupabaseServiceClient(env);
    const { data: memRows, error: memErr } = await service
      .from("memberships")
      .select("user_id, role")
      .eq("org_id", org.org_id);
    if (memErr) {
      return redirect(flag(returnTo, "error", "delete"), { headers });
    }
    const ownerCount = (memRows ?? []).filter((m) => m.role === "owner").length;
    const otherMemberCount = (memRows ?? []).filter((m) => m.user_id !== user.id).length;
    const decision = accountDeletionDecision({
      confirm: form.get("confirm"),
      currentEmail: user.email ?? "",
      isLastOwner: isLastOwnerMember(org.role === "owner", ownerCount),
    });
    if (!decision.ok) {
      return redirect(flag(returnTo, "error", decision.error), { headers });
    }

    const conn = await getConnectionStatus(service, org.org_id);
    if (shouldDisconnectQboOnAccountDelete(conn?.status === "connected", otherMemberCount)) {
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
          // Best-effort: still wipe memberships and sign out.
        }
      }
    }

    const { error } = await service
      .from("memberships")
      .delete()
      .eq("user_id", user.id)
      .eq("org_id", org.org_id);
    if (error) {
      const lastOwnerRace = /last owner/i.test(error.message ?? "");
      return redirect(flag(returnTo, "error", lastOwnerRace ? "last-owner" : "delete"), { headers });
    }
    headers.append("Set-Cookie", clearOrgCookieHeader());
    await supabase.auth.signOut();
    return redirect("/login", { headers });
  }

  if (form.get("intent") === "password") {
    const decision = passwordChangeDecision({
      currentPassword: form.get("current_password"),
      newPassword: form.get("new_password"),
      confirmPassword: form.get("confirm_password"),
    });
    if (!decision.ok) {
      return redirect(flag(returnTo, "error", decision.error), { headers });
    }

    const email = user.email ?? "";
    if (!email) {
      return redirect(flag(returnTo, "error", "password"), { headers });
    }

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: decision.currentPassword,
    });
    if (verifyError) {
      return redirect(flag(returnTo, "error", passwordChangeVerifyFlash(verifyError.message)), { headers });
    }

    const { error } = await supabase.auth.updateUser({ password: decision.newPassword });
    if (error) {
      return redirect(flag(returnTo, "error", "password"), { headers });
    }
    return redirect(flag(returnTo, "saved", "password"), { headers });
  }

  const raw = form.get("display_name");
  const displayName = typeof raw === "string" ? raw.trim() : "";
  if (!displayName || displayName.length > 80) {
    return redirect(flag(returnTo, "error", "invalid-name"), { headers });
  }

  const { error } = await supabase.auth.updateUser({
    data: { display_name: displayName },
  });
  if (error) {
    return redirect(flag(returnTo, "error", "profile-save-failed"), { headers });
  }

  return redirect(flag(returnTo, "saved", "profile"), { headers });
}
