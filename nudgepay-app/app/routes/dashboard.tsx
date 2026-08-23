import { useLoaderData, redirect, data, Link, type LoaderFunctionArgs } from "react-router";
import { useFlashCleanup } from "../lib/use-flash-cleanup";
import { getEnv, getQboEnvOrNull } from "../lib/env.server";
import { QBO_FLASH, SYNC_FLASH, bulkSmsFailureSummary, parseBulkErrorNames } from "../lib/flash-copy";
import { requireOrgUser } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { loadCaseQueueSource } from "../lib/case-queue.server";
import { loadPeekSource, loadReplySource, peekWindowStartIso } from "../lib/activity-peek.server";
import { PEEK_WINDOW_DAYS, type ActivityPeek } from "../lib/activity-peek";
import { loadBrokenPromiseCustomers, loadPayerSource } from "../lib/payer-behavior.server";
import type { PayerStats } from "../lib/payer-behavior";
import { dashboardHref, parseDensity, parseEntityMode, parseSort } from "../lib/queue-chrome";
import { applyInvoiceView, buildInvoiceQueue, sortInvoiceItems, type InvoiceQueueItem } from "../lib/invoice-queue";
import { loadArKpiSource } from "../lib/ar-kpis.server";
import { buildArKpis, DASHBOARD_AR_RANGE_DAYS } from "../lib/ar-kpis";
import { loadContactPromiseRates } from "../lib/contact-promise-rates.server";
import { addCalendarDays } from "../lib/business-days";
import { isCaseSuppressed } from "../lib/exceptions";
import { loadOrgConfig } from "../lib/org-config.server";
import { localMidnightUtcIso, todayInTz } from "../lib/tz";
import type { OrgMember } from "../lib/orgs.server";
// worklist.ts is pure (no I/O, no node:*, no secrets) so it is safe in both the
// client bundle and the server — buildCaseData is exported from this route
// (for tests) and the UI components import its types directly.
import {
  type InvoiceInput, type CustomerInput,
  type Metrics, type ViewId, type SortId,
} from "../lib/worklist";
import {
  buildCaseItems, applyCaseView, sortCaseItems, computeCaseMetrics,
  mergeWorkspaceInvoices,
  type CaseItem, type CaseInvoice, type CaseRow, type CaseStatus, type NextActionType,
  type CasePromiseInput, type CaseLastContactInput,
} from "../lib/cases";
import type { PriorityOverrideLevel } from "../lib/priority";
import type { ExceptionReason } from "../lib/contact-log";
import { AppShell } from "../components/AppShell";
import { FirstRunBanner } from "../components/FirstRunBanner";
import { FlashBanner } from "../components/FlashBanner";
import { SyncIssues } from "../components/SyncIssues";
import { mapSyncIssues } from "../lib/workspace.server";
import { ArKpiBand } from "../components/ArKpiBand";
import { KpiBand } from "../components/KpiBand";
import { TriageStrip } from "../components/TriageStrip";
import { WorkQueue } from "../components/WorkQueue";
import { DetailPanel } from "../components/DetailPanel";
import { detailPaneClass, isMobileCaseOpen, queuePaneClass } from "../lib/dashboard-panes";
import { LogContactDrawer } from "../components/LogContactDrawer";
import { CommPrefsDrawer } from "../components/CommPrefsDrawer";
import { buildTimeline, type TimelineEntry, type TimelineLogInput, type TimelineSmsInput } from "~/lib/timeline";
import { collisionState, type Collision } from "../lib/collision";
import { resolveCommPrefs, DEFAULT_COMM_PREFS, type CommPrefs } from "../lib/comm-prefs";
import type { OrgConfig } from "../lib/org-config";
import { DEFAULT_ORG_CONFIG } from "../lib/org-config";
import { resolveEmailSettings } from "../lib/email-settings";
import { plural } from "../lib/labels";
import { pageTitle } from "../lib/meta";
import { honestListState, orderPage, pageAllHonest, PAGE_ALL_MAX_ROWS } from "../lib/page-all";
import { LoadErrorBanner, TruncationBanner } from "../components/TruncationBanner";
import { displayLabel, initialsFrom } from "../lib/names";
import { buildComingDueGroups, comingDueMetric, type ComingDueGroup } from "../lib/coming-due";
import type { Route } from "./+types/dashboard";

export const meta: Route.MetaFunction = ({ data }) =>
  pageTitle(data?.selected ? `${data.selected.customerName} — Collections` : "Collections");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DashboardParams = {
  view: ViewId;
  sort: SortId;
  q: string;
  caseId: string | null;
  invoice?: string | null;
  tab?: "overview" | "activity" | "messages" | "email";
};

