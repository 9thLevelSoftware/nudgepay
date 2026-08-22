// Pure invoice-mode worklist. No I/O. Dashboard maps overdue ∪ coming-due
// open-balance invoices onto rows; caseless rows stay in the list.

import type { ActivityPeek } from "./activity-peek";
import type { PayerStats } from "./payer-behavior";
import {
  ageInDays, heatOf, HIGH_VALUE_THRESHOLD,
  type Heat, type LastContact, type SortId, type ViewId,
  type InvoiceInput, type CustomerInput,
} from "./worklist";

export type InvoiceQueueItem = {
  invoiceId: string;
  caseId: string | null;
  customerId: string | null;
  customerName: string;
  docNumber: string | null;
  balance: number;
  amount: number;
  dueDate: string | null;
  invoiceDate: string | null;
  ageDays: number;
  heat: Heat;
  owner: string;
  ownerId: string | null;
  lastContact: LastContact;
  peeks: ActivityPeek[];
  payer: PayerStats | null;
  suppressed: boolean;
  searchText: string;
};

export function buildInvoiceQueue(args: {
  invoices: InvoiceInput[];
  casesByCustomer: Map<string, { caseId: string; lastContact: LastContact; peeks: ActivityPeek[]; suppressed?: boolean }>;
  customers: CustomerInput[];
  ownerLabels: Map<string, string>;
  payerByCustomer: Map<string, PayerStats>;
  today: string;
}): InvoiceQueueItem[] {
  const customerById = new Map(args.customers.map((c) => [c.id, c]));
  const out: InvoiceQueueItem[] = [];

  for (const inv of args.invoices) {
    const balance = Number(inv.balance || 0);
    if (balance <= 0) continue;
    const cust = inv.customer_id ? customerById.get(inv.customer_id) ?? null : null;
    const ageDays = inv.due_date ? ageInDays(inv.due_date, args.today) : 0;
    const name = cust?.name ?? "(unknown customer)";
    const ownerId = cust?.owner ?? null;
    const ownerLabel = ownerId ? (args.ownerLabels.get(ownerId) ?? "Unknown") : "Unassigned";
    const cse = inv.customer_id ? args.casesByCustomer.get(inv.customer_id) ?? null : null;
    // Coming-due (not yet past due) stays caseless so the row is awareness,
    // not a collections case — j/k opens /accounts/:id.
    const caseId = ageDays <= 0 ? null : (cse?.caseId ?? null);
    out.push({
      invoiceId: inv.id,
      caseId,
      customerId: inv.customer_id,
      customerName: name,
      docNumber: inv.qbo_doc_number,
      balance,
      amount: Number(inv.amount ?? 0),
      dueDate: inv.due_date,
      invoiceDate: inv.invoice_date ?? null,
      ageDays,
      heat: heatOf(ageDays),
      owner: ownerLabel,
      ownerId,
      lastContact: caseId ? (cse?.lastContact ?? null) : null,
      peeks: caseId ? (cse?.peeks ?? []) : [],
      payer: inv.customer_id ? args.payerByCustomer.get(inv.customer_id) ?? null : null,
      suppressed: caseId ? (cse?.suppressed ?? false) : false,
      searchText: [name, inv.qbo_doc_number ?? "", cust?.phone ?? "", cust?.email ?? "", ownerLabel].join(" ").toLowerCase(),
    });
  }

  return out;
}

export function sortInvoiceItems(items: InvoiceQueueItem[], sort: SortId): InvoiceQueueItem[] {
  const copy = [...items];
  if (sort === "most-overdue") return copy.sort((a, b) => b.ageDays - a.ageDays);
  if (sort === "highest-balance") return copy.sort((a, b) => b.balance - a.balance);
  if (sort === "customer") return copy.sort((a, b) => a.customerName.localeCompare(b.customerName));
  if (sort === "due-date") {
    return copy.sort((a, b) => {
      if (a.dueDate == null && b.dueDate == null) return 0;
      if (a.dueDate == null) return 1;
      if (b.dueDate == null) return -1;
      return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
    });
  }
  // recommended: hottest / oldest / highest
  return copy.sort((a, b) => b.ageDays - a.ageDays || b.balance - a.balance);
}

export function applyInvoiceView(
  items: InvoiceQueueItem[],
  view: ViewId,
  opts: {
    matchingCaseIds: Set<string>;
    currentUserId: string | null;
    highValue?: number;
  },
): InvoiceQueueItem[] {
  const highValue = opts.highValue ?? HIGH_VALUE_THRESHOLD;
  const byMatchingCase = () =>
    items.filter((i) => i.caseId != null && opts.matchingCaseIds.has(i.caseId));
  switch (view) {
    case "coming-due":
      return [];
    case "30-plus":
      return items.filter((i) => i.ageDays >= 30 && !i.suppressed);
    case "high-value":
      return items.filter((i) => i.balance >= highValue && !i.suppressed);
    case "never-contacted":
      return items.filter((i) => i.lastContact === null && !i.suppressed);
    case "follow-ups-due":
    case "broken-promises":
    case "waiting":
      return byMatchingCase();
    case "on-hold":
      return items.filter((i) => i.suppressed);
    case "my-work":
      return items.filter((i) => i.ownerId != null && i.ownerId === opts.currentUserId);
    case "all-open":
      return items.filter((i) => !i.suppressed);
    default: {
      const _exhaustive: never = view;
      return _exhaustive;
    }
  }
}

/** Select-all cap: cased invoices belong to at most `maxCases`; caseless rows are uncapped. */
export function clampInvoiceBatch(
  items: { invoiceId: string; caseId: string | null }[],
  maxCases: number,
): string[] {
  const cases = new Set<string>();
  const out: string[] = [];
  for (const i of items) {
    if (i.caseId == null) {
      out.push(i.invoiceId);
      continue;
    }
    if (!cases.has(i.caseId) && cases.size >= maxCases) continue;
    cases.add(i.caseId);
    out.push(i.invoiceId);
  }
  return out;
}
