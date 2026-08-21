import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";
import { passwordChangeDecision, passwordChangeVerifyFlash } from "../lib/password-change";

function flag(returnTo: string, key: string, val: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}${key}=${val}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"), "/settings");

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
