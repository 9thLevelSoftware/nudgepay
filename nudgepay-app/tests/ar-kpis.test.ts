import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { ageInDays } from "../app/lib/worklist";
import {
  arKpisToCsv,
  buildArAgingBuckets,
  buildArKpis,
  countbackDso,
  salesByDateFrom,
  type ArInvoice,
  type ArPayment,
  type ArSalesRow,
} from "../app/lib/ar-kpis";
import { loadArKpiSource } from "../app/lib/ar-kpis.server";
import { loadContactPromiseRates } from "../app/lib/contact-promise-rates.server";

const TODAY = "2026-08-21";

test("buildArAgingBuckets groups open balances by due-date age", () => {
  const buckets = buildArAgingBuckets([
    { amount: 100, balance: 100, invoiceDate: null, dueDate: null, customerId: "c1" },
    { amount: 200, balance: 200, invoiceDate: null, dueDate: "2026-08-20", customerId: "c2" },
    { amount: 300, balance: 300, invoiceDate: null, dueDate: "2026-07-21", customerId: "c3" },
    { amount: 400, balance: 400, invoiceDate: null, dueDate: "2026-06-21", customerId: "c4" },
    { amount: 500, balance: 500, invoiceDate: null, dueDate: "2026-05-01", customerId: "c5" },
  ], TODAY);
  expect(buckets.map((bucket) => bucket.amount)).toEqual([100, 200, 300, 400, 500]);
  expect(buckets.map((bucket) => bucket.count)).toEqual([1, 1, 1, 1, 1]);
});

function kpis(overrides: Partial<Parameters<typeof buildArKpis>[0]> = {}) {
  return buildArKpis({
    open: [],
    salesLookback: [],
    payments: [],
    today: TODAY,
    rangeDays: 30,
    openCaseIds: [],
    contactedCaseIdsInWindow: [],
    promisesCreatedInWindow: 0,
    truncated: { a: false, b: false, c: false },
    ...overrides,
  });
}

test("countbackDso fixture is 20.5 for 1500 AR against 1000+1000 sales", () => {
  const salesByDate = salesByDateFrom([
    { invoiceDate: "2026-08-11", amount: 1000 },
    { invoiceDate: "2026-08-01", amount: 1000 },
  ]);
  expect(countbackDso(salesByDate, 1500, TODAY)).toBe(
    ageInDays("2026-08-01", TODAY) + 0.5,
  );
  expect(countbackDso(salesByDate, 1500, TODAY)).toBe(20.5);
});

test("countbackDso groups same-day invoices before walking", () => {
  const grouped = salesByDateFrom([
    { invoiceDate: "2026-08-11", amount: 500 },
    { invoiceDate: "2026-08-11", amount: 500 },
    { invoiceDate: "2026-08-01", amount: 1000 },
  ]);
  expect(grouped.get("2026-08-11")).toBe(1000);
  expect(countbackDso(grouped, 1500, TODAY)).toBe(20.5);
});

test("countbackDso returns 0 when ending AR is not positive", () => {
  const sales = salesByDateFrom([{ invoiceDate: "2026-08-11", amount: 1000 }]);
  expect(countbackDso(sales, 0, TODAY)).toBe(0);
  expect(countbackDso(sales, -10, TODAY)).toBe(0);
});

test("countbackDso returns null when sales cannot cover AR", () => {
  const sales = salesByDateFrom([{ invoiceDate: "2026-08-11", amount: 100 }]);
  expect(countbackDso(sales, 1500, TODAY)).toBeNull();
});

test("countbackDso skips zero and negative day sales", () => {
  const sales = new Map<string, number>([
    ["2026-08-21", 0],
    ["2026-08-20", -50],
    ["2026-08-11", 1000],
  ]);
  expect(countbackDso(sales, 500, TODAY)).toBe(ageInDays("2026-08-11", TODAY) + 0.5);
});

test("future-dated sales are ignored by countback so DSO stays on the historical path", () => {
  const open: ArInvoice[] = [{
    amount: 1000, balance: 1500, invoiceDate: "2026-08-11", dueDate: null, customerId: "c1",
  }];
  const result = kpis({
    open,
    salesLookback: [
      { invoiceDate: "2026-08-31", amount: 5000 },
      { invoiceDate: "2026-08-11", amount: 1000 },
      { invoiceDate: "2026-08-01", amount: 1000 },
    ],
  });
  expect(result.dso).toBe(20.5);
  expect(result.dso).toBeGreaterThan(0);
});

