// Pure activity-peek math for the collections row. No I/O — server loaders
// fetch primitives; tests and the dashboard mapper call these with fixtures.

import { OUTCOME_LABELS } from "./timeline";

export type PeekKind = "call" | "email" | "text" | "note" | "reply";

export type ActivityPeek = {
  at: string;
  kind: PeekKind;
  summary: string;
};

export const PEEK_MAX = 3;
export const PEEK_SUMMARY_MAX = 80;
export const PEEK_WINDOW_DAYS = 90;

export function clipSummary(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= PEEK_SUMMARY_MAX) return t;
  return t.slice(0, PEEK_SUMMARY_MAX - 1).trimEnd() + "…";
}

export function summarizePeek(input: {
  method?: string | null;
  outcome?: string | null;
  notes?: string | null;
  direction?: string | null;
  body?: string | null;
  subject?: string | null;
}): { kind: PeekKind; summary: string } {
  if (input.direction === "inbound") {
    return { kind: "reply", summary: clipSummary(input.body || input.subject || "Customer replied") };
  }
  if (input.method === "note") {
    return { kind: "note", summary: clipSummary(input.notes || "Note") };
  }
  const method = input.method === "call" || input.method === "email" || input.method === "text"
    ? input.method
    : input.direction === "outbound" && input.subject ? "email"
    : input.direction === "outbound" ? "text"
    : "note";
  const outcome = input.outcome ? (OUTCOME_LABELS[input.outcome] ?? input.outcome) : null;
  const summary = clipSummary(outcome || input.notes || input.body || input.subject || "Logged");
  return { kind: method, summary };
}

export function collapsePeeks(entries: ActivityPeek[], limit = PEEK_MAX): ActivityPeek[] {
  const newestFirst = [...entries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const out: ActivityPeek[] = [];
  const seen = new Set<string>();
  for (const e of newestFirst) {
    const key = `${e.at}|${e.kind}|${e.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}
