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

test("parse: accepts the new B4 manual outcomes", () => {
  for (const outcome of [
    "payment-already-sent", "requested-documentation", "escalation-required", "follow-up-requested",
  ]) {
    const r = parseContactLogForm(
      fd({ caseId: "c1", method: "call", outcome, nextStep: "follow_up", followUpAt: "2026-07-01" }),
    );
    expect(r.ok, `${outcome} should be accepted`).toBe(true);
    if (r.ok) expect(r.fields.outcome).toBe(outcome);
  }
});

test("parse: rejects an unknown outcome", () => {
  expect(parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "totally-made-up", nextStep: "follow_up", followUpAt: "2026-07-01" })))
    .toEqual({ ok: false, error: "bad-outcome" });
});

test("exception with a review-dated reason requires reviewAt", () => {
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "dispute", nextStep: "exception", exceptionReason: "disputed" }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toBe("next-step-date");
});

test("exception with a review-dated reason accepts a valid reviewAt", () => {
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "dispute", nextStep: "exception", exceptionReason: "incorrect_amount", reviewAt: "2026-08-01" }));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.fields.exceptionReason).toBe("incorrect_amount");
    expect(r.fields.reviewAt).toBe("2026-08-01");
  }
});

test("exception with a terminal reason does NOT require reviewAt", () => {
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "no-commitment", nextStep: "exception", exceptionReason: "do_not_contact" }));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.fields.exceptionReason).toBe("do_not_contact");
    expect(r.fields.reviewAt).toBeNull();
  }
});

test("exception rejects an unknown reason", () => {
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "dispute", nextStep: "exception", exceptionReason: "bogus", reviewAt: "2026-08-01" }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toBe("bad-exception");
});

test("parseContactLogForm rejects email as a method (email is not a NudgePay channel)", () => {
  const r = parseContactLogForm(fd({ caseId: "c1", method: "email", outcome: "no-answer", nextStep: "follow_up", followUpAt: "2026-07-01" }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toBe("bad-method");
});

test("parseContactLogForm still accepts call/text/note", () => {
  for (const method of ["call", "text", "note"]) {
    const r = parseContactLogForm(fd({ caseId: "c1", method, outcome: "other", nextStep: "follow_up", followUpAt: "2026-07-01" }));
    expect(r.ok).toBe(true);
  }
});
