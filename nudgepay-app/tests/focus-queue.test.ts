import { expect, test } from "vitest";
import { buildFocusQueue } from "../app/lib/focus-queue";
import type { CaseItem } from "../app/lib/cases";

// Minimal stub for CaseItem — only the fields buildFocusQueue inspects.
function stub(overrides: Partial<CaseItem> & { caseId: string }): CaseItem {
  return {
    caseId: overrides.caseId,
    customerId: overrides.customerId ?? "cust-1",
    customerName: overrides.customerName ?? "Acme",
    owner: overrides.owner ?? "",
    ownerId: overrides.ownerId ?? null,
    status: overrides.status ?? "working",
    nextActionType: overrides.nextActionType ?? "contact",
    nextActionAt: overrides.nextActionAt ?? null,
    totalOverdue: overrides.totalOverdue ?? 1000,
    invoiceCount: overrides.invoiceCount ?? 1,
    oldestAgeDays: overrides.oldestAgeDays ?? 30,
    heat: overrides.heat ?? { band: "warm", label: "WARM", days: 30 },
    priority: overrides.priority ?? { level: "Medium", tone: "warm", reason: "30d", rank: 3, factors: [] },
    score: overrides.score ?? 30,
    factors: overrides.factors ?? [],
    effectiveLevel: overrides.effectiveLevel ?? "Medium",
    priorAttempts: overrides.priorAttempts ?? 0,
    override: overrides.override ?? null,
    lastContact: overrides.lastContact ?? null,
    phone: overrides.phone ?? null,
    smsConsent: overrides.smsConsent ?? false,
    commPrefs: overrides.commPrefs ?? { preferredChannel: null, doNotCall: false, doNotText: false, doNotEmail: false },
    doNotText: overrides.doNotText ?? false,
    email: overrides.email ?? null,
    promise: overrides.promise ?? null,
    brokenPromise: overrides.brokenPromise ?? false,
    promiseStatus: overrides.promiseStatus ?? null,
    amountReceived: overrides.amountReceived ?? null,
    exceptionReason: overrides.exceptionReason ?? null,
    exceptionNote: overrides.exceptionNote ?? null,
    suppressed: overrides.suppressed ?? false,
    contactBlocked: overrides.contactBlocked ?? false,
    suggestedFollowUpAt: overrides.suggestedFollowUpAt ?? "2026-07-10",
    suggestedFollowUpIntervalDays: overrides.suggestedFollowUpIntervalDays ?? 7,
    followUpDue: overrides.followUpDue ?? false,
    lateFeeTotal: overrides.lateFeeTotal ?? 0,
    searchText: overrides.searchText ?? "",
    invoices: overrides.invoices ?? [],
  };
}

const TODAY = "2026-07-03";
const USER = "user-1";

test("my-work scope when user owns cases", () => {
  const items = [
    stub({ caseId: "c1", ownerId: USER, score: 50 }),
    stub({ caseId: "c2", ownerId: "other", score: 80 }),
    stub({ caseId: "c3", ownerId: USER, score: 70 }),
  ];
  const { queue, scope } = buildFocusQueue(items, TODAY, USER);
  expect(scope).toBe("my-work");
  expect(queue.map((c) => c.caseId)).toEqual(["c3", "c1"]); // sorted by score desc
});

test("falls back to all-open when user owns nothing", () => {
  const items = [
    stub({ caseId: "c1", ownerId: "other", score: 50 }),
    stub({ caseId: "c2", ownerId: null, score: 80 }),
  ];
  const { queue, scope } = buildFocusQueue(items, TODAY, USER);
  expect(scope).toBe("all-open");
  expect(queue).toHaveLength(2);
});

test("suppressed cases excluded from my-work scope", () => {
  const items = [
    stub({ caseId: "c1", ownerId: USER, suppressed: true }),
    stub({ caseId: "c2", ownerId: USER, suppressed: false }),
  ];
  const { queue, scope } = buildFocusQueue(items, TODAY, USER);
  expect(scope).toBe("my-work");
  expect(queue.map((c) => c.caseId)).toEqual(["c2"]);
});

test("when only suppressed cases are owned, falls back to all-open", () => {
  const items = [
    stub({ caseId: "c1", ownerId: USER, suppressed: true }),
    stub({ caseId: "c2", ownerId: "other", score: 80 }),
  ];
  const { queue, scope } = buildFocusQueue(items, TODAY, USER);
  expect(scope).toBe("all-open");
  expect(queue.map((c) => c.caseId)).toEqual(["c2"]);
});

test("empty items → empty queue with all-open scope", () => {
  const { queue, scope } = buildFocusQueue([], TODAY, USER);
  expect(scope).toBe("all-open");
  expect(queue).toEqual([]);
});
