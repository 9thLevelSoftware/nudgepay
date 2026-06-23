import type { SupabaseClient } from "@supabase/supabase-js";

// The forward-action fields parsed from a contact log (subset of ContactLogFields).
export type NextStepInput = {
  nextStep: "follow_up" | "promise" | "waiting" | "exception";
  followUpAt: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
  reviewAt: string | null;
  exceptionReason: "disputed" | "payment_plan" | "do_not_contact" | "other" | null;
  exceptionNote: string | null;
};

// Applies a non-promise nextStep to a case (the promise branch is handled by the
// caller via createPromiseForLog). All writes go through the supplied user/RLS
// client. waiting/exception first cancel any pending promise so the evaluator
// cannot later flip the deferred case back to working.
export async function applyNextStep(
  client: SupabaseClient, caseId: string, f: NextStepInput,
): Promise<{ ok: boolean }> {
  if (f.nextStep === "waiting" || f.nextStep === "exception") {
    const { error: cancelErr } = await client
      .from("promises")
      .update({ status: "cancelled", resolved_at: new Date().toISOString() })
      .eq("case_id", caseId).eq("status", "pending");
    if (cancelErr) return { ok: false };
  }

  let update: Record<string, unknown>;
  if (f.nextStep === "follow_up") {
    update = { status: "working", next_action_type: "follow_up", next_action_at: f.followUpAt, exception_reason: null, exception_note: null };
  } else if (f.nextStep === "waiting") {
    update = { status: "waiting", next_action_type: "waiting", next_action_at: f.reviewAt, exception_reason: null, exception_note: null };
  } else {
    // exception
    update = { status: "on_hold", next_action_type: "exception", next_action_at: f.reviewAt, exception_reason: f.exceptionReason, exception_note: f.exceptionNote };
  }

  const { error } = await client.from("collection_cases").update(update).eq("id", caseId);
  if (error) return { ok: false };
  return { ok: true };
}
