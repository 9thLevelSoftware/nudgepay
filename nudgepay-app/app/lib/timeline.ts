// Pure unification of the per-case interaction stream. No I/O, no node:*, no
// .server suffix — imported by the dashboard loader, the log drawer, the detail
// panel, and tests. Date.parse is pure and permitted here.

export type TimelineLogInput = {
  id: string;
  at: string; // ISO timestamp (contact_logs.created_at)
  method: string;
  outcome: string | null;
  notes: string | null;
  followUpAt: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
  authorLabel: string | null;
};

export type TimelineSmsInput = {
  id: string;
  at: string; // ISO timestamp (text_messages.created_at)
  direction: string; // "outbound" | "inbound"
  body: string | null;
  status: string | null;
  errorCode: string | null;
};

export type TimelineEntry =
  | {
      kind: "log";
      id: string;
      at: string;
      method: string;
      outcome: string | null;
      outcomeLabel: string | null;
      notes: string | null;
      followUpAt: string | null;
      promisedAmount: number | null;
      promisedDate: string | null;
      authorLabel: string | null;
    }
  | {
      kind: "sms";
      id: string;
      at: string;
      direction: string;
      body: string | null;
      status: string | null;
      errorCode: string | null;
      outcome: string;
      outcomeLabel: string;
    };

// Single source of outcome display copy (manual + SMS-derived). Static literal
// strings. `other` is "Other" (drawer-friendly); null/unknown render via the
// caller's "Logged" fallback, not this map.
export const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  "promise-to-pay": "Promise to pay",
  dispute: "Dispute",
  "no-commitment": "No commitment",
  "left-voicemail": "Left voicemail",
  "no-answer": "No answer",
  other: "Other",
  "payment-already-sent": "Payment already sent",
  "requested-documentation": "Requested documentation",
  "escalation-required": "Escalation required",
  "follow-up-requested": "Follow-up requested",
  "message-sent": "Text sent",
  "message-delivered": "Text delivered",
  "customer-replied": "Customer replied",
  "contact-invalid": "Text failed",
};

// Derive a structured outcome from an SMS row. Pure, total: unknown status →
// "message-sent". errorCode is accepted for completeness but not needed.
export function deriveSmsOutcome(
  direction: string,
  status: string | null,
  _errorCode: string | null,
): string {
  if (direction === "inbound") return "customer-replied";
  if (status === "delivered") return "message-delivered";
  if (status === "failed" || status === "undelivered") return "contact-invalid";
  return "message-sent";
}

// Merge already-case-scoped logs + SMS into one newest-first stream. Sorts by
// parsed timestamp (descending); stable for equal timestamps (logs precede sms,
// matching concatenation order). Never throws.
export function buildTimeline(
  logs: TimelineLogInput[],
  smsMessages: TimelineSmsInput[],
): TimelineEntry[] {
  const logEntries: TimelineEntry[] = logs.map((l) => ({
    kind: "log",
    id: l.id,
    at: l.at,
    method: l.method,
    outcome: l.outcome,
    outcomeLabel: l.outcome == null ? null : OUTCOME_LABELS[l.outcome] ?? null,
    notes: l.notes,
    followUpAt: l.followUpAt,
    promisedAmount: l.promisedAmount,
    promisedDate: l.promisedDate,
    authorLabel: l.authorLabel,
  }));

  const smsEntries: TimelineEntry[] = smsMessages.map((m) => {
    const outcome = deriveSmsOutcome(m.direction, m.status, m.errorCode);
    return {
      kind: "sms",
      id: m.id,
      at: m.at,
      direction: m.direction,
      body: m.body,
      status: m.status,
      errorCode: m.errorCode,
      outcome,
      outcomeLabel: OUTCOME_LABELS[outcome] ?? outcome,
    };
  });

  // Concatenate logs-then-sms so equal timestamps keep that stable order, then
  // sort descending by epoch ms (Array.prototype.sort is stable in our runtime).
  return [...logEntries, ...smsEntries].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );
}
