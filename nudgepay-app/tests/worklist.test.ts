import { expect, test } from "vitest";
import {
  ageInDays, heatOf, priorityOf, nextActionOf, buildWorkItems,
  applyView, sortItems, computeMetrics, isBrokenPromise, isFollowUpDue,
  type PromiseSignalInput,
} from "../app/lib/worklist";

const TODAY = "2026-06-22";

test("ageInDays counts whole days overdue (UTC, positive = overdue)", () => {
  expect(ageInDays("2026-06-12", TODAY)).toBe(10);
  expect(ageInDays("2026-06-22", TODAY)).toBe(0);
  expect(ageInDays("2026-06-25", TODAY)).toBe(-3);
});

test("heatOf bands at 30 and 90 day boundaries", () => {
  expect(heatOf(0).band).toBe("cool");
  expect(heatOf(29).band).toBe("cool");
  expect(heatOf(30).band).toBe("warm");
  expect(heatOf(89).band).toBe("warm");
  expect(heatOf(90).band).toBe("hot");
  expect(heatOf(90).label).toBe("HOT");
  expect(heatOf(45).days).toBe(45);
});

test("priorityOf escalates by age and notes never-contacted", () => {
  expect(priorityOf(95, false).level).toBe("Critical");
  expect(priorityOf(95, false).tone).toBe("hot");
  expect(priorityOf(95, true).reason).toContain("never contacted");
  expect(priorityOf(70, false).level).toBe("High");
  expect(priorityOf(45, false).level).toBe("Medium");
  expect(priorityOf(10, false).level).toBe("Low");
  // exact fencepost boundaries
  expect(priorityOf(90, false).level).toBe("Critical");
  expect(priorityOf(60, false).level).toBe("High");
  expect(priorityOf(30, false).level).toBe("Medium");
  expect(priorityOf(29, false).level).toBe("Low");
  // rank: Critical < High < Medium < Low (lower sorts first)
  expect(priorityOf(95, false).rank).toBeLessThan(priorityOf(10, false).rank);
});

test("nextActionOf recommends contact-today for aged never-contacted", () => {
  expect(nextActionOf(40, true).label).toBe("Contact today");
  expect(nextActionOf(40, true).tone).toBe("hot");
  expect(nextActionOf(5, true).label).toBe("Make first contact");
  expect(nextActionOf(95, false).label).toBe("Escalate");
  expect(nextActionOf(20, false).label).toBe("Follow up");
});

test("buildWorkItems joins invoice+customer, derives fields, owner=Unassigned", () => {
  const items = buildWorkItems(
    [
      { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 6000, due_date: "2026-03-01" },
      { id: "i2", qbo_doc_number: "1002", customer_id: "c1", balance: 500, due_date: "2026-06-10" },
    ],
    [{ id: "c1", name: "Acme", phone: "+13105550101", email: "ap@acme.test" }],
    [{ invoiceId: "i2", date: "2026-06-15T10:00:00Z", channel: "Text" }],
    [], TODAY,
  );
  const i1 = items.find((x) => x.invoiceId === "i1")!;
  expect(i1.customerName).toBe("Acme");
  expect(i1.owner).toBe("Unassigned");
  expect(i1.customerBalance).toBe(6500);
  expect(i1.invoiceCount).toBe(2);
  expect(i1.heat.band).toBe("hot");        // >90 days
  expect(i1.lastContact).toBeNull();        // i1 never contacted
  expect(i1.searchText).toContain("acme");
  expect(i1.searchText).toContain("1001");
  expect(items.find((x) => x.invoiceId === "i2")!.lastContact?.channel).toBe("Text");
});

test("applyView filters by each view id", () => {
  const items = buildWorkItems(
    [
      { id: "a", qbo_doc_number: "1", customer_id: "c", balance: 6000, due_date: "2026-03-01" }, // hot, high-value, never
      { id: "b", qbo_doc_number: "2", customer_id: "c", balance: 200, due_date: "2026-06-18" },  // cool, low-value
    ],
    [{ id: "c", name: "C", phone: null, email: null }],
    [{ invoiceId: "b", date: "2026-06-19T00:00:00Z", channel: "Text" }],
    [], TODAY,
  );
  expect(applyView(items, "all-open", TODAY).length).toBe(2);
  expect(applyView(items, "30-plus", TODAY).map((x) => x.invoiceId)).toEqual(["a"]);
  expect(applyView(items, "high-value", TODAY).map((x) => x.invoiceId)).toEqual(["a"]);
  expect(applyView(items, "never-contacted", TODAY).map((x) => x.invoiceId)).toEqual(["a"]);
});