type DashboardData = {
  items: CaseItem[];
  invoiceItems: InvoiceQueueItem[];
  metrics: Metrics;
  viewCounts: Record<ViewId, number>;
  invoiceViewCounts: Record<ViewId, number>;
  selected: CaseItem | null;
  comingDueGroups: ComingDueGroup[];
};

const ALL_VIEWS: ViewId[] = ["all-open", "coming-due", "30-plus", "high-value", "never-contacted", "follow-ups-due", "broken-promises", "waiting", "on-hold", "my-work"];

// ---------------------------------------------------------------------------
// Pure helper — exported so tests can call it without I/O
// ---------------------------------------------------------------------------

export function buildCaseData(
  cases: CaseRow[],
  invoices: InvoiceInput[],
  customers: CustomerInput[],
  lastContacts: CaseLastContactInput[],
  promises: CasePromiseInput[],
  params: DashboardParams,
  today: string,
  ownerLabels: Map<string, string>,
  currentUserId: string | null,
  config: OrgConfig,
  comingDueInvoices: InvoiceInput[] = [],
  peeksByCase: Map<string, ActivityPeek[]> = new Map(),
  payerByCustomer: Map<string, PayerStats> = new Map(),
): DashboardData {
  const { view, sort, q, caseId } = params;
  const highValue = config.priority.highValue;
  const base = buildCaseItems(cases, invoices, customers, lastContacts, promises, today, ownerLabels, config);
  const allItems = base.map((i) => ({
    ...i,
    peeks: peeksByCase.get(i.caseId) ?? [],
    payer: payerByCustomer.get(i.customerId) ?? null,
  }));
  const searched = q.trim() === "" ? allItems : allItems.filter((i) => i.searchText.includes(q.toLowerCase()));
  const metrics = computeCaseMetrics(searched, today, highValue);

  // Coming-due groups: built from the separate non-overdue invoice set
  const allComingDueGroups = buildComingDueGroups(comingDueInvoices, customers, today, config.workflow.comingDueDays);
  const lowerQ = q.trim().toLowerCase();
  const filteredComingDue = lowerQ === ""
    ? allComingDueGroups
    : allComingDueGroups.filter((g) =>
        g.customerName.toLowerCase().includes(lowerQ) ||
        g.invoices.some((i) => (i.docNumber ?? "").toLowerCase().includes(lowerQ)),
      );
  metrics.comingDue = comingDueMetric(filteredComingDue);

  const caseViewById = Object.fromEntries(
    ALL_VIEWS.map((v) => [
      v,
      v === "coming-due" ? [] : applyCaseView(searched, v, today, currentUserId, highValue),
    ]),
  ) as Record<ViewId, CaseItem[]>;
  const viewCounts = Object.fromEntries(
    ALL_VIEWS.map((v) => [v, v === "coming-due" ? filteredComingDue.length : caseViewById[v].length]),
  ) as Record<ViewId, number>;
  const items = sortCaseItems(caseViewById[view], sort);
  const selected = caseId != null ? (searched.find((i) => i.caseId === caseId) ?? null) : null;
  const casesByCustomer = new Map(
    allItems.map((i) => [i.customerId, {
      caseId: i.caseId, lastContact: i.lastContact, peeks: i.peeks, suppressed: i.suppressed,
    }]),
  );
  const builtInvoices = buildInvoiceQueue({
    invoices: [...invoices, ...comingDueInvoices],
    casesByCustomer,
    customers,
    ownerLabels,
    payerByCustomer,
    today,
  });
  const searchedInvoices = q.trim() === ""
    ? builtInvoices
    : builtInvoices.filter((i) => i.searchText.includes(q.toLowerCase()));
  const invoiceItems = sortInvoiceItems(
    applyInvoiceView(searchedInvoices, view, {
      matchingCaseIds: new Set(items.map((i) => i.caseId)),
      currentUserId,
      highValue,
    }),
    sort,
  );
  const invoiceViewCounts = Object.fromEntries(
    ALL_VIEWS.map((v) => {
      if (v === "coming-due") return [v, filteredComingDue.length];
      return [v, applyInvoiceView(searchedInvoices, v, {
        matchingCaseIds: new Set(caseViewById[v].map((i) => i.caseId)),
        currentUserId,
        highValue,
      }).length];
    }),
  ) as Record<ViewId, number>;
  return { items, invoiceItems, metrics, viewCounts, invoiceViewCounts, selected, comingDueGroups: filteredComingDue };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

// Columns selected for the case activity timeline (keep in sync with the SELECT below).
type ContactLogRow = {
  id: string;
  method: string;
  outcome: string | null;
  notes: string | null;
  created_at: string;
  follow_up_at: string | null;
  promised_amount: number | string | null;
  promised_date: string | null;
};

type SelectedMessageRow = {
  id: string;
  direction: string;
  body: string | null;
  status: string | null;
  error_code: string | null;
  created_at: string;
};

export type MessageEntry = {
  id: string;
  direction: string;
  body: string | null;
  status: string | null;
  errorCode: string | null;
  createdAt: string;
};

export type EmailMessageEntry = {
  id: string;
  direction: string;
  subject: string | null;
  body: string | null;
  status: string | null;
  errorCode: string | null;
  createdAt: string;
};

export type RosterMember = { userId: string; email: string; label: string };

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user, org } = await requireOrgUser(request, env);

  // tab=activity aliases to overview + #history (timeline lives on overview).
  const activityAliasUrl = new URL(request.url);
  if (activityAliasUrl.searchParams.get("tab") === "activity") {
    activityAliasUrl.searchParams.delete("tab");
    throw redirect(`${activityAliasUrl.pathname}${activityAliasUrl.search}#history`);
  }

  // User initials from display name or email
  const userLabel = displayLabel(user.user_metadata?.display_name, user.email, user.id);
  const initials = initialsFrom(userLabel);

  // Service client for connection-status + roster (no RLS needed)
  const service = createSupabaseServiceClient(env);

  // Org config loaded up front so "today" is the org's local calendar day
  // (not UTC's) — passed into loadCaseQueueSource below to avoid a second
  // org_settings read.
  const orgConfigForToday = await loadOrgConfig(supabase, org.org_id).catch(() => DEFAULT_ORG_CONFIG);
  const today = todayInTz(orgConfigForToday.companyProfile.timezone);

  // Batch A: shared queue source + dashboard-only queries in parallel.
  const [
    src,
    { data: orgRow, error: orgErr },
    conn,
    { data: connMeta, error: connMetaErr },
    { data: ecfg, error: ecfgErr },
    { data: syncErrorRows, error: syncErr },
    arSrc,
  ] = await Promise.all([
    loadCaseQueueSource({
      supabase, service, orgId: org.org_id, today, includePresence: true, orgConfig: orgConfigForToday,
    }),
    supabase.from("organizations").select("name").eq("id", org.org_id).single(),
    getConnectionStatus(service, org.org_id),
    service.from("qbo_connections").select("last_sync_at").eq("org_id", org.org_id).maybeSingle(),
    supabase.from("email_config").select("email_enabled").eq("org_id", org.org_id).maybeSingle(),
    supabase.from("sync_errors")
      .select("id, source, scope, message, occurred_at").eq("org_id", org.org_id)
      .is("resolved_at", null).order("occurred_at", { ascending: false }).limit(20),
    loadArKpiSource({
      supabase, orgId: org.org_id, today, rangeDays: DASHBOARD_AR_RANGE_DAYS,
    }),
  ]);
  if (orgErr) throw orgErr;
  if (connMetaErr) throw connMetaErr;
  if (ecfgErr) throw ecfgErr;
  if (syncErr) throw syncErr;

  const connected = conn?.status === "connected";
  const qboConfigured = getQboEnvOrNull(context as any) !== null;

  const lastSyncAt = (connMeta?.last_sync_at as string | null) ?? null;
  let syncLabel: string;
  if (!connected) {
    syncLabel = conn?.status === "error" ? "Needs reconnect" : "Not connected";
  } else if (lastSyncAt) {
    const diffMs = Date.now() - new Date(lastSyncAt).getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    if (diffMin < 2) syncLabel = "Synced just now";
    else if (diffMin < 60) syncLabel = `Synced ${diffMin}m ago`;
    else if (diffHr < 24) syncLabel = `Synced ${diffHr}h ago`;
    else syncLabel = `Synced ${diffDay}d ago`;
  } else {
    syncLabel = "Connected";
  }

  // Parse URL params
  const url = new URL(request.url);
  const sp = url.searchParams;

  const VALID_VIEWS: ViewId[] = ["all-open", "coming-due", "30-plus", "high-value", "never-contacted", "follow-ups-due", "broken-promises", "waiting", "on-hold", "my-work"];
  const VALID_TABS = ["overview", "activity", "messages", "email"] as const;

  const rawView = sp.get("view") ?? "";
  const rawTab = sp.get("tab") ?? "";
  const densityRaw = sp.get("density");
  const densityFromUrl = densityRaw != null;
  const density = parseDensity(densityRaw);
  const entity = parseEntityMode(sp.get("entity"));

  const view: ViewId = VALID_VIEWS.includes(rawView as ViewId) ? (rawView as ViewId) : "all-open";
  const sort: SortId = parseSort(sp.get("sort"));
  const q = sp.get("q") ?? "";
  const caseId = sp.get("case") ?? null;
  const invoice = sp.get("invoice") ?? null; // optional sub-selection for invoice-specific actions
  const tab: "overview" | "activity" | "messages" | "email" = VALID_TABS.includes(
    rawTab as "overview" | "activity" | "messages" | "email",
  )
    ? (rawTab as "overview" | "activity" | "messages" | "email")
    : "overview";

  const sms = sp.get("sms");
  const log = sp.get("log") === "1";
  const logMethod = sp.get("method");
  const logError = sp.get("logError");
  const promiseError = sp.get("promiseError");
  const saved = sp.get("saved") === "1";
  const prefsOpen = sp.get("prefs") === "1";

  const bulkAssign = sp.get("bulkAssign");
  const bulkAssignCount = sp.get("count");
  const bulkSms = sp.get("bulkSms");
  const bulkSent = sp.get("sent");
  const bulkFailed = sp.get("failed");
  const bulkSkipped = sp.get("skipped");
  const bulkErrors = sp.get("bulkErrors");
  const denied = sp.get("denied");

  let selectedTimeline: TimelineEntry[] = [];
  let selectedMessages: MessageEntry[] = [];
  let selectedConsent = false;
  let selectedSmsConsentSource: "inbound_stop" | "inbound_start" | "staff" | "import" | "unknown" | null = null;
  let selectedPhone: string | null = null;
  let selectedPrefs: CommPrefs = DEFAULT_COMM_PREFS;
  let selectedRepInvoiceId: string | null = null;
  let selectedPromiseId: string | null = null;
  let collisions: Record<string, Collision> = {};
  let selectedEmailMessages: EmailMessageEntry[] = [];
  let selectedCustomerEmail: string | null = null;
  let workspaceInvoices: CaseInvoice[] = [];

  // Destructure the shared queue source
  const {
    cases, invoicesInput, comingDueInvoices, customersInput,
    lastContactsInput, queueTruncated, lastContactTruncated: lastContactTruncatedSrc,
    lastContactLoadError, promisesInput, recentByCase, presenceRows,
    roster, ownerLabels, orgConfig, smsEnabled, smsQuietNow, quietHoursLabel, templates,
  } = src;
  let lastContactTruncated = lastContactTruncatedSrc;
  let loadError = lastContactLoadError;

  const orgCompany = orgRow?.name ?? "";
  const orgPhone = orgConfig.companyProfile.phone ?? "";
  const orgPaymentLink = orgConfig.companyProfile.paymentPortalUrl ?? "";

  // Per-customer presence map → per-case collision (self-excluded).
  const presenceByCustomer = new Map<string, { userId: string; lastSeenAt: string }[]>();
  for (const r of presenceRows) {
    const list = presenceByCustomer.get(r.customer_id) ?? [];
    list.push({ userId: r.user_id, lastSeenAt: r.last_seen_at });
    presenceByCustomer.set(r.customer_id, list);
  }
  const nowMs = Date.now();
  for (const cse of cases) {
    collisions[cse.id] = collisionState({
      contacts: recentByCase.get(cse.id) ?? [],
      heartbeats: presenceByCustomer.get(cse.customerId) ?? [],
      currentUserId: user.id,
      nowMs,
      label: (id) => ownerLabels.get(id) ?? "A teammate",
    });
  }

  const emailEnabled = resolveEmailSettings(ecfg as any).emailEnabled;

  const customerIds = [...new Set([
    ...cases.map((c) => c.customerId),
    ...invoicesInput.map((i) => i.customer_id ?? ""),
    ...comingDueInvoices.map((i) => i.customer_id ?? ""),
  ].filter(Boolean))];
  const tz = orgConfig.companyProfile.timezone;
  const windowStartIso = peekWindowStartIso(today, PEEK_WINDOW_DAYS, tz);
  const caseToCustomer = new Map(cases.map((c) => [c.id, c.customerId]));
  const openCaseIds = cases
    .filter((c) => !isCaseSuppressed({
      status: c.status,
      exceptionReason: c.exceptionReason,
      nextActionAt: c.nextActionAt,
      today,
    }))
    .map((c) => c.id);
  const contactWindowStartIso = localMidnightUtcIso(
    addCalendarDays(today, -DASHBOARD_AR_RANGE_DAYS), tz,
  );

  const peekP = loadPeekSource({
    supabase,
    orgId: org.org_id,
    caseIds: cases.map((c) => c.id),
    windowStartIso,
  });
  const payerP = Promise.all([
    loadReplySource({
      supabase,
      orgId: org.org_id,
      customerIds,
      windowStartIso,
    }),
    loadBrokenPromiseCustomers({ supabase, orgId: org.org_id, caseToCustomer }),
  ]).then(([replySrc, brokenPromiseByCustomer]) => loadPayerSource({
    supabase,
    orgId: org.org_id,
    customerIds,
    today,
    brokenPromiseByCustomer,
    replyByCustomer: replySrc.replyByCustomer,
    replyTruncated: replySrc.truncated,
  }));
  const ratesP = loadContactPromiseRates({
    supabase,
    orgId: org.org_id,
    windowStartIso: contactWindowStartIso,
    openCaseIds,
  });
  const [peekSrc, payerByCustomer, rates] = await Promise.all([peekP, payerP, ratesP]);

  const arKpis = buildArKpis({
    open: arSrc.open,
    salesLookback: arSrc.salesLookback,
    payments: arSrc.payments,
    today,
    rangeDays: DASHBOARD_AR_RANGE_DAYS,
    openCaseIds,
    contactedCaseIdsInWindow: rates.contactedOpenCaseIds,
    promisesCreatedInWindow: rates.promisesCreated,
    truncated: { ...arSrc.truncated, contact: rates.truncated },
  });

  const dashboardData: DashboardData = buildCaseData(
    cases, invoicesInput, customersInput, lastContactsInput, promisesInput,
    { view, sort, q, caseId, invoice, tab }, today, ownerLabels, user.id, orgConfig,
    comingDueInvoices, peekSrc.peeksByCase, payerByCustomer,
  );

  const sel = dashboardData.selected;
  if (sel) {
    const customerId = sel.customerId;
    workspaceInvoices = mergeWorkspaceInvoices(
      sel.invoices, comingDueInvoices, sel.customerId, today,
    );
    const repInvoiceId =
      (invoice && workspaceInvoices.some((iv) => iv.invoiceId === invoice))
        ? invoice
        : (sel.invoices[0]?.invoiceId ?? workspaceInvoices[0]?.invoiceId ?? null);

    // Batch C: selected-case lists page (loadError, never throw). Query order is
    // created_at desc so max_rows keeps newest replies; display sort is oldest-first.
    type ActRow = ContactLogRow & { user_id: string | null };
    type MsgRow = SelectedMessageRow & { case_id: string | null };
    type EmailRow = {
      id: string; direction: string; subject: string | null; body: string | null;
      status: string | null; error_code: string | null; created_at: string;
    };
    const [
      actPage,
      msgPage,
      { data: custRow, error: custErr },
      { data: ap, error: apErr },
      emailPage,
    ] = await Promise.all([
      pageAllHonest<ActRow>(
        (from, to) =>
          orderPage(
            supabase
              .from("contact_logs")
              .select("id, user_id, method, outcome, notes, created_at, follow_up_at, promised_amount, promised_date", { count: "exact" })
              .eq("org_id", org.org_id)
              .eq("case_id", sel.caseId),
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      ),
      pageAllHonest<MsgRow>(
        (from, to) =>
          orderPage(
            supabase
              .from("text_messages")
              .select("id, case_id, direction, body, status, error_code, created_at", { count: "exact" })
              .eq("org_id", org.org_id)
              .eq("customer_id", customerId),
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      ),
      supabase
        .from("customers").select("phone, email, sms_consent, sms_consent_source, preferred_channel, do_not_call, do_not_text, do_not_email").eq("id", customerId).maybeSingle(),
      supabase
        .from("promises").select("id").eq("org_id", org.org_id).eq("case_id", sel.caseId).eq("status", "pending").maybeSingle(),
      pageAllHonest<EmailRow>(
        (from, to) =>
          orderPage(
            supabase
              .from("email_messages")
              .select("id, direction, subject, body, status, error_code, created_at", { count: "exact" })
              .eq("org_id", org.org_id)
              .eq("customer_id", customerId),
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      ),
    ]);
    if (custErr) throw custErr;
    if (apErr) throw apErr;
    const batchC = honestListState([actPage, msgPage, emailPage]);
    if (batchC.loadError) {
      loadError = loadError ?? "Could not load thread";
    } else {
      if (batchC.truncated) lastContactTruncated = true;
      // Activity: contact logs for the case (timeline input).
      const logInputs: TimelineLogInput[] = actPage.rows.map((r) => ({
        id: r.id, at: r.created_at, method: r.method, outcome: r.outcome, notes: r.notes,
        followUpAt: r.follow_up_at,
        promisedAmount: r.promised_amount == null ? null : Number(r.promised_amount),
        promisedDate: r.promised_date,
        authorLabel: r.user_id ? (ownerLabels.get(r.user_id) ?? null) : null,
      }));

      // Messages: thread by CUSTOMER. Query is created_at desc (newest kept);
      // display sort is oldest-first among the kept page.
      const msgRowsTyped = [...msgPage.rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
      selectedMessages = msgRowsTyped.map((r) => ({
        id: r.id, direction: r.direction, body: r.body, status: r.status,
        errorCode: r.error_code, createdAt: r.created_at,
      }));

      // Timeline: case-scoped logs + case-scoped SMS, merged newest-first.
      const smsInputs: TimelineSmsInput[] = msgRowsTyped
        .filter((r) => r.case_id === sel.caseId)
        .map((r) => ({
          id: r.id, at: r.created_at, direction: r.direction,
          body: r.body, status: r.status, errorCode: r.error_code,
        }));
      selectedTimeline = buildTimeline(logInputs, smsInputs);

      selectedEmailMessages = [...emailPage.rows]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((r) => ({
          id: r.id,
          direction: r.direction,
          subject: r.subject ?? null,
          body: r.body ?? null,
          status: r.status ?? null,
          errorCode: r.error_code ?? null,
          createdAt: r.created_at,
        }));
    }

    // Consent + phone + email prefs from the customer.
    selectedConsent = (custRow as any)?.sms_consent ?? false;
    selectedSmsConsentSource = (custRow as any)?.sms_consent_source ?? null;
    selectedPhone = (custRow as any)?.phone ?? null;
    selectedPrefs = resolveCommPrefs(custRow as any);
    selectedCustomerEmail = (custRow as any)?.email ?? null;
    selectedRepInvoiceId = repInvoiceId;

    // Active pending promise id for the cancel form
    selectedPromiseId = ap?.id ?? null;
  }

  return data(
    {
      orgName: orgRow?.name ?? "(unknown)",
      userInitials: initials,
      userLabel,
      isOwner: org.role === "owner",
      connected,
      syncIssues: mapSyncIssues(syncErrorRows as {
        id: string; source: string; scope: string; message: string; occurred_at: string;
      }[] | null),
      qboConfigured,
      qboFlash: sp.get("qbo"),
      syncFlash: sp.get("sync"),
      syncLabel,
      view,
      sort,
      q,
      entity,
      density,
      densityFromUrl,
      case: caseId,
      invoice,
      repInvoiceId: selectedRepInvoiceId,
      tab,
      log,
      logMethod,
      logError,
      selectedTimeline,
      selectedMessages,
      selectedConsent,
      selectedSmsConsentSource,
      selectedPhone,
      selectedPrefs,
      selectedPromiseId,
      sms,
      smsEnabled,
      smsQuietNow,
      quietHoursLabel,
      emailEnabled,
      emailMessages: selectedEmailMessages,
      customerEmail: selectedCustomerEmail,
      promiseError,
      saved,
      prefsOpen,
      bulkAssign,
      bulkAssignCount,
      bulkSms,
      bulkSent,
      bulkFailed,
      bulkSkipped,
      bulkErrors,
      denied,
      roster,
      collisions,
      currentUserId: user.id,
      smsTemplates: templates.sms,
      emailTemplates: templates.email,
      orgCompany,
      orgPhone,
      orgPaymentLink,
      maxBatch: orgConfig.workflow.smsBatchLimit,
      comingDueDays: orgConfig.workflow.comingDueDays,
      today,
      timeZone: orgConfig.companyProfile.timezone,
      arKpis,
      lastContactTruncated,
      queueTruncated,
      queueTruncatedMessage: queueTruncated
        ? `Showing the first ${invoicesInput.length} overdue invoices / ${cases.length} cases — list may be incomplete`
        : null,
      loadError,
      workspaceInvoices,
      ...dashboardData,
    },
    { headers },
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const {
    orgName,
    userInitials,
    userLabel,
    isOwner,
    connected,
    syncIssues,
    qboConfigured,
    qboFlash,
    syncFlash,
    syncLabel,
    view,
    sort,
    q,
    entity,
    density,
    densityFromUrl,
    invoice,
    invoiceItems,
    tab,
    log,
    logMethod,
    logError,
    promiseError,
    selectedTimeline,
    selectedMessages,
    selectedConsent,
    selectedSmsConsentSource,
    selectedPhone,
    selectedPrefs,
    selectedPromiseId,
    sms,
    smsEnabled,
    smsQuietNow,
    quietHoursLabel,
    emailEnabled,
    emailMessages,
    customerEmail,
    saved,
    prefsOpen,
    bulkAssign,
    bulkAssignCount,
    bulkSms,
    bulkSent,
    bulkFailed,
    bulkSkipped,
    bulkErrors,
    denied,
    roster,
    collisions,
    items,
    metrics,
    viewCounts,
    invoiceViewCounts,
    selected,
    comingDueGroups,
    comingDueDays,
    today,
    arKpis,
    lastContactTruncated,
    queueTruncatedMessage,
    loadError,
    repInvoiceId,
    workspaceInvoices,
    smsTemplates,
    emailTemplates,
    orgCompany,
    orgPhone,
    orgPaymentLink,
    maxBatch,
    timeZone,
  } = useLoaderData<typeof loader>();

  useFlashCleanup();
  const bulkFailureSummary = bulkSmsFailureSummary(Number(bulkFailed) || 0, parseBulkErrorNames(bulkErrors));

  const VIEW_LABEL: Record<string, string> = {
    "30-plus": "30+ days past due", "high-value": "High value",
    "never-contacted": "Never contacted", "all-open": "All open",
    "coming-due": "Coming due", "follow-ups-due": "Follow-ups due",
    "broken-promises": "Broken promises",
    "on-hold": "On hold", "waiting": "Waiting", "my-work": "My work",
  };
  const isFiltered = q !== "" || (view !== "all-open" && view !== undefined);
  const scopeLabel = isFiltered
    ? q ? `Filtered — matching "${q}"` : `Filtered — ${VIEW_LABEL[view ?? ""] ?? view}`
    : null;
  const hrefDensity = densityFromUrl ? density : undefined;
  const hrefEntity = entity !== "customers" ? entity : undefined;
  const clearHref = isFiltered
    ? dashboardHref({ view: "all-open", sort, entity: hrefEntity, density: hrefDensity })
    : undefined;

  return (
    <AppShell
      orgName={orgName}
      userInitials={userInitials}
      userLabel={userLabel}
      syncLabel={syncLabel}
      connected={connected}
      isOwner={isOwner}
      activeNav="collections"
      headerActions={
        <Link
          to="/focus"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-copper/40 text-copper text-[11px] font-sans font-semibold hover:bg-copper/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          Focus mode
        </Link>
      }
      syncIssues={<SyncIssues issues={syncIssues} returnTo="/dashboard" />}
    >
      {qboFlash && QBO_FLASH[qboFlash] ? (
        <FlashBanner tone={QBO_FLASH[qboFlash].tone} text={QBO_FLASH[qboFlash].text} />
      ) : null}
      {syncFlash && SYNC_FLASH[syncFlash] ? (
        <FlashBanner tone={SYNC_FLASH[syncFlash].tone} text={SYNC_FLASH[syncFlash].text} />
      ) : null}
      {!connected ? <FirstRunBanner isOwner={isOwner} qboConfigured={qboConfigured} /> : null}
      {saved ? (
        <div className="px-6 py-2 bg-cool/10 border-b border-cool/30 text-sm font-sans font-medium text-cool" role="status">
          Contact logged successfully.
        </div>
      ) : null}
      {bulkAssign === "done" ? (
        <div className="px-6 py-2 bg-cool/10 border-b border-cool/30 text-sm font-sans font-medium text-cool" role="status">
          Reassigned {plural(Number(bulkAssignCount) || 0, "account")}.
        </div>
      ) : null}
      {bulkSms === "done" ? (
        <div className="px-6 py-2 bg-cool/10 border-b border-cool/30 text-sm font-sans font-medium text-cool" role="status">
          Sent {bulkSent ?? "0"} · Failed {bulkFailed ?? "0"} · Skipped {bulkSkipped ?? "0"}.{bulkFailureSummary ? ` ${bulkFailureSummary}` : ""}
        </div>
      ) : null}
      {bulkSms === "disabled" ? (
        <div className="px-6 py-2 bg-hot/10 border-b border-hot/30 text-sm font-sans font-medium text-hot" role="alert">
          Bulk text not sent — text messaging is turned off for this workspace.
        </div>
      ) : null}
      {bulkSms === "quiet" ? (
        <div className="px-6 py-2 bg-warm/10 border-b border-warm/30 text-sm font-sans font-medium text-warm" role="alert">
          Bulk text not sent — outside quiet hours ({quietHoursLabel}).
        </div>
      ) : null}
      {bulkSms === "error" ? (
        <div className="px-6 py-2 bg-hot/10 border-b border-hot/30 text-sm font-sans font-medium text-hot" role="alert">
          Could not send the bulk text — please try again.
        </div>
      ) : null}
      {denied === "reports" ? (
        <div className="px-6 py-2 bg-hot/10 border-b border-hot/30 text-sm font-sans font-medium text-hot" role="status">
          Reports are available to workspace owners only.
        </div>
      ) : null}

      <div className="flex flex-col h-full">
          {/* KPI band */}
          <div className="px-6 py-3 border-b border-border bg-panel shrink-0 space-y-3">
            {loadError ? <LoadErrorBanner message={loadError} /> : null}
            {queueTruncatedMessage ? <TruncationBanner message={queueTruncatedMessage} /> : null}
            <ArKpiBand kpis={arKpis} isOwner={isOwner} />
            <KpiBand metrics={metrics} view={view} sort={sort} search={q} entity={hrefEntity} density={hrefDensity} scopeLabel={scopeLabel} clearHref={clearHref} lastContactTruncated={lastContactTruncated || !!loadError} />
          </div>

          {/* Triage strip — top-3 actionable cases */}
          <TriageStrip items={items} view={view} sort={sort} search={q} entity={hrefEntity} density={hrefDensity} timeZone={timeZone} />

          {/* Workspace: queue full-width until a case is selected; md+ two-pane, <md detail fills */}
          <div className="flex flex-1 overflow-hidden">
            {/* Work queue — left pane (CSS-hidden below md while a case is open; stays mounted) */}
            <div className={queuePaneClass(isMobileCaseOpen(selected))}>
              <WorkQueue
                items={items}
                invoiceItems={invoiceItems}
                entity={entity}
                view={view}
                sort={sort}
                search={q}
                density={density}
                densityFromUrl={densityFromUrl}
                tab={tab}
                invoice={invoice}
                selectedCaseId={selected?.caseId ?? null}
                selectedInvoiceId={invoice ?? null}
                totalCount={entity === "invoices" && view !== "coming-due" ? invoiceViewCounts["all-open"] : viewCounts["all-open"]}
                viewCounts={entity === "invoices" && view !== "coming-due" ? invoiceViewCounts : viewCounts}
                roster={roster}
                returnTo={`/dashboard${dashboardHref({ view, sort, q: q || undefined, entity: hrefEntity, density: hrefDensity })}`}
                collisions={collisions}
                smsEnabled={smsEnabled}
                smsQuietNow={smsQuietNow}
                quietHoursLabel={quietHoursLabel}
                comingDueGroups={comingDueGroups}
                comingDueDays={comingDueDays}
                smsTemplates={smsTemplates}
                orgCompany={orgCompany}
                orgPhone={orgPhone}
                orgPaymentLink={orgPaymentLink}
                maxBatch={maxBatch}
                connected={connected}
                timeZone={timeZone}
              />
            </div>

            {/* Detail panel — full-width below md; fixed two-pane width at md+ */}
            {selected ? (
              <div className={detailPaneClass()}>
                <DetailPanel
                  selected={selected ?? null}
                  repInvoiceId={repInvoiceId ?? null}
                  workspaceInvoices={workspaceInvoices}
                  selectedInvoiceId={invoice}
                  activeTab={tab === "activity" ? "overview" : tab}
                  timeline={selectedTimeline}
                  messages={selectedMessages}
                  consent={selectedConsent}
                  smsConsentSource={selectedSmsConsentSource}
                  isOwner={isOwner}
                  prefs={selectedPrefs}
                  phone={selectedPhone}
                  selectedPromiseId={selectedPromiseId}
                  roster={roster}
                  sms={sms}
                  smsEnabled={smsEnabled}
                  smsQuietNow={smsQuietNow}
                  quietHoursLabel={quietHoursLabel}
                  emailEnabled={emailEnabled}
                  emailMessages={emailMessages}
                  customerEmail={customerEmail}
                  promiseError={promiseError}
                  view={view}
                  sort={sort}
                  q={q}
                  entity={hrefEntity}
                  density={hrefDensity}
                  collision={selected ? (collisions[selected.caseId] ?? null) : null}
                  smsTemplates={smsTemplates}
                  emailTemplates={emailTemplates}
                  orgCompany={orgCompany}
                  orgPhone={orgPhone}
                  orgPaymentLink={orgPaymentLink}
                  today={today}
                  timeZone={timeZone}
                />
              </div>
            ) : null}
          </div>

          {log && selected ? (
            <LogContactDrawer
              key={selected.caseId}
              selected={selected}
              repInvoiceId={repInvoiceId ?? null}
              invoices={workspaceInvoices}
              returnTo={`/dashboard${dashboardHref({ view, sort, q: q || undefined, entity: hrefEntity, density: hrefDensity, case: selected.caseId, tab, invoice: invoice ?? undefined })}`}
              logError={logError}
              collision={collisions[selected.caseId] ?? null}
              method={logMethod}
            />
          ) : null}
          {prefsOpen && selected ? (
            <CommPrefsDrawer
              key={selected.caseId}
              customerName={selected.customerName}
              caseId={selected.caseId}
              repInvoiceId={repInvoiceId ?? null}
              prefs={selectedPrefs}
              returnTo={`/dashboard${dashboardHref({ view, sort, q: q || undefined, entity: hrefEntity, density: hrefDensity, case: selected.caseId, tab, invoice: invoice ?? undefined })}`}
              closeHref={dashboardHref({ view, sort, q: q || undefined, entity: hrefEntity, density: hrefDensity, case: selected.caseId, tab, invoice: invoice ?? undefined })}
            />
          ) : null}
        </div>
    </AppShell>
  );
}
