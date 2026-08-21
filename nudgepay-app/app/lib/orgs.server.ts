import type { SupabaseClient } from "@supabase/supabase-js";
import { displayLabel } from "./names";
import { DEFAULT_SMS_TEMPLATES } from "./sms-templates";
import { DEFAULT_EMAIL_TEMPLATES } from "./email-templates";
import {
  AlreadyInWorkspaceError,
  canJoinOrg,
} from "./org-membership";

function isUniqueViolation(err: { code?: string } | null | undefined): boolean {
  return err?.code === "23505";
}

async function existingOrgId(service: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await service
    .from("memberships").select("org_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return (data?.org_id as string | undefined) ?? null;
}

export async function acceptInvite(
  service: SupabaseClient,
  token: string,
  userId: string,
  userEmail: string
): Promise<string> {
  const { data: inv, error } = await service
    .from("invites").select("id, org_id, email, accepted_at, expires_at").eq("token", token).maybeSingle();
  if (error) throw error;
  if (!inv) throw new Error("Invite not found");
  if (!inv.email || !userEmail) throw new Error("Invite email missing");
  if (inv.email.toLowerCase() !== userEmail.toLowerCase())
    throw new Error("This invite was sent to a different email address");
  if (inv.accepted_at) throw new Error("Invite already accepted");
  if (inv.expires_at && new Date(inv.expires_at as string).getTime() <= Date.now()) {
    throw new Error("Invite expired");
  }

  const targetOrgId = inv.org_id as string;
  const decision = canJoinOrg(await existingOrgId(service, userId), targetOrgId);
  if (decision === "already_in_workspace") throw new AlreadyInWorkspaceError();
  if (decision === "join") {
    const { error: memErr } = await service
      .from("memberships").insert({ org_id: targetOrgId, user_id: userId, role: "member" });
    if (memErr) {
      // 23505: same-org race → success; different-org unique(user_id) → reject.
      if (!isUniqueViolation(memErr)) throw memErr;
      const again = await existingOrgId(service, userId);
      if (canJoinOrg(again, targetOrgId) !== "already_member") {
        throw new AlreadyInWorkspaceError();
      }
    }
  }

  const { error: stampErr } = await service.from("invites")
    .update({ accepted_at: new Date().toISOString() }).eq("id", inv.id).is("accepted_at", null);
  if (stampErr) throw stampErr;
  return targetOrgId;
}

export async function createOrgForUser(
  service: SupabaseClient,
  userId: string,
  name: string
): Promise<string> {
  if (canJoinOrg(await existingOrgId(service, userId)) !== "join") {
    throw new AlreadyInWorkspaceError();
  }

  const { data: org, error: orgErr } = await service
    .from("organizations").insert({ name }).select("id").single();
  if (orgErr || !org) throw orgErr ?? new Error("org insert failed");

  const { error: memErr } = await service
    .from("memberships").insert({ org_id: org.id, user_id: userId, role: "owner" });
  if (memErr) {
    await service.from("organizations").delete().eq("id", org.id); // compensate
    if (isUniqueViolation(memErr)) throw new AlreadyInWorkspaceError();
    throw memErr;
  }

  // Seed default message templates. Best-effort — if this fails, resolveTemplates
  // falls back to the hardcoded defaults, so a failure here is never fatal.
  const templateRows = [
    ...DEFAULT_SMS_TEMPLATES.map((t, i) => ({
      org_id: org.id, channel: "sms", slug: t.id, label: t.label,
      subject: null, body: t.body, sort: i,
    })),
    ...DEFAULT_EMAIL_TEMPLATES.map((t, i) => ({
      org_id: org.id, channel: "email", slug: t.id, label: t.label,
      subject: t.subject, body: t.body, sort: i,
    })),
  ];
  try {
    await service.from("message_templates").insert(templateRows);
  } catch {
    // best-effort — resolveTemplates() falls back to defaults if this row set is missing
  }

  return org.id as string;
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
