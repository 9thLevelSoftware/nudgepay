import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import { reconcileCases } from "./cases";
import { chunkIds, keysetAfter, orderPage, pageAllKeyset, PAGE_ALL_MAX_ROWS } from "./page-all";

// Reconcile collection_cases for one org against the current overdue set.
// Org-scoped on every query. Idempotent: the partial unique index makes a
// concurrent duplicate "open" a no-op (conflict is swallowed).
export async function applyCaseReconciliation(
  client: SupabaseClient, orgId: string, today: string,
): Promise<{ opened: number; resolved: number }> {
  const overduePage = await pageAllKeyset<{ customer_id: string | null; created_at: string; id: string }>(
    (cursor, from, to) =>
      keysetAfter(
        orderPage(
          client
            .from("invoices")
            .select("customer_id, created_at, id", { count: "exact" })
            .eq("org_id", orgId)
            .gt("balance", 0)
            .lt("due_date", today)
            .not("customer_id", "is", null),
        ),
        cursor,
      ).range(from, to),
    { maxRows: PAGE_ALL_MAX_ROWS },
  );
  if (overduePage.truncated) {
    throw new Error("reconciliation truncated: overdue invoice page is incomplete");
  }
  const overdueCustomerIds = new Set(
    overduePage.rows.map((r) => r.customer_id as string).filter(Boolean),
  );

  const openPage = await pageAllKeyset<{ id: string; customer_id: string; created_at: string }>(
    (cursor, from, to) =>
      keysetAfter(
        orderPage(
          client
            .from("collection_cases")
            .select("id, customer_id, created_at", { count: "exact" })
            .eq("org_id", orgId)
            .is("closed_at", null),
        ),
        cursor,
      ).range(from, to),
    { maxRows: PAGE_ALL_MAX_ROWS },
  );
  if (openPage.truncated) {
    throw new Error("reconciliation truncated: open case page is incomplete");
  }
  const openCases = openPage.rows.map((r) => ({ id: r.id as string, customerId: r.customer_id as string }));

  const ops = reconcileCases(overdueCustomerIds, openCases, today);

  // Keyset cannot see an older invoice that entered the overdue predicate after
  // its (created_at, id) cursor passed. Recheck close candidates before resolving.
  const resolveOps = ops.filter((op): op is { kind: "resolve"; caseId: string } => op.kind === "resolve");
  const stillOverdue = new Set<string>();
  if (resolveOps.length > 0) {
    const resolveCaseIds = new Set(resolveOps.map((op) => op.caseId));
    const candidateIds = openCases
      .filter((c) => resolveCaseIds.has(c.id))
      .map((c) => c.customerId);
    for (const chunk of chunkIds(candidateIds)) {
      const recheck = await pageAllKeyset<{ customer_id: string | null; created_at: string; id: string }>(
        (cursor, from, to) =>
          keysetAfter(
            orderPage(
              client
                .from("invoices")
                .select("customer_id, created_at, id", { count: "exact" })
                .eq("org_id", orgId)
                .gt("balance", 0)
                .lt("due_date", today)
                .not("customer_id", "is", null)
                .in("customer_id", chunk),
            ),
            cursor,
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      );
      if (recheck.truncated) {
        throw new Error("reconciliation truncated: overdue recheck page is incomplete");
      }
      for (const row of recheck.rows) {
        if (row.customer_id) stillOverdue.add(row.customer_id);
      }
    }
  }

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
      const customerId = openCases.find((c) => c.id === op.caseId)?.customerId;
      if (customerId && stillOverdue.has(customerId)) continue;
      const { data: updated, error } = await client.from("collection_cases")
        .update({ status: "resolved", closed_at: new Date().toISOString(), next_action_at: null })
        .eq("id", op.caseId)
        .eq("org_id", orgId)
        .select("id");
      if (error) throw error;
      if (updated && updated.length > 0) resolved += 1;
    }
  }
  return { opened, resolved };
}
