import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { isLastOwnerMember } from "../lib/account-deletion";
import { personalAccountDeletionDecision } from "../lib/personal-account-deletion";
import { safeReturnTo } from "../lib/return-to";

function flag(returnTo: string, key: string, val: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}${key}=${val}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id, request);
  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"), org ? "/settings" : "/onboarding");
  const service = createSupabaseServiceClient(env);

  let isLastOwner = false;
  if (org) {
    const { data: memRows, error: memErr } = await service
      .from("memberships")
      .select("user_id, role")
      .eq("org_id", org.org_id);
    if (memErr) {
      return redirect(flag(returnTo, "accountError", "account"), { headers });
    }
    const ownerCount = (memRows ?? []).filter((m) => m.role === "owner").length;
    isLastOwner = isLastOwnerMember(org.role === "owner", ownerCount);
  }

  const decision = personalAccountDeletionDecision({
    confirm: form.get("confirm"),
    currentEmail: user.email ?? "",
    isLastOwner,
  });
  if (!decision.ok) {
    return redirect(flag(returnTo, "accountError", decision.error), { headers });
  }

  const { error } = await service.auth.admin.deleteUser(user.id);
  if (error) {
    const lastOwnerRace = /last owner/i.test(error.message ?? "");
    return redirect(flag(returnTo, "accountError", lastOwnerRace ? "last-owner" : "account"), { headers });
  }

  await supabase.auth.signOut();
  return redirect("/login", { headers });
}

export function loader() {
  return redirect("/settings");
}
