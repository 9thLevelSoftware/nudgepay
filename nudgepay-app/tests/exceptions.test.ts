import { expect, test } from "vitest";
import {
  EXCEPTION_STATES, PRIMARY_EXCEPTION_STATES, EXCEPTION_POLICY,
  isTerminal, requiresReviewDate, isContactBlocked, exceptionLabel, isCaseSuppressed,
  type ExceptionState,
} from "../app/lib/exceptions";

const TERMINAL: ExceptionState[] = ["legal_agency", "do_not_contact"];

test("EXCEPTION_STATES has the 8 primary values plus retained 'other'", () => {
  expect(EXCEPTION_STATES).toEqual([
    "disputed", "incorrect_amount", "work_incomplete", "documentation_requested",
    "wrong_contact", "payment_plan", "legal_agency", "do_not_contact", "other",
  ]);
  expect(PRIMARY_EXCEPTION_STATES).not.toContain("other");
  expect(PRIMARY_EXCEPTION_STATES).toHaveLength(8);
});

test("terminal set is exactly legal_agency + do_not_contact", () => {
  for (const s of EXCEPTION_STATES) {
    expect(isTerminal(s)).toBe(TERMINAL.includes(s));
  }
});

test("blocksContact set equals the terminal set", () => {
  for (const s of EXCEPTION_STATES) {
    expect(EXCEPTION_POLICY[s].blocksContact).toBe(TERMINAL.includes(s));
  }
  expect(isContactBlocked("do_not_contact")).toBe(true);
  expect(isContactBlocked("disputed")).toBe(false);
  expect(isContactBlocked(null)).toBe(false);
});

test("every non-terminal state requires a review date; terminal states do not", () => {
  for (const s of EXCEPTION_STATES) {
    expect(requiresReviewDate(s)).toBe(!TERMINAL.includes(s));
  }
});

test("every state has a non-empty label; exceptionLabel(null) is empty", () => {
  for (const s of EXCEPTION_STATES) expect(EXCEPTION_POLICY[s].label.length).toBeGreaterThan(0);
  expect(exceptionLabel("do_not_contact")).toBe("Do not contact");
  expect(exceptionLabel(null)).toBe("");
});

test("isCaseSuppressed: terminal on_hold is always suppressed", () => {
  expect(isCaseSuppressed({ status: "on_hold", exceptionReason: "do_not_contact", nextActionAt: null, today: "2026-06-25" })).toBe(true);
  // even with a past review date, terminal stays suppressed
  expect(isCaseSuppressed({ status: "on_hold", exceptionReason: "legal_agency", nextActionAt: "2026-01-01", today: "2026-06-25" })).toBe(true);
});

test("isCaseSuppressed: review-dated future is suppressed, resurfaced is not", () => {
  expect(isCaseSuppressed({ status: "on_hold", exceptionReason: "disputed", nextActionAt: "2026-07-01", today: "2026-06-25" })).toBe(true);
  expect(isCaseSuppressed({ status: "on_hold", exceptionReason: "disputed", nextActionAt: "2026-06-25", today: "2026-06-25" })).toBe(false);
  expect(isCaseSuppressed({ status: "on_hold", exceptionReason: "disputed", nextActionAt: "2026-06-20", today: "2026-06-25" })).toBe(false);
});

test("isCaseSuppressed: review-dated with no date is suppressed", () => {
  expect(isCaseSuppressed({ status: "on_hold", exceptionReason: "disputed", nextActionAt: null, today: "2026-06-25" })).toBe(true);
});

test("isCaseSuppressed: not suppressed unless on_hold with an exception", () => {
  expect(isCaseSuppressed({ status: "working", exceptionReason: "disputed", nextActionAt: "2026-07-01", today: "2026-06-25" })).toBe(false);
  expect(isCaseSuppressed({ status: "on_hold", exceptionReason: null, nextActionAt: "2026-07-01", today: "2026-06-25" })).toBe(false);
});
