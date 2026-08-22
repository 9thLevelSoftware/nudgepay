import { expect, test } from "vitest";
import {
  buildPayerStats,
  daysToPay,
  payerBand,
  replyRate,
  PAYER_BAND_HINT,
  PAYER_BAND_LABEL,
} from "../app/lib/payer-behavior";
import { loadPayerSource } from "../app/lib/payer-behavior.server";
import { buildCaseData } from "../app/routes/dashboard";
import type { CaseRow } from "../app/lib/cases";
import { DEFAULT_ORG_CONFIG } from "../app/lib/org-config";
import type { PayerStats } from "../app/lib/payer-behavior";

test("daysToPay averages the 12 most recently paid invoices", () => {
  expect(daysToPay([])).toBeNull();
  expect(daysToPay([{ invoiceDate: null, paidDate: "2026-06-01" }])).toBeNull();
  expect(daysToPay([
    { invoiceDate: "2026-01-01", paidDate: "2026-01-31" },
    { invoiceDate: "2026-02-01", paidDate: "2026-03-03" },
  ])).toBe((30 + 30) / 2);

  const extra = Array.from({ length: 14 }, (_, i) => ({
    invoiceDate: "2026-01-01",
    paidDate: `2026-01-${String(i + 1).padStart(2, "0")}`,
  }));
  // Newest 12 by paidDate; each is paid 0..11 days after invoice_date of Jan 1.
  // After sort desc + slice, paid dates are Jan 14 down to Jan 3 → ages 13..2.
  const avg = daysToPay(extra);
  expect(avg).not.toBeNull();
  expect(avg).toBe((13 + 12 + 11 + 10 + 9 + 8 + 7 + 6 + 5 + 4 + 3 + 2) / 12);
});

test("replyRate is null when outbound is 0, never a fake 0%", () => {
  expect(replyRate(0, 2)).toBeNull();
  expect(replyRate(4, 1)).toBe(0.25);
});

test("payerBand table: risk / good / fair / unknown", () => {
  const base = {
    daysToPay: null as number | null,
    paidSample: 0,
    replyRate: null as number | null,
    outbound: 0,
    inbound: 0,
    brokenPromise: false,
  };
  expect(payerBand({ ...base, brokenPromise: true })).toBe("risk");
  expect(payerBand({ ...base, daysToPay: 45, paidSample: 1 })).toBe("risk");
  expect(payerBand({ ...base, replyRate: 0.1, outbound: 3 })).toBe("risk");
  expect(payerBand({ ...base, daysToPay: 35, paidSample: 2, replyRate: 0.5, outbound: 2 })).toBe("good");
  expect(payerBand({ ...base, daysToPay: 20, paidSample: 1 })).toBe("good");
  expect(payerBand({ ...base, daysToPay: 40, paidSample: 1 })).toBe("fair");
  expect(payerBand({ ...base, outbound: 1, replyRate: 0.4 })).toBe("fair");
  expect(payerBand(base)).toBe("unknown");
});

test("chip labels and tooltip copy", () => {
  expect(PAYER_BAND_LABEL.good).toBe("GOOD");
  expect(PAYER_BAND_LABEL.fair).toBe("FAIR");
  expect(PAYER_BAND_LABEL.risk).toBe("RISK");
  expect(PAYER_BAND_LABEL.unknown).toBe("—");
  expect(PAYER_BAND_HINT).toBe("Heuristic from NudgePay activity, not a bureau rating.");
});

test("buildCaseData threads payer after buildCaseItems, not inside it", () => {
  const cases: CaseRow[] = [{
    id: "case-1", customerId: "c1", status: "working", nextActionType: "follow_up",
    nextActionAt: "2026-06-20", exceptionReason: null, exceptionNote: null,
  }];
  const invoices = [{ id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 6000, due_date: "2026-03-01" }];
  const customers = [{ id: "c1", name: "Acme", phone: null, email: null, owner: "u1" }];
  const payer: PayerStats = buildPayerStats({
    daysToPay: 20, paidSample: 3, replyRate: 0.8, outbound: 5, inbound: 4, brokenPromise: false,
  });
  const data = buildCaseData(
    cases, invoices, customers, [], [],
    { view: "all-open", sort: "recommended", q: "", caseId: "case-1" }, "2026-06-22",
    new Map([["u1", "diskin"]]), "u1", DEFAULT_ORG_CONFIG, [], new Map(),
    new Map([["c1", payer]]),
  );
  expect(data.items[0].payer).toEqual(payer);
  expect(data.items[0].payer?.band).toBe("good");
});

type TableRows = { rows: Record<string, unknown>[]; count?: number };
type OrderCall = { column: string; ascending: boolean };

