import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyInvoiceView, buildInvoiceQueue, sortInvoiceItems,
  type InvoiceQueueItem,
} from "../app/lib/invoice-queue";
import type { InvoiceInput, CustomerInput } from "../app/lib/worklist";

const TODAY = "2026-06-22";
const CUSTOMERS: CustomerInput[] = [
  { id: "c1", name: "Acme", phone: "+1", email: "ap@acme.test", owner: "u1" },
  { id: "c2", name: "Globex", phone: null, email: null, owner: null },
];
const INVOICES: InvoiceInput[] = [
  { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 6000, due_date: "2026-03-01", amount: 6000, invoice_date: "2026-02-01", status: "overdue", paid_date: null },
  { id: "i2", qbo_doc_number: "1002", customer_id: "c1", balance: 300, due_date: "2026-06-18", amount: 300, invoice_date: "2026-05-01", status: "open", paid_date: null },
  { id: "i3", qbo_doc_number: "2001", customer_id: "c2", balance: 800, due_date: "2026-05-01", amount: 800, invoice_date: "2026-04-01", status: "overdue", paid_date: null },
  { id: "i4", qbo_doc_number: "3001", customer_id: "c3", balance: 100, due_date: "2026-06-25", amount: 100, invoice_date: "2026-06-01", status: "open", paid_date: null },
];

function built(): InvoiceQueueItem[] {
  return buildInvoiceQueue({
    invoices: INVOICES,
    casesByCustomer: new Map([
      ["c1", { caseId: "case-1", lastContact: { date: "2026-06-19T00:00:00Z", channel: "Text" }, peeks: [{ at: "2026-06-19T00:00:00Z", kind: "text", summary: "Nudge sent" }] }],
    ]),
    customers: CUSTOMERS,
    ownerLabels: new Map([["u1", "diskin"]]),
    payerByCustomer: new Map([
      ["c1", { band: "fair", daysToPay: 38, paidSample: 2, replyRate: 0.4, outbound: 5, inbound: 2, brokenPromise: false }],
    ]),
    today: TODAY,
  });
}

test("buildInvoiceQueue maps cased and caseless rows and skips zero-balance", () => {
  const items = built();
  expect(items.map((i) => i.invoiceId)).toEqual(["i1", "i2", "i3", "i4"]);
  const cased = items.find((i) => i.invoiceId === "i1")!;
  expect(cased.caseId).toBe("case-1");
  expect(cased.customerName).toBe("Acme");
  expect(cased.owner).toBe("diskin");
  expect(cased.ageDays).toBe(113);
  expect(cased.heat.band).toBe("hot");
  expect(cased.lastContact?.channel).toBe("Text");
  expect(cased.peeks).toHaveLength(1);
  expect(cased.payer?.daysToPay).toBe(38);
  expect(cased.searchText).toContain("1001");

  const caseless = items.find((i) => i.invoiceId === "i4")!;
  expect(caseless.caseId).toBeNull();
  expect(caseless.customerId).toBe("c3");
  expect(caseless.customerName).toBe("(unknown customer)");
  expect(caseless.peeks).toEqual([]);
  expect(caseless.lastContact).toBeNull();
  expect(caseless.payer).toBeNull();
});

test("sortInvoiceItems due-date puts nulls last and recommended is oldest then highest", () => {
  const items = built();
  expect(sortInvoiceItems(items, "due-date").map((i) => i.invoiceId)).toEqual(["i1", "i3", "i2", "i4"]);
  expect(sortInvoiceItems(items, "most-overdue").map((i) => i.invoiceId)).toEqual(["i1", "i3", "i2", "i4"]);
  expect(sortInvoiceItems(items, "highest-balance").map((i) => i.invoiceId)).toEqual(["i1", "i3", "i2", "i4"]);
  expect(sortInvoiceItems(items, "customer")[0].customerName).toBe("(unknown customer)");
  const withNull = [
    ...items,
    { ...items[0], invoiceId: "null-due", dueDate: null, ageDays: 0 },
  ];
  const dueSorted = sortInvoiceItems(withNull, "due-date");
  expect(dueSorted[dueSorted.length - 1].invoiceId).toBe("null-due");
  const rec = sortInvoiceItems(
    [
      { ...items[0], invoiceId: "old-small", ageDays: 50, balance: 10 },
      { ...items[0], invoiceId: "old-big", ageDays: 50, balance: 99 },
      { ...items[0], invoiceId: "older", ageDays: 80, balance: 1 },
    ],
    "recommended",
  );
  expect(rec.map((i) => i.invoiceId)).toEqual(["older", "old-big", "old-small"]);
});

