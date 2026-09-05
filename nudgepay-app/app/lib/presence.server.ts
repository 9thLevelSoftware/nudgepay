import type { SupabaseClient } from "@supabase/supabase-js";

export type HeartbeatRow = { customer_id: string; user_id: string; last_seen_at: string };

// Keep PostgREST GET URLs comfortably below proxy request-target limits when a
// large queue supplies thousands of UUIDs.
export const PRESENCE_CUSTOMER_ID_BATCH_SIZE = 100;
const PRESENCE_READ_CONCURRENCY = 4;

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

  // `.in()` serializes IDs into the request URL. De-duplicate first to retain
  // its set semantics while keeping each request bounded.
  const customerIds = [...new Set(args.customerIds)];
  const batches = Array.from(
    { length: Math.ceil(customerIds.length / PRESENCE_CUSTOMER_ID_BATCH_SIZE) },
    (_, index) => customerIds.slice(
      index * PRESENCE_CUSTOMER_ID_BATCH_SIZE,
      (index + 1) * PRESENCE_CUSTOMER_ID_BATCH_SIZE,
    ),
  );
  const batchRows: HeartbeatRow[][] = new Array(batches.length);
  let nextBatchIndex = 0;
  let failed = false;
  let failure: unknown;

  async function readNextBatch(): Promise<void> {
    while (nextBatchIndex < batches.length) {
      if (failed) throw failure;
      const batchIndex = nextBatchIndex++;
      try {
        const { data, error } = await service
          .from("case_presence")
          .select("customer_id, user_id, last_seen_at")
          .eq("org_id", args.orgId)
          .in("customer_id", batches[batchIndex]);
        if (error) throw error;
        batchRows[batchIndex] = (data as HeartbeatRow[]) ?? [];
      } catch (error) {
        failed = true;
        failure = error;
        throw error;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PRESENCE_READ_CONCURRENCY, batches.length) }, readNextBatch),
  );
  return batchRows.flat();
}
