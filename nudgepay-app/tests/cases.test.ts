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
  { id: "case-1", customerId: "c1", status: "working", nextActionType: "follow_up", nextActionAt: "2026-06-20", exceptionReason: null, exceptionNote: null },
  { id: "case-2", customerId: "c2", status: "new", nextActionType: "contact", nextActionAt: "2026-06-25", exceptionReason: null, exceptionNote: null },
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
  const cases = [{ id: "case-1", customerId: "c1", status: "promised" as const, nextActionType: "promise" as const, nextActionAt: "2026-07-03", exceptionReason: null, exceptionNote: null }];
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

// --- Phase 7b scorer tests ---
// SCORE_TODAY is one day before the follow-up due date ("2026-06-20") so that
// followUpDue is false for case-1 in the shared CASES fixture. This keeps the
// expected scores matching the brief's arithmetic: age45 + balance12 + silence15 = 72.
const SCORE_TODAY = "2026-06-19";

test("buildCaseItems scores via scorePriority and exposes score/factors/effectiveLevel", () => {
  // Acme: oldest 110d (2026-03-01 -> SCORE_TODAY 2026-06-19), total 6300, never contacted -> age45 + balance12 + silence15 = 72 -> High
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, [], [], SCORE_TODAY, LABELS);
  const acme = items.find((c) => c.customerId === "c1")!;
  expect(acme.score).toBe(72);
  expect(acme.priority.level).toBe("High");
  expect(acme.effectiveLevel).toBe("High"); // no override
  expect(acme.factors.map((f) => f.key)).toContain("age");
  expect(acme.override).toBe(null);
});

test("buildCaseItems derives priorAttempts from the per-case contact count", () => {
  const lastContacts: CaseLastContactInput[] = [
    { caseId: "case-1", date: "2026-06-10T00:00:00Z", channel: "Text" },
    { caseId: "case-1", date: "2026-06-17T00:00:00Z", channel: "Email" },
    { caseId: "case-1", date: "2026-06-19T00:00:00Z", channel: "Text" },
  ];
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, lastContacts, [], SCORE_TODAY, LABELS);
  expect(items.find((c) => c.caseId === "case-1")!.priorAttempts).toBe(3);
  expect(items.find((c) => c.caseId === "case-2")!.priorAttempts).toBe(0);
});

test("an override pins the effective level while leaving the computed score intact", () => {
  const cases: CaseRow[] = [
    { id: "case-1", customerId: "c1", status: "working", nextActionType: "follow_up", nextActionAt: "2026-06-20",
      exceptionReason: null, exceptionNote: null,
      priorityOverride: "critical", priorityOverrideReason: "CEO escalation",
      priorityOverrideBy: "u1", priorityOverrideAt: "2026-06-24T00:00:00Z" },
  ];
  const items = buildCaseItems(cases, INVOICES, CUSTOMERS, [], [], SCORE_TODAY, LABELS);
  const c = items[0];
  expect(c.priority.level).toBe("High");     // computed unchanged
  expect(c.effectiveLevel).toBe("Critical"); // pinned up
  expect(c.override).toEqual({ level: "Critical", reason: "CEO escalation", by: "u1", at: "2026-06-24T00:00:00Z" });
});

test("sortCaseItems recommended orders by effective level, then score, then priorAttempts", () => {
  // c2 pinned to critical should lead despite a lower computed score than c1.
  const cases: CaseRow[] = [
    { id: "case-1", customerId: "c1", status: "working", nextActionType: "follow_up", nextActionAt: "2026-06-20", exceptionReason: null, exceptionNote: null },
    { id: "case-2", customerId: "c2", status: "new", nextActionType: "contact", nextActionAt: "2026-06-25", exceptionReason: null, exceptionNote: null,
      priorityOverride: "critical", priorityOverrideReason: null, priorityOverrideBy: null, priorityOverrideAt: null },
  ];
  const items = buildCaseItems(cases, INVOICES, CUSTOMERS, [], [], SCORE_TODAY, LABELS);
  expect(sortCaseItems(items, "recommended").map((c) => c.customerId)).toEqual(["c2", "c1"]);
});

