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
  paid_date?: string | null;
};

function money(v: unknown): number {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

export function qboCustomerName(c: any): string {
  const name = String(c?.DisplayName ?? c?.FullyQualifiedName ?? c?.CompanyName ?? "").trim();
  return name;
}

export function mapQboCustomer(c: any, orgId: string): CustomerUpsert {
  return {
    org_id: orgId,
    qbo_id: String(c.Id),
    name: qboCustomerName(c) || "(unnamed)",
    email: c.PrimaryEmailAddr?.Address ?? null,
    phone: c.PrimaryPhone?.FreeFormNumber ?? null,
  };
}

/** Calendar compare (YYYY-MM-DD). Due today is still open — never UTC-midnight skew. */
export function invoiceStatusOn(balance: number, dueDate: string | null, today: string): string {
  if (balance <= 0) return "paid";
  if (dueDate && dueDate < today) return "overdue";
  return "open";
}

export function invoiceStatus(balance: number, dueDate: string | null, now: Date): string {
  return invoiceStatusOn(balance, dueDate, now.toISOString().slice(0, 10));
}

export function isQboVoidOrDeleted(raw: unknown): boolean {
  if (raw == null || typeof raw !== "object") return false;
  const rec = raw as Record<string, unknown>;
  const status = String(rec.status ?? rec.Status ?? "");
  if (/^(deleted|void)$/i.test(status)) return true;
  if (rec.active === false || rec.Active === false) return true;
  return false;
}

export function mapQboInvoice(
  inv: any, orgId: string, customerId: string | null, now: Date = new Date(),
  today?: string,
): InvoiceUpsert {
  const voided = isQboVoidOrDeleted(inv);
  const balance = voided ? 0 : money(inv.Balance);
  const due_date = inv.DueDate ?? null;
  const day = today ?? now.toISOString().slice(0, 10);
  return {
    org_id: orgId,
    qbo_id: String(inv.Id),
    qbo_doc_number: inv.DocNumber ?? null,
    customer_id: customerId,
    amount: money(inv.TotalAmt),
    balance,
    due_date,
    invoice_date: inv.TxnDate ?? null,
    status: invoiceStatusOn(balance, due_date, day),
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
