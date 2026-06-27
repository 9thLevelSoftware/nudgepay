// tests/accounts.test.ts
import { expect, test } from "vitest";
import {
  deriveStanding, buildAccountRows,
  type AccountCaseInput, type AccountLastContactInput,
} from "../app/lib/accounts";
import type { CustomerInput, InvoiceInput } from "../app/lib/worklist";

const TODAY = "2026-06-22";

test("deriveStanding: no open balance is current (even with a stale case)", () => {
  expect(deriveStanding({ openBalance: 0, hasActiveCase: true, onHold: false })).toBe("current");
});
test("deriveStanding: on-hold wins over everything", () => {
  expect(deriveStanding({ openBalance: 500, hasActiveCase: true, onHold: true })).toBe("on_hold");
});
test("deriveStanding: open balance + active case is in_collections", () => {
  expect(deriveStanding({ openBalance: 500, hasActiveCase: true, onHold: false })).toBe("in_collections");
});
test("deriveStanding: open balance + no case is overdue", () => {
  expect(deriveStanding({ openBalance: 500, hasActiveCase: false, onHold: false })).toBe("overdue");
});

const CUSTOMERS: CustomerInput[] = [
  { id: "c1", name: "Acme", phone: "+13105550101", email: "ap@acme.test", owner: "u1", smsConsent: true },
  { id: "c2", name: "Globex", phone: null, email: null, owner: null, smsConsent: false },
  { id: "c3", name: "Initech", phone: null, email: null, owner: "u1", smsConsent: false }, // paid-up, no invoices
];
const INVOICES: InvoiceInput[] = [
  { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 6000, due_date: "2026-03-01" }, // overdue 113d
  { id: "i2", qbo_doc_number: "1002", customer_id: "c1", balance: 300,  due_date: "2026-09-01" }, // open, not due
  { id: "i3", qbo_doc_number: "2001", customer_id: "c2", balance: 800,  due_date: "2026-05-01" }, // overdue 52d
];
const CASES: AccountCaseInput[] = [{ customerId: "c1", onHold: false }];
const LCS: AccountLastContactInput[] = [
  { customerId: "c1", date: "2026-06-10", channel: "Call" },
  { customerId: "c1", date: "2026-06-18", channel: "Text" }, // newer wins
];
const LABELS = new Map([["u1", "diskin"]]);

test("buildAccountRows aggregates balance, open count, oldest overdue, owner, last contact, standing", () => {
  const rows = buildAccountRows(CUSTOMERS, INVOICES, CASES, LCS, TODAY, LABELS);
  const acme = rows.find((r) => r.customerId === "c1")!;
  expect(acme.openBalance).toBe(6300);
  expect(acme.openInvoiceCount).toBe(2);
  expect(acme.oldestOverdueDays).toBe(113); // only the overdue invoice counts toward age
  expect(acme.owner).toBe("diskin");
  expect(acme.hasActiveCase).toBe(true);
  expect(acme.standing).toBe("in_collections");
  expect(acme.lastContact).toEqual({ date: "2026-06-18", channel: "Text" });
  expect(acme.searchText).toContain("acme");

  const globex = rows.find((r) => r.customerId === "c2")!;
  expect(globex.owner).toBe("Unassigned");
  expect(globex.standing).toBe("overdue"); // open balance, no case

  const initech = rows.find((r) => r.customerId === "c3")!;
  expect(initech.openBalance).toBe(0);
  expect(initech.openInvoiceCount).toBe(0);
  expect(initech.standing).toBe("current"); // directory includes paid-up customers
  expect(initech.lastContact).toBeNull();
});

test("buildAccountRows includes every customer, even with no invoices", () => {
  const rows = buildAccountRows(CUSTOMERS, INVOICES, CASES, LCS, TODAY, LABELS);
  expect(rows.map((r) => r.customerId).sort()).toEqual(["c1", "c2", "c3"]);
});
