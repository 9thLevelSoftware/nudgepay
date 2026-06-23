// Pure derived-intelligence for the case-centric collections workspace. No I/O,
// no node:*, no .server suffix (imported by route + tests + client components via
// type-only imports). Reuses the invoice-level heat/priority helpers from worklist.ts.

import {
  heatOf, priorityOf, ageInDays, HIGH_VALUE_THRESHOLD,
  type Heat, type Priority, type LastContact, type Metric, type Metrics,
  type ViewId, type SortId, type InvoiceInput, type CustomerInput,
} from "./worklist";
import type { PromiseStatus } from "./promises";
import type { ExceptionReason } from "./contact-log";

export type CasePromiseInput = {
  caseId: string;
  status: PromiseStatus;
  promisedAmount: number;
  promisedDate: string;
  amountReceived: number;
};
export type CaseLastContactInput = { caseId: string; date: string; channel: string };

export type CaseStatus = "new" | "working" | "promised" | "waiting" | "on_hold" | "resolved";
export type NextActionType = "contact" | "follow_up" | "promise" | "waiting" | "exception";

export type CaseRow = {
  id: string;
  customerId: string;
  status: CaseStatus;
  nextActionType: NextActionType | null;
  nextActionAt: string | null;
  exceptionReason: ExceptionReason | null;
  exceptionNote: string | null;
};

export type CaseInvoice = {
  invoiceId: string;
  docNumber: string | null;
  balance: number;
  dueDate: string | null;
  ageDays: number;
  heat: Heat;
};

export type CaseItem = {
  caseId: string;
  customerId: string;
  customerName: string;
  owner: string;
  ownerId: string | null;
  status: CaseStatus;
  nextActionType: NextActionType | null;
  nextActionAt: string | null;
  totalOverdue: number;
  invoiceCount: number;
  oldestAgeDays: number;
  heat: Heat;
  priority: Priority;
  lastContact: LastContact;
  phone: string | null;
  email: string | null;
  promise: { amount: number; date: string } | null;
  brokenPromise: boolean;
  promiseStatus: PromiseStatus | null;
  amountReceived: number | null;
  exceptionReason: ExceptionReason | null;
  exceptionNote: string | null;
  followUpDue: boolean;
  searchText: string;
  invoices: CaseInvoice[];
};

export type ReconcileOp =
  | { kind: "open"; customerId: string }
  | { kind: "resolve"; caseId: string };

// Pure: given the set of customer ids that currently have overdue work and the
// existing OPEN cases, return the open/resolve ops needed. Idempotent.
export function reconcileCases(
  overdueCustomerIds: Set<string>,
  openCases: { id: string; customerId: string }[],
  _today: string,
): ReconcileOp[] {
  const ops: ReconcileOp[] = [];
  const openByCustomer = new Set(openCases.map((c) => c.customerId));

  for (const customerId of overdueCustomerIds) {
    if (!openByCustomer.has(customerId)) ops.push({ kind: "open", customerId });
  }
  for (const c of openCases) {
    if (!overdueCustomerIds.has(c.customerId)) ops.push({ kind: "resolve", caseId: c.id });
  }
  return ops;
}

