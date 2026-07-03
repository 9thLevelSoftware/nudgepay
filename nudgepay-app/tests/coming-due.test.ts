import { test, expect } from "vitest";
import { isComingDue, buildComingDueGroups, comingDueMetric } from "../app/lib/coming-due";
import type { InvoiceInput, CustomerInput } from "../app/lib/worklist";

const today = "2026-07-02";

// ---------------------------------------------------------------------------
// isComingDue boundaries
// ---------------------------------------------------------------------------

test("due today is coming due", () => {
  expect(isComingDue("2026-07-02", today)).toBe(true);
});

test("due in 7 days is coming due", () => {
  expect(isComingDue("2026-07-09", today)).toBe(true);
});

test("due in 8 days is NOT coming due", () => {
  expect(isComingDue("2026-07-10", today)).toBe(false);
});

test("overdue (yesterday) is NOT coming due", () => {
  expect(isComingDue("2026-07-01", today)).toBe(false);
});

test("far future is NOT coming due", () => {
  expect(isComingDue("2026-08-01", today)).toBe(false);
});

test("a custom (org-configured) window widens or narrows the boundary", () => {
  // Default window (7d) excludes day 10; a 14-day org-configured window includes it.
  expect(isComingDue("2026-07-10", today, 14)).toBe(true);
  // 18 days out is beyond even the 14-day window.
  expect(isComingDue("2026-07-20", today, 14)).toBe(false);
  // 4 days out: a narrower window (3d) excludes it; the default (7d) includes it.
  expect(isComingDue("2026-07-06", today, 3)).toBe(false);
  expect(isComingDue("2026-07-06", today, 7)).toBe(true);
});

// ---------------------------------------------------------------------------
// buildComingDueGroups
// ---------------------------------------------------------------------------

const customers: CustomerInput[] = [
  { id: "c1", name: "Acme Corp", phone: null, email: null },
  { id: "c2", name: "Beta Inc", phone: null, email: null },
];

test("groups invoices by customer and sorts by nextDueDate", () => {
  const invoices: InvoiceInput[] = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 500, due_date: "2026-07-05" },
    { id: "i2", qbo_doc_number: "1002", customer_id: "c1", balance: 300, due_date: "2026-07-03" },
    { id: "i3", qbo_doc_number: "1003", customer_id: "c2", balance: 200, due_date: "2026-07-02" },
  ];
  const groups = buildComingDueGroups(invoices, customers, today);
  expect(groups).toHaveLength(2);
  // c2 (due today = soonest) first, then c1
  expect(groups[0].customerId).toBe("c2");
  expect(groups[0].totalBalance).toBe(200);
  expect(groups[0].invoices).toHaveLength(1);
  expect(groups[1].customerId).toBe("c1");
  expect(groups[1].totalBalance).toBe(800);
  expect(groups[1].invoices).toHaveLength(2);
  // Within c1, sorted by daysUntilDue ascending
  expect(groups[1].invoices[0].docNumber).toBe("1002"); // due in 1d
  expect(groups[1].invoices[1].docNumber).toBe("1001"); // due in 3d
});

test("excludes zero-balance invoices", () => {
  const invoices: InvoiceInput[] = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 0, due_date: "2026-07-05" },
  ];
  expect(buildComingDueGroups(invoices, customers, today)).toHaveLength(0);
});

test("excludes null due_date invoices", () => {
  const invoices: InvoiceInput[] = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 500, due_date: null },
  ];
  expect(buildComingDueGroups(invoices, customers, today)).toHaveLength(0);
});

test("excludes overdue invoices", () => {
  const invoices: InvoiceInput[] = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 500, due_date: "2026-06-30" },
  ];
  expect(buildComingDueGroups(invoices, customers, today)).toHaveLength(0);
});

test("excludes invoices beyond 7 days", () => {
  const invoices: InvoiceInput[] = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 500, due_date: "2026-07-10" },
  ];
  expect(buildComingDueGroups(invoices, customers, today)).toHaveLength(0);
});

test("buildComingDueGroups honors an org-configured comingDueDays window", () => {
  const invoices: InvoiceInput[] = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 500, due_date: "2026-07-10" },
  ];
  // Beyond the default 7-day window...
  expect(buildComingDueGroups(invoices, customers, today)).toHaveLength(0);
  // ...but within a 14-day org-configured window.
  const groups = buildComingDueGroups(invoices, customers, today, 14);
  expect(groups).toHaveLength(1);
  expect(groups[0].invoices[0].docNumber).toBe("1001");
});

// ---------------------------------------------------------------------------
// comingDueMetric
// ---------------------------------------------------------------------------

test("metric counts customers and sums balances", () => {
  const invoices: InvoiceInput[] = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 500, due_date: "2026-07-05" },
    { id: "i2", qbo_doc_number: "1002", customer_id: "c2", balance: 200, due_date: "2026-07-03" },
  ];
  const groups = buildComingDueGroups(invoices, customers, today);
  const m = comingDueMetric(groups);
  expect(m.count).toBe(2);
  expect(m.amount).toBe(700);
});

test("metric is zero for no groups", () => {
  const m = comingDueMetric([]);
  expect(m.count).toBe(0);
  expect(m.amount).toBe(0);
});
