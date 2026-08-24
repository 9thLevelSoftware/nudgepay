import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { applyPromiseEvaluation } from "../app/lib/promise-evaluation.server";
import {
  evaluatePromise,
  liveLinkedBalancesOrNull,
  sumLinkedBalances,
} from "../app/lib/promises";
import { buildPromiseRows, type PromiseInput } from "../app/lib/promise-ledger";

type TableRows = { rows: Record<string, unknown>[]; count?: number; error?: { message: string } | null };

function makeEvalClient(tables: Record<string, TableRows>) {
  const updates: { table: string; payload: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      const src = tables[table] ?? { rows: [] };
      const state = { from: 0, to: Number.POSITIVE_INFINITY };
      const q: Record<string, unknown> = {
        select() { return q; },
        eq() { return q; },
        in() { return q; },
        is() { return q; },
        order() { return q; },
        range(from: number, to: number) { state.from = from; state.to = to; return q; },
        update(payload: Record<string, unknown>) {
          const result: Record<string, unknown> = {
            eq() { return result; },
            is() { return result; },
            select() { return result; },
            then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
              updates.push({ table, payload });
              return Promise.resolve({ data: [{ id: "updated" }], error: null }).then(resolve, reject);
            },
          };
          return result;
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          if (src.error) {
            return Promise.resolve({ data: null, count: null, error: src.error }).then(resolve, reject);
          }
          return Promise.resolve({
            data: src.rows.slice(state.from, state.to + 1),
            count: src.count ?? src.rows.length,
            error: null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { client: client as any, updates };
}

const PENDING = {
  id: "p1",
  status: "pending",
  promised_amount: 500,
  promised_date: "2026-07-01",
  baseline_balance: 1200,
  grace_until: "2026-07-03",
  case_id: "c1",
  created_at: "2026-06-01T00:00:00Z",
};

function pendingTables(over: Record<string, TableRows> = {}): Record<string, TableRows> {
  return {
    promises: { rows: [PENDING] },
    promise_invoices: {
      rows: [
        { promise_id: "p1", invoice_id: "inv1" },
        { promise_id: "p1", invoice_id: "inv2" },
      ],
    },
    invoices: {
      rows: [
        { id: "inv1", balance: 700, created_at: "2026-01-01T00:00:00Z" },
        { id: "inv2", balance: 500, created_at: "2026-01-02T00:00:00Z" },
      ],
    },
    ...over,
  };
}

test("truncated invoice page throws and writes no promise status", async () => {
  const { client, updates } = makeEvalClient(pendingTables({
    invoices: {
      // One of two linked invoices — treating the miss as $0 would forge kept
      // (baseline 1200 − 0 ≥ promised 500) before grace.
      rows: [{ id: "inv1", balance: 0, created_at: "2026-01-01T00:00:00Z" }],
      count: 2,
    },
  }));
  await expect(applyPromiseEvaluation(client, "org-1", "2026-07-01"))
    .rejects.toThrow(/promise evaluation truncated: invoice page is incomplete/);
  expect(updates).toEqual([]);
});

test("truncated links page throws and writes no promise status", async () => {
  const { client, updates } = makeEvalClient(pendingTables({
    promise_invoices: {
      rows: [{ promise_id: "p1", invoice_id: "inv1" }],
      count: 2,
    },
  }));
  await expect(applyPromiseEvaluation(client, "org-1", "2026-07-01"))
    .rejects.toThrow(/promise evaluation truncated: promise invoice links page is incomplete/);
  expect(updates).toEqual([]);
});

test("truncated pending page throws and writes no promise status", async () => {
  const { client, updates } = makeEvalClient(pendingTables({
    promises: { rows: [PENDING], count: 1001 },
  }));
  await expect(applyPromiseEvaluation(client, "org-1", "2026-07-01"))
    .rejects.toThrow(/promise evaluation truncated: pending promise page is incomplete/);
  expect(updates).toEqual([]);
});

test("complete map with missing invoice id is $0 remaining (deleted), may keep", async () => {
  // Documented: after a complete lookup, a linked id not in the invoice set
  // is a deleted invoice — remaining balance 0, not a truncated miss.
  const { client, updates } = makeEvalClient(pendingTables({
    promise_invoices: { rows: [{ promise_id: "p1", invoice_id: "gone" }] },
    invoices: { rows: [], count: 0 },
  }));
  const res = await applyPromiseEvaluation(client, "org-1", "2026-07-01");
  expect(res.kept).toBe(1);
  expect(updates.some((u) => u.table === "promises" && u.payload.status === "kept")).toBe(true);
});

test("missing invoice in a truncated map would forge kept — eval throws instead", () => {
  const truncated = sumLinkedBalances(
    [{ promiseId: "p1", invoiceId: "inv1" }, { promiseId: "p1", invoiceId: "inv2" }],
    new Map([["inv1", 0]]), // inv2 absent because the page was short
  );
  expect(truncated.get("p1")).toBe(0);
  const forged = evaluatePromise(
    { id: "p1", status: "pending", promisedAmount: 500, baselineBalance: 1200, graceUntil: "2026-07-03" },
    truncated.get("p1")!,
    "2026-07-01",
  );
  expect(forged?.status).toBe("kept");
});

test("sumLinkedBalances treats a missing id in a complete map as $0 (deleted invoice)", () => {
  const balances = sumLinkedBalances(
    [{ promiseId: "p1", invoiceId: "gone" }, { promiseId: "p1", invoiceId: "inv1" }],
    new Map([["inv1", 200]]),
  );
  expect(balances.get("p1")).toBe(200);
});

test("liveLinkedBalancesOrNull returns null when truncated — never inflated received", () => {
  const links = [{ promiseId: "p1", invoiceId: "inv1" }, { promiseId: "p1", invoiceId: "inv2" }];
  const invoices = new Map([["inv1", 0]]);
  expect(liveLinkedBalancesOrNull(true, links, invoices)).toBeNull();
  expect(liveLinkedBalancesOrNull(false, links, invoices)?.get("p1")).toBe(0);
});

test("loader live-delta truncated → pending received is null, not inflated", () => {
  const input: PromiseInput[] = [{
    promiseId: "p1", caseId: "k1", customerId: "c1", customerName: "Acme", ownerId: null,
    status: "pending", promisedAmount: 500, amountReceived: 0, baselineBalance: 1200,
    promisedDate: "2026-07-01", graceUntil: "2026-07-03", createdAt: "2026-06-01T00:00:00Z",
  }];
  const short = new Map([["p1", 0]]); // missing invoice coerced to $0 would show received 1200
  const inflated = buildPromiseRows(input, "2026-07-01", new Map(), {
    liveLinkedBalanceByPromiseId: short,
  });
  expect(inflated[0]!.amountReceived).toBe(1200);

  const honest = buildPromiseRows(input, "2026-07-01", new Map(), {
    liveLinkedBalanceByPromiseId: short,
    liveDeltaTruncated: true,
  });
  expect(honest[0]!.amountReceived).toBeNull();
});

test("applyPromiseEvaluation pages pending, links, and invoices with exact count", () => {
  const src = readFileSync(new URL("../app/lib/promise-evaluation.server.ts", import.meta.url), "utf8");
  expect(src).toContain("pageAll");
  expect(src).toContain("pageAllChunked");
  expect(src).toContain('count: "exact"');
  expect(src).toContain("promise evaluation truncated: invoice page is incomplete");
  expect(src).toContain("deleted invoice");
  const loader = readFileSync(new URL("../app/routes/promises.tsx", import.meta.url), "utf8");
  expect(loader).toContain("liveLinkedBalancesOrNull");
  expect(loader).toContain("liveDeltaTruncated");
});
