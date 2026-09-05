import type { SupabaseClient } from "@supabase/supabase-js";
import { displayLabel } from "./names";
import { DEFAULT_SMS_TEMPLATES } from "./sms-templates";
import { DEFAULT_EMAIL_TEMPLATES } from "./email-templates";
import { AlreadyInWorkspaceError } from "./org-membership";

export type UserWorkspace = { orgId: string; name: string; role: string };

export async function listUserWorkspaces(
  service: SupabaseClient,
  userId: string,
): Promise<UserWorkspace[]> {
  const { data, error } = await service
    .from("memberships")
    .select("org_id, role, organizations(name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const org = r.organizations as { name: string } | { name: string }[] | null;
    const name = Array.isArray(org) ? org[0]?.name : org?.name;
    return {
      orgId: r.org_id as string,
      name: (name ?? "").trim() || "Workspace",
      role: r.role as string,
    };
  });
}

export async function acceptInvite(
  service: SupabaseClient,
  token: string,
  userId: string,
  userEmail: string
): Promise<string> {
  const { data: orgId, error: rpcErr } = await service.rpc("accept_invite", {
    p_token: token,
    p_user_id: userId,
    p_email: userEmail,
  });
  if (rpcErr) {
    const msg = rpcErr.message ?? "";
    if (msg.includes("already in a workspace")) throw new AlreadyInWorkspaceError();
    if (msg.includes("Invite not found")) throw new Error("Invite not found");
    if (msg.includes("Invite email missing")) throw new Error("Invite email missing");
    if (msg.includes("different email address")) {
      throw new Error("This invite was sent to a different email address");
    }
    if (msg.includes("already been used") || msg.includes("already accepted")) {
      throw new Error("Invite already accepted");
    }
    if (msg.includes("Invite expired")) throw new Error("Invite expired");
    throw rpcErr;
  }
  return orgId as string;
}

export async function createOrgForUser(
  service: SupabaseClient,
  userId: string,
  name: string
): Promise<string> {
  const { data: orgId, error: rpcErr } = await service.rpc("create_pilot_workspace", {
    p_user_id: userId,
    p_name: name,
  });
  if (rpcErr) {
    if ((rpcErr.message ?? "").includes("Pilot workspace capacity reached")) {
      throw new Error("Pilot workspace capacity reached");
    }
    throw rpcErr;
  }
  if (!orgId) throw new Error("org insert failed");

  // Seed default message templates. Best-effort — if this fails, resolveTemplates
  // falls back to the hardcoded defaults, so a failure here is never fatal.
  const templateRows = [
    ...DEFAULT_SMS_TEMPLATES.map((t, i) => ({
      org_id: orgId, channel: "sms", slug: t.id, label: t.label,
      subject: null, body: t.body, sort: i,
    })),
    ...DEFAULT_EMAIL_TEMPLATES.map((t, i) => ({
      org_id: orgId, channel: "email", slug: t.id, label: t.label,
      subject: t.subject, body: t.body, sort: i,
    })),
  ];
  try {
    await service.from("message_templates").insert(templateRows);
  } catch {
    // best-effort — resolveTemplates() falls back to defaults if this row set is missing
  }

  return orgId as string;
}

export type OrgMember = { userId: string; email: string; label: string; role: string };

// Roster of the org's members with display labels. Uses the SERVICE client
// because member emails live in auth.users, which the RLS user client cannot
// read. Looks up each membership user id (never the project-wide 1,000-user list).
export async function listOrgMembers(
  service: SupabaseClient,
  orgId: string,
): Promise<OrgMember[]> {
  const { data: rows, error } = await service
    .from("memberships").select("user_id, role").eq("org_id", orgId);
  if (error) throw error;
  const members: OrgMember[] = [];
  for (const row of rows ?? []) {
    const userId = row.user_id as string;
    const { data, error: userErr } = await service.auth.admin.getUserById(userId);
    if (userErr) throw userErr;
    const u = data.user;
    const email = u?.email ?? "";
    members.push({
      userId,
      email,
      label: displayLabel(u?.user_metadata?.display_name, email, userId),
      role: (row.role as string) || "member",
    });
  }
  members.sort((a, b) => a.label.localeCompare(b.label));
  return members;
}
