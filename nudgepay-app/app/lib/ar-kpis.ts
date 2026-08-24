// Pure AR KPI math (countback DSO, CEI, contact/promise rates, collections).
// No I/O. Ending AR comes from query A only; sales from B only — never A∪B.

import { addCalendarDays } from "./business-days";
import { ageInDays } from "./worklist";

export const DASHBOARD_AR_RANGE_DAYS = 30;
export const AR_SALES_LOOKBACK_DAYS = 365;

/** Empty-coverage tile subtitle. Connected-empty is not first-run. */
export function arKpiEmptySub(args: {
  connected: boolean;
  needsReconnect?: boolean;
}): string {
  if (args.needsReconnect) return "Needs reconnect";
  if (args.connected) return "No overdue history in this window";
  return "Connect QuickBooks";
}

export type ArKpiCoverage = "full" | "partial" | "empty";

export type ArKpis = {
  rangeDays: number;
  asOf: string;
  dso: number | null;
  bestPossibleDso: number | null;
  cei: number | null;
  contactRate: number | null;
  promiseRate: number | null;
  collected: number;
  coverage: ArKpiCoverage;
  /** True when a source query hit the 5,000-row page cap — independent of DSO history. */
  truncated: boolean;
  /** Current open-AR distribution, available to report visualizations. */
  agingBuckets?: ArAgingBucket[];
  inputs: {
    endingTotalAr: number;
    endingCurrentAr: number;
    creditSales: number;
    collections: number;
    openCases: number;
    contactedOpenCases: number;
    promisesCreated: number;
  };
};

export type ArAgingBucket = {
  label: string;
  amount: number;
  count: number;
};

export type ArInvoice = {
  amount: number;
  balance: number;
  invoiceDate: string | null;
  dueDate: string | null;
  customerId: string | null;
};

export type ArPayment = {
  amount: number;
  txnDate: string | null;
  type: "payment" | "credit_memo";
};

/** Group open invoices by due-date age without changing any KPI math. */
export function buildArAgingBuckets(open: ArInvoice[], today: string): ArAgingBucket[] {
  const buckets: ArAgingBucket[] = [
    { label: "Current", amount: 0, count: 0 },
    { label: "1–30 days", amount: 0, count: 0 },
    { label: "31–60 days", amount: 0, count: 0 },
    { label: "61–90 days", amount: 0, count: 0 },
    { label: "91+ days", amount: 0, count: 0 },
  ];
  for (const invoice of open) {
    const age = invoice.dueDate == null ? -1 : ageInDays(invoice.dueDate, today);
    const index = age <= 0 ? 0 : age <= 30 ? 1 : age <= 60 ? 2 : age <= 90 ? 3 : 4;
    buckets[index].amount += invoice.balance;
    buckets[index].count += 1;
  }
  return buckets;
}

export type ArSalesRow = { invoiceDate: string; amount: number };

export function salesByDateFrom(rows: ArSalesRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.invoiceDate) continue;
    m.set(r.invoiceDate, (m.get(r.invoiceDate) ?? 0) + r.amount);
  }
  return m;
}

/**
 * Group sales by calendar day; walk newest → oldest.
 * Fixture: today 2026-08-21, sales 08-11→1000 then 08-01→1000, AR 1500 → 20.5.
 */
