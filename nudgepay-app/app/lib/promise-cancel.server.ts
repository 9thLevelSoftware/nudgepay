import type { SupabaseClient } from "@supabase/supabase-js";

// Cancels a pending promise (RLS-scoped client) and resets the case to a
// follow-up next action. Rejects if the promise is not pending or not visible.
//
// Write order (most recoverable → least recoverable):
// 1. SELECT the promise (validates cross-org guard + pending status via RLS).
// 2. UPDATE the case → working/follow_up (if this fails, nothing has changed).
// 3. UPDATE the promise → cancelled (terminal). If this fails, the case is
//    working with the promise still pending — the cancel button still shows and
//    promise evaluation still runs, so the state is recoverable.
export async function cancelPromise(
  client: SupabaseClient, promiseId: string, orgId: string, today: string,
): Promise<{ ok: boolean }> {
  // Step 1: SELECT — validates org membership (RLS) and that promise is pending.
  const { data: prom, error: selErr } = await client.from("promises")
    .select("id, case_id")
    .eq("org_id", orgId)
    .eq("id", promiseId)
    .eq("status", "pending")
    .maybeSingle();
  if (selErr || !prom) return { ok: false };

  const caseId = prom.case_id as string;

  // Step 2: UPDATE the case — if this fails, the promise is still pending (consistent).
  const { error: cErr } = await client.from("collection_cases")
    .update({ status: "working", next_action_type: "follow_up", next_action_at: today })
    .eq("org_id", orgId)
    .eq("id", caseId);
  if (cErr) return { ok: false };

  // Step 3: UPDATE the promise (terminal write — last).
  const { data: cancelled, error: pErr } = await client.from("promises")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", promiseId)
    .eq("status", "pending")
    .select("id");
  if (pErr || !cancelled || cancelled.length === 0) return { ok: false };

  return { ok: true };
}
