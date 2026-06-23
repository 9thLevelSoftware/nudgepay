import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import { evaluatePromises, type PromiseEvalRow, type PromiseStatus } from "./promises";

// Recompute pending promises for one org against current linked-invoice balances.
// Org-scoped on every query (service client at the sync layer). Idempotent: only
// `pending` promises transition; terminal states are skipped by the pure evaluator.
export async function applyPromiseEvaluation(
  client: SupabaseClient, orgId: string, today: string,
): Promise<{ kept: number; partiallyKept: number; broken: number }> {
  const { data: pend, error: pErr } = await client
    .from("promises")
    .select("id, status, promised_amount, baseline_balance, grace_until, case_id")
    .eq("org_id", orgId)
    .eq("status", "pending");
  if (pErr) throw pErr;
  const promises = pend ?? [];
  if (promises.length === 0) return { kept: 0, partiallyKept: 0, broken: 0 };

  // Map case_id for case-state reflection on broken promises.
  const caseByPromise = new Map(promises.map((p) => [p.id as string, p.case_id as string]));

  const ids = promises.map((p) => p.id as string);
  const { data: links, error: lErr } = await client
    .from("promise_invoices")
    .select("promise_id, invoice_id")
    .eq("org_id", orgId)
    .in("promise_id", ids);
  if (lErr) throw lErr;

  const invoiceIds = [...new Set((links ?? []).map((l) => l.invoice_id as string))];
  const balanceByInvoice = new Map<string, number>();
  if (invoiceIds.length > 0) {
    const { data: invs, error: iErr } = await client
      .from("invoices").select("id, balance").eq("org_id", orgId).in("id", invoiceIds);
    if (iErr) throw iErr;
    for (const inv of invs ?? []) balanceByInvoice.set(inv.id as string, Number(inv.balance) || 0);
  }

  const balanceByPromiseId = new Map<string, number>();
  for (const l of links ?? []) {
    const prev = balanceByPromiseId.get(l.promise_id as string) ?? 0;
    balanceByPromiseId.set(l.promise_id as string, prev + (balanceByInvoice.get(l.invoice_id as string) ?? 0));
  }

  const rows: PromiseEvalRow[] = promises.map((p) => ({
    id: p.id as string,
    status: p.status as PromiseStatus,
    promisedAmount: Number(p.promised_amount) || 0,
    baselineBalance: Number(p.baseline_balance) || 0,
    graceUntil: p.grace_until as string,
  }));

  const ops = evaluatePromises(rows, balanceByPromiseId, today);

  let kept = 0, partiallyKept = 0, broken = 0;
  for (const op of ops) {
    const { data: updated, error } = await client.from("promises")
      .update({ status: op.status, amount_received: op.amountReceived, resolved_at: new Date().toISOString() })
      .eq("id", op.promiseId).eq("status", "pending") // guard against a concurrent transition
      .select("id");
    if (error) throw error as PostgrestError;
    if (!updated || updated.length === 0) continue;

    if (op.status === "kept") kept += 1;
    else if (op.status === "partially_kept") partiallyKept += 1;
    else if (op.status === "broken") {
      broken += 1;
      const caseId = caseByPromise.get(op.promiseId);
      if (caseId) {
        const { error: cErr } = await client.from("collection_cases")
          .update({ status: "working", next_action_type: "follow_up", next_action_at: today })
          .eq("id", caseId);
        if (cErr) throw cErr;
      }
    }
  }
  return { kept, partiallyKept, broken };
}