test("buildArKpis never concatenates A∪B for sales / DSO", () => {
  const open: ArInvoice[] = [{
    amount: 1000, balance: 1500, invoiceDate: "2026-08-11", dueDate: null, customerId: "c1",
  }];
  const salesLookback: ArSalesRow[] = [
    { invoiceDate: "2026-08-11", amount: 1000 },
    { invoiceDate: "2026-08-01", amount: 1000 },
  ];
  const result = kpis({ open, salesLookback });
  expect(result.dso).toBe(20.5);
  expect(result.inputs.endingTotalAr).toBe(1500);
});

test("null invoice_date open invoices count in ending AR and are excluded from B", () => {
  const open: ArInvoice[] = [
    { amount: 500, balance: 500, invoiceDate: null, dueDate: null, customerId: "c1" },
    { amount: 1000, balance: 1000, invoiceDate: "2026-08-11", dueDate: TODAY, customerId: "c1" },
  ];
  const salesLookback: ArSalesRow[] = [
    { invoiceDate: "2026-08-11", amount: 1000 },
  ];
  const result = kpis({ open, salesLookback });
  expect(result.inputs.endingTotalAr).toBe(1500);
  expect(result.inputs.creditSales).toBe(1000);
  expect(result.dso).toBeNull();
  expect(result.coverage).toBe("partial");
});

test("ending current AR is not-yet-due including due today and null due dates", () => {
  const open: ArInvoice[] = [
    { amount: 100, balance: 100, invoiceDate: "2026-07-01", dueDate: "2026-08-20", customerId: "c1" },
    { amount: 200, balance: 200, invoiceDate: "2026-08-01", dueDate: TODAY, customerId: "c1" },
    { amount: 300, balance: 300, invoiceDate: "2026-08-10", dueDate: null, customerId: "c1" },
    { amount: 400, balance: 400, invoiceDate: "2026-08-15", dueDate: "2026-09-01", customerId: "c1" },
  ];
  const result = kpis({ open, salesLookback: open.filter((i) => i.invoiceDate).map((i) => ({ invoiceDate: i.invoiceDate!, amount: i.amount })) });
  expect(result.inputs.endingTotalAr).toBe(1000);
  expect(result.inputs.endingCurrentAr).toBe(900);
});

test("credit sales and collections use the range window; credit memos are not collections", () => {
  const salesLookback: ArSalesRow[] = [
    { invoiceDate: "2026-07-22", amount: 400 },
    { invoiceDate: "2026-07-21", amount: 50 },
    { invoiceDate: TODAY, amount: 100 },
  ];
  const payments: ArPayment[] = [
    { amount: 200, txnDate: "2026-08-10", type: "payment" },
    { amount: 75, txnDate: "2026-08-10", type: "credit_memo" },
    { amount: 10, txnDate: "2026-07-21", type: "payment" },
    { amount: 5, txnDate: null, type: "payment" },
  ];
  const result = kpis({
    open: [{ amount: 1000, balance: 1000, invoiceDate: "2026-06-01", dueDate: "2026-06-15", customerId: "c1" }],
    salesLookback,
    payments,
  });
  expect(result.inputs.creditSales).toBe(500);
  expect(result.inputs.collections).toBe(200);
  expect(result.collected).toBe(200);
  // beginning AR = 1000 - 500 + 200 + 75 (credit memo) = 775
  expect(result.cei).not.toBeNull();
});

test("CEI beginning AR includes credit memos as AR reductions", () => {
  const result = kpis({
    open: [{ amount: 1000, balance: 1000, invoiceDate: "2026-06-01", dueDate: "2026-06-15", customerId: "c1" }],
    salesLookback: [{ invoiceDate: "2026-08-01", amount: 400 }],
    payments: [
      { amount: 300, txnDate: "2026-08-10", type: "payment" },
      { amount: 100, txnDate: "2026-08-10", type: "credit_memo" },
    ],
  });
  // beginning = 1000 - 400 + 300 + 100 = 1000
  // numerator = 1000 + 400 - 1000 = 400
  // denominator = 1000 + 400 - 0 = 1400
  expect(result.collected).toBe(300);
  expect(result.cei).toBeCloseTo(100 * 400 / 1400, 10);
});

