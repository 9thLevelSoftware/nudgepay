import { expect, test } from "vitest";
import { evaluatePromise, evaluatePromises, type PromiseEvalRow } from "../app/lib/promises";

const row = (over: Partial<PromiseEvalRow> = {}): PromiseEvalRow => ({
  id: "p1", status: "pending", promisedAmount: 500, baselineBalance: 1200, graceUntil: "2026-07-03", ...over,
});

test("kept when received >= promised (even before grace)", () => {
  // current 700 => received 500 >= 500
  expect(evaluatePromise(row(), 700, "2026-07-01")).toEqual({
    promiseId: "p1", status: "kept", amountReceived: 500, resolvedAt: "2026-07-01",
  });
});

test("stays pending before grace when not fully received", () => {
  // current 1000 => received 200 < 500, today <= graceUntil
  expect(evaluatePromise(row(), 1000, "2026-07-02")).toBeNull();
});

test("partially_kept past grace with some receipt", () => {
  expect(evaluatePromise(row(), 1000, "2026-07-06")).toEqual({
    promiseId: "p1", status: "partially_kept", amountReceived: 200, resolvedAt: "2026-07-06",
  });
});

test("broken past grace with no receipt", () => {
  expect(evaluatePromise(row(), 1200, "2026-07-06")).toEqual({
    promiseId: "p1", status: "broken", amountReceived: 0, resolvedAt: "2026-07-06",
  });
});

test("received clamps at 0 when balance grew", () => {
  expect(evaluatePromise(row(), 1500, "2026-07-06")).toEqual({
    promiseId: "p1", status: "broken", amountReceived: 0, resolvedAt: "2026-07-06",
  });
});

test("terminal statuses are never re-evaluated", () => {
  for (const status of ["kept", "broken", "renegotiated", "cancelled", "partially_kept"] as const) {
    expect(evaluatePromise(row({ status }), 0, "2026-07-06")).toBeNull();
  }
});

test("evaluatePromises returns only changed rows", () => {
  const rows = [row({ id: "a" }), row({ id: "b" })];
  const balances = new Map([["a", 700], ["b", 1000]]); // a kept, b pending pre-grace
  const ops = evaluatePromises(rows, balances, "2026-07-01");
  expect(ops.map((o) => o.promiseId)).toEqual(["a"]);
});
