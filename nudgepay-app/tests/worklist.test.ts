import { expect, test } from "vitest";
import {
  ageInDays, heatOf, priorityOf, nextActionOf, buildWorkItems,
  applyView, sortItems, computeMetrics,
} from "../app/lib/worklist.server";

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
    TODAY,
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
    TODAY,
  );
  expect(applyView(items, "all-open").length).toBe(2);
  expect(applyView(items, "30-plus").map((x) => x.invoiceId)).toEqual(["a"]);
  expect(applyView(items, "high-value").map((x) => x.invoiceId)).toEqual(["a"]);
  expect(applyView(items, "never-contacted").map((x) => x.invoiceId)).toEqual(["a"]);
});

test("applyView high-value is inclusive at exactly the threshold (5000)", () => {
  const items = buildWorkItems(
    [
      { id: "at", qbo_doc_number: "1", customer_id: "c", balance: 5000, due_date: "2026-03-01" },
      { id: "below", qbo_doc_number: "2", customer_id: "c", balance: 4999, due_date: "2026-03-01" },
    ],
    [{ id: "c", name: "C", phone: null, email: null }],
    [],
    TODAY,
  );
  const ids = applyView(items, "high-value").map((x) => x.invoiceId);
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
    [],
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
    [],
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
    TODAY,
  );
  const m = computeMetrics(items);
  expect(m.allOpen).toEqual({ count: 2, amount: 6400 });
  expect(m.thirtyPlus).toEqual({ count: 1, amount: 6000 });
  expect(m.highValue).toEqual({ count: 1, amount: 6000 });
  expect(m.neverContacted).toEqual({ count: 1, amount: 6000 });
});
