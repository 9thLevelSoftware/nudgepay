// Dedicated 90-day peek (case-scoped, includes bodies) and reply
// (customer-scoped, no bodies) reads. Do not widen Stage-2 last-contact.

import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkIds, pageAllChunked, PAGE_ALL_MAX_ROWS } from "./page-all";
import {
  collapsePeeks,
  summarizePeek,
  PEEK_WINDOW_DAYS,
  type ActivityPeek,
} from "./activity-peek";

export type ReplyCounts = { inbound: number; outbound: number };

type PeekLogRow = {
  case_id: string | null;
  method: string | null;
  outcome: string | null;
  notes: string | null;
  created_at: string;
};

type PeekTextRow = {
  case_id: string | null;
  direction: string | null;
  body: string | null;
  created_at: string;
};

type PeekEmailRow = {
  case_id: string | null;
  direction: string | null;
  subject: string | null;
  created_at: string;
};

type ReplyRow = {
  customer_id: string | null;
  direction: string | null;
};

export function peekWindowStartIso(today: string, days = PEEK_WINDOW_DAYS): string {
  const start = new Date(`${today}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - days);
  return start.toISOString();
}

export async function loadPeekSource(args: {
  supabase: SupabaseClient;
  orgId: string;
  caseIds: string[];
  windowStartIso: string;
}): Promise<{ peeksByCase: Map<string, ActivityPeek[]>; truncated: boolean }> {
  const { supabase, orgId, caseIds, windowStartIso } = args;
  if (caseIds.length === 0) return { peeksByCase: new Map(), truncated: false };

  const chunks = chunkIds(caseIds, 100);
  const started = Date.now();
  const [logs, texts, emails] = await Promise.all([
    pageAllChunked<PeekLogRow>(
      chunks,
      (ids, from, to) =>
        supabase
          .from("contact_logs")
          .select("case_id, method, outcome, notes, created_at", { count: "exact" })
          .eq("org_id", orgId)
          .in("case_id", ids)
          .gte("created_at", windowStartIso)
          .order("created_at", { ascending: false })
          .range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAllChunked<PeekTextRow>(
      chunks,
      (ids, from, to) =>
        supabase
          .from("text_messages")
          .select("case_id, direction, body, created_at", { count: "exact" })
          .eq("org_id", orgId)
          .in("case_id", ids)
          .gte("created_at", windowStartIso)
          .order("created_at", { ascending: false })
          .range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAllChunked<PeekEmailRow>(
      chunks,
      (ids, from, to) =>
        supabase
          .from("email_messages")
          .select("case_id, direction, subject, created_at", { count: "exact" })
          .eq("org_id", orgId)
          .in("case_id", ids)
          .gte("created_at", windowStartIso)
          .order("created_at", { ascending: false })
          .range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
  ]);

  const truncated = logs.truncated || texts.truncated || emails.truncated;
  const rows = logs.rows.length + texts.rows.length + emails.rows.length;
  console.info({
    event: "load_peek_source",
    orgId,
    rows,
    truncated,
    ms: Date.now() - started,
  });
  // Truncation → empty peeks so the queue never shows a partial 90d window.
  if (truncated) return { peeksByCase: new Map(), truncated: true };

  const byCase = new Map<string, ActivityPeek[]>();
  const push = (caseId: string | null, at: string, input: Parameters<typeof summarizePeek>[0]) => {
    if (!caseId) return;
    const { kind, summary } = summarizePeek(input);
    const list = byCase.get(caseId) ?? [];
    list.push({ at, kind, summary });
    byCase.set(caseId, list);
  };
  for (const r of logs.rows) {
    push(r.case_id, r.created_at, { method: r.method, outcome: r.outcome, notes: r.notes });
  }
  for (const r of texts.rows) {
    push(r.case_id, r.created_at, { direction: r.direction, body: r.body });
  }
  for (const r of emails.rows) {
    push(r.case_id, r.created_at, { direction: r.direction, subject: r.subject });
  }

  const peeksByCase = new Map<string, ActivityPeek[]>();
  for (const [caseId, entries] of byCase) {
    peeksByCase.set(caseId, collapsePeeks(entries));
  }
  return { peeksByCase, truncated: false };
}

export async function loadReplySource(args: {
  supabase: SupabaseClient;
  orgId: string;
  customerIds: string[];
  windowStartIso: string;
}): Promise<{
  replyByCustomer: Map<string, ReplyCounts>;
  truncated: boolean;
}> {
  const { supabase, orgId, windowStartIso } = args;
  const customerIds = args.customerIds.filter(Boolean);
  if (customerIds.length === 0) return { replyByCustomer: new Map(), truncated: false };

  const chunks = chunkIds(customerIds, 100);
  const started = Date.now();
  const [texts, emails] = await Promise.all([
    pageAllChunked<ReplyRow>(
      chunks,
      (ids, from, to) =>
        supabase
          .from("text_messages")
          .select("customer_id, direction", { count: "exact" })
          .eq("org_id", orgId)
          .gte("created_at", windowStartIso)
          .in("customer_id", ids)
          .range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAllChunked<ReplyRow>(
      chunks,
      (ids, from, to) =>
        supabase
          .from("email_messages")
          .select("customer_id, direction", { count: "exact" })
          .eq("org_id", orgId)
          .gte("created_at", windowStartIso)
          .in("customer_id", ids)
          .range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
  ]);

  const truncated = texts.truncated || emails.truncated;
  console.info({
    event: "load_reply_source",
    orgId,
    rows: texts.rows.length + emails.rows.length,
    truncated,
    ms: Date.now() - started,
  });

  const replyByCustomer = new Map<string, ReplyCounts>();
  for (const r of [...texts.rows, ...emails.rows]) {
    if (!r.customer_id) continue;
    const cur = replyByCustomer.get(r.customer_id) ?? { inbound: 0, outbound: 0 };
    if (r.direction === "inbound") cur.inbound += 1;
    else if (r.direction === "outbound") cur.outbound += 1;
    replyByCustomer.set(r.customer_id, cur);
  }
  return { replyByCustomer, truncated };
}
