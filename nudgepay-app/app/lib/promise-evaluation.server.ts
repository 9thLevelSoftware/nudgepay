import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import { chunkIds, orderPage, pageAll, pageAllChunked, PAGE_ALL_MAX_ROWS } from "./page-all";
import {
  evaluatePromises,
  sumLinkedBalances,
  type PromiseEvalRow,
  type PromiseStatus,
} from "./promises";

// Recompute pending promises for one org against current linked-invoice balances.
// Org-scoped on every query (service client at the sync layer). Idempotent: only
// `pending` promises transition; terminal states are skipped by the pure evaluator.
export type BrokenPromiseDetail = {
  promiseId: string;
  caseId: string;
  promisedAmount: number;
  promisedDate: string;
};

type PendingRow = {
  id: string;
  status: PromiseStatus;
  promised_amount: number | string | null;
  promised_date: string | null;
  baseline_balance: number | string | null;
  grace_until: string;
  case_id: string;
  created_at: string;
};

type LinkRow = { promise_id: string; invoice_id: string };
type InvRow = { id: string; balance: number | string | null; created_at: string };

export async function applyPromiseEvaluation(
  client: SupabaseClient, orgId: string, today: string,
): Promise<{ kept: number; partiallyKept: number; broken: number; brokenDetails: BrokenPromiseDetail[] }> {
  const pendingPage = await pageAll<PendingRow>(
    (from, to) =>
      orderPage(
        client
          .from("promises")
          .select(
            "id, status, promised_amount, promised_date, baseline_balance, grace_until, case_id, created_at",
            { count: "exact" },
          )
          .eq("org_id", orgId)
          .eq("status", "pending"),
      ).range(from, to),
    { maxRows: PAGE_ALL_MAX_ROWS },
  );
  if (pendingPage.truncated) {
    throw new Error("promise evaluation truncated: pending promise page is incomplete");
  }
  const promises = pendingPage.rows;
  if (promises.length === 0) return { kept: 0, partiallyKept: 0, broken: 0, brokenDetails: [] };

  // Map case_id for case-state reflection on broken promises.
  const caseByPromise = new Map(promises.map((p) => [p.id as string, p.case_id as string]));

  const ids = promises.map((p) => p.id as string);
  const linksPage = await pageAllChunked<LinkRow>(
    chunkIds(ids, 100),
    (chunk, from, to) =>
      client
        .from("promise_invoices")
        .select("promise_id, invoice_id", { count: "exact" })
        .eq("org_id", orgId)
        .in("promise_id", chunk)
        .order("promise_id", { ascending: false })
        .order("invoice_id", { ascending: false })
        .range(from, to),
    { maxRows: PAGE_ALL_MAX_ROWS },
  );
  if (linksPage.truncated) {
    throw new Error("promise evaluation truncated: promise invoice links page is incomplete");
  }

  const invoiceIds = [...new Set(linksPage.rows.map((l) => l.invoice_id as string))];
  const invPage = invoiceIds.length === 0
    ? { rows: [] as InvRow[], truncated: false }
    : await pageAllChunked<InvRow>(
        chunkIds(invoiceIds, 100),
        (chunk, from, to) =>
          orderPage(
            client
              .from("invoices")
              .select("id, balance, created_at", { count: "exact" })
              .eq("org_id", orgId)
              .in("id", chunk),
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      );
  if (invPage.truncated) {
    throw new Error("promise evaluation truncated: invoice page is incomplete");
  }

  // Credit memos that reduce invoice balance still count: QBO balance is the source of truth.
  const balanceByInvoice = new Map<string, number>();
  for (const inv of invPage.rows) balanceByInvoice.set(inv.id as string, Number(inv.balance) || 0);

  // Missing id after this complete map: deleted invoice → $0 remaining (documented).
  const balanceByPromiseId = sumLinkedBalances(
    linksPage.rows.map((l) => ({ promiseId: l.promise_id as string, invoiceId: l.invoice_id as string })),
    balanceByInvoice,
  );

  const rows: PromiseEvalRow[] = promises.map((p) => ({
    id: p.id as string,
    status: p.status as PromiseStatus,
    promisedAmount: Number(p.promised_amount) || 0,
    baselineBalance: Number(p.baseline_balance) || 0,
    graceUntil: p.grace_until as string,
  }));

  const ops = evaluatePromises(rows, balanceByPromiseId, today);

  // Map promise id → promised_date for broken-detail surfacing.
  const promisedDateByPromise = new Map(promises.map((p) => [p.id as string, p.promised_date as string | null]));

  let kept = 0, partiallyKept = 0, broken = 0;
  const brokenDetails: BrokenPromiseDetail[] = [];
  for (const op of ops) {
    const { data: updated, error } = await client.from("promises")
      .update({ status: op.status, amount_received: op.amountReceived, resolved_at: new Date().toISOString() })
      .eq("id", op.promiseId).eq("org_id", orgId).eq("status", "pending") // guard against a concurrent transition
      .select("id");
    if (error) throw error as PostgrestError;
    if (!updated || updated.length === 0) continue;

    if (op.status === "kept") kept += 1;
    else if (op.status === "partially_kept") partiallyKept += 1;
    else if (op.status === "broken") {
      broken += 1;
      const caseId = caseByPromise.get(op.promiseId);
      if (caseId) {
        // Closed or missing cases: 0-row UPDATE is a no-op (do not reopen).
        const { error: cErr } = await client.from("collection_cases")
          .update({ status: "working", next_action_type: "follow_up", next_action_at: today })
          .eq("id", caseId).eq("org_id", orgId).is("closed_at", null);
        if (cErr) throw cErr;
        const promRow = promises.find((p) => (p.id as string) === op.promiseId);
        brokenDetails.push({
          promiseId: op.promiseId,
          caseId,
          promisedAmount: Number(promRow?.promised_amount) || 0,
          promisedDate: promisedDateByPromise.get(op.promiseId) ?? today,
        });
      }
    }
  }
  return { kept, partiallyKept, broken, brokenDetails };
}
