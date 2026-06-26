import type { SupabaseClient } from "@supabase/supabase-js";
import { requiresReviewDate } from "./exceptions";
import type { ExceptionReason } from "./contact-log";

// The forward-action fields parsed from a contact log (subset of ContactLogFields).
export type NextStepInput = {
  nextStep: "follow_up" | "promise" | "waiting" | "exception";
  followUpAt: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
  reviewAt: string | null;
  exceptionReason: ExceptionReason | null;
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
    // exception: terminal states (legal_agency, do_not_contact) leave
    // next_action_at null so nothing auto-resurfaces them; review-dated
    // states keep their review date.
    const state = f.exceptionReason;
    const keepReview = state != null && requiresReviewDate(state);
    update = {
      status: "on_hold",
      next_action_type: "exception",
      next_action_at: keepReview ? f.reviewAt : null,
      exception_reason: state,
      exception_note: f.exceptionNote,
    };
  }

  const { error } = await client.from("collection_cases").update(update).eq("id", caseId);
  if (error) return { ok: false };
  return { ok: true };
}
