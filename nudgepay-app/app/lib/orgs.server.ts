import type { SupabaseClient } from "@supabase/supabase-js";

export async function acceptInvite(
  service: SupabaseClient,
  token: string,
  userId: string,
  userEmail: string
): Promise<string> {
  const { data: inv, error } = await service
    .from("invites").select("id, org_id, email, accepted_at").eq("token", token).maybeSingle();
  if (error) throw error;
  if (!inv) throw new Error("Invite not found");
  if (!inv.email || !userEmail) throw new Error("Invite email missing");
  if (inv.email.toLowerCase() !== userEmail.toLowerCase())
    throw new Error("This invite was sent to a different email address");
  if (inv.accepted_at) throw new Error("Invite already accepted");

  const { error: memErr } = await service
    .from("memberships").insert({ org_id: inv.org_id, user_id: userId, role: "member" });
  // 23505 = unique_violation: user already a member (race or repeat) -> treat as success
  if (memErr && (memErr as any).code !== "23505") throw memErr;

  const { error: stampErr } = await service.from("invites")
    .update({ accepted_at: new Date().toISOString() }).eq("id", inv.id).is("accepted_at", null);
  if (stampErr) throw stampErr;
  return inv.org_id as string;
}

export async function createOrgForUser(
  service: SupabaseClient,
  userId: string,
  name: string
): Promise<string> {
  const { data: org, error: orgErr } = await service
    .from("organizations").insert({ name }).select("id").single();
  if (orgErr || !org) throw orgErr ?? new Error("org insert failed");

  const { error: memErr } = await service
    .from("memberships").insert({ org_id: org.id, user_id: userId, role: "owner" });
  if (memErr) {
    await service.from("organizations").delete().eq("id", org.id); // compensate
    throw memErr;
  }
  return org.id as string;
}

export type OrgMember = { userId: string; email: string; label: string };

// Roster of the org's members with display labels. Uses the SERVICE client
// because member emails live in auth.users, which the RLS user client cannot
// read (same own-org exception as connection status). label = email local-part.
export async function listOrgMembers(
  service: SupabaseClient,
  orgId: string,
): Promise<OrgMember[]> {
  const { data: rows, error } = await service
    .from("memberships").select("user_id").eq("org_id", orgId);
  if (error) throw error;
  const memberIds = new Set((rows ?? []).map((r) => r.user_id as string));
  if (memberIds.size === 0) return [];

  const { data: list, error: listErr } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const emailById = new Map(list.users.map((u) => [u.id, u.email ?? ""]));

  const members: OrgMember[] = [...memberIds].map((userId) => {
    const email = emailById.get(userId) ?? "";
    const label = email ? email.split("@")[0] : userId.slice(0, 8);
    return { userId, email, label };
  });
  members.sort((a, b) => a.label.localeCompare(b.label));
  return members;
}
