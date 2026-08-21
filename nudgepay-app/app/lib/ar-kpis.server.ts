// Dedicated AR KPI reads (ending AR, sales lookback, window payments).
// Never concat A∪B — open invoices in the last 365d appear in both.

import type { SupabaseClient } from "@supabase/supabase-js";
import { addCalendarDays } from "./business-days";
import { pageAll, PAGE_ALL_MAX_ROWS } from "./page-all";
import {
  AR_SALES_LOOKBACK_DAYS,
  type ArInvoice,
  type ArPayment,
  type ArSalesRow,
} from "./ar-kpis";

// Range pages without ORDER BY can skip/duplicate rows. created_at desc + id
// desc is a stable unique key so equal timestamps cannot slip between pages.
function orderPage(q: { order: (column: string, opts: { ascending: boolean }) => any }): any {
  return q.order("created_at", { ascending: false }).order("id", { ascending: false });
}

function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

type OpenRow = {
  amount: unknown;
  balance: unknown;
  invoice_date: string | null;
  due_date: string | null;
  customer_id: string | null;
};

type SalesRow = {
  amount: unknown;
  invoice_date: string | null;
};

type PaymentRow = {
  amount: unknown;
  txn_date: string | null;
  type: string | null;
};

export type ArKpiSource = {
  open: ArInvoice[];
  salesLookback: ArSalesRow[];
  payments: ArPayment[];
  truncated: { a: boolean; b: boolean; c: boolean };
};

export async function loadArKpiSource(args: {
  supabase: SupabaseClient;
  orgId: string;
  today: string;
  rangeDays: number;
  lookbackDays?: number;
}): Promise<ArKpiSource> {
  const { supabase, orgId, today, rangeDays } = args;
  const lookbackDays = args.lookbackDays ?? AR_SALES_LOOKBACK_DAYS;
  const lookbackStart = addCalendarDays(today, -lookbackDays);
  const windowStart = addCalendarDays(today, -rangeDays);
  const started = Date.now();

  const [a, b, c] = await Promise.all([
    pageAll<OpenRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("invoices")
            .select("amount, balance, invoice_date, due_date, customer_id", { count: "exact" })
            .eq("org_id", orgId)
            .gt("balance", 0),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAll<SalesRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("invoices")
            .select("amount, invoice_date", { count: "exact" })
            .eq("org_id", orgId)
            .not("invoice_date", "is", null)
            .gte("invoice_date", lookbackStart),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAll<PaymentRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("payments")
            .select("amount, txn_date, type", { count: "exact" })
            .eq("org_id", orgId)
            .gte("txn_date", windowStart),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
  ]);

  const truncated = { a: a.truncated, b: b.truncated, c: c.truncated };
  console.info({
    event: "load_ar_kpi_source",
    orgId,
    rows: a.rows.length + b.rows.length + c.rows.length,
    truncated,
    ms: Date.now() - started,
  });

  const open: ArInvoice[] = a.rows.map((r) => ({
    amount: money(r.amount),
    balance: money(r.balance),
    invoiceDate: r.invoice_date ?? null,
    dueDate: r.due_date ?? null,
    customerId: r.customer_id ?? null,
  }));

  const salesLookback: ArSalesRow[] = [];
  for (const r of b.rows) {
    if (!r.invoice_date) continue;
    salesLookback.push({ invoiceDate: r.invoice_date, amount: money(r.amount) });
  }

  const payments: ArPayment[] = [];
  for (const r of c.rows) {
    if (r.type !== "payment" && r.type !== "credit_memo") continue;
    payments.push({
      amount: money(r.amount),
      txnDate: r.txn_date ?? null,
      type: r.type,
    });
  }

  return { open, salesLookback, payments, truncated };
}