test("applyView high-value is inclusive at exactly the threshold (5000)", () => {
  const items = buildWorkItems(
    [
      { id: "at", qbo_doc_number: "1", customer_id: "c", balance: 5000, due_date: "2026-03-01" },
      { id: "below", qbo_doc_number: "2", customer_id: "c", balance: 4999, due_date: "2026-03-01" },
    ],
    [{ id: "c", name: "C", phone: null, email: null }],
    [], [],
    TODAY,
  );
  const ids = applyView(items, "high-value", TODAY).map((x) => x.invoiceId);
  expect(ids).toContain("at");
  expect(ids).not.toContain("below");
});

test("sortItems orders by the chosen key", () => {
  const items = buildWorkItems(
    [
      { id: "old", qbo_doc_number: "1", customer_id: "c", balance: 100, due_date: "2026-01-01" },
      { id: "big", qbo_doc_number: "2", customer_id: "c", balance: 9000, due_date: "2026-06-10" },
    ],
    [{ id: "c", name: "C", phone: null, email: null }],
    [], [],
    TODAY,
  );
  expect(sortItems(items, "most-overdue")[0].invoiceId).toBe("old");
  expect(sortItems(items, "highest-balance")[0].invoiceId).toBe("big");
});

test("sortItems orders by customer name and recommended priority", () => {
  const items = buildWorkItems(
    [
      { id: "z", qbo_doc_number: "1", customer_id: "cz", balance: 100, due_date: "2026-06-10" },  // recent, low priority
      { id: "a", qbo_doc_number: "2", customer_id: "ca", balance: 100, due_date: "2026-01-01" },  // most overdue, Critical
    ],
    [
      { id: "cz", name: "Zeta", phone: null, email: null },
      { id: "ca", name: "Acme", phone: null, email: null },
    ],
    [], [],
    TODAY,
  );
  // customer: ascending by customerName -> Acme before Zeta
  expect(sortItems(items, "customer").map((x) => x.customerName)).toEqual(["Acme", "Zeta"]);
  // recommended: highest priority (lowest rank / most overdue) first
  expect(sortItems(items, "recommended")[0].invoiceId).toBe("a");
});

test("computeMetrics totals count and amount per bucket", () => {
  const items = buildWorkItems(
    [
      { id: "a", qbo_doc_number: "1", customer_id: "c", balance: 6000, due_date: "2026-03-01" }, // 30+, high-value, never
      { id: "b", qbo_doc_number: "2", customer_id: "c", balance: 400, due_date: "2026-06-19" },  // recent, contacted
    ],
    [{ id: "c", name: "C", phone: null, email: null }],
    [{ invoiceId: "b", date: "2026-06-20T00:00:00Z", channel: "Text" }],
    [], TODAY,
  );
  const m = computeMetrics(items, TODAY);
  expect(m.allOpen).toEqual({ count: 2, amount: 6400 });
  expect(m.thirtyPlus).toEqual({ count: 1, amount: 6000 });
  expect(m.highValue).toEqual({ count: 1, amount: 6000 });
  expect(m.neverContacted).toEqual({ count: 1, amount: 6000 });
});

const T = "2026-06-22";
const inv = (id: string, due: string, bal = 1000) =>
  ({ id, qbo_doc_number: id, customer_id: "c1", balance: bal, due_date: due });
const cust = [{ id: "c1", name: "Acme", phone: null, email: null }];

test("buildWorkItems picks the most-recent contact regardless of input order", () => {
  const items = buildWorkItems(
    [inv("i1", "2026-03-01")], cust,
    [
      { invoiceId: "i1", date: "2026-06-10T00:00:00Z", channel: "Text" },
      { invoiceId: "i1", date: "2026-06-20T00:00:00Z", channel: "Call" },
    ],
    [], T,
  );
  expect(items[0].lastContact).toEqual({ date: "2026-06-20T00:00:00Z", channel: "Call" });
});

test("buildWorkItems maps promise + followUpAt from signals", () => {
  const signals: PromiseSignalInput[] = [
    { invoiceId: "i1", promisedAmount: 250, promisedDate: "2026-06-30", followUpAt: "2026-06-25" },
  ];
  const items = buildWorkItems([inv("i1", "2026-03-01")], cust, [], signals, T);
  expect(items[0].promise).toEqual({ amount: 250, date: "2026-06-30" });
  expect(items[0].followUpAt).toBe("2026-06-25");
});

test("buildWorkItems leaves promise null when amount or date missing", () => {
  const signals: PromiseSignalInput[] = [
    { invoiceId: "i1", promisedAmount: 250, promisedDate: null, followUpAt: null },
  ];
  const items = buildWorkItems([inv("i1", "2026-03-01")], cust, [], signals, T);
  expect(items[0].promise).toBeNull();
});

