import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import { reconcileCases } from "./cases";

// Reconcile collection_cases for one org against the current overdue set.
// Org-scoped on every query. Idempotent: the partial unique index makes a
// concurrent duplicate "open" a no-op (conflict is swallowed).
export async function applyCaseReconciliation(
  client: SupabaseClient, orgId: string, today: string,
): Promise<{ opened: number; resolved: number }> {
  const { data: overdue, error: oErr } = await client
    .from("invoices")
    .select("customer_id")
    .eq("org_id", orgId)
    .gt("balance", 0)
    .lt("due_date", today)
    .not("customer_id", "is", null);
  if (oErr) throw oErr;
  const overdueCustomerIds = new Set(
    (overdue ?? []).map((r) => r.customer_id as string).filter(Boolean),
  );

  const { data: open, error: cErr } = await client
    .from("collection_cases")
    .select("id, customer_id")
    .eq("org_id", orgId)
    .is("closed_at", null);
  if (cErr) throw cErr;
  const openCases = (open ?? []).map((r) => ({ id: r.id as string, customerId: r.customer_id as string }));

  const ops = reconcileCases(overdueCustomerIds, openCases, today);

  let opened = 0;
  let resolved = 0;
  for (const op of ops) {
    if (op.kind === "open") {
      const { error } = await client.from("collection_cases").insert({
        org_id: orgId, customer_id: op.customerId,
        status: "new", next_action_type: "contact", next_action_at: today,
      });
      // 23505 = unique_violation (a concurrent reconcile already opened it): no-op.
      if (error && (error as PostgrestError).code !== "23505") throw error;
      if (!error) opened += 1;
    } else {
      const { data: updated, error } = await client.from("collection_cases")
        .update({ status: "resolved", closed_at: new Date().toISOString(), next_action_at: null })
        .eq("id", op.caseId)
        .select("id");
      if (error) throw error;
      if (updated && updated.length > 0) resolved += 1;
    }
  }
  return { opened, resolved };
}
