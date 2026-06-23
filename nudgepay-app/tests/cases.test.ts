import { expect, test } from "vitest";
import { reconcileCases } from "../app/lib/cases";

const TODAY = "2026-06-22";

test("reconcileCases opens a case for an overdue customer with no open case", () => {
  const ops = reconcileCases(new Set(["c1", "c2"]), [{ id: "case-1", customerId: "c1" }], TODAY);
  expect(ops).toEqual([{ kind: "open", customerId: "c2" }]);
});

test("reconcileCases resolves an open case whose customer is no longer overdue", () => {
  const ops = reconcileCases(new Set(["c1"]), [
    { id: "case-1", customerId: "c1" },
    { id: "case-2", customerId: "c2" },
  ], TODAY);
  expect(ops).toEqual([{ kind: "resolve", caseId: "case-2" }]);
});

test("reconcileCases is a no-op when cases already match the overdue set", () => {
  const ops = reconcileCases(new Set(["c1"]), [{ id: "case-1", customerId: "c1" }], TODAY);
  expect(ops).toEqual([]);
});

test("reconcileCases both opens and resolves in one pass", () => {
  const ops = reconcileCases(new Set(["c2"]), [{ id: "case-1", customerId: "c1" }], TODAY);
  expect(ops).toContainEqual({ kind: "open", customerId: "c2" });
  expect(ops).toContainEqual({ kind: "resolve", caseId: "case-1" });
  expect(ops.length).toBe(2);
});