test("CEI reconstructs beginning AR and is null when the denominator is not positive", () => {
  const open: ArInvoice[] = [
    { amount: 800, balance: 800, invoiceDate: "2026-06-01", dueDate: "2026-06-15", customerId: "c1" },
    { amount: 200, balance: 200, invoiceDate: "2026-08-01", dueDate: TODAY, customerId: "c1" },
  ];
  const result = kpis({
    open,
    salesLookback: [
      { invoiceDate: "2026-08-01", amount: 400 },
      { invoiceDate: "2026-06-01", amount: 800 },
    ],
    payments: [{ amount: 300, txnDate: "2026-08-10", type: "payment" }],
  });
  // beginning = max(0, 1000 - 400 + 300) = 900
  // numerator = 900 + 400 - 1000 = 300
  // denominator = 900 + 400 - 200 = 1100
  expect(result.inputs.endingTotalAr).toBe(1000);
  expect(result.inputs.endingCurrentAr).toBe(200);
  expect(result.cei).toBeCloseTo(100 * 300 / 1100, 10);

  const allCurrent = kpis({
    open: [{ amount: 100, balance: 100, invoiceDate: "2026-08-01", dueDate: TODAY, customerId: "c1" }],
    salesLookback: [{ invoiceDate: "2026-08-01", amount: 100 }],
  });
  expect(allCurrent.cei).toBeNull();
});

test("contact and promise rates are null when the denominator is zero", () => {
  expect(kpis().contactRate).toBeNull();
  expect(kpis().promiseRate).toBeNull();
  const contacted = kpis({
    openCaseIds: ["c1", "c2", "c3"],
    contactedCaseIdsInWindow: ["c1", "c2"],
    promisesCreatedInWindow: 1,
  });
  expect(contacted.contactRate).toBeCloseTo(2 / 3, 10);
  expect(contacted.promiseRate).toBeCloseTo(1 / 2, 10);
  expect(kpis({ openCaseIds: ["c1"], contactedCaseIdsInWindow: [] }).promiseRate).toBeNull();
});

test("coverage is empty, partial, or full", () => {
  expect(kpis().coverage).toBe("empty");
  expect(kpis().truncated).toBe(false);
  expect(kpis({
    open: [{ amount: 100, balance: 100, invoiceDate: "2026-08-11", dueDate: TODAY, customerId: "c1" }],
    salesLookback: [{ invoiceDate: "2026-08-11", amount: 100 }],
    truncated: { a: true, b: false, c: false },
  }).coverage).toBe("partial");
  expect(kpis({
    open: [{ amount: 100, balance: 100, invoiceDate: "2026-08-11", dueDate: TODAY, customerId: "c1" }],
    salesLookback: [{ invoiceDate: "2026-08-11", amount: 100 }],
    truncated: { a: true, b: false, c: false },
  }).truncated).toBe(true);
  expect(kpis({
    open: [{ amount: 100, balance: 100, invoiceDate: "2026-08-11", dueDate: TODAY, customerId: "c1" }],
    salesLookback: [{ invoiceDate: "2026-08-11", amount: 50 }],
  }).coverage).toBe("partial");
  expect(kpis({
    open: [{ amount: 100, balance: 100, invoiceDate: "2026-08-11", dueDate: TODAY, customerId: "c1" }],
    salesLookback: [{ invoiceDate: "2026-08-11", amount: 50 }],
  }).truncated).toBe(false);
  expect(kpis({
    open: [{ amount: 100, balance: 100, invoiceDate: "2026-08-11", dueDate: TODAY, customerId: "c1" }],
    salesLookback: [{ invoiceDate: "2026-08-11", amount: 100 }],
  }).coverage).toBe("full");
  const contactTrunc = kpis({
    open: [{ amount: 100, balance: 100, invoiceDate: "2026-08-11", dueDate: TODAY, customerId: "c1" }],
    salesLookback: [{ invoiceDate: "2026-08-11", amount: 100 }],
    openCaseIds: ["c1", "c2"],
    contactedCaseIdsInWindow: ["c1"],
    promisesCreatedInWindow: 1,
    truncated: { a: false, b: false, c: false, contact: true },
  });
  expect(contactTrunc.coverage).toBe("partial");
  expect(contactTrunc.truncated).toBe(true);
  expect(contactTrunc.contactRate).toBeNull();
  expect(contactTrunc.promiseRate).toBeNull();
});

test("0% CEI with full coverage and collected 0 is a valid empty-collections day", () => {
  const result = kpis({
    open: [{ amount: 100, balance: 100, invoiceDate: "2026-06-01", dueDate: "2026-06-15", customerId: "c1" }],
    salesLookback: [{ invoiceDate: "2026-06-01", amount: 100 }],
  });
  expect(result.coverage).toBe("full");
  expect(result.collected).toBe(0);
  expect(result.cei).toBe(0);
});