test("isBrokenPromise: past promise broken, today/future not", () => {
  const mk = (date: string | null) =>
    buildWorkItems([inv("i1", "2026-03-01")], cust, [],
      date ? [{ invoiceId: "i1", promisedAmount: 100, promisedDate: date, followUpAt: null }] : [], T)[0];
  expect(isBrokenPromise(mk("2026-06-21"), T)).toBe(true);  // < today
  expect(isBrokenPromise(mk("2026-06-22"), T)).toBe(false); // == today
  expect(isBrokenPromise(mk("2026-06-23"), T)).toBe(false); // > today
  expect(isBrokenPromise(mk(null), T)).toBe(false);         // no promise
});

test("isFollowUpDue: on/before today due, after not", () => {
  const mk = (fu: string | null) =>
    buildWorkItems([inv("i1", "2026-03-01")], cust, [],
      [{ invoiceId: "i1", promisedAmount: null, promisedDate: null, followUpAt: fu }], T)[0];
  expect(isFollowUpDue(mk("2026-06-21"), T)).toBe(true);  // < today
  expect(isFollowUpDue(mk("2026-06-22"), T)).toBe(true);  // == today
  expect(isFollowUpDue(mk("2026-06-23"), T)).toBe(false); // > today
  expect(isFollowUpDue(mk(null), T)).toBe(false);         // none
});

test("applyView filters follow-ups-due and broken-promises", () => {
  const items = buildWorkItems(
    [inv("i1", "2026-03-01"), inv("i2", "2026-03-01"), inv("i3", "2026-03-01")], cust, [],
    [
      { invoiceId: "i1", promisedAmount: 100, promisedDate: "2026-06-01", followUpAt: null }, // broken
      { invoiceId: "i2", promisedAmount: null, promisedDate: null, followUpAt: "2026-06-20" }, // follow-up due
      { invoiceId: "i3", promisedAmount: 100, promisedDate: "2026-12-01", followUpAt: "2026-12-01" }, // neither
    ], T,
  );
  expect(applyView(items, "broken-promises", T).map((i) => i.invoiceId)).toEqual(["i1"]);
  expect(applyView(items, "follow-ups-due", T).map((i) => i.invoiceId)).toEqual(["i2"]);
});

test("computeMetrics totals follow-ups-due and broken-promises", () => {
  const items = buildWorkItems(
    [inv("i1", "2026-03-01", 400), inv("i2", "2026-03-01", 600)], cust, [],
    [
      { invoiceId: "i1", promisedAmount: 100, promisedDate: "2026-06-01", followUpAt: "2026-06-20" }, // broken + due
      { invoiceId: "i2", promisedAmount: null, promisedDate: null, followUpAt: null },
    ], T,
  );
  const m = computeMetrics(items, T);
  expect(m.brokenPromises).toEqual({ count: 1, amount: 400 });
  expect(m.followUpsDue).toEqual({ count: 1, amount: 400 });
});

test("buildWorkItems resolves owner label from the map and threads ownerId", () => {
  const invoices = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 100, due_date: "2026-03-01" },
    { id: "i2", qbo_doc_number: "1002", customer_id: "c2", balance: 200, due_date: "2026-03-01" },
    { id: "i3", qbo_doc_number: "1003", customer_id: "c3", balance: 300, due_date: "2026-03-01" },
  ];
  const customers = [
    { id: "c1", name: "Acme", phone: null, email: null, owner: "u1" },
    { id: "c2", name: "Globex", phone: null, email: null, owner: null },
    { id: "c3", name: "Initech", phone: null, email: null, owner: "u-stale" },
  ];
  const labels = new Map([["u1", "diskin"]]);
  const items = buildWorkItems(invoices, customers, [], [], "2026-06-22", labels);
  const byId = new Map(items.map((i) => [i.invoiceId, i]));
  expect(byId.get("i1")!.ownerId).toBe("u1");
  expect(byId.get("i1")!.owner).toBe("diskin");
  expect(byId.get("i2")!.ownerId).toBe(null);
  expect(byId.get("i2")!.owner).toBe("Unassigned");
  expect(byId.get("i3")!.owner).toBe("Unknown"); // owner id not in the label map
  expect(byId.get("i1")!.searchText).toContain("diskin"); // owner is searchable
});

test("applyView my-work filters to the current user's accounts", () => {
  const invoices = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 100, due_date: "2026-03-01" },
    { id: "i2", qbo_doc_number: "1002", customer_id: "c2", balance: 200, due_date: "2026-03-01" },
  ];
  const customers = [
    { id: "c1", name: "Acme", phone: null, email: null, owner: "me" },
    { id: "c2", name: "Globex", phone: null, email: null, owner: "someone-else" },
  ];
  const items = buildWorkItems(invoices, customers, [], [], "2026-06-22", new Map());
  expect(applyView(items, "my-work", "2026-06-22", "me").map((i) => i.invoiceId)).toEqual(["i1"]);
  expect(applyView(items, "my-work", "2026-06-22", "nobody")).toEqual([]);
  expect(applyView(items, "my-work", "2026-06-22", null)).toEqual([]); // no current user → none
});