const STABLE_PAID_ORDER: OrderCall[] = [
  { column: "paid_date", ascending: false },
  { column: "id", ascending: false },
];

function makeClient(tables: Record<string, TableRows>) {
  const calls: {
    table: string; select: string; inCol: string; ids: string[];
    orders: OrderCall[]; not?: { col: string; op: string; value: unknown };
  }[] = [];
  const client = {
    from(table: string) {
      const src = tables[table] ?? { rows: [] };
      const state = {
        select: "",
        inCol: "",
        ids: [] as string[],
        from: 0,
        to: Number.POSITIVE_INFINITY,
        orders: [] as OrderCall[],
        not: undefined as { col: string; op: string; value: unknown } | undefined,
      };
      const q: Record<string, unknown> = {
        select(cols: string) {
          state.select = cols;
          return q;
        },
        eq() {
          return q;
        },
        in(col: string, ids: string[]) {
          state.inCol = col;
          state.ids = ids;
          return q;
        },
        not(col: string, op: string, value: unknown) {
          state.not = { col, op, value };
          return q;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          state.orders.push({ column, ascending: opts?.ascending ?? true });
          return q;
        },
        range(from: number, to: number) {
          state.from = from;
          state.to = to;
          return q;
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          const idSet = new Set(state.ids);
          const filtered = src.rows.filter((r) => {
            const key = r.customer_id;
            return typeof key === "string" && idSet.has(key);
          });
          calls.push({
            table,
            select: state.select,
            inCol: state.inCol,
            ids: state.ids,
            orders: [...state.orders],
            not: state.not,
          });
          return Promise.resolve({
            data: filtered.slice(state.from, state.to + 1),
            count: src.count ?? filtered.length,
            error: null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { client: client as any, calls };
}

test("loadPayerSource returns empty for no customer ids", async () => {
  const { client, calls } = makeClient({});
  const result = await loadPayerSource({
    supabase: client, orgId: "org-1", customerIds: [], today: "2026-06-22",
    brokenPromiseByCustomer: new Map(),
  });
  expect(result.size).toBe(0);
  expect(calls).toEqual([]);
});

test("loadPayerSource pages paid invoices, keeps 12, and uses replyByCustomer", async () => {
  const paid = Array.from({ length: 15 }, () => ({
    customer_id: "cust-1",
    invoice_date: "2026-01-01",
    paid_date: "2026-01-21",
  }));
  const { client, calls } = makeClient({ invoices: { rows: paid } });
  const result = await loadPayerSource({
    supabase: client,
    orgId: "org-1",
    customerIds: ["cust-1", "cust-2"],
    today: "2026-06-22",
    brokenPromiseByCustomer: new Map([["cust-2", true]]),
    replyByCustomer: new Map([
      ["cust-1", { inbound: 2, outbound: 4 }],
      ["cust-2", { inbound: 0, outbound: 0 }],
    ]),
  });
  expect(calls[0]?.table).toBe("invoices");
  expect(calls[0]?.select).toBe("customer_id, invoice_date, paid_date");
  expect(calls[0]?.inCol).toBe("customer_id");
  expect(calls[0]?.not).toEqual({ col: "paid_date", op: "is", value: null });
  expect(calls[0]?.orders).toEqual(STABLE_PAID_ORDER);
  expect(calls.every((c) => c.table !== "contact_logs")).toBe(true);

  const c1 = result.get("cust-1")!;
  expect(c1.paidSample).toBe(12);
  expect(c1.daysToPay).not.toBeNull();
  expect(c1.replyRate).toBe(0.5);
  expect(c1.outbound).toBe(4);
  expect(c1.brokenPromise).toBe(false);
  expect(c1.band).toBe("good");

  const c2 = result.get("cust-2")!;
  expect(c2.daysToPay).toBeNull();
  expect(c2.paidSample).toBe(0);
  expect(c2.brokenPromise).toBe(true);
  expect(c2.band).toBe("risk");
});

test("loadPayerSource still returns missing customers with null DTP when truncated", async () => {
  const { client } = makeClient({
    invoices: {
      rows: [{ customer_id: "cust-1", invoice_date: "2026-01-01", paid_date: "2026-03-01" }],
      count: 6000,
    },
  });
  const result = await loadPayerSource({
    supabase: client,
    orgId: "org-1",
    customerIds: ["cust-1", "cust-missing"],
    today: "2026-06-22",
    brokenPromiseByCustomer: new Map(),
  });
  expect(result.get("cust-missing")?.daysToPay).toBeNull();
  expect(result.get("cust-1")?.daysToPay).not.toBeNull();
});
