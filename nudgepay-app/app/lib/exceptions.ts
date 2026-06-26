// Pure taxonomy + policy for collection-case exception states. No I/O, no
// node:*, no .server suffix — the single source of truth imported by the
// contact-log parser, the case derivation, the messaging guards, the format
// labels, and the UI.

export const EXCEPTION_STATES = [
  "disputed",
  "incorrect_amount",
  "work_incomplete",
  "documentation_requested",
  "wrong_contact",
  "payment_plan",
  "legal_agency",
  "do_not_contact",
  "other",
] as const;

export type ExceptionState = (typeof EXCEPTION_STATES)[number];

type Policy = { terminal: boolean; requiresReview: boolean; blocksContact: boolean; label: string };

// Terminal (legal_agency, do_not_contact): indefinite hold, no auto-resurface,
// blocks outbound SMS. All others are review-dated and resurface on their date.
export const EXCEPTION_POLICY: Readonly<Record<ExceptionState, Policy>> = Object.freeze({
  disputed:                { terminal: false, requiresReview: true,  blocksContact: false, label: "Disputed" },
  incorrect_amount:        { terminal: false, requiresReview: true,  blocksContact: false, label: "Incorrect amount" },
  work_incomplete:         { terminal: false, requiresReview: true,  blocksContact: false, label: "Work incomplete" },
  documentation_requested: { terminal: false, requiresReview: true,  blocksContact: false, label: "Documentation requested" },
  wrong_contact:           { terminal: false, requiresReview: true,  blocksContact: false, label: "Wrong contact" },
  payment_plan:            { terminal: false, requiresReview: true,  blocksContact: false, label: "Payment plan" },
  legal_agency:            { terminal: true,  requiresReview: false, blocksContact: true,  label: "Legal / agency" },
  do_not_contact:          { terminal: true,  requiresReview: false, blocksContact: true,  label: "Do not contact" },
  other:                   { terminal: false, requiresReview: true,  blocksContact: false, label: "Other" },
});

// The 8 states offered in the primary picker (excludes the retained `other`).
export const PRIMARY_EXCEPTION_STATES: ExceptionState[] =
  EXCEPTION_STATES.filter((s) => s !== "other");

export function isTerminal(state: ExceptionState): boolean {
  return EXCEPTION_POLICY[state].terminal;
}

export function requiresReviewDate(state: ExceptionState): boolean {
  return EXCEPTION_POLICY[state].requiresReview;
}

export function isContactBlocked(state: ExceptionState | null): boolean {
  return state != null && EXCEPTION_POLICY[state].blocksContact;
}

export function exceptionLabel(state: ExceptionState | null): string {
  return state ? EXCEPTION_POLICY[state].label : "";
}

// A case is "parked" (suppressed from active surfacing) when it is on_hold with
// an exception that holds indefinitely (terminal), carries no review date, or
// whose review date is still in the future. Date strings are YYYY-MM-DD and
// compare lexicographically.
export function isCaseSuppressed(args: {
  status: string;
  exceptionReason: ExceptionState | null;
  nextActionAt: string | null;
  today: string;
}): boolean {
  if (args.status !== "on_hold" || args.exceptionReason == null) return false;
  if (isTerminal(args.exceptionReason)) return true;
  if (args.nextActionAt == null) return true;
  return args.nextActionAt > args.today;
}
