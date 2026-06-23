// Pure derived-intelligence for the case-centric collections workspace. No I/O,
// no node:*, no .server suffix (imported by route + tests + client components via
// type-only imports). Reuses the invoice-level heat/priority helpers from worklist.ts.

import {
  heatOf, priorityOf, ageInDays, HIGH_VALUE_THRESHOLD,
  type Heat, type Priority, type LastContact, type Metric, type Metrics,
  type ViewId, type SortId, type InvoiceInput, type CustomerInput, type LastContactInput,
} from "./worklist";

export type CaseStatus = "new" | "working" | "promised" | "waiting" | "on_hold" | "resolved";
export type NextActionType = "contact" | "follow_up" | "promise" | "waiting" | "exception";

export type CaseRow = {
  id: string;
  customerId: string;
  status: CaseStatus;
  nextActionType: NextActionType | null;
  nextActionAt: string | null;
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