test("applyInvoiceView uses invoice predicates and does not drop caseless from all-open", () => {
  const items = built();
  const matchingCaseIds = new Set(["case-1"]);
  expect(applyInvoiceView(items, "coming-due", { matchingCaseIds, currentUserId: "u1" })).toEqual([]);
  expect(applyInvoiceView(items, "all-open", { matchingCaseIds, currentUserId: "u1" }).map((i) => i.invoiceId))
    .toEqual(["i1", "i2", "i3", "i4"]);
  expect(applyInvoiceView(items, "30-plus", { matchingCaseIds, currentUserId: "u1" }).map((i) => i.invoiceId))
    .toEqual(["i1", "i3"]);
  expect(applyInvoiceView(items, "high-value", { matchingCaseIds, currentUserId: "u1" }).map((i) => i.invoiceId))
    .toEqual(["i1"]);
  expect(applyInvoiceView(items, "never-contacted", { matchingCaseIds, currentUserId: "u1" }).map((i) => i.invoiceId))
    .toEqual(["i3", "i4"]);
  expect(applyInvoiceView(items, "my-work", { matchingCaseIds, currentUserId: "u1" }).map((i) => i.invoiceId))
    .toEqual(["i1", "i2"]);
  expect(applyInvoiceView(items, "waiting", { matchingCaseIds, currentUserId: "u1" }).map((i) => i.invoiceId))
    .toEqual(["i1", "i2"]);
});

test("applyInvoiceView excludes on-hold cases from invoice-native views", () => {
  const items = built().map((i) => i.customerId === "c1" ? { ...i, suppressed: true } : i);
  const matchingCaseIds = new Set(["case-1"]);
  expect(applyInvoiceView(items, "all-open", { matchingCaseIds, currentUserId: "u1" }).map((i) => i.invoiceId))
    .toEqual(["i3", "i4"]);
  expect(applyInvoiceView(items, "30-plus", { matchingCaseIds, currentUserId: "u1" }).map((i) => i.invoiceId))
    .toEqual(["i3"]);
  expect(applyInvoiceView(items, "high-value", { matchingCaseIds, currentUserId: "u1" }).map((i) => i.invoiceId))
    .toEqual([]);
  expect(applyInvoiceView(items, "on-hold", { matchingCaseIds, currentUserId: "u1" }).map((i) => i.invoiceId))
    .toEqual(["i1", "i2"]);
});

test("case-queue Stage-1 select includes amount/invoice_date/status/paid_date", () => {
  const src = readFileSync(new URL("../app/lib/case-queue.server.ts", import.meta.url), "utf8");
  expect(src).toContain("amount, invoice_date, status, paid_date");
  const dash = readFileSync(new URL("../app/routes/dashboard.tsx", import.meta.url), "utf8");
  expect(dash).not.toMatch(/const VALID_SORTS/);
  expect(dash).toContain("parseEntityMode");
  expect(dash).toContain("invoiceItems");
});

test("WorkQueue invoice rows keep table roles, entity toggle, and caseless j/k", () => {
  const src = readFileSync(new URL("../app/components/WorkQueue.tsx", import.meta.url), "utf8");
  expect(src).toContain("QUEUE_GRID_INV_GENERAL");
  expect(src).toContain("QUEUE_GRID_INV_DETAILED");
  expect(src).toContain("QUEUE_GRID_INV_RISK");
  expect(src).toContain("function InvoiceQueueRow");
  expect(src).toContain('role="row"');
  expect(src).toContain('data-label="Doc #"');
  expect(src).toContain("Coming due is invoice-grouped. Switch to All open to use Customers vs Invoices.");
  expect(src).toContain("aria-label=\"Queue entity\"");
  expect(src).not.toContain('role="tablist"');
  expect(src).toContain("navigate(`/accounts/${target.customerId}`)");
  expect(src).toContain("selectedCaseIds");
  expect(src).toContain("`${selected.size} invoices · ${selectedCaseIds.length} accounts`");
  expect(src).toContain("Invoices without an open case skipped.");
  expect(src).toContain("SORT_OPTIONS_INVOICES");
  expect(src).toContain('{ id: "due-date", label: "Due date" }');
  expect(src).toContain("value={sortSelectValue}");
  expect(src).toContain('id === "customers" && sort === "due-date" ? "most-overdue"');
  expect(src).toContain("collision={item.caseId ? collisions[item.caseId] : undefined}");
  expect(src).toContain("<CollisionMarker collision={collision} />");
  const entityAt = src.indexOf("aria-label=\"Queue entity\"");
  const formAt = src.indexOf('<Form method="get"');
  expect(entityAt).toBeGreaterThan(-1);
  expect(formAt).toBeGreaterThan(entityAt);
});
