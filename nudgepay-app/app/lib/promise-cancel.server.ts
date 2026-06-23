import type { SupabaseClient } from "@supabase/supabase-js";

// Cancels a pending promise (RLS-scoped client) and resets the case to a
// follow-up next action. Rejects if the promise is not pending or not visible.
export async function cancelPromise(
  client: SupabaseClient, promiseId: string, today: string,
): Promise<{ ok: boolean }> {
  const { data: updated, error } = await client.from("promises")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("id", promiseId).eq("status", "pending")
    .select("id, case_id");
  if (error) return { ok: false };
  if (!updated || updated.length === 0) return { ok: false };

  const caseId = updated[0].case_id as string;
  const { error: cErr } = await client.from("collection_cases")
    .update({ status: "working", next_action_type: "follow_up", next_action_at: today })
    .eq("id", caseId);
  if (cErr) return { ok: false };
  return { ok: true };
}
