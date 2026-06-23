// Pure validation for the contact-log form. No I/O, no node:*, no .server suffix
// (it is imported by both the action route and tests). The action layer performs
// auth/org/RLS; this only shapes and validates the submitted fields.

export const CONTACT_METHODS = ["call", "email", "text", "note"] as const;
export const CONTACT_OUTCOMES = [
  "promise-to-pay", "dispute", "no-commitment", "left-voicemail", "no-answer", "other",
] as const;

export type ContactMethod = (typeof CONTACT_METHODS)[number];
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

export const NEXT_STEPS = ["follow_up", "promise", "waiting", "exception"] as const;
export type NextStep = (typeof NEXT_STEPS)[number];
export const EXCEPTION_REASONS = ["disputed", "payment_plan", "do_not_contact", "other"] as const;
export type ExceptionReason = (typeof EXCEPTION_REASONS)[number];

export type ContactLogFields = {
  caseId: string;
  invoiceId: string | null;
  customerId: string | null;
  method: ContactMethod;
  outcome: ContactOutcome;
  notes: string | null;
  nextStep: NextStep;
  followUpAt: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
  reviewAt: string | null;
  exceptionReason: ExceptionReason | null;
  exceptionNote: string | null;
};

export type ParseResult =
  | { ok: true; fields: ContactLogFields }
  | { ok: false; error: string };

// Strict YYYY-MM-DD with a real calendar check (rejects 2026-13-99).
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function str(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function parseContactLogForm(form: FormData): ParseResult {
  const caseId = str(form, "caseId");
  if (!caseId) return { ok: false, error: "missing-case" };

  const invoiceId = str(form, "invoiceId"); // optional
  const customerId = str(form, "customerId");

  const method = str(form, "method");
  if (!method || !CONTACT_METHODS.includes(method as ContactMethod)) return { ok: false, error: "bad-method" };

  const outcome = str(form, "outcome");
  if (!outcome || !CONTACT_OUTCOMES.includes(outcome as ContactOutcome)) return { ok: false, error: "bad-outcome" };

  const notes = str(form, "notes");

  const nextStep = str(form, "nextStep");
  if (!nextStep || !NEXT_STEPS.includes(nextStep as NextStep)) return { ok: false, error: "bad-next-step" };

  let followUpAt: string | null = null;
  let promisedAmount: number | null = null;
  let promisedDate: string | null = null;
  let reviewAt: string | null = null;
  let exceptionReason: ExceptionReason | null = null;
  let exceptionNote: string | null = null;

  if (nextStep === "follow_up") {
    const d = str(form, "followUpAt");
    if (!d || !validDate(d)) return { ok: false, error: "next-step-date" };
    followUpAt = d;
  } else if (nextStep === "promise") {
    const amountRaw = str(form, "promisedAmount");
    const dateRaw = str(form, "promisedDate");
    if (!amountRaw || !dateRaw) return { ok: false, error: "promise-required" };
    const n = Number(amountRaw);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "bad-amount" };
    if (!validDate(dateRaw)) return { ok: false, error: "bad-date" };
    promisedAmount = n;
    promisedDate = dateRaw;
  } else if (nextStep === "waiting") {
    const d = str(form, "reviewAt");
    if (!d || !validDate(d)) return { ok: false, error: "next-step-date" };
    reviewAt = d;
  } else if (nextStep === "exception") {
    const r = str(form, "exceptionReason");
    if (!r || !EXCEPTION_REASONS.includes(r as ExceptionReason)) return { ok: false, error: "bad-exception" };
    const d = str(form, "reviewAt");
    if (!d || !validDate(d)) return { ok: false, error: "next-step-date" };
    exceptionReason = r as ExceptionReason;
    reviewAt = d;
    exceptionNote = str(form, "exceptionNote");
  }

  return {
    ok: true,
    fields: {
      caseId, invoiceId, customerId,
      method: method as ContactMethod,
      outcome: outcome as ContactOutcome,
      notes,
      nextStep: nextStep as NextStep,
      followUpAt, promisedAmount, promisedDate,
      reviewAt, exceptionReason, exceptionNote,
    },
  };
}
