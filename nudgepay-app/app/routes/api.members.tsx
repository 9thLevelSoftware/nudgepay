import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getPublicBaseUrls, getEmailEnvOrNull, resendTransport } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { safeReturnTo } from "../lib/return-to";
import { trySendInviteEmail } from "../lib/invite-email.server";
import { assignableRoles, hasPermission, parseRole } from "../lib/roles";

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
  const intent = form.get("intent");

  if (intent === "invite") {
    if (!hasPermission(org.role, "manageMembers")) return redirect(flag(returnTo, "error", "forbidden"), { headers });
    const email = typeof form.get("email") === "string" ? (form.get("email") as string).trim().toLowerCase() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return redirect(flag(returnTo, "error", "invite"), { headers });
    }
    const { data, error } = await supabase.from("invites")
      .insert({ org_id: org.org_id, email }).select("token").single();
    if (error) return redirect(flag(returnTo, "error", "invite"), { headers });
    const service = createSupabaseServiceClient(env);
    const base = getPublicBaseUrls(context as any).appBaseUrl ?? new URL(request.url).origin;
    const link = `${base.replace(/\/$/, "")}/accept/${data!.token}`;
    let sentFlag = "0";
    try {
      const { data: orgRow } = await service.from("organizations")
        .select("name").eq("id", org.org_id).maybeSingle();
      const emailEnv = getEmailEnvOrNull(context as any);
      const sent = await trySendInviteEmail(
        {
          fetchFn: fetch,
          service,
          email: emailEnv ? resendTransport(emailEnv) : null,
        },
        {
          orgId: org.org_id,
          orgName: ((orgRow?.name as string) ?? "").trim() || "your workspace",
          to: email,
          acceptUrl: link,
        },
      );
      sentFlag = sent === "sent" ? "1" : "0";
    } catch {
      // Invite row already exists — still return the copyable link.
    }
    return redirect(
      flag(flag(returnTo, "invite_link", encodeURIComponent(link)), "invite_sent", sentFlag),
      { headers },
    );
  }

  if (intent === "remove") {
    if (!hasPermission(org.role, "manageMembers")) return redirect(flag(returnTo, "error", "forbidden"), { headers });
    const memberId = typeof form.get("userId") === "string" ? (form.get("userId") as string) : "";
    if (!memberId || memberId === user.id) return redirect(flag(returnTo, "error", "member"), { headers });
    const { data: target } = await supabase.from("memberships")
      .select("role").eq("org_id", org.org_id).eq("user_id", memberId).maybeSingle();
    if (target?.role === "owner" && !hasPermission(org.role, "manageOwners")) {
      return redirect(flag(returnTo, "error", "forbidden"), { headers });
    }
    const { data, error } = await supabase.from("memberships")
      .delete().eq("org_id", org.org_id).eq("user_id", memberId).select("user_id");
    if (error || !data?.length) return redirect(flag(returnTo, "error", "member"), { headers });
    return redirect(flag(returnTo, "saved", "member"), { headers });
  }

  if (intent === "role") {
    if (!hasPermission(org.role, "manageMembers")) return redirect(flag(returnTo, "error", "forbidden"), { headers });
    const memberId = typeof form.get("userId") === "string" ? (form.get("userId") as string) : "";
    const nextRole = parseRole(typeof form.get("role") === "string" ? (form.get("role") as string) : "");
    if (!memberId || !nextRole || !assignableRoles(org.role).includes(nextRole)) {
      return redirect(flag(returnTo, "error", "member"), { headers });
    }
    const { data: target } = await supabase.from("memberships")
      .select("role").eq("org_id", org.org_id).eq("user_id", memberId).maybeSingle();
    if (target?.role === "owner" && !hasPermission(org.role, "manageOwners")) {
      return redirect(flag(returnTo, "error", "forbidden"), { headers });
    }
    const { data, error } = await supabase.from("memberships")
      .update({ role: nextRole }).eq("org_id", org.org_id).eq("user_id", memberId).select("user_id");
    if (error || !data?.length) return redirect(flag(returnTo, "error", "member"), { headers });
    return redirect(flag(returnTo, "saved", "member"), { headers });
  }

  if (intent === "revoke") {
    if (!hasPermission(org.role, "manageMembers")) return redirect(flag(returnTo, "error", "forbidden"), { headers });
    const inviteId = String(form.get("inviteId") ?? "");
    if (!inviteId) return redirect(flag(returnTo, "error", "revoke"), { headers });
    const { data, error } = await supabase.from("invites")
      .delete().eq("org_id", org.org_id).eq("id", inviteId).is("accepted_at", null).select("id");
    if (error || !data?.length) return redirect(flag(returnTo, "error", "revoke"), { headers });
    return redirect(returnTo, { headers });
  }

  if (intent === "leave") {
    const { data, error } = await supabase.from("memberships")
      .delete().eq("org_id", org.org_id).eq("user_id", user.id).select("user_id");
    if (error || !data?.length) return redirect(flag(returnTo, "error", "member"), { headers });
    return redirect("/onboarding", { headers });
  }

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/settings");
}
