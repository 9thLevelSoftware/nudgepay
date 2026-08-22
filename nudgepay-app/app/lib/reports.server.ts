// Shared reads + window filtering for the team report. Used by /reports and
// /reports.csv. Aggregation stays in reports.ts (pure).

import type { SupabaseClient } from "@supabase/supabase-js";
import { listOrgMembers } from "./orgs.server";
import { addCalendarDays } from "./business-days";
import { loadOrgConfig } from "./org-config.server";
import { localMidnightUtcIso, todayInTz } from "./tz";
import { isCaseSuppressed } from "./exceptions";
import type { ExceptionReason } from "./contact-log";
import { buildArKpis, type ArKpis } from "./ar-kpis";
import { loadArKpiSource } from "./ar-kpis.server";
import { loadContactPromiseRates } from "./contact-promise-rates.server";
import { orderPage, pageAll, PAGE_ALL_MAX_ROWS } from "./page-all";
import {
  activeBrokenCaseIds, buildTeamReport, type ReportRange,
  type ReportContactLog, type ReportPromise, type ReportOpenedCase, type ReportWorkloadCase,
  type TeamReport,
} from "./reports";

type OpenCaseRow = {
  id: string;
  status: string;
  exception_reason: ExceptionReason | null;
  next_action_at: string | null;
};

export async function loadTeamReport(args: {
  supabase: SupabaseClient;
  service: SupabaseClient;
  orgId: string;
  range: ReportRange;
}): Promise<TeamReport> {
  const { supabase, service, orgId, range } = args;

  const orgConfig = await loadOrgConfig(supabase, orgId);
  const tz = orgConfig.companyProfile.timezone;
  const today = todayInTz(tz);
  const windowStartIso = localMidnightUtcIso(addCalendarDays(today, -range), tz);

  const roster = (await listOrgMembers(service, orgId)).map((m) => ({ userId: m.userId, label: m.label }));

  const { data: logRows } = await supabase
    .from("contact_logs")
    .select("user_id, case_id, created_at")
    .eq("org_id", orgId)
    .gte("created_at", windowStartIso);
  const contactLogs: ReportContactLog[] = ((logRows as any[]) ?? []).map((r) => ({
    userId: r.user_id, caseId: r.case_id ?? null, createdAt: r.created_at,
  }));

  const { data: promRows } = await supabase
    .from("promises")
    .select("created_by, status, resolved_at")
    .eq("org_id", orgId)
    .in("status", ["kept", "partially_kept", "broken"])
    .gte("resolved_at", windowStartIso);
  const promises: ReportPromise[] = ((promRows as any[]) ?? []).map((r) => ({
    createdBy: r.created_by ?? null, status: r.status, resolvedAt: r.resolved_at ?? null,
  }));

  const { data: openedRows } = await supabase
    .from("collection_cases")
    .select("id, opened_at")
    .eq("org_id", orgId)
    .gte("opened_at", windowStartIso);
  const openedCases: ReportOpenedCase[] = ((openedRows as any[]) ?? []).map((r) => ({
    caseId: r.id, openedAt: r.opened_at,
  }));

  const { data: openCaseRows } = await supabase
    .from("collection_cases")
    .select("id, customer_id, status, exception_reason, next_action_at")
    .eq("org_id", orgId)
    .is("closed_at", null);
  const openCases = ((openCaseRows as any[]) ?? []);
  const customerIds = [...new Set(openCases.map((c) => c.customer_id).filter(Boolean))];

  const ownerByCustomer = new Map<string, string | null>();
  if (customerIds.length > 0) {
    const { data: custRows } = await supabase
      .from("customers").select("id, owner").eq("org_id", orgId).in("id", customerIds);
    for (const r of (custRows as any[]) ?? []) ownerByCustomer.set(r.id, r.owner ?? null);
  }

  const overdueByCustomer = new Map<string, number>();
  const { data: invRows } = await supabase
    .from("invoices").select("customer_id, balance").eq("org_id", orgId)
    .gt("balance", 0).lt("due_date", today);
  for (const r of (invRows as any[]) ?? []) {
    if (!r.customer_id) continue;
    overdueByCustomer.set(r.customer_id, (overdueByCustomer.get(r.customer_id) ?? 0) + (Number(r.balance) || 0));
  }

  const openCaseIds = openCases.map((c) => c.id);
  let brokenCaseIds = new Set<string>();
  if (openCaseIds.length > 0) {
    const { data: promForCases } = await supabase
      .from("promises")
      .select("case_id, status, created_at")
      .eq("org_id", orgId)
      .in("case_id", openCaseIds)
      .neq("status", "cancelled");
    brokenCaseIds = activeBrokenCaseIds(
      ((promForCases as any[]) ?? []).map((r) => ({ caseId: r.case_id, status: r.status, createdAt: r.created_at })),
    );
  }

  const workloadCases: ReportWorkloadCase[] = openCases.map((c) => ({
    caseId: c.id,
    ownerId: c.customer_id ? (ownerByCustomer.get(c.customer_id) ?? null) : null,
    status: c.status,
    exceptionReason: c.exception_reason ?? null,
    nextActionAt: c.next_action_at ?? null,
    overdueTotal: c.customer_id ? (overdueByCustomer.get(c.customer_id) ?? 0) : 0,
    hasBrokenPromise: brokenCaseIds.has(c.id),
  }));

  return buildTeamReport({ range, roster, contactLogs, promises, openedCases, workloadCases, today });
}

// Selected 7/30/90 window — not Stage-2 last-contact / case-promise inputs,
// which are uncapped and not range-scoped.
export async function loadReportArKpis(args: {
  supabase: SupabaseClient;
  orgId: string;
  range: ReportRange;
}): Promise<ArKpis> {
  const { supabase, orgId, range } = args;
  const orgConfig = await loadOrgConfig(supabase, orgId);
  const tz = orgConfig.companyProfile.timezone;
  const today = todayInTz(tz);
  const windowStartIso = localMidnightUtcIso(addCalendarDays(today, -range), tz);

  const [arSrc, openCases] = await Promise.all([
    loadArKpiSource({ supabase, orgId, today, rangeDays: range }),
    pageAll<OpenCaseRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("collection_cases")
            .select("id, status, exception_reason, next_action_at", { count: "exact" })
            .eq("org_id", orgId)
            .is("closed_at", null),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
  ]);

  const openCaseIds = openCases.rows
    .filter((c) => !isCaseSuppressed({
      status: c.status,
      exceptionReason: c.exception_reason ?? null,
      nextActionAt: c.next_action_at ?? null,
      today,
    }))
    .map((c) => c.id);

  const rates = await loadContactPromiseRates({
    supabase, orgId, windowStartIso, openCaseIds,
  });

  return buildArKpis({
    open: arSrc.open,
    salesLookback: arSrc.salesLookback,
    payments: arSrc.payments,
    today,
    rangeDays: range,
    openCaseIds,
    contactedCaseIdsInWindow: rates.contactedOpenCaseIds,
    promisesCreatedInWindow: rates.promisesCreated,
    truncated: { ...arSrc.truncated, contact: rates.truncated || openCases.truncated },
  });
}
