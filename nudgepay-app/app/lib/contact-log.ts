// Pure validation for the contact-log form. No I/O, no node:*, no .server suffix
// (it is imported by both the action route and tests). The action layer performs
// auth/org/RLS; this only shapes and validates the submitted fields.

export const CONTACT_METHODS = ["call", "email", "text", "note"] as const;
export const CONTACT_OUTCOMES = [
  "promise-to-pay", "dispute", "no-commitment", "left-voicemail", "no-answer", "other",
] as const;

export type ContactMethod = (typeof CONTACT_METHODS)[number];
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

export type ContactLogFields = {
  invoiceId: string;
  customerId: string | null;
  method: ContactMethod;
  outcome: ContactOutcome;
  notes: string | null;
  followUpAt: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
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
  const invoiceId = str(form, "invoiceId");
  if (!invoiceId) return { ok: false, error: "missing-invoice" };

  const customerId = str(form, "customerId");

  const method = str(form, "method");
  if (!method || !CONTACT_METHODS.includes(method as ContactMethod)) return { ok: false, error: "bad-method" };

  const outcome = str(form, "outcome");
  if (!outcome || !CONTACT_OUTCOMES.includes(outcome as ContactOutcome)) return { ok: false, error: "bad-outcome" };

  const notes = str(form, "notes");

  const followUpRaw = str(form, "followUpAt");
  if (followUpRaw && !validDate(followUpRaw)) return { ok: false, error: "bad-date" };
  const followUpAt = followUpRaw;

  let promisedAmount: number | null = null;
  let promisedDate: string | null = null;

  if (outcome === "promise-to-pay") {
    const amountRaw = str(form, "promisedAmount");
    const dateRaw = str(form, "promisedDate");
    if (!amountRaw || !dateRaw) return { ok: false, error: "promise-required" };
    const n = Number(amountRaw);
    if (!Number.isFinite(n)) return { ok: false, error: "bad-amount" };
    if (n <= 0) return { ok: false, error: "bad-amount" };
    if (!validDate(dateRaw)) return { ok: false, error: "bad-date" };
    promisedAmount = n;
    promisedDate = dateRaw;
  }

  return {
    ok: true,
    fields: {
      invoiceId, customerId,
      method: method as ContactMethod,
      outcome: outcome as ContactOutcome,
      notes, followUpAt, promisedAmount, promisedDate,
    },
  };
}
