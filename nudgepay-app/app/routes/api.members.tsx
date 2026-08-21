import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getPublicBaseUrls } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { safeReturnTo } from "../lib/return-to";

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
  const intent = form.get("intent");
  const service = createSupabaseServiceClient(env);

  if (intent === "invite") {
    if (org.role !== "owner") return redirect(flag(returnTo, "error", "forbidden"), { headers });
    const email = typeof form.get("email") === "string" ? (form.get("email") as string).trim().toLowerCase() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return redirect(flag(returnTo, "error", "invite"), { headers });
    }
    const { data, error } = await service.from("invites")
      .insert({ org_id: org.org_id, email }).select("token").single();
    if (error) return redirect(flag(returnTo, "error", "invite"), { headers });
    const base = getPublicBaseUrls(context as any).appBaseUrl ?? new URL(request.url).origin;
    const link = `${base.replace(/\/$/, "")}/accept/${data!.token}`;
    return redirect(flag(returnTo, "invite_link", encodeURIComponent(link)), { headers });
  }

  if (intent === "remove") {
    if (org.role !== "owner") return redirect(flag(returnTo, "error", "forbidden"), { headers });
    const memberId = typeof form.get("userId") === "string" ? (form.get("userId") as string) : "";
    if (!memberId || memberId === user.id) return redirect(flag(returnTo, "error", "member"), { headers });
    const { error } = await service.from("memberships")
      .delete().eq("org_id", org.org_id).eq("user_id", memberId);
    if (error) return redirect(flag(returnTo, "error", "member"), { headers });
    return redirect(flag(returnTo, "saved", "member"), { headers });
  }

  if (intent === "role") {
    if (org.role !== "owner") return redirect(flag(returnTo, "error", "forbidden"), { headers });
    const memberId = typeof form.get("userId") === "string" ? (form.get("userId") as string) : "";
    const role = form.get("role") === "owner" ? "owner" : "member";
    if (!memberId) return redirect(flag(returnTo, "error", "member"), { headers });
    const { error } = await service.from("memberships")
      .update({ role }).eq("org_id", org.org_id).eq("user_id", memberId);
    if (error) return redirect(flag(returnTo, "error", "member"), { headers });
    return redirect(flag(returnTo, "saved", "member"), { headers });
  }

  if (intent === "leave") {
    const { error } = await service.from("memberships")
      .delete().eq("org_id", org.org_id).eq("user_id", user.id);
    if (error) return redirect(flag(returnTo, "error", "member"), { headers });
    return redirect("/onboarding", { headers });
  }

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/settings");
}