test("waiting view selects waiting + on_hold cases; exception fields flow through", () => {
  const cases: CaseRow[] = [
    { id: "c-w", customerId: "x1", status: "waiting", nextActionType: "waiting", nextActionAt: "2026-07-20", exceptionReason: null, exceptionNote: null },
    { id: "c-h", customerId: "x2", status: "on_hold", nextActionType: "exception", nextActionAt: "2026-07-20", exceptionReason: "disputed", exceptionNote: "line 3" },
    { id: "c-o", customerId: "x3", status: "working", nextActionType: "follow_up", nextActionAt: "2026-07-01", exceptionReason: null, exceptionNote: null },
  ];
  const invoices = [
    { id: "i1", qbo_doc_number: "1", customer_id: "x1", balance: 100, due_date: "2026-03-01" },
    { id: "i2", qbo_doc_number: "2", customer_id: "x2", balance: 100, due_date: "2026-03-01" },
    { id: "i3", qbo_doc_number: "3", customer_id: "x3", balance: 100, due_date: "2026-03-01" },
  ];
  const customers = [
    { id: "x1", name: "W", phone: null, email: null, owner: null },
    { id: "x2", name: "H", phone: null, email: null, owner: null },
    { id: "x3", name: "O", phone: null, email: null, owner: null },
  ];
  const items = buildCaseItems(cases, invoices, customers, [], [], "2026-07-10", new Map());
  const hold = items.find((i) => i.caseId === "c-h")!;
  expect(hold.exceptionReason).toBe("disputed");
  expect(hold.exceptionNote).toBe("line 3");

  const waiting = applyCaseView(items, "waiting", "2026-07-10", null).map((i) => i.caseId).sort();
  expect(waiting).toEqual(["c-h", "c-w"]);

  // The two deferred cases have a future review date -> excluded from follow-ups-due.
  const due = applyCaseView(items, "follow-ups-due", "2026-07-10", null).map((i) => i.caseId);
  expect(due).toEqual(["c-o"]);
});

test("buildCaseItems threads smsConsent from the customer (defaults false)", () => {
  const today = "2026-06-25";
  const cases = [
    { id: "case-1", customerId: "cust-1", status: "working" as const, nextActionType: null, nextActionAt: null, exceptionReason: null, exceptionNote: null },
    { id: "case-2", customerId: "cust-2", status: "working" as const, nextActionType: null, nextActionAt: null, exceptionReason: null, exceptionNote: null },
  ];
  const invoices = [
    { id: "inv-1", qbo_doc_number: "1001", customer_id: "cust-1", balance: 100, due_date: "2026-05-01" },
    { id: "inv-2", qbo_doc_number: "1002", customer_id: "cust-2", balance: 50, due_date: "2026-05-01" },
  ];
  const customers = [
    { id: "cust-1", name: "Yes Co", phone: "+12295550100", email: null, owner: null, smsConsent: true },
    { id: "cust-2", name: "No Co", phone: "+12295550101", email: null, owner: null }, // smsConsent omitted -> false
  ];
  const items = buildCaseItems(cases, invoices, customers, [], [], today, new Map());
  const byId = Object.fromEntries(items.map((i) => [i.caseId, i]));
  expect(byId["case-1"].smsConsent).toBe(true);
  expect(byId["case-2"].smsConsent).toBe(false);
});

test("suppressed parked cases drop out of the default view and active metrics; onHold counts them", () => {
  const today = "2026-06-25";
  const cases: CaseRow[] = [
    { id: "active", customerId: "c-active", status: "working", nextActionType: "follow_up", nextActionAt: "2026-06-20", exceptionReason: null, exceptionNote: null },
    { id: "parked-future", customerId: "c-fut", status: "on_hold", nextActionType: "exception", nextActionAt: "2026-07-10", exceptionReason: "disputed", exceptionNote: null },
    { id: "parked-terminal", customerId: "c-term", status: "on_hold", nextActionType: "exception", nextActionAt: null, exceptionReason: "do_not_contact", exceptionNote: null },
    { id: "resurfaced", customerId: "c-res", status: "on_hold", nextActionType: "exception", nextActionAt: "2026-06-24", exceptionReason: "disputed", exceptionNote: null },
  ];
  const invoices = cases.map((c) => ({ id: `i-${c.customerId}`, qbo_doc_number: "1", customer_id: c.customerId, balance: 100, due_date: "2026-01-01" }));
  const customers = cases.map((c) => ({ id: c.customerId, name: c.customerId, phone: null, email: null, owner: null, smsConsent: false }));
  const items = buildCaseItems(cases, invoices, customers, [], [], today, new Map());

  const byId = new Map(items.map((i) => [i.caseId, i]));
  expect(byId.get("parked-future")!.suppressed).toBe(true);
  expect(byId.get("parked-terminal")!.suppressed).toBe(true);
  expect(byId.get("resurfaced")!.suppressed).toBe(false);
  expect(byId.get("active")!.suppressed).toBe(false);

  // Default view excludes suppressed; resurfaced + active remain.
  const def = applyCaseView(items, "all-open", today, null).map((i) => i.caseId).sort();
  expect(def).toEqual(["active", "resurfaced"]);

  // Exceptions/On-hold view ("waiting") includes ALL parked, including terminal.
  const onHoldView = applyCaseView(items, "waiting", today, null).map((i) => i.caseId).sort();
  expect(onHoldView).toEqual(["parked-future", "parked-terminal", "resurfaced"]);

  // Metrics: allOpen excludes the two still-parked; onHold counts them.
  const m = computeCaseMetrics(items, today);
  expect(m.allOpen.count).toBe(2);     // active + resurfaced
  expect(m.onHold.count).toBe(2);      // parked-future + parked-terminal
});
