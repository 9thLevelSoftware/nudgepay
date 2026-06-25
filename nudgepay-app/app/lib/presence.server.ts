import type { SupabaseClient } from "@supabase/supabase-js";

export type HeartbeatRow = { customer_id: string; user_id: string; last_seen_at: string };

// Upsert the caller's heartbeat for one customer. RLS pins user_id = auth.uid().
// Binds org_id. Throws on error (the route catches — heartbeats are best-effort).
export async function recordHeartbeat(
  service: SupabaseClient,
  args: { orgId: string; customerId: string; userId: string },
): Promise<void> {
  const { error } = await service.from("case_presence").upsert(
    {
      org_id: args.orgId,
      customer_id: args.customerId,
      user_id: args.userId,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "org_id,customer_id,user_id" },
  );
  if (error) throw error;
}

// Org-scoped presence read for the given customers. Returns [] for empty input.
// Binds org_id (RLS permits every member org, so scope explicitly). Throws on error;
// the loader decides how to handle it (presence read degrades gracefully).
export async function readPresence(
  service: SupabaseClient,
  args: { orgId: string; customerIds: string[] },
): Promise<HeartbeatRow[]> {
  if (args.customerIds.length === 0) return [];
  const { data, error } = await service
    .from("case_presence")
    .select("customer_id, user_id, last_seen_at")
    .eq("org_id", args.orgId)
    .in("customer_id", args.customerIds);
  if (error) throw error;
  return (data as HeartbeatRow[]) ?? [];
}
