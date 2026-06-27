// app/lib/promise-ledger.ts
// Pure derived-intelligence for the Promises tab (promise pipeline/ledger). No
// I/O, no node:*, no .server — imported by the route loader, the ledger/panel
// components (type-only), and tests. Mirrors app/lib/accounts.ts in shape.

import { addBusinessDays, DEFAULT_WORKING_DAYS, NO_HOLIDAYS } from "./business-days";

export type PromiseDbStatus =
  | "pending" | "kept" | "partially_kept" | "broken" | "renegotiated" | "cancelled";

// How many business days ahead still counts a pending promise as "due soon".
export const DUE_SOON_BUSINESS_DAYS = 3;

export type PromiseTab = "active" | "due-soon" | "broken" | "kept" | "all";
export const PROMISE_TABS: PromiseTab[] = ["active", "due-soon", "broken", "kept", "all"];

export type PromiseSort = "due-date" | "amount" | "customer";
export const PROMISE_SORTS: PromiseSort[] = ["due-date", "amount", "customer"];

export type PromiseLinkedInvoice = { invoiceId: string; docNumber: string | null; balance: number };

// One promise as the loader hands it to the deriver (org-scoped, numeric-coerced).
export type PromiseInput = {
  promiseId: string;
  caseId: string;
  customerId: string;
  customerName: string;
  ownerId: string | null;
  status: PromiseDbStatus;
  promisedAmount: number;
  amountReceived: number;
  baselineBalance: number;
  promisedDate: string; // YYYY-MM-DD
  graceUntil: string;   // YYYY-MM-DD
  createdAt: string;    // ISO timestamp
};

export type PromiseRow = PromiseInput & {
  owner: string;
  outstanding: number;         // max(0, promised - received)
  superseded: boolean;         // renegotiated | cancelled
  awaitingEvaluation: boolean; // pending but today > graceUntil (sync lag)
  caseOpen: boolean;           // case still open (closed cases can't be deep-linked into Collections)
};

type DayConfig = { workingDays?: ReadonlySet<number>; holidays?: ReadonlySet<string> };

export type BuildPromiseRowsOpts = {
  // Current summed balance of each pending promise's linked invoices. The
  // `amount_received` column stays at its persisted value (0) until the
  // evaluator resolves a promise, so for pending rows we derive received from
  // the live linked balance (balance-delta, matching evaluatePromise). Absent
  // entry → fall back to the persisted amountReceived.
  liveLinkedBalanceByPromiseId?: ReadonlyMap<string, number>;
  // case_ids whose case is still open (closed_at is null). Absent → treat every
  // case as open (the no-info default, used by pure unit tests).
  openCaseIds?: ReadonlySet<string>;
};

export function buildPromiseRows(
  promises: PromiseInput[],
  today: string,
  ownerLabels: Map<string, string>,
  opts: BuildPromiseRowsOpts = {},
): PromiseRow[] {
  return promises.map((p) => {
    // Live received for pending promises (the persisted column lags until the
    // evaluator settles the promise); terminal statuses keep their authoritative value.
    let amountReceived = p.amountReceived;
    if (p.status === "pending" && opts.liveLinkedBalanceByPromiseId?.has(p.promiseId)) {
      amountReceived = Math.max(0, p.baselineBalance - opts.liveLinkedBalanceByPromiseId.get(p.promiseId)!);
    }
    return {
      ...p,
      owner: p.ownerId ? (ownerLabels.get(p.ownerId) ?? "Unknown") : "Unassigned",
      amountReceived,
      outstanding: Math.max(0, p.promisedAmount - amountReceived),
      superseded: p.status === "renegotiated" || p.status === "cancelled",
      awaitingEvaluation: p.status === "pending" && today > p.graceUntil,
      caseOpen: opts.openCaseIds ? opts.openCaseIds.has(p.caseId) : true,
    };
  });
}

// A pending promise is "due soon" when its promised date falls within
// DUE_SOON_BUSINESS_DAYS business days of today — which also captures any
// promised date already in the past (proactive + overdue watch list).
export function isDueSoon(row: PromiseRow, today: string, config: DayConfig = {}): boolean {
  if (row.status !== "pending") return false;
  const threshold = addBusinessDays(today, DUE_SOON_BUSINESS_DAYS, {
    workingDays: config.workingDays ?? DEFAULT_WORKING_DAYS,
    holidays: config.holidays ?? NO_HOLIDAYS,
  });
  return row.promisedDate <= threshold;
}

export function applyPromiseTab(
  rows: PromiseRow[], tab: PromiseTab, today: string, config: DayConfig = {},
): PromiseRow[] {
  if (tab === "active") return rows.filter((r) => r.status === "pending");
  if (tab === "due-soon") return rows.filter((r) => isDueSoon(r, today, config));
  if (tab === "broken") return rows.filter((r) => r.status === "broken");
  if (tab === "kept") return rows.filter((r) => r.status === "kept" || r.status === "partially_kept");
  return rows; // "all"
}

export function sortPromiseRows(rows: PromiseRow[], sort: PromiseSort): PromiseRow[] {
  const copy = [...rows];
  if (sort === "amount") {
    return copy.sort((a, b) => b.promisedAmount - a.promisedAmount || a.customerName.localeCompare(b.customerName));
  }
  if (sort === "customer") {
    return copy.sort((a, b) => a.customerName.localeCompare(b.customerName));
  }
  // due-date: soonest promised date first; ties broken by customer name.
  return copy.sort((a, b) =>
    a.promisedDate === b.promisedDate
      ? a.customerName.localeCompare(b.customerName)
      : a.promisedDate.localeCompare(b.promisedDate),
  );
}

export type PromiseMetrics = {
  activeCount: number; activeAmount: number;
  dueSoonCount: number; dueSoonAmount: number;
  brokenCount: number; brokenOutstanding: number;
  keptRate: number | null; // strict: kept / (kept + partially_kept + broken); null when none resolved
};

export function computePromiseMetrics(
  rows: PromiseRow[], today: string, config: DayConfig = {},
): PromiseMetrics {
  const active = rows.filter((r) => r.status === "pending");
  const dueSoon = rows.filter((r) => isDueSoon(r, today, config));
  const broken = rows.filter((r) => r.status === "broken");
  const keptCount = rows.filter((r) => r.status === "kept").length;
  const partialCount = rows.filter((r) => r.status === "partially_kept").length;
  const resolvedDenom = keptCount + partialCount + broken.length;
  return {
    activeCount: active.length,
    activeAmount: active.reduce((s, r) => s + r.promisedAmount, 0),
    dueSoonCount: dueSoon.length,
    dueSoonAmount: dueSoon.reduce((s, r) => s + r.promisedAmount, 0),
    brokenCount: broken.length,
    brokenOutstanding: broken.reduce((s, r) => s + r.outstanding, 0),
    keptRate: resolvedDenom === 0 ? null : keptCount / resolvedDenom,
  };
}
