// Dedicated windowed contact / promise-created rates. Do not reuse Stage-2
// lastContactsInput (uncapped, not range-scoped) or CasePromiseInput (no created_at).

import type { SupabaseClient } from "@supabase/supabase-js";
import { countsAsCustomerContact } from "./last-contact";
import { chunkIds, orderPage, pageAll, pageAllChunked, PAGE_ALL_MAX_ROWS } from "./page-all";

type LogRow = { case_id: string | null; method: string | null };
type MsgRow = { case_id: string | null };
type PromiseRow = { case_id: string | null };

const CONTACT_METHODS = ["call", "text", "email"] as const;

export async function loadContactPromiseRates(args: {
  supabase: SupabaseClient;
  orgId: string;
  windowStartIso: string;
  openCaseIds: string[];
}): Promise<{ contactedOpenCaseIds: string[]; promisesCreated: number; truncated: boolean }> {
  const { supabase, orgId, windowStartIso, openCaseIds } = args;
  const chunks = chunkIds(openCaseIds.filter(Boolean), 100);

  const [logs, texts, emails, promises] = await Promise.all([
    chunks.length === 0
      ? Promise.resolve({ rows: [] as LogRow[], truncated: false })
      : pageAllChunked<LogRow>(
          chunks,
          (ids, from, to) =>
            orderPage(
              supabase
                .from("contact_logs")
                .select("case_id, method, created_at", { count: "exact" })
                .eq("org_id", orgId)
                .in("case_id", ids)
                .in("method", [...CONTACT_METHODS])
                .gte("created_at", windowStartIso),
            ).range(from, to),
          { maxRows: PAGE_ALL_MAX_ROWS },
        ),
    chunks.length === 0
      ? Promise.resolve({ rows: [] as MsgRow[], truncated: false })
      : pageAllChunked<MsgRow>(
          chunks,
          (ids, from, to) =>
            orderPage(
              supabase
                .from("text_messages")
                .select("case_id", { count: "exact" })
                .eq("org_id", orgId)
                .eq("direction", "outbound")
                .in("case_id", ids)
                .gte("created_at", windowStartIso),
            ).range(from, to),
          { maxRows: PAGE_ALL_MAX_ROWS },
        ),
    chunks.length === 0
      ? Promise.resolve({ rows: [] as MsgRow[], truncated: false })
      : pageAllChunked<MsgRow>(
          chunks,
          (ids, from, to) =>
            orderPage(
              supabase
                .from("email_messages")
                .select("case_id", { count: "exact" })
                .eq("org_id", orgId)
                .eq("direction", "outbound")
                .in("case_id", ids)
                .gte("created_at", windowStartIso),
            ).range(from, to),
          { maxRows: PAGE_ALL_MAX_ROWS },
        ),
    pageAll<PromiseRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("promises")
            .select("case_id", { count: "exact" })
            .eq("org_id", orgId)
            .gte("created_at", windowStartIso)
            .neq("status", "cancelled"),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
  ]);

  const openSet = new Set(openCaseIds);
  const contacted = new Set<string>();
  const add = (caseId: string | null) => {
    if (caseId && openSet.has(caseId)) contacted.add(caseId);
  };
  for (const r of logs.rows) {
    if (countsAsCustomerContact(r.method)) add(r.case_id);
  }
  for (const r of texts.rows) add(r.case_id);
  for (const r of emails.rows) add(r.case_id);

  const promiseCases = new Set<string>();
  for (const r of promises.rows) {
    if (r.case_id) promiseCases.add(r.case_id);
  }

  return {
    contactedOpenCaseIds: [...contacted],
    promisesCreated: promiseCases.size,
    truncated: logs.truncated || texts.truncated || emails.truncated || promises.truncated,
  };
}
