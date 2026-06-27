import { expect, test } from "vitest";
import {
  buildPromiseRows, isDueSoon, applyPromiseTab, sortPromiseRows, computePromiseMetrics,
  PROMISE_TABS, PROMISE_SORTS, type PromiseInput,
} from "../app/lib/promise-ledger";

const TODAY = "2026-06-22"; // Monday; addBusinessDays(+3) = Thu 2026-06-25

// p1 due-soon (06-24, within window), p2 active-not-due-soon (07-10),
// p3 due-soon + awaiting-evaluation (past grace), p4 broken, p5 kept,
// p6 partially_kept, p7 renegotiated, p8 cancelled.
const PROMISES: PromiseInput[] = [
  { promiseId: "p1", caseId: "k1", customerId: "c1", customerName: "Acme",   ownerId: "u1", status: "pending",        promisedAmount: 500,  amountReceived: 0,   baselineBalance: 500,  promisedDate: "2026-06-24", graceUntil: "2026-06-26", createdAt: "2026-06-20T00:00:00Z" },
  { promiseId: "p2", caseId: "k2", customerId: "c2", customerName: "Globex", ownerId: null, status: "pending",        promisedAmount: 1000, amountReceived: 0,   baselineBalance: 1000, promisedDate: "2026-07-10", graceUntil: "2026-07-12", createdAt: "2026-06-20T00:00:00Z" },
  { promiseId: "p3", caseId: "k3", customerId: "c3", customerName: "Initech",ownerId: "u1", status: "pending",        promisedAmount: 300,  amountReceived: 0,   baselineBalance: 300,  promisedDate: "2026-06-10", graceUntil: "2026-06-12", createdAt: "2026-06-05T00:00:00Z" },
  { promiseId: "p4", caseId: "k4", customerId: "c4", customerName: "Umbrella",ownerId: "u1",status: "broken",         promisedAmount: 800,  amountReceived: 200, baselineBalance: 800,  promisedDate: "2026-05-01", graceUntil: "2026-05-05", createdAt: "2026-04-28T00:00:00Z" },
  { promiseId: "p5", caseId: "k5", customerId: "c5", customerName: "Stark",  ownerId: "u1", status: "kept",           promisedAmount: 400,  amountReceived: 400, baselineBalance: 400,  promisedDate: "2026-05-10", graceUntil: "2026-05-14", createdAt: "2026-05-08T00:00:00Z" },
  { promiseId: "p6", caseId: "k6", customerId: "c6", customerName: "Wayne",  ownerId: "u1", status: "partially_kept", promisedAmount: 600,  amountReceived: 250, baselineBalance: 600,  promisedDate: "2026-05-12", graceUntil: "2026-05-16", createdAt: "2026-05-10T00:00:00Z" },
  { promiseId: "p7", caseId: "k7", customerId: "c7", customerName: "Cyberdyne",ownerId:"u1",status: "renegotiated",   promisedAmount: 700,  amountReceived: 0,   baselineBalance: 700,  promisedDate: "2026-06-01", graceUntil: "2026-06-03", createdAt: "2026-05-28T00:00:00Z" },
  { promiseId: "p8", caseId: "k8", customerId: "c8", customerName: "Soylent",ownerId: "u1", status: "cancelled",      promisedAmount: 900,  amountReceived: 0,   baselineBalance: 900,  promisedDate: "2026-06-02", graceUntil: "2026-06-04", createdAt: "2026-05-29T00:00:00Z" },
];
const LABELS = new Map([["u1", "diskin"]]);

test("frozen constants list every tab and sort", () => {
  expect(PROMISE_TABS).toEqual(["active", "due-soon", "broken", "kept", "all"]);
  expect(PROMISE_SORTS).toEqual(["due-date", "amount", "customer"]);
});

