// Pure translation from QBO API payloads to our row shapes. No I/O.
// Money is NaN-guarded (never write NaN into a numeric column). Invoice
// status is anchored on DUE DATE per the domain rules.

export type CustomerUpsert = {
  org_id: string;
  qbo_id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

export type InvoiceUpsert = {
  org_id: string;
  qbo_id: string;
  qbo_doc_number: string | null;
  customer_id: string | null;
  amount: number;
  balance: number;
  due_date: string | null;
  invoice_date: string | null;
  status: string;
  qbo_sync_at: string;
};

function money(v: unknown): number {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

export function mapQboCustomer(c: any, orgId: string): CustomerUpsert {
  return {
    org_id: orgId,
    qbo_id: String(c.Id),
    name: c.DisplayName ?? c.FullyQualifiedName ?? c.CompanyName ?? "(unnamed)",
    email: c.PrimaryEmailAddr?.Address ?? null,
    phone: c.PrimaryPhone?.FreeFormNumber ?? null,
  };
}

export function invoiceStatus(balance: number, dueDate: string | null, now: Date): string {
  if (balance <= 0) return "paid";
  if (dueDate && new Date(`${dueDate}T00:00:00Z`).getTime() < now.getTime()) return "overdue";
  return "open";
}

export function mapQboInvoice(
  inv: any, orgId: string, customerId: string | null, now: Date = new Date(),
): InvoiceUpsert {
  const balance = money(inv.Balance);
  const due_date = inv.DueDate ?? null;
  return {
    org_id: orgId,
    qbo_id: String(inv.Id),
    qbo_doc_number: inv.DocNumber ?? null,
    customer_id: customerId,
    amount: money(inv.TotalAmt),
    balance,
    due_date,
    invoice_date: inv.TxnDate ?? null,
    status: invoiceStatus(balance, due_date, now),
    qbo_sync_at: now.toISOString(),
  };
}

export type PaymentUpsert = {
  org_id: string;
  qbo_id: string;
  type: "payment" | "credit_memo";
  customer_id: string | null;
  amount: number;
  txn_date: string | null;
  qbo_sync_at: string;
};

export function mapQboPayment(
  raw: any, type: "payment" | "credit_memo", orgId: string,
  customerId: string | null, now: Date = new Date(),
): PaymentUpsert {
  return {
    org_id: orgId,
    qbo_id: String(raw.Id),
    type,
    customer_id: customerId,
    amount: money(raw.TotalAmt),
    txn_date: raw.TxnDate ?? null,
    qbo_sync_at: now.toISOString(),
  };
}
