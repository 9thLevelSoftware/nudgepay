import { expect, test } from "vitest";
import { applyCaseReconciliation } from "../app/lib/case-lifecycle.server";
import { applyPaymentsAndEvaluate, type SyncDeps } from "../app/lib/qbo-sync.server";

type TableRows = { rows: Record<string, unknown>[]; count?: number; error?: { message: string } | null };

function makeClient(tables: Record<string, TableRows>) {
  const calls: { table: string; from: number; to: number }[] = [];
  const inserts: { table: string; row: unknown }[] = [];
  const client = {
    from(table: string) {
      const src = tables[table] ?? { rows: [] };
      const state = { from: 0, to: Number.POSITIVE_INFINITY };
      const q: Record<string, unknown> = {
        select() { return q; },
        eq() { return q; },
        gt() { return q; },
        lt() { return q; },
        not() { return q; },
        is() { return q; },
        in() { return q; },
        order() { return q; },
        range(from: number, to: number) { state.from = from; state.to = to; return q; },
        insert: async (row: unknown) => {
          inserts.push({ table, row });
          return { error: null };
        },
        update() {
          return {
            eq() {
              return { select: async () => ({ data: [], error: null }) };
            },
          };
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          calls.push({ table, from: state.from, to: state.to });
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
  return { client: client as any, calls, inserts };
}

test("applyCaseReconciliation pages 1001 overdue invoices instead of throwing on the first page", async () => {
  const invoices = Array.from({ length: 1001 }, (_, i) => ({
    customer_id: "cust-1",
    created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
    id: `inv-${i}`,
  }));
  const { client, calls, inserts } = makeClient({
    invoices: { rows: invoices },
    collection_cases: { rows: [] },
  });
  const result = await applyCaseReconciliation(client, "org-1", "2026-06-22");
  expect(result.opened).toBe(1);
  expect(calls.filter((c) => c.table === "invoices").length).toBeGreaterThanOrEqual(2);
  expect(calls.some((c) => c.table === "invoices" && c.from === 0 && c.to === 999)).toBe(true);
  expect(calls.some((c) => c.table === "invoices" && c.from === 1000)).toBe(true);
  expect(inserts.filter((i) => i.table === "collection_cases")).toHaveLength(1);
});

test("applyCaseReconciliation throws when overdue paging hits the cap", async () => {
  const invoices = Array.from({ length: 1000 }, (_, i) => ({
    customer_id: "cust-1",
    created_at: `2026-01-01T00:00:00.${String(i).padStart(3, "0")}Z`,
    id: `inv-${i}`,
  }));
  const { client } = makeClient({
    invoices: { rows: invoices, count: 6000 },
    collection_cases: { rows: [] },
  });
  await expect(applyCaseReconciliation(client, "org-1", "2026-06-22"))
    .rejects.toThrow(/reconciliation truncated: overdue invoice page is incomplete/);
});

test("applyPaymentsAndEvaluate records a recon error and rethrows so CDC cannot stamp last_cdc_time", async () => {
  const recorded: Record<string, unknown>[] = [];
  const { client } = makeClient({
    invoices: { rows: [], error: { message: "boom" } },
    collection_cases: { rows: [] },
    sync_errors: { rows: [] },
  });
  const origFrom = client.from.bind(client);
  client.from = (table: string) => {
    if (table === "sync_errors") {
      return {
        insert: async (row: Record<string, unknown>) => {
          recorded.push(row);
          return { error: null };
        },
      };
    }
    return origFrom(table);
  };
  const deps: SyncDeps = {
    fetchFn: fetch,
    service: client,
    cfg: { clientId: "x", clientSecret: "x", redirectUri: "x" },
    api: { baseUrl: "https://x" },
    key: "x",
    errorSource: "cron",
  };
  await expect(applyPaymentsAndEvaluate(deps, "org-1", "tok", "RID", [], "2026-07-01", new Date("2026-07-01T00:00:00Z")))
    .rejects.toEqual({ message: "boom" });
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({ org_id: "org-1", source: "cron", scope: "recon" });
});