test("arKpisToCsv emits inputs plus KPI columns and blanks nulls", () => {
  const csv = arKpisToCsv(kpis({
    open: [{ amount: 100, balance: 100, invoiceDate: "2026-08-11", dueDate: TODAY, customerId: "c1" }],
    salesLookback: [{ invoiceDate: "2026-08-11", amount: 100 }],
    openCaseIds: ["c1"],
  }));
  expect(csv.startsWith("asOf,rangeDays,endingTotalAr,endingCurrentAr,creditSales,collections,openCases,contactedOpenCases,promisesCreated,dso,bestPossibleDso,cei,contactRate,promiseRate,collected,coverage\n")).toBe(true);
  expect(csv).toContain(TODAY);
  expect(csv).toContain(",full\n");
});

// ---------------------------------------------------------------------------
// Server loaders
// ---------------------------------------------------------------------------

type TableRows = { rows: Record<string, unknown>[]; count?: number };
type FilterCall = { method: string; args: unknown[] };
type OrderCall = { column: string; ascending: boolean };
type QueryCall = { table: string; select: string; filters: FilterCall[]; orders: OrderCall[] };

const STABLE_PAGE_ORDER: OrderCall[] = [
  { column: "created_at", ascending: false },
  { column: "id", ascending: false },
];

