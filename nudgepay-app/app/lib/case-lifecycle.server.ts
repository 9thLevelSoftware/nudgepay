import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import { reconcileCases } from "./cases";
import { orderPage, pageAll, PAGE_ALL_MAX_ROWS } from "./page-all";

// Reconcile collection_cases for one org against the current overdue set.
// Org-scoped on every query. Idempotent: the partial unique index makes a
// concurrent duplicate "open" a no-op (conflict is swallowed).
export async function applyCaseReconciliation(
  client: SupabaseClient, orgId: string, today: string,
): Promise<{ opened: number; resolved: number }> {
  const overduePage = await pageAll<{ customer_id: string | null }>(
    (from, to) =>
      orderPage(
        client
          .from("invoices")
          .select("customer_id", { count: "exact" })
          .eq("org_id", orgId)
          .gt("balance", 0)
          .lt("due_date", today)
          .not("customer_id", "is", null),
      ).range(from, to),
    { maxRows: PAGE_ALL_MAX_ROWS },
  );
  if (overduePage.truncated) {
    throw new Error("reconciliation truncated: overdue invoice page is incomplete");
  }
  const overdueCustomerIds = new Set(
    overduePage.rows.map((r) => r.customer_id as string).filter(Boolean),
  );

  const openPage = await pageAll<{ id: string; customer_id: string }>(
    (from, to) =>
      orderPage(
        client
          .from("collection_cases")
          .select("id, customer_id", { count: "exact" })
          .eq("org_id", orgId)
          .is("closed_at", null),
      ).range(from, to),
    { maxRows: PAGE_ALL_MAX_ROWS },
  );
  if (openPage.truncated) {
    throw new Error("reconciliation truncated: open case page is incomplete");
  }
  const openCases = openPage.rows.map((r) => ({ id: r.id as string, customerId: r.customer_id as string }));

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
