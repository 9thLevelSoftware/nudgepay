import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"), "/settings");

  const raw = form.get("display_name");
  const displayName = typeof raw === "string" ? raw.trim() : "";
  if (!displayName || displayName.length > 80) {
    return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=invalid-name`, { headers });
  }

  const { error } = await supabase.auth.updateUser({
    data: { display_name: displayName },
  });
  if (error) {
    return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=profile-save-failed`, { headers });
  }

  return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}saved=profile`, { headers });
}