test("buildPromiseRows resolves owner label, outstanding, superseded, awaitingEvaluation", () => {
  const rows = buildPromiseRows(PROMISES, TODAY, LABELS);
  const byId = new Map(rows.map((r) => [r.promiseId, r]));
  expect(byId.get("p2")!.owner).toBe("Unassigned");     // null owner
  expect(byId.get("p1")!.owner).toBe("diskin");
  expect(byId.get("p4")!.outstanding).toBe(600);         // 800 - 200
  expect(byId.get("p5")!.outstanding).toBe(0);           // received >= promised
  expect(byId.get("p7")!.superseded).toBe(true);         // renegotiated
  expect(byId.get("p8")!.superseded).toBe(true);         // cancelled
  expect(byId.get("p1")!.superseded).toBe(false);
  expect(byId.get("p3")!.awaitingEvaluation).toBe(true); // pending, today > grace
  expect(byId.get("p1")!.awaitingEvaluation).toBe(false);// pending, today <= grace
  expect(byId.get("p4")!.awaitingEvaluation).toBe(false);// not pending
});

test("isDueSoon: pending within 3 business days or already past; never for resolved", () => {
  const rows = buildPromiseRows(PROMISES, TODAY, LABELS);
  const byId = new Map(rows.map((r) => [r.promiseId, r]));
  expect(isDueSoon(byId.get("p1")!, TODAY)).toBe(true);  // 06-24 <= 06-25 threshold
  expect(isDueSoon(byId.get("p3")!, TODAY)).toBe(true);  // past due, still pending
  expect(isDueSoon(byId.get("p2")!, TODAY)).toBe(false); // 07-10 far future
  expect(isDueSoon(byId.get("p4")!, TODAY)).toBe(false); // broken, not pending
});

test("applyPromiseTab partitions by lifecycle", () => {
  const rows = buildPromiseRows(PROMISES, TODAY, LABELS);
  const ids = (tab: any) => applyPromiseTab(rows, tab, TODAY).map((r) => r.promiseId).sort();
  expect(ids("active")).toEqual(["p1", "p2", "p3"]);
  expect(ids("due-soon")).toEqual(["p1", "p3"]);
  expect(ids("broken")).toEqual(["p4"]);
  expect(ids("kept")).toEqual(["p5", "p6"]);          // kept + partially_kept
  expect(applyPromiseTab(rows, "all", TODAY).length).toBe(8);
});

test("sortPromiseRows: due-date asc, amount desc, customer asc", () => {
  const rows = buildPromiseRows(PROMISES, TODAY, LABELS);
  expect(sortPromiseRows(rows, "due-date").map((r) => r.promiseId)[0]).toBe("p4"); // 2026-05-01 earliest
  expect(sortPromiseRows(rows, "amount").map((r) => r.promiseId)[0]).toBe("p2");   // 1000 highest
  expect(sortPromiseRows(rows, "customer").map((r) => r.customerName)[0]).toBe("Acme");
});

test("computePromiseMetrics: counts, dollars, and null-safe strict kept rate", () => {
  const rows = buildPromiseRows(PROMISES, TODAY, LABELS);
  const m = computePromiseMetrics(rows, TODAY);
  expect(m.activeCount).toBe(3);
  expect(m.activeAmount).toBe(1800);        // 500 + 1000 + 300
  expect(m.dueSoonCount).toBe(2);
  expect(m.dueSoonAmount).toBe(800);        // 500 + 300
  expect(m.brokenCount).toBe(1);
  expect(m.brokenOutstanding).toBe(600);
  expect(m.keptRate).toBeCloseTo(1 / 3);    // kept(1) / (kept1 + partial1 + broken1)
});

test("computePromiseMetrics: kept rate is null when nothing is resolved", () => {
  const onlyPending = buildPromiseRows(PROMISES.filter((p) => p.status === "pending"), TODAY, LABELS);
  expect(computePromiseMetrics(onlyPending, TODAY).keptRate).toBeNull();
});
