// Shared reads + window filtering for the team report. Used by /reports and
// /reports.csv. Aggregation stays in reports.ts (pure).

import type { SupabaseClient } from "@supabase/supabase-js";
import { listOrgMembers } from "./orgs.server";
import { addCalendarDays } from "./business-days";
import { loadOrgConfig } from "./org-config.server";
import type { OrgConfig } from "./org-config";
import { localMidnightUtcIso, todayInTz } from "./tz";
import { isCaseSuppressed } from "./exceptions";
import type { ExceptionReason } from "./contact-log";
import { buildArAgingBuckets, buildArKpis, type ArKpis } from "./ar-kpis";
import { loadArKpiSource } from "./ar-kpis.server";
import { loadContactPromiseRates } from "./contact-promise-rates.server";
import {
  chunkIds, honestListState, orderPage, pageAllChunkedHonest, pageAllHonest, PAGE_ALL_MAX_ROWS,
} from "./page-all";
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
  orgConfig?: OrgConfig;
}): Promise<TeamReport & { truncated: boolean; loadError: string | null }> {
  const { supabase, service, orgId, range } = args;

  const [orgConfig, rosterMembers] = await Promise.all([
    args.orgConfig ? Promise.resolve(args.orgConfig) : loadOrgConfig(supabase, orgId),
    listOrgMembers(service, orgId),
  ]);
  const tz = orgConfig.companyProfile.timezone;
  const today = todayInTz(tz);
  const windowStartIso = localMidnightUtcIso(addCalendarDays(today, -range), tz);

  const roster = rosterMembers.map((m) => ({ userId: m.userId, label: m.label }));

  type LogRow = { user_id: string; case_id: string | null; created_at: string };
  type PromRow = { created_by: string | null; status: ReportPromise["status"]; resolved_at: string | null };
  type OpenedRow = { id: string; opened_at: string };
  type OpenRow = {
    id: string; customer_id: string | null; status: string;
    exception_reason: ExceptionReason | null; next_action_at: string | null;
  };
  type InvRow = { customer_id: string | null; balance: number | string | null };
  const [logs, proms, opened, openCasesPage, invs] = await Promise.all([
    pageAllHonest<LogRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("contact_logs")
            .select("user_id, case_id, created_at", { count: "exact" })
            .eq("org_id", orgId)
            .gte("created_at", windowStartIso),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAllHonest<PromRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("promises")
            .select("created_by, status, resolved_at", { count: "exact" })
            .eq("org_id", orgId)
            .in("status", ["kept", "partially_kept", "broken"])
            .gte("resolved_at", windowStartIso),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAllHonest<OpenedRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("collection_cases")
            .select("id, opened_at", { count: "exact" })
            .eq("org_id", orgId)
            .gte("opened_at", windowStartIso),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAllHonest<OpenRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("collection_cases")
            .select("id, customer_id, status, exception_reason, next_action_at", { count: "exact" })
            .eq("org_id", orgId)
            .is("closed_at", null),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAllHonest<InvRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("invoices")
            .select("customer_id, balance", { count: "exact" })
            .eq("org_id", orgId)
            .gt("balance", 0)
            .lt("due_date", today),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
  ]);

  const contactLogs: ReportContactLog[] = logs.rows.map((r) => ({
    userId: r.user_id, caseId: r.case_id ?? null, createdAt: r.created_at,
  }));
  const promises: ReportPromise[] = proms.rows.map((r) => ({
    createdBy: r.created_by ?? null, status: r.status, resolvedAt: r.resolved_at ?? null,
  }));
  const openedCases: ReportOpenedCase[] = opened.rows.map((r) => ({
    caseId: r.id, openedAt: r.opened_at,
  }));
  const openCases = openCasesPage.rows;
  const customerIds = [...new Set(openCases.map((c) => c.customer_id).filter((id): id is string => Boolean(id)))];

  type CustOwnerRow = { id: string; owner: string | null };
  const custPage = customerIds.length === 0
    ? { rows: [] as CustOwnerRow[], truncated: false, error: null }
    : await pageAllChunkedHonest<CustOwnerRow>(
        chunkIds(customerIds, 100),
        (ids, from, to) =>
          orderPage(
            supabase
              .from("customers")
              .select("id, owner", { count: "exact" })
              .eq("org_id", orgId)
              .in("id", ids),
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      );
  const ownerByCustomer = new Map<string, string | null>();
  for (const r of custPage.rows) ownerByCustomer.set(r.id, r.owner ?? null);

  const overdueByCustomer = new Map<string, number>();
  for (const r of invs.rows) {
    if (!r.customer_id) continue;
    overdueByCustomer.set(r.customer_id, (overdueByCustomer.get(r.customer_id) ?? 0) + (Number(r.balance) || 0));
  }

  const openCaseIds = openCases.map((c) => c.id);
  type PromCaseRow = { case_id: string; status: ReportPromise["status"]; created_at: string };
  const promForCases = openCaseIds.length === 0
    ? { rows: [] as PromCaseRow[], truncated: false, error: null }
    : await pageAllChunkedHonest<PromCaseRow>(
        chunkIds(openCaseIds, 100),
        (ids, from, to) =>
          orderPage(
            supabase
              .from("promises")
              .select("case_id, status, created_at", { count: "exact" })
              .eq("org_id", orgId)
              .in("case_id", ids)
              .neq("status", "cancelled"),
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      );
  const brokenCaseIds = activeBrokenCaseIds(
    promForCases.rows.map((r) => ({ caseId: r.case_id, status: r.status, createdAt: r.created_at })),
  );

  const workloadCases: ReportWorkloadCase[] = openCases.map((c) => ({
    caseId: c.id,
    ownerId: c.customer_id ? (ownerByCustomer.get(c.customer_id) ?? null) : null,
    status: c.status,
    exceptionReason: c.exception_reason ?? null,
    nextActionAt: c.next_action_at ?? null,
    overdueTotal: c.customer_id ? (overdueByCustomer.get(c.customer_id) ?? 0) : 0,
    hasBrokenPromise: brokenCaseIds.has(c.id),
  }));

  const listState = honestListState(
    [logs, proms, opened, openCasesPage, invs, custPage, promForCases],
  );
  const loadError = listState.loadError ? "Could not load report" : null;
  const truncated = listState.truncated;

  return {
    ...buildTeamReport({
      range, roster,
      contactLogs: loadError ? [] : contactLogs,
      promises: loadError ? [] : promises,
      openedCases: loadError ? [] : openedCases,
      workloadCases: loadError ? [] : workloadCases,
      today, timeZone: tz,
    }),
    truncated,
    loadError,
  };
}

// Selected 7/30/90 window — not Stage-2 last-contact / case-promise inputs,
// which are uncapped and not range-scoped.
export async function loadReportArKpis(args: {
  supabase: SupabaseClient;
  orgId: string;
  range: ReportRange;
  orgConfig?: OrgConfig;
}): Promise<ArKpis & { loadError: string | null }> {
  const { supabase, orgId, range } = args;
  const orgConfig = args.orgConfig ?? await loadOrgConfig(supabase, orgId);
  const tz = orgConfig.companyProfile.timezone;
  const today = todayInTz(tz);
  const windowStartIso = localMidnightUtcIso(addCalendarDays(today, -range), tz);

  const [arSrc, openCases] = await Promise.all([
    loadArKpiSource({ supabase, orgId, today, rangeDays: range }),
    pageAllHonest<OpenCaseRow>(
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

  if (openCases.error) {
    const kpis = buildArKpis({
      open: arSrc.open,
      salesLookback: arSrc.salesLookback,
      payments: arSrc.payments,
      today,
      rangeDays: range,
      openCaseIds: [],
      contactedCaseIdsInWindow: [],
      promisesCreatedInWindow: 0,
      truncated: { ...arSrc.truncated, contact: false },
    });
    return {
      ...kpis,
      agingBuckets: buildArAgingBuckets(arSrc.open, today),
      loadError: "Could not load report",
    };
  }

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

  const kpis = buildArKpis({
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
  return { ...kpis, agingBuckets: buildArAgingBuckets(arSrc.open, today), loadError: null };
}
