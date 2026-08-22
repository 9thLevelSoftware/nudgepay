// Paid-invoice days-to-pay + payer band. Reply counts come from loadReplySource
// (customer-scoped) — never from the case-scoped peek query.

import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkIds, pageAllChunked, PAGE_ALL_MAX_ROWS } from "./page-all";
import {
  buildPayerStats,
  daysToPay,
  replyRate,
  type PayerStats,
} from "./payer-behavior";

type PaidInvoiceRow = {
  customer_id: string | null;
  invoice_date: string | null;
  paid_date: string | null;
};

export async function loadPayerSource(args: {
  supabase: SupabaseClient;
  orgId: string;
  customerIds: string[];
  today: string;
  brokenPromiseByCustomer: Map<string, boolean>;
  replyByCustomer?: Map<string, { inbound: number; outbound: number }>;
}): Promise<Map<string, PayerStats>> {
  const { supabase, orgId, today, brokenPromiseByCustomer } = args;
  const replyByCustomer = args.replyByCustomer ?? new Map();
  const customerIds = args.customerIds.filter(Boolean);
  if (customerIds.length === 0) return new Map();

  const chunks = chunkIds(customerIds, 100);
  const started = Date.now();
  const paid = await pageAllChunked<PaidInvoiceRow>(
    chunks,
    (ids, from, to) =>
      supabase
        .from("invoices")
        .select("customer_id, invoice_date, paid_date", { count: "exact" })
        .eq("org_id", orgId)
        .in("customer_id", ids)
        .not("paid_date", "is", null)
        .order("paid_date", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    { maxRows: PAGE_ALL_MAX_ROWS },
  );

  console.info({
    event: "load_payer_source",
    orgId,
    rows: paid.rows.length,
    truncated: paid.truncated,
    ms: Date.now() - started,
    today,
  });

  const invoicesByCustomer = new Map<string, { invoiceDate: string | null; paidDate: string | null }[]>();
  for (const r of paid.rows) {
    if (!r.customer_id) continue;
    const list = invoicesByCustomer.get(r.customer_id) ?? [];
    if (list.length >= 12) continue;
    list.push({ invoiceDate: r.invoice_date, paidDate: r.paid_date });
    invoicesByCustomer.set(r.customer_id, list);
  }

  const out = new Map<string, PayerStats>();
  for (const customerId of customerIds) {
    const invoices = invoicesByCustomer.get(customerId) ?? [];
    const dtp = daysToPay(invoices);
    const reply = replyByCustomer.get(customerId) ?? { inbound: 0, outbound: 0 };
    const rate = replyRate(reply.outbound, reply.inbound);
    out.set(customerId, buildPayerStats({
      daysToPay: dtp,
      paidSample: invoices.filter((i) => i.invoiceDate && i.paidDate).length,
      replyRate: rate,
      outbound: reply.outbound,
      inbound: reply.inbound,
      brokenPromise: brokenPromiseByCustomer.get(customerId) ?? false,
    }));
  }
  return out;
}
