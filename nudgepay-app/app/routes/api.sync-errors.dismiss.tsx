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
  const returnTo = safeReturnTo(form.get("returnTo"));
  const errorId = typeof form.get("id") === "string" ? (form.get("id") as string) : "";
  if (!errorId) return redirect(returnTo, { headers });

  // Org-scoped: RLS permits every org the user belongs to, so bind the update to
  // the active dashboard org as well. Capture the error — a silent redirect would
  // imply the dismiss saved when it didn't.
  const { error } = await supabase.from("sync_errors")
    .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq("org_id", org.org_id).eq("id", errorId);
  if (error) throw new Error(`Failed to dismiss sync error: ${error.message}`);

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
