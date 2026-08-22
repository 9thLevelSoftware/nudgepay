import { expect, test } from "vitest";
import {
  assertNotTruncated,
  chunkIds,
  isTruncatedPage,
  orderPage,
  pageAll,
  pageAllChunked,
  PAGE_ALL_MAX_ROWS,
  POSTGREST_MAX_ROWS,
} from "../app/lib/page-all";

test("isTruncatedPage is true when returned rows are fewer than exact count", () => {
  expect(isTruncatedPage(1000, 1001)).toBe(true);
  expect(isTruncatedPage(0, 1)).toBe(true);
});

test("isTruncatedPage is false when the page is complete or count is unknown", () => {
  expect(isTruncatedPage(10, 10)).toBe(false);
  expect(isTruncatedPage(0, 0)).toBe(false);
  expect(isTruncatedPage(1000, 1000)).toBe(false);
  expect(isTruncatedPage(1000, null)).toBe(false);
  expect(isTruncatedPage(1000, undefined)).toBe(false);
});

test("assertNotTruncated throws a labeled error only when truncated", () => {
  expect(() => assertNotTruncated(1000, 1001, "invoices")).toThrow(/invoices truncated/);
  expect(() => assertNotTruncated(3, 3, "cases")).not.toThrow();
});

test("POSTGREST_MAX_ROWS documents the default cap", () => {
  expect(POSTGREST_MAX_ROWS).toBe(1000);
});

test("PAGE_ALL_MAX_ROWS is 5000 across chunks, not per chunk", () => {
  expect(PAGE_ALL_MAX_ROWS).toBe(5000);
});

function fakeRun<T>(all: T[], opts?: { count?: number | null; error?: { message: string } | null }) {
  const calls: { from: number; to: number }[] = [];
  const run = async (from: number, to: number) => {
    calls.push({ from, to });
    if (opts?.error) return { data: null, count: null, error: opts.error };
    const page = all.slice(from, to + 1);
    const count = opts && "count" in opts ? opts.count ?? null : all.length;
    return { data: page, count, error: null };
  };
  return { run, calls };
}

test("pageAll walks range pages until the set is exhausted", async () => {
  const all = Array.from({ length: 2500 }, (_, i) => i);
  const { run, calls } = fakeRun(all);
  const { rows, truncated } = await pageAll(run, { pageSize: 1000, maxRows: 5000 });
  expect(rows).toEqual(all);
  expect(truncated).toBe(false);
  expect(calls).toEqual([
    { from: 0, to: 999 },
    { from: 1000, to: 1999 },
    { from: 2000, to: 2999 },
  ]);
});

test("pageAll stops at maxRows and flags truncated when more rows exist", async () => {
  const all = Array.from({ length: 80 }, (_, i) => i);
  const { run } = fakeRun(all);
  const { rows, truncated } = await pageAll(run, { pageSize: 10, maxRows: 25 });
  expect(rows).toHaveLength(25);
  expect(rows[0]).toBe(0);
  expect(rows[24]).toBe(24);
  expect(truncated).toBe(true);
});

test("pageAll is not truncated when count equals the cap", async () => {
  const all = Array.from({ length: 25 }, (_, i) => i);
  const { run } = fakeRun(all);
  const { rows, truncated } = await pageAll(run, { pageSize: 10, maxRows: 25 });
  expect(rows).toHaveLength(25);
  expect(truncated).toBe(false);
});

test("pageAll treats a short last page as complete when count matches", async () => {
  const all = Array.from({ length: 12 }, (_, i) => i);
  const { run } = fakeRun(all);
  const { rows, truncated } = await pageAll(run, { pageSize: 10, maxRows: 50 });
  expect(rows).toEqual(all);
  expect(truncated).toBe(false);
});

test("pageAll flags truncated when a short page still has a higher count", async () => {
  const { run } = fakeRun([1, 2, 3], { count: 9 });
  const { rows, truncated } = await pageAll(run, { pageSize: 10, maxRows: 50 });
  expect(rows).toEqual([1, 2, 3]);
  expect(truncated).toBe(true);
});

test("pageAll defaults pageSize and maxRows to PostgREST / 5k caps", async () => {
  const all = Array.from({ length: 3 }, (_, i) => i);
  const { run, calls } = fakeRun(all);
  const { rows, truncated } = await pageAll(run);
  expect(rows).toEqual(all);
  expect(truncated).toBe(false);
  expect(calls[0]).toEqual({ from: 0, to: POSTGREST_MAX_ROWS - 1 });
});

