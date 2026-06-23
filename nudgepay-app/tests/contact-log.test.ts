import { expect, test } from "vitest";
import { parseContactLogForm } from "../app/lib/contact-log";
import { fd } from "./fd";

test("parseContactLogForm requires caseId", () => {
  const r = parseContactLogForm(fd({ method: "call", outcome: "no-answer" }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toBe("missing-case");
});

test("parseContactLogForm accepts a case-level log with no invoice", () => {
  const r = parseContactLogForm(fd({ caseId: "case-1", method: "note", outcome: "other", nextStep: "follow_up", followUpAt: "2026-07-01" }));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.fields.caseId).toBe("case-1");
    expect(r.fields.invoiceId).toBeNull();
  }
});

test("parseContactLogForm keeps an optional invoiceId when present", () => {
  const r = parseContactLogForm(fd({ caseId: "case-1", invoiceId: "i1", method: "call", outcome: "no-answer", nextStep: "follow_up", followUpAt: "2026-07-01" }));
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.fields.invoiceId).toBe("i1");
});

test("parse: requires a valid nextStep", () => {
  expect(parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "no-answer" })))
    .toEqual({ ok: false, error: "bad-next-step" });
});

test("parse: follow_up requires a date", () => {
  expect(parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "no-answer", nextStep: "follow_up" })))
    .toEqual({ ok: false, error: "next-step-date" });
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "no-answer", nextStep: "follow_up", followUpAt: "2026-07-01" }));
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.fields.followUpAt).toBe("2026-07-01");
});

test("parse: promise via nextStep needs amount + date", () => {
  expect(parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "promise-to-pay", nextStep: "promise" })))
    .toEqual({ ok: false, error: "promise-required" });
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "promise-to-pay", nextStep: "promise", promisedAmount: "500", promisedDate: "2026-07-01" }));
  expect(r.ok).toBe(true);
  if (r.ok) { expect(r.fields.promisedAmount).toBe(500); expect(r.fields.nextStep).toBe("promise"); }
});

test("parse: waiting needs a review date", () => {
  expect(parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "no-commitment", nextStep: "waiting" })))
    .toEqual({ ok: false, error: "next-step-date" });
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "no-commitment", nextStep: "waiting", reviewAt: "2026-07-08" }));
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.fields.reviewAt).toBe("2026-07-08");
});

test("parse: exception needs a valid reason + review date", () => {
  expect(parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "dispute", nextStep: "exception", reviewAt: "2026-07-08" })))
    .toEqual({ ok: false, error: "bad-exception" });
  expect(parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "dispute", nextStep: "exception", exceptionReason: "disputed" })))
    .toEqual({ ok: false, error: "next-step-date" });
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "dispute", nextStep: "exception", exceptionReason: "disputed", exceptionNote: "line 3 wrong", reviewAt: "2026-07-08" }));
  expect(r.ok).toBe(true);
  if (r.ok) { expect(r.fields.exceptionReason).toBe("disputed"); expect(r.fields.exceptionNote).toBe("line 3 wrong"); expect(r.fields.reviewAt).toBe("2026-07-08"); }
});
