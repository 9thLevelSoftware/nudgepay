import type { SupabaseClient } from "@supabase/supabase-js";

export async function acceptInvite(
  service: SupabaseClient,
  token: string,
  userId: string
): Promise<string> {
  const { data: inv, error } = await service
    .from("invites").select("id, org_id, accepted_at").eq("token", token).single();
  if (error || !inv) throw error ?? new Error("invite not found");
  if (inv.accepted_at) throw new Error("invite already accepted");

  const { error: memErr } = await service
    .from("memberships").insert({ org_id: inv.org_id, user_id: userId, role: "member" });
  if (memErr) throw memErr;

  await service.from("invites").update({ accepted_at: new Date().toISOString() }).eq("id", inv.id);
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
