import type { SupabaseClient } from "@supabase/supabase-js";

export type UnmatchedStop = {
  id: string;
  fromNumber: string;
  toNumber: string;
  createdAt: string;
};

/**
 * Recent unmatched inbound STOP rows. `inbound_orphans` has no org_id (A-006);
 * service-role is required (RLS grants service_role only). Owner chrome only —
 * do not call from a member loader.
 */
export async function listRecentUnmatchedStops(
  service: SupabaseClient,
  limit = 20,
): Promise<UnmatchedStop[]> {
  const { data, error } = await service
    .from("inbound_orphans")
    .select("id, from_number, to_number, created_at")
    .eq("keyword", "stop")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[inbound_orphans] unmatched STOP list failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    fromNumber: (r.from_number as string | null) ?? "",
    toNumber: (r.to_number as string | null) ?? "",
    createdAt: r.created_at as string,
  }));
}
