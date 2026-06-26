import { expect, test } from "vitest";
import { partitionEligibility, renderCaseBody, clampBatch, MAX_BATCH } from "../app/lib/bulk";

test("partitionEligibility keeps consented cases that have a phone", () => {
  const { eligible, skipped } = partitionEligibility([
    { caseId: "c1", customerName: "Acme", phone: "+12295550100", smsConsent: true },
  ]);
  expect(eligible).toHaveLength(1);
  expect(skipped).toHaveLength(0);
});

test("partitionEligibility skips no-phone (phone checked first) and no-consent", () => {
  const { eligible, skipped } = partitionEligibility([
    { caseId: "c1", customerName: "A", phone: "+12295550100", smsConsent: true },
    { caseId: "c2", customerName: "B", phone: null, smsConsent: true },
    { caseId: "c3", customerName: "C", phone: "+12295550102", smsConsent: false },
    { caseId: "c4", customerName: "D", phone: null, smsConsent: false },
  ]);
  expect(eligible.map((c) => c.caseId)).toEqual(["c1"]);
  expect(skipped).toEqual([
    { caseId: "c2", name: "B", reason: "no-phone" },
    { caseId: "c3", name: "C", reason: "no-consent" },
    { caseId: "c4", name: "D", reason: "no-phone" },
  ]);
});

test("renderCaseBody fills totals + oldest-invoice tokens", () => {
  const body = renderCaseBody(
    "Hi {customer}, invoice {invoice} for {balance} due {dueDate}.",
    { customerName: "Acme", totalOverdue: 1234.5, invoices: [{ invoiceId: "i1", docNumber: "1042", dueDate: "2026-05-01" }] },
  );
  expect(body).toBe("Hi Acme, invoice 1042 for $1,234.50 due May 1, 2026.");
});

test("renderCaseBody falls back to 'your account' / empty when no doc or due date", () => {
  const body = renderCaseBody("{customer} {invoice} {dueDate}", {
    customerName: "Acme", totalOverdue: 0, invoices: [{ invoiceId: "i1", docNumber: null, dueDate: null }],
  });
  expect(body).toBe("Acme your account ");
});

test("renderCaseBody leaves unknown tokens untouched", () => {
  const body = renderCaseBody("{customer} {unknown}", {
    customerName: "Acme", totalOverdue: 0, invoices: [{ invoiceId: "i1", docNumber: "1", dueDate: "2026-05-01" }],
  });
  expect(body).toBe("Acme {unknown}");
});

test("clampBatch truncates to MAX_BATCH, leaves short lists alone", () => {
  const ids = Array.from({ length: MAX_BATCH + 5 }, (_, i) => String(i));
  expect(clampBatch(ids)).toHaveLength(MAX_BATCH);
  expect(clampBatch(["a", "b"])).toEqual(["a", "b"]);
});

test("partitionEligibility skips a contact-blocked case ahead of phone/consent", () => {
  const { eligible, skipped } = partitionEligibility([
    { caseId: "c1", customerName: "OK", phone: "+12295550100", smsConsent: true },
    { caseId: "c2", customerName: "Blocked", phone: "+12295550101", smsConsent: true, contactBlocked: true },
    { caseId: "c3", customerName: "BlockedNoPhone", phone: null, smsConsent: false, contactBlocked: true },
  ]);
  expect(eligible.map((c) => c.caseId)).toEqual(["c1"]);
  expect(skipped).toEqual([
    { caseId: "c2", name: "Blocked", reason: "do-not-contact" },
    { caseId: "c3", name: "BlockedNoPhone", reason: "do-not-contact" },
  ]);
});
