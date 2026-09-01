import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { orgCookieHeader, requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const form = await request.formData();
  const raw = form.get("orgId");
  const orgId = typeof raw === "string" ? raw : "";
  const returnTo = safeReturnTo(form.get("returnTo"), "/dashboard");
  const org = await resolveOrg(supabase, user.id, orgId);
  if (!org || org.org_id !== orgId) return redirect(returnTo, { headers });
  headers.append("Set-Cookie", orgCookieHeader(org.org_id));
  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