function makeClient(tables: Record<string, TableRows>) {
  const calls: QueryCall[] = [];
  const client = {
    from(table: string) {
      const src = tables[table] ?? { rows: [] };
      const state = {
        select: "",
        filters: [] as FilterCall[],
        orders: [] as OrderCall[],
        from: 0,
        to: Number.POSITIVE_INFINITY,
      };
      const q: Record<string, unknown> = {
        select(cols: string) { state.select = cols; return q; },
        eq(...args: unknown[]) { state.filters.push({ method: "eq", args }); return q; },
        gt(...args: unknown[]) { state.filters.push({ method: "gt", args }); return q; },
        gte(...args: unknown[]) { state.filters.push({ method: "gte", args }); return q; },
        lte(...args: unknown[]) { state.filters.push({ method: "lte", args }); return q; },
        neq(...args: unknown[]) { state.filters.push({ method: "neq", args }); return q; },
        not(...args: unknown[]) { state.filters.push({ method: "not", args }); return q; },
        in(col: string, ids: string[]) { state.filters.push({ method: "in", args: [col, ids] }); return q; },
        order(column: string, opts?: { ascending?: boolean }) {
          state.orders.push({ column, ascending: opts?.ascending ?? true });
          return q;
        },
        range(from: number, to: number) { state.from = from; state.to = to; return q; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          let rows = src.rows;
          for (const f of state.filters) {
            if (f.method === "eq") {
              const [col, val] = f.args as [string, unknown];
              rows = rows.filter((r) => r[col] === val);
            } else if (f.method === "gt") {
              const [col, val] = f.args as [string, number];
              rows = rows.filter((r) => Number(r[col]) > val);
            } else if (f.method === "gte") {
              const [col, val] = f.args as [string, string | number];
              rows = rows.filter((r) => r[col] != null && (r[col] as string | number) >= val);
            } else if (f.method === "lte") {
              const [col, val] = f.args as [string, string | number];
              rows = rows.filter((r) => r[col] != null && (r[col] as string | number) <= val);
            } else if (f.method === "neq") {
              const [col, val] = f.args as [string, unknown];
              rows = rows.filter((r) => r[col] !== val);
            } else if (f.method === "not") {
              const [col, op] = f.args as [string, string];
              if (op === "is") rows = rows.filter((r) => r[col] != null);
            } else if (f.method === "in") {
              const [col, ids] = f.args as [string, string[]];
              const idSet = new Set(ids);
              rows = rows.filter((r) => typeof r[col] === "string" && idSet.has(r[col] as string));
            }
          }
          calls.push({
            table,
            select: state.select,
            filters: [...state.filters],
            orders: [...state.orders],
          });
          return Promise.resolve({
            data: rows.slice(state.from, state.to + 1),
            count: src.count ?? rows.length,
            error: null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { client: client as any, calls };
}

test("loadArKpiSource keeps A and B separate, does not filter A by invoice_date, and orders pages", async () => {
  const { client, calls } = makeClient({
    invoices: {
      rows: [
        { org_id: "org-1", amount: 1000, balance: 500, invoice_date: "2026-08-11", due_date: TODAY, customer_id: "c1", created_at: "t1", id: "i1" },
        { org_id: "org-1", amount: 200, balance: 200, invoice_date: null, due_date: null, customer_id: "c1", created_at: "t2", id: "i2" },
        { org_id: "org-1", amount: 300, balance: 0, invoice_date: "2026-08-01", due_date: "2026-08-15", customer_id: "c1", created_at: "t3", id: "i3" },
        { org_id: "org-1", amount: 9000, balance: 0, invoice_date: "2026-09-01", due_date: "2026-09-15", customer_id: "c1", created_at: "t4", id: "i4" },
      ],
    },
    payments: {
      rows: [
        { org_id: "org-1", amount: 50, txn_date: "2026-08-10", type: "payment" },
        { org_id: "org-1", amount: 10, txn_date: "2026-08-10", type: "credit_memo" },
        { org_id: "org-1", amount: 99, txn_date: "2026-09-01", type: "payment" },
      ],
    },
  });
  const src = await loadArKpiSource({
    supabase: client, orgId: "org-1", today: TODAY, rangeDays: 30,
  });
  expect(src.open).toHaveLength(2);
  expect(src.open.some((i) => i.invoiceDate == null)).toBe(true);
  expect(src.open.every((i) => i.balance > 0)).toBe(true);
  expect(src.salesLookback).toEqual([
    { invoiceDate: "2026-08-11", amount: 1000 },
    { invoiceDate: "2026-08-01", amount: 300 },
  ]);
  expect(src.payments.map((p) => p.type)).toEqual(["payment", "credit_memo"]);
  expect(src.truncated).toEqual({ a: false, b: false, c: false });

  const invoiceCalls = calls.filter((c) => c.table === "invoices");
  expect(invoiceCalls).toHaveLength(2);
  const a = invoiceCalls.find((c) => c.select.includes("balance"))!;
  const b = invoiceCalls.find((c) => !c.select.includes("balance"))!;
  const c = calls.find((call) => call.table === "payments")!;
  expect(a.filters.some((f) => f.method === "gt" && f.args[0] === "balance")).toBe(true);
  expect(a.filters.some((f) => f.args[0] === "invoice_date")).toBe(false);
  expect(b.filters.some((f) => f.method === "gte" && f.args[0] === "invoice_date")).toBe(true);
  expect(b.filters.some((f) => f.method === "lte" && f.args[0] === "invoice_date" && f.args[1] === TODAY)).toBe(true);
  expect(b.filters.some((f) => f.method === "not" && f.args[0] === "invoice_date")).toBe(true);
  expect(c.filters.some((f) => f.method === "lte" && f.args[0] === "txn_date" && f.args[1] === TODAY)).toBe(true);
  expect(calls.every((call) => JSON.stringify(call.orders) === JSON.stringify(STABLE_PAGE_ORDER))).toBe(true);
});

test("loadArKpiSource flags truncation per query and does not throw", async () => {
  const { client } = makeClient({
    invoices: {
      rows: [{ org_id: "org-1", amount: 1, balance: 1, invoice_date: "2026-08-11", due_date: TODAY, customer_id: "c1" }],
      count: 6000,
    },
    payments: { rows: [] },
  });
  const src = await loadArKpiSource({
    supabase: client, orgId: "org-1", today: TODAY, rangeDays: 30,
  });
  expect(src.truncated.a).toBe(true);
  expect(src.truncated.b).toBe(true);
  expect(src.truncated.c).toBe(false);
});

test("loadContactPromiseRates counts customer contacts, outbound messages, and created promises", async () => {
  const { client, calls } = makeClient({
    contact_logs: {
      rows: [
        { org_id: "org-1", case_id: "c1", method: "call", created_at: "2026-08-10T10:00:00Z" },
        { org_id: "org-1", case_id: "c1", method: "note", created_at: "2026-08-10T11:00:00Z" },
        { org_id: "org-1", case_id: "c2", method: "email", created_at: "2026-08-10T12:00:00Z" },
      ],
    },
    text_messages: {
      rows: [
        { org_id: "org-1", case_id: "c3", direction: "outbound", created_at: "2026-08-10T10:00:00Z" },
        { org_id: "org-1", case_id: "c3", direction: "inbound", created_at: "2026-08-10T11:00:00Z" },
      ],
    },
    email_messages: {
      rows: [{ org_id: "org-1", case_id: "c1", direction: "outbound", created_at: "2026-08-10T10:00:00Z" }],
    },
    promises: {
      rows: [
        { org_id: "org-1", case_id: "c1", status: "pending", created_at: "2026-08-10T10:00:00Z" },
        { org_id: "org-1", case_id: "c1", status: "cancelled", created_at: "2026-08-10T10:00:00Z" },
        { org_id: "org-1", case_id: "c2", status: "kept", created_at: "2026-08-10T10:00:00Z" },
        { org_id: "org-1", case_id: "c9", status: "pending", created_at: "2026-08-10T10:00:00Z" },
        { org_id: "org-1", case_id: "c1", status: "pending", created_at: "2026-08-11T10:00:00Z" },
      ],
    },
  });
  const result = await loadContactPromiseRates({
    supabase: client,
    orgId: "org-1",
    windowStartIso: "2026-07-22T00:00:00.000Z",
    openCaseIds: ["c1", "c2", "c3"],
  });
  expect(result.contactedOpenCaseIds.sort()).toEqual(["c1", "c2", "c3"]);
  expect(result.promisesCreated).toBe(2); // c1/c2 contacted; c9 is outside the open/contacted cohort
  expect(result.truncated).toBe(false);
  expect(calls.filter((c) => c.table === "contact_logs")[0]?.filters.some((f) => f.method === "in" && f.args[0] === "method")).toBe(true);
  expect(calls.filter((c) => c.table === "text_messages")[0]?.filters.some((f) => f.method === "eq" && f.args[0] === "direction" && f.args[1] === "outbound")).toBe(true);
  expect(calls.filter((c) => c.table === "promises")[0]?.filters.some((f) => f.method === "neq" && f.args[0] === "status" && f.args[1] === "cancelled")).toBe(true);
  expect(calls.every((c) => JSON.stringify(c.orders) === JSON.stringify(STABLE_PAGE_ORDER))).toBe(true);
});

test("loadContactPromiseRates skips all rate queries when there are no open cases", async () => {
  const { client, calls } = makeClient({
    promises: { rows: [{ org_id: "org-1", case_id: "c9", status: "pending", created_at: "2026-08-10T10:00:00Z" }] },
  });
  const result = await loadContactPromiseRates({
    supabase: client,
    orgId: "org-1",
    windowStartIso: "2026-07-22T00:00:00.000Z",
    openCaseIds: [],
  });
  expect(result.contactedOpenCaseIds).toEqual([]);
  expect(result.promisesCreated).toBe(0);
  expect(result.truncated).toBe(false);
  expect(calls.map((c) => c.table)).toEqual([]);
});

test("loadContactPromiseRates flags truncation and does not throw", async () => {
  const { client } = makeClient({
    contact_logs: {
      rows: [{ org_id: "org-1", case_id: "c1", method: "call", created_at: "2026-08-10T10:00:00Z" }],
      count: 6000,
    },
    promises: { rows: [{ org_id: "org-1", case_id: "c9", status: "pending", created_at: "2026-08-10T10:00:00Z" }] },
  });
  const result = await loadContactPromiseRates({
    supabase: client,
    orgId: "org-1",
    windowStartIso: "2026-07-22T00:00:00.000Z",
    openCaseIds: ["c1"],
  });
  expect(result.truncated).toBe(true);
  expect(result.contactedOpenCaseIds).toEqual(["c1"]);
});

test("dashboard places ArKpiBand above KpiBand and links reports for owners only", () => {
  const dashboard = readFileSync(new URL("../app/routes/dashboard.tsx", import.meta.url), "utf8");
  const band = readFileSync(new URL("../app/components/ArKpiBand.tsx", import.meta.url), "utf8");
  const worklist = readFileSync(new URL("../app/lib/worklist.ts", import.meta.url), "utf8");
  expect(dashboard.indexOf("<ArKpiBand")).toBeLessThan(dashboard.indexOf("<KpiBand"));
  expect(dashboard).toContain("loadArKpiSource");
  expect(dashboard).toContain("loadContactPromiseRates");
  expect(dashboard).toContain("DASHBOARD_AR_RANGE_DAYS");
  expect(dashboard).toContain("contact: rates.truncated");
  expect(dashboard).toContain("peekWindowStartIso(today, PEEK_WINDOW_DAYS, tz)");
  expect(dashboard).toContain("loadBrokenPromiseCustomers");
  expect(dashboard).toContain("localMidnightUtcIso");
  expect(band).toContain('to="/reports"');
  expect(band).toContain("isOwner");
  expect(band).not.toMatch(/<MetricTile[^>]*href=/);
  expect(worklist).not.toContain("dso");
  expect(worklist).not.toContain("ArKpi");
});