export function buildCaseItems(
  cases: CaseRow[],
  invoices: InvoiceInput[],
  customers: CustomerInput[],
  lastContacts: CaseLastContactInput[],
  promises: CasePromiseInput[],
  today: string,
  ownerLabels: Map<string, string>,
): CaseItem[] {
  const customerById = new Map(customers.map((c) => [c.id, c]));

  // Group overdue invoices by customer (skip orphans with null customer_id).
  const invoicesByCustomer = new Map<string, CaseInvoice[]>();
  for (const inv of invoices) {
    if (!inv.customer_id) continue;
    const ageDays = inv.due_date ? ageInDays(inv.due_date, today) : 0;
    const ci: CaseInvoice = {
      invoiceId: inv.id,
      docNumber: inv.qbo_doc_number,
      balance: Number(inv.balance || 0),
      dueDate: inv.due_date,
      ageDays,
      heat: heatOf(ageDays),
    };
    const list = invoicesByCustomer.get(inv.customer_id) ?? [];
    list.push(ci);
    invoicesByCustomer.set(inv.customer_id, list);
  }

  // Most-recent contact per CASE (max-by-date; do not rely on order).
  const lastByCase = new Map<string, CaseLastContactInput>();
  for (const lc of lastContacts) {
    const prev = lastByCase.get(lc.caseId);
    if (!prev || lc.date > prev.date) lastByCase.set(lc.caseId, lc);
  }

  // Active promise per case (the input carries at most one relevant promise per case).
  const promiseByCase = new Map<string, CasePromiseInput>();
  for (const p of promises) promiseByCase.set(p.caseId, p);

  return cases.map((cse) => {
    const cust = customerById.get(cse.customerId) ?? null;
    const invList = (invoicesByCustomer.get(cse.customerId) ?? [])
      .slice()
      .sort((a, b) => b.ageDays - a.ageDays); // oldest first
    const totalOverdue = invList.reduce((s, i) => s + i.balance, 0);
    const oldestAgeDays = invList.length ? invList[0].ageDays : 0;
    const lc = lastByCase.get(cse.id) ?? null;
    const neverContacted = !lc;
    const ownerId = cust?.owner ?? null;
    const owner = ownerId ? (ownerLabels.get(ownerId) ?? "Unknown") : "Unassigned";
    const name = cust?.name ?? "(unknown customer)";
    const followUpDue = cse.nextActionAt != null && cse.nextActionAt <= today;
    const prom = promiseByCase.get(cse.id) ?? null;

    return {
      caseId: cse.id,
      customerId: cse.customerId,
      customerName: name,
      owner,
      ownerId,
      status: cse.status,
      nextActionType: cse.nextActionType,
      nextActionAt: cse.nextActionAt,
      totalOverdue,
      invoiceCount: invList.length,
      oldestAgeDays,
      heat: heatOf(oldestAgeDays),
      priority: priorityOf(oldestAgeDays, neverContacted),
      lastContact: lc ? { date: lc.date, channel: lc.channel } : null,
      phone: cust?.phone ?? null,
      email: cust?.email ?? null,
      promise: prom ? { amount: prom.promisedAmount, date: prom.promisedDate } : null,
      brokenPromise: prom?.status === "broken",
      promiseStatus: prom ? prom.status : null,
      amountReceived: prom ? prom.amountReceived : null,
      exceptionReason: cse.exceptionReason,
      exceptionNote: cse.exceptionNote,
      followUpDue,
      searchText: [name, ...invList.map((i) => i.docNumber ?? ""), cust?.phone ?? "", cust?.email ?? "", owner]
        .filter(Boolean).join(" ").toLowerCase(),
      invoices: invList,
    };
  });
}

export function applyCaseView(
  items: CaseItem[], view: ViewId, today: string, currentUserId: string | null,
): CaseItem[] {
  if (view === "30-plus") return items.filter((i) => i.oldestAgeDays >= 30);
  if (view === "high-value") return items.filter((i) => i.totalOverdue >= HIGH_VALUE_THRESHOLD);
  if (view === "never-contacted") return items.filter((i) => i.lastContact === null);
  if (view === "follow-ups-due") return items.filter((i) => i.nextActionAt != null && i.nextActionAt <= today);
  if (view === "broken-promises") return items.filter((i) => i.brokenPromise);
  if (view === "waiting") return items.filter((i) => i.status === "waiting" || i.status === "on_hold");
  if (view === "my-work") return items.filter((i) => i.ownerId != null && i.ownerId === currentUserId);
  return items;
}

export function sortCaseItems(items: CaseItem[], sort: SortId): CaseItem[] {
  const copy = [...items];
  if (sort === "most-overdue") return copy.sort((a, b) => b.oldestAgeDays - a.oldestAgeDays);
  if (sort === "highest-balance") return copy.sort((a, b) => b.totalOverdue - a.totalOverdue);
  if (sort === "customer") return copy.sort((a, b) => a.customerName.localeCompare(b.customerName));
  return copy.sort((a, b) => a.priority.rank - b.priority.rank || b.oldestAgeDays - a.oldestAgeDays || b.totalOverdue - a.totalOverdue);
}

export function computeCaseMetrics(items: CaseItem[], today: string): Metrics {
  const bucket = (pred: (i: CaseItem) => boolean): Metric => {
    const matched = items.filter(pred);
    return { count: matched.length, amount: matched.reduce((s, i) => s + i.totalOverdue, 0) };
  };
  return {
    thirtyPlus: bucket((i) => i.oldestAgeDays >= 30),
    highValue: bucket((i) => i.totalOverdue >= HIGH_VALUE_THRESHOLD),
    neverContacted: bucket((i) => i.lastContact === null),
    allOpen: bucket(() => true),
    followUpsDue: bucket((i) => i.nextActionAt != null && i.nextActionAt <= today),
    brokenPromises: bucket((i) => i.brokenPromise),
  };
}
