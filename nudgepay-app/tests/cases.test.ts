import { expect, test } from "vitest";
import {
  reconcileCases,
  buildCaseItems, applyCaseView, sortCaseItems, computeCaseMetrics,
  type CaseRow,
  type CasePromiseInput, type CaseLastContactInput,
} from "../app/lib/cases";

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

const CASES: CaseRow[] = [
  { id: "case-1", customerId: "c1", status: "working", nextActionType: "follow_up", nextActionAt: "2026-06-20" },
  { id: "case-2", customerId: "c2", status: "new", nextActionType: "contact", nextActionAt: "2026-06-25" },
];
const CUSTOMERS = [
  { id: "c1", name: "Acme", phone: "+13105550101", email: "ap@acme.test", owner: "u1" },
  { id: "c2", name: "Globex", phone: null, email: null, owner: null },
];
const INVOICES = [
  { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 6000, due_date: "2026-03-01" }, // 113d
  { id: "i2", qbo_doc_number: "1002", customer_id: "c1", balance: 300,  due_date: "2026-06-18" }, // 4d
  { id: "i3", qbo_doc_number: "2001", customer_id: "c2", balance: 800,  due_date: "2026-05-01" }, // 52d
];
const LABELS = new Map([["u1", "diskin"]]);

test("buildCaseItems aggregates totalOverdue, invoiceCount, oldest age, and heat from the oldest", () => {
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, [], [], TODAY, LABELS);
  const acme = items.find((c) => c.customerId === "c1")!;
  expect(acme.totalOverdue).toBe(6300);
  expect(acme.invoiceCount).toBe(2);
  expect(acme.oldestAgeDays).toBe(113);
  expect(acme.heat.band).toBe("hot");
  expect(acme.owner).toBe("diskin");
  expect(acme.invoices.map((i) => i.invoiceId)).toEqual(["i1", "i2"]); // oldest first
  expect(acme.searchText).toContain("diskin");
  expect(acme.searchText).toContain("1001");
});

test("buildCaseItems resolves owner Unassigned when null", () => {
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, [], [], TODAY, LABELS);
  expect(items.find((c) => c.customerId === "c2")!.owner).toBe("Unassigned");
});

test("buildCaseItems excludes invoices with a null customer_id", () => {
  const orphanInvoices = [...INVOICES, { id: "i9", qbo_doc_number: "9999", customer_id: null, balance: 100, due_date: "2026-01-01" }];
  const items = buildCaseItems(CASES, orphanInvoices, CUSTOMERS, [], [], TODAY, LABELS);
  expect(items.flatMap((c) => c.invoices).some((i) => i.invoiceId === "i9")).toBe(false);
});

test("applyCaseView filters by case-level predicates", () => {
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, [], [], TODAY, LABELS);
  expect(applyCaseView(items, "30-plus", TODAY, null).map((c) => c.customerId)).toEqual(["c1", "c2"]);
  expect(applyCaseView(items, "high-value", TODAY, null).map((c) => c.customerId)).toEqual(["c1"]);
  expect(applyCaseView(items, "follow-ups-due", TODAY, null).map((c) => c.customerId)).toEqual(["c1"]); // nextActionAt 06-20 <= today
  expect(applyCaseView(items, "my-work", TODAY, "u1").map((c) => c.customerId)).toEqual(["c1"]);
  expect(applyCaseView(items, "never-contacted", TODAY, null).map((c) => c.customerId).sort()).toEqual(["c1", "c2"]);
});

test("computeCaseMetrics counts cases and sums overdue", () => {
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, [], [], TODAY, LABELS);
  const m = computeCaseMetrics(items, TODAY);
  expect(m.allOpen.count).toBe(2);
  expect(m.allOpen.amount).toBe(7100);
  expect(m.highValue.count).toBe(1);
  expect(m.followUpsDue.count).toBe(1);
  expect(m.followUpsDue.amount).toBe(6300);
});

test("buildCaseItems sets lastContact from the most-recent contact per case and excludes it from never-contacted", () => {
  const lastContacts: CaseLastContactInput[] = [
    { caseId: "case-1", date: "2026-06-17T00:00:00Z", channel: "Email" },
    { caseId: "case-1", date: "2026-06-19T00:00:00Z", channel: "Text" },
  ];
  const items = buildCaseItems(
    CASES, INVOICES, CUSTOMERS,
    lastContacts, [],
    TODAY, LABELS,
  );
  // Most-recent for case-1 is June 19 (Text), not June 17 (Email).
  expect(items.find((c) => c.caseId === "case-1")!.lastContact).toEqual({ date: "2026-06-19T00:00:00Z", channel: "Text" });
  expect(applyCaseView(items, "never-contacted", TODAY, null).map((c) => c.customerId)).toEqual(["c2"]);
});

test("sortCaseItems recommended orders by priority rank then oldest age", () => {
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, [], [], TODAY, LABELS);
  expect(sortCaseItems(items, "recommended").map((c) => c.customerId)).toEqual(["c1", "c2"]);
});

test("buildCaseItems populates promise, brokenPromise, promiseStatus and case-keyed last contact", () => {
  const cases = [{ id: "case-1", customerId: "c1", status: "promised" as const, nextActionType: "promise" as const, nextActionAt: "2026-07-03" }];
  const invoices = [{ id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 1200, due_date: "2026-03-01" }];
  const customers = [{ id: "c1", name: "Acme", phone: null, email: null, owner: null }];
  const lastContacts: CaseLastContactInput[] = [{ caseId: "case-1", date: "2026-06-20T10:00:00Z", channel: "Text" }];
  const promises: CasePromiseInput[] = [
    { caseId: "case-1", status: "broken", promisedAmount: 500, promisedDate: "2026-07-01", amountReceived: 0 },
  ];
  const items = buildCaseItems(cases, invoices, customers, lastContacts, promises, "2026-07-10", new Map());
  expect(items[0].promise).toEqual({ amount: 500, date: "2026-07-01" });
  expect(items[0].brokenPromise).toBe(true);
  expect(items[0].promiseStatus).toBe("broken");
  expect(items[0].lastContact).toEqual({ date: "2026-06-20T10:00:00Z", channel: "Text" });
});
