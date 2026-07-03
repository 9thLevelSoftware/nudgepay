import { expect, test } from "vitest";
import { whyNow, pickTriage } from "../app/lib/next-best-action";
import type { CaseItem } from "../app/lib/cases";

// Minimal stub — only the fields whyNow/pickTriage inspect.
function stub(overrides: Partial<CaseItem> & { caseId: string }): CaseItem {
  return {
    caseId: overrides.caseId,
    customerId: overrides.customerId ?? "cust-1",
    customerName: overrides.customerName ?? "Test",
    owner: overrides.owner ?? "",
    ownerId: overrides.ownerId ?? null,
    status: overrides.status ?? "working",
    nextActionType: overrides.nextActionType ?? "contact",
    nextActionAt: overrides.nextActionAt ?? null,
    totalOverdue: overrides.totalOverdue ?? 1000,
    invoiceCount: overrides.invoiceCount ?? 1,
    oldestAgeDays: overrides.oldestAgeDays ?? 30,
    heat: overrides.heat ?? { band: "warm", label: "WARM", days: 30 },
    priority: overrides.priority ?? { level: "Medium", tone: "warm", reason: "30d overdue", rank: 3, factors: [] },
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

// ---------------------------------------------------------------------------
// whyNow
// ---------------------------------------------------------------------------

test("whyNow: uses priority reason as headline", () => {
  const r = whyNow(stub({ caseId: "c1", priority: { level: "Critical", tone: "hot", reason: "95d overdue, Broken promise", rank: 1, factors: [] } }));
  expect(r.headline).toBe("95d overdue, Broken promise");
});

test("whyNow: broken promise shows in reason", () => {
  const r = whyNow(stub({ caseId: "c1", brokenPromise: true, promise: { amount: 1000, date: "2026-06-20" } }));
  expect(r.reason).toContain("Promise broken");
});

test("whyNow: follow-up due shows in reason", () => {
  const r = whyNow(stub({ caseId: "c1", followUpDue: true, nextActionAt: "2026-07-01" }));
  expect(r.reason).toContain("Follow-up due");
});

test("whyNow: never contacted shows in reason", () => {
  const r = whyNow(stub({ caseId: "c1", lastContact: null }));
  expect(r.reason).toContain("Never contacted");
});

test("whyNow: preferred channel shows in reason", () => {
  const r = whyNow(stub({
    caseId: "c1",
    commPrefs: { preferredChannel: "call", doNotCall: false, doNotText: false, doNotEmail: false },
    lastContact: { date: "2026-06-30", channel: "Call" },
  }));
  expect(r.reason).toContain("Prefers phone");
});

test("whyNow: falls back to age when no special facts", () => {
  const r = whyNow(stub({
    caseId: "c1",
    oldestAgeDays: 45,
    lastContact: { date: "2026-06-30", channel: "Text" },
    commPrefs: { preferredChannel: null, doNotCall: false, doNotText: false, doNotEmail: false },
  }));
  expect(r.reason).toContain("Last contact");
});

// ---------------------------------------------------------------------------
// pickTriage
// ---------------------------------------------------------------------------

test("pickTriage: returns top N by score, excluding on_hold/waiting/pending promise/suppressed", () => {
  const items = [
    stub({ caseId: "a", score: 90 }),
    stub({ caseId: "b", score: 80, status: "on_hold", suppressed: true }),
    stub({ caseId: "c", score: 70, status: "waiting" }),
    stub({ caseId: "d", score: 60, promiseStatus: "pending" }),
    stub({ caseId: "e", score: 50 }),
    stub({ caseId: "f", score: 40 }),
  ];
  const result = pickTriage(items, 3);
  expect(result.map((c) => c.caseId)).toEqual(["a", "e", "f"]);
});

test("pickTriage: returns fewer than N when not enough actionable", () => {
  const items = [stub({ caseId: "a", score: 50 })];
  const result = pickTriage(items, 3);
  expect(result).toHaveLength(1);
});

test("pickTriage: empty list → empty", () => {
  expect(pickTriage([])).toEqual([]);
});