test("pageAll throws when the page reports an error", async () => {
  const { run } = fakeRun([], { error: { message: "boom" } });
  await expect(pageAll(run, { pageSize: 10, maxRows: 20 })).rejects.toEqual({ message: "boom" });
});

test("pageAll treats null data as an empty page", async () => {
  const run = async () => ({ data: null, count: 0, error: null });
  const { rows, truncated } = await pageAll(run, { pageSize: 10, maxRows: 20 });
  expect(rows).toEqual([]);
  expect(truncated).toBe(false);
});

test("chunkIds splits ids into chunks of 100 by default", () => {
  expect(chunkIds([])).toEqual([]);
  expect(chunkIds(["a", "b"], 2)).toEqual([["a", "b"]]);
  expect(chunkIds(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
  const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
  const chunks = chunkIds(ids);
  expect(chunks).toHaveLength(2);
  expect(chunks[0]).toHaveLength(100);
  expect(chunks[1]).toEqual(["id-100"]);
});

test("pageAllChunked applies one running cap across chunks, not per chunk", async () => {
  const chunks = [["a"], ["b"], ["c"]];
  const seen: string[][] = [];
  const runChunk = async (ids: string[], from: number, to: number) => {
    if (from === 0) seen.push(ids);
    const all = Array.from({ length: 30 }, (_, i) => `${ids[0]}-${i}`);
    return { data: all.slice(from, to + 1), count: all.length, error: null };
  };
  const { rows, truncated } = await pageAllChunked(chunks, runChunk, { pageSize: 10, maxRows: 50 });
  expect(rows).toHaveLength(50);
  expect(truncated).toBe(true);
  expect(seen).toEqual([["a"], ["b"]]);
  expect(rows.filter((r) => r.startsWith("a-"))).toHaveLength(30);
  expect(rows.filter((r) => r.startsWith("b-"))).toHaveLength(20);
  expect(rows.some((r) => r.startsWith("c-"))).toBe(false);
});

test("pageAllChunked is truncated when a remaining chunk is skipped at the cap", async () => {
  const chunks = [["a"], ["b"]];
  const runChunk = async (ids: string[], from: number, to: number) => {
    const all = Array.from({ length: 10 }, (_, i) => `${ids[0]}-${i}`);
    return { data: all.slice(from, to + 1), count: all.length, error: null };
  };
  const { rows, truncated } = await pageAllChunked(chunks, runChunk, { pageSize: 10, maxRows: 10 });
  expect(rows).toHaveLength(10);
  expect(truncated).toBe(true);
  expect(rows.every((r) => r.startsWith("a-"))).toBe(true);
});

test("pageAllChunked is truncated when a chunk's count exceeds what was pulled", async () => {
  const runChunk = async (_ids: string[], from: number, to: number) => {
    const page = Array.from({ length: 5 }, (_, i) => from + i);
    return { data: page, count: 40, error: null };
  };
  const { rows, truncated } = await pageAllChunked([["a"]], runChunk, { pageSize: 5, maxRows: 10 });
  expect(rows).toHaveLength(10);
  expect(truncated).toBe(true);
});

test("pageAllChunked is complete when every chunk is exhausted under the cap", async () => {
  const runChunk = async (ids: string[], from: number, to: number) => {
    const all = Array.from({ length: 3 }, (_, i) => `${ids[0]}-${i}`);
    return { data: all.slice(from, to + 1), count: all.length, error: null };
  };
  const { rows, truncated } = await pageAllChunked([["a"], ["b"]], runChunk, { pageSize: 10, maxRows: 50 });
  expect(rows).toEqual(["a-0", "a-1", "a-2", "b-0", "b-1", "b-2"]);
  expect(truncated).toBe(false);
});

test("orderPage applies created_at desc then id desc", () => {
  const calls: { column: string; ascending: boolean }[] = [];
  const q = {
    order(column: string, opts: { ascending: boolean }) {
      calls.push({ column, ascending: opts.ascending });
      return q;
    },
  };
  expect(orderPage(q)).toBe(q);
  expect(calls).toEqual([
    { column: "created_at", ascending: false },
    { column: "id", ascending: false },
  ]);
});

test("pageAllChunked returns empty and not truncated for no chunks", async () => {
  const { rows, truncated } = await pageAllChunked([], async () => {
    throw new Error("should not run");
  });
  expect(rows).toEqual([]);
  expect(truncated).toBe(false);
});