export function countbackDso(
  salesByDate: Map<string, number>,
  endingAr: number,
  today: string,
): number | null {
  if (endingAr <= 0) return 0;
  const dates = [...salesByDate.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  let remaining = endingAr;
  for (const d of dates) {
    const daySales = salesByDate.get(d) ?? 0;
    if (daySales <= 0) continue;
    if (remaining <= daySales) {
      return ageInDays(d, today) + remaining / daySales;
    }
    remaining -= daySales;
  }
  return null;
}

export function buildArKpis(input: {
  open: ArInvoice[];
  salesLookback: ArSalesRow[];
  payments: ArPayment[];
  today: string;
  rangeDays: number;
  openCaseIds: string[];
  contactedCaseIdsInWindow: string[];
  promisesCreatedInWindow: number;
  truncated: { a: boolean; b: boolean; c: boolean; contact?: boolean };
}): ArKpis {
  const endingTotalAr = input.open.reduce((s, i) => s + i.balance, 0);
  const endingCurrentAr = input.open
    .filter((i) => i.dueDate == null || i.dueDate >= input.today)
    .reduce((s, i) => s + i.balance, 0);
  const windowStart = addCalendarDays(input.today, -input.rangeDays);
  const creditSales = input.salesLookback
    .filter((r) => r.invoiceDate >= windowStart && r.invoiceDate <= input.today)
    .reduce((s, r) => s + r.amount, 0);
  const inWindow = (p: ArPayment) =>
    p.txnDate != null && p.txnDate >= windowStart && p.txnDate <= input.today;
  const collections = input.payments
    .filter((p) => p.type === "payment" && inWindow(p))
    .reduce((s, p) => s + p.amount, 0);
  // Credit memos reduce ending AR the same way cash does; add them back so
  // beginning AR is not understated. `collected` stays payments only.
  const creditMemos = input.payments
    .filter((p) => p.type === "credit_memo" && inWindow(p))
    .reduce((s, p) => s + p.amount, 0);

  // Countback walks newest first; future TxnDate rows would yield a negative DSO.
  const salesByDate = salesByDateFrom(
    input.salesLookback.filter((r) => r.invoiceDate <= input.today),
  );
  const anyTrunc = input.truncated.a || input.truncated.b || input.truncated.c
    || input.truncated.contact === true;
  const empty = input.open.length === 0 && input.salesLookback.length === 0;

  const dso = countbackDso(salesByDate, endingTotalAr, input.today);
  const bestPossibleDso = countbackDso(salesByDate, endingCurrentAr, input.today);

  const beginningAr = Math.max(0, endingTotalAr - creditSales + collections + creditMemos);
  const numerator = beginningAr + creditSales - endingTotalAr;
  const denominator = beginningAr + creditSales - endingCurrentAr;
  const cei = denominator <= 0 ? null : 100 * numerator / denominator;

  const openCases = input.openCaseIds.length;
  const contactedOpenCases = input.contactedCaseIdsInWindow.length;
  const contactTrunc = input.truncated.contact === true;
  const contactRate = contactTrunc || openCases === 0 ? null : contactedOpenCases / openCases;
  const promiseRate = contactTrunc || contactedOpenCases === 0
    ? null
    : input.promisesCreatedInWindow / contactedOpenCases;

  return {
    rangeDays: input.rangeDays,
    asOf: input.today,
    dso, bestPossibleDso, cei, contactRate, promiseRate,
    collected: collections,
    coverage: empty ? "empty" : anyTrunc || dso == null ? "partial" : "full",
    truncated: anyTrunc,
    inputs: {
      endingTotalAr, endingCurrentAr, creditSales, collections,
      openCases, contactedOpenCases, promisesCreated: input.promisesCreatedInWindow,
    },
  };
}

const CSV_COLUMNS = [
  "asOf", "rangeDays",
  "endingTotalAr", "endingCurrentAr", "creditSales", "collections",
  "openCases", "contactedOpenCases", "promisesCreated",
  "dso", "bestPossibleDso", "cei", "contactRate", "promiseRate", "collected", "coverage",
] as const;

function csvNum(n: number | null): string {
  return n == null ? "" : String(n);
}

export function arKpisToCsv(kpis: ArKpis): string {
  const line = [
    kpis.asOf,
    String(kpis.rangeDays),
    String(kpis.inputs.endingTotalAr),
    String(kpis.inputs.endingCurrentAr),
    String(kpis.inputs.creditSales),
    String(kpis.inputs.collections),
    String(kpis.inputs.openCases),
    String(kpis.inputs.contactedOpenCases),
    String(kpis.inputs.promisesCreated),
    csvNum(kpis.dso),
    csvNum(kpis.bestPossibleDso),
    csvNum(kpis.cei),
    csvNum(kpis.contactRate),
    csvNum(kpis.promiseRate),
    String(kpis.collected),
    kpis.coverage,
  ].join(",");
  return `${CSV_COLUMNS.join(",")}\n${line}\n`;
}
