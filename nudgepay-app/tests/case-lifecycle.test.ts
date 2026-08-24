import { expect, test } from "vitest";
import { applyCaseReconciliation } from "../app/lib/case-lifecycle.server";
import { applyPaymentsAndEvaluate, customerIdMap, type SyncDeps } from "../app/lib/qbo-sync.server";

type TableRows = { rows: Record<string, unknown>[]; count?: number; error?: { message: string } | null };

function parseKeysetCursor(filter: string | null): { created_at: string; id: string } | null {
  if (!filter) return null;
  const m = filter.match(/created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\."([^"]+)"\)/);
  if (!m) return null;
  return { created_at: m[1], id: m[3] };
}

function keysetSlice(rows: Record<string, unknown>[], cursor: { created_at: string; id: string } | null) {
  const sorted = [...rows].sort((a, b) => {
    const ac = String(a.created_at ?? "");
    const bc = String(b.created_at ?? "");
    if (ac !== bc) return ac < bc ? 1 : -1;
    const ai = String(a.id ?? "");
    const bi = String(b.id ?? "");
    if (ai === bi) return 0;
    return ai < bi ? 1 : -1;
  });
  if (!cursor) return sorted;
  return sorted.filter((r) => {
    const created = String(r.created_at ?? "");
    const id = String(r.id ?? "");
    return created < cursor.created_at || (created === cursor.created_at && id < cursor.id);
  });
}

function makeClient(tables: Record<string, TableRows>) {
  const calls: { table: string; from: number; to: number; or: string | null }[] = [];
  const inserts: { table: string; row: unknown }[] = [];
  const client = {
    from(table: string) {
      const src = tables[table] ?? { rows: [] };
      const state = { from: 0, to: Number.POSITIVE_INFINITY, or: null as string | null };
      const q: Record<string, unknown> = {
        select() { return q; },
        eq() { return q; },
        gt() { return q; },
        lt() { return q; },
        not() { return q; },
        is() { return q; },
        in() { return q; },
        order() { return q; },
        or(filter: string) { state.or = filter; return q; },
        range(from: number, to: number) { state.from = from; state.to = to; return q; },
        insert: async (row: unknown) => {
          inserts.push({ table, row });
          return { error: null };
        },
        update() {
          const result = {
            eq() { return result; },
            select: async () => ({ data: [], error: null }),
          };
          return result;
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          calls.push({ table, from: state.from, to: state.to, or: state.or });
          if (src.error) {
            return Promise.resolve({ data: null, count: null, error: src.error }).then(resolve, reject);
          }
          const remaining = keysetSlice(src.rows, parseKeysetCursor(state.or));
          return Promise.resolve({
            data: remaining.slice(state.from, state.to + 1),
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
  const invoiceCalls = calls.filter((c) => c.table === "invoices");
  expect(invoiceCalls.length).toBeGreaterThanOrEqual(2);
  expect(invoiceCalls[0]?.or).toBeNull();
  expect(invoiceCalls.slice(1).some((c) => c.or && c.or.includes("created_at.lt."))).toBe(true);
  expect(invoiceCalls.every((c) => c.from === 0 && c.to === 999)).toBe(true);
  expect(inserts.filter((i) => i.table === "collection_cases")).toHaveLength(1);
});

test("applyCaseReconciliation pages 1500 overdue invoices without throwing", async () => {
  const invoices = Array.from({ length: 1500 }, (_, i) => ({
    customer_id: `cust-${i % 50}`,
    created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
    id: `inv-${i}`,
  }));
  const { client, calls } = makeClient({
    invoices: { rows: invoices },
    collection_cases: { rows: [] },
  });
  const result = await applyCaseReconciliation(client, "org-1", "2026-06-22");
  expect(result.opened).toBe(50);
  const invoiceCalls = calls.filter((c) => c.table === "invoices");
  expect(invoiceCalls.length).toBeGreaterThanOrEqual(2);
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

test("applyCaseReconciliation does not close a case when a recheck finds an overdue invoice", async () => {
  let invoicePasses = 0;
  const overdue = { customer_id: "cust-1", created_at: "2026-01-01T00:00:00.000Z", id: "inv-1" };
  const updates: string[] = [];
  const client = {
    from(table: string) {
      const q: Record<string, unknown> = {
        select() { return q; },
        eq() { return q; },
        gt() { return q; },
        lt() { return q; },
        not() { return q; },
        is() { return q; },
        in() { return q; },
        order() { return q; },
        or() { return q; },
        range() { return q; },
        insert: async () => ({ error: null }),
        update() {
          const result = {
            eq(col: string, val: string) {
              if (col === "id") updates.push(val);
              return result;
            },
            select: async () => ({ data: [{ id: updates[updates.length - 1] }], error: null }),
          };
          return result;
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          if (table === "invoices") {
            invoicePasses += 1;
            const rows = invoicePasses === 1 ? [] : [overdue];
            return Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve, reject);
          }
          return Promise.resolve({
            data: [{ id: "case-1", customer_id: "cust-1", created_at: "2026-01-01T00:00:00.000Z" }],
            count: 1,
            error: null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  const result = await applyCaseReconciliation(client as any, "org-1", "2026-06-22");
  expect(result.resolved).toBe(0);
  expect(result.opened).toBe(0);
  expect(updates).toEqual([]);
  expect(invoicePasses).toBeGreaterThanOrEqual(2);
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

function customerLookupClient(opts: {
  rows: { id: string; qbo_id: string }[];
  count?: number;
  error?: { message: string } | null;
}) {
  return {
    from() {
      const q: Record<string, unknown> = {
        select() { return q; },
        eq() { return q; },
        in() { return q; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          if (opts.error) {
            return Promise.resolve({ data: null, count: null, error: opts.error }).then(resolve, reject);
          }
          return Promise.resolve({
            data: opts.rows,
            count: opts.count ?? opts.rows.length,
            error: null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

test("customerIdMap throws on a short lookup page, not on a missing id", async () => {
  await expect(customerIdMap(
    customerLookupClient({ rows: [{ id: "u1", qbo_id: "1" }], count: 3 }) as any,
    "org-1",
    ["1", "2"],
  )).rejects.toThrow(/customer lookup truncated/);

  const map = await customerIdMap(
    customerLookupClient({ rows: [{ id: "u1", qbo_id: "1" }] }) as any,
    "org-1",
    ["1", "2"],
  );
  expect(map.get("1")).toBe("u1");
  expect(map.has("2")).toBe(false);
});
