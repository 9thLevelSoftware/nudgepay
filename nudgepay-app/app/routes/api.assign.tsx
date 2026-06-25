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
  const customerId = typeof form.get("customerId") === "string" ? (form.get("customerId") as string) : "";
  const ownerRaw = form.get("ownerId");
  const ownerId = typeof ownerRaw === "string" && ownerRaw.length > 0 ? ownerRaw : null;
  if (!customerId) return redirect(returnTo, { headers });

  // Explicit org-scope guard: bind to the resolved dashboard org — RLS alone permits every org
  // the caller is a member of, so a multi-org user could otherwise touch another org's customer.
  const { data: cust } = await supabase
    .from("customers").select("id").eq("org_id", org.org_id).eq("id", customerId).maybeSingle();
  if (!cust) return redirect(returnTo, { headers });

  // Membership guard: never assign to a user outside the caller's org.
  if (ownerId) {
    const { data: member } = await supabase
      .from("memberships").select("user_id").eq("org_id", org.org_id).eq("user_id", ownerId).maybeSingle();
    if (!member) return redirect(returnTo, { headers });
  }

  const { error } = await supabase.from("customers")
    .update({ owner: ownerId }).eq("org_id", org.org_id).eq("id", customerId);
  // Don't swallow a failed write — a silent redirect would imply the assignment
  // saved when it didn't. Surface it to the error boundary.
  if (error) throw new Error(`Failed to assign owner: ${error.message}`);
  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
