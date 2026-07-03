import { useLoaderData, redirect, data, Link, type LoaderFunctionArgs } from "react-router";
import { useFlashCleanup } from "../lib/use-flash-cleanup";
import { getEnv } from "../lib/env.server";
import { requireOrgUser } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { loadCaseQueueSource } from "../lib/case-queue.server";
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
  type CaseItem, type CaseRow, type CaseStatus, type NextActionType,
  type CasePromiseInput, type CaseLastContactInput,
} from "../lib/cases";
import type { PriorityOverrideLevel } from "../lib/priority";
import type { ExceptionReason } from "../lib/contact-log";
import { AppShell } from "../components/AppShell";
import { KpiBand } from "../components/KpiBand";
import { TriageStrip } from "../components/TriageStrip";
import { WorkQueue } from "../components/WorkQueue";
import { DetailPanel } from "../components/DetailPanel";
import { LogContactDrawer } from "../components/LogContactDrawer";
import { CommPrefsDrawer } from "../components/CommPrefsDrawer";
import { buildTimeline, type TimelineEntry, type TimelineLogInput, type TimelineSmsInput } from "~/lib/timeline";
import { collisionState, type Collision } from "../lib/collision";
import { resolveCommPrefs, DEFAULT_COMM_PREFS, type CommPrefs } from "../lib/comm-prefs";
import type { OrgConfig } from "../lib/org-config";
import { resolveEmailSettings } from "../lib/email-settings";
import { plural } from "../lib/labels";
import { pageTitle } from "../lib/meta";
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
  metrics: Metrics;
  viewCounts: Record<ViewId, number>;
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
): DashboardData {
  const { view, sort, q, caseId } = params;
  const highValue = config.priority.highValue;
  const allItems = buildCaseItems(cases, invoices, customers, lastContacts, promises, today, ownerLabels, config);
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

  const viewCounts = Object.fromEntries(
    ALL_VIEWS.map((v) => {
      if (v === "coming-due") return [v, filteredComingDue.length];
      return [v, applyCaseView(searched, v, today, currentUserId, highValue).length];
    }),
  ) as Record<ViewId, number>;
  const items = sortCaseItems(applyCaseView(searched, view, today, currentUserId, highValue), sort);
  const selected = caseId != null ? (searched.find((i) => i.caseId === caseId) ?? null) : null;
  return { items, metrics, viewCounts, selected, comingDueGroups: filteredComingDue };
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

  // User initials from display name or email
  const userLabel = displayLabel(user.user_metadata?.display_name, user.email, user.id);
  const initials = initialsFrom(userLabel);

  const today = new Date().toISOString().slice(0, 10);

  // Service client for connection-status + roster (no RLS needed)
  const service = createSupabaseServiceClient(env);

  // Batch A: shared queue source + dashboard-only queries in parallel.
  // Disconnected orgs pay a few wasted queries (redirect gate runs right
  // after this batch settles) — acceptable, same as the pre-extraction behaviour.
  const [
    src,
    { data: orgRow },
    conn,
    { data: connMeta },
    { data: ecfg },
  ] = await Promise.all([
    loadCaseQueueSource({
      supabase, service, orgId: org.org_id, today, includePresence: true,
    }),
    supabase.from("organizations").select("name").eq("id", org.org_id).single(),
    getConnectionStatus(service, org.org_id),
    service.from("qbo_connections").select("last_sync_at").eq("org_id", org.org_id).maybeSingle(),
    supabase.from("email_config").select("email_enabled").eq("org_id", org.org_id).maybeSingle(),
  ]);

  const connected = conn?.status === "connected";
  if (!connected) throw redirect("/settings?tab=integrations", { headers });

  // Sync label from last_sync_at (connected is guaranteed true here — redirect above)
  const lastSyncAt = (connMeta?.last_sync_at as string | null) ?? null;
  let syncLabel: string;
  if (lastSyncAt) {
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
  const VALID_SORTS: SortId[] = ["recommended", "most-overdue", "highest-balance", "customer"];
  const VALID_TABS = ["overview", "activity", "messages", "email"] as const;

  const rawView = sp.get("view") ?? "";
  const rawSort = sp.get("sort") ?? "";
  const rawTab = sp.get("tab") ?? "";

  const view: ViewId = VALID_VIEWS.includes(rawView as ViewId) ? (rawView as ViewId) : "all-open";
  const sort: SortId = VALID_SORTS.includes(rawSort as SortId) ? (rawSort as SortId) : "recommended";
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
  const denied = sp.get("denied");

  let selectedTimeline: TimelineEntry[] = [];
  let selectedMessages: MessageEntry[] = [];
  let selectedConsent = false;
  let selectedPhone: string | null = null;
  let selectedPrefs: CommPrefs = DEFAULT_COMM_PREFS;
  let selectedRepInvoiceId: string | null = null;
  let selectedPromiseId: string | null = null;
  let collisions: Record<string, Collision> = {};
  let selectedEmailMessages: EmailMessageEntry[] = [];
  let selectedCustomerEmail: string | null = null;

  // Destructure the shared queue source
  const {
    cases, invoicesInput, comingDueInvoices, customersInput,
    lastContactsInput, promisesInput, recentByCase, presenceRows,
    roster, ownerLabels, orgConfig, smsEnabled, templates,
  } = src;

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

  const dashboardData: DashboardData = buildCaseData(
    cases, invoicesInput, customersInput, lastContactsInput, promisesInput,
    { view, sort, q, caseId, invoice, tab }, today, ownerLabels, user.id, orgConfig,
    comingDueInvoices,
  );

  const sel = dashboardData.selected;
  if (sel) {
    const customerId = sel.customerId;
    const repInvoiceId =
      (invoice && sel.invoices.some((iv) => iv.invoiceId === invoice))
        ? invoice
        : (sel.invoices[0]?.invoiceId ?? null);

    // Batch C: the 5 selected-case queries.
    const [
      { data: actRows },
      { data: msgRows },
      { data: custRow },
      { data: ap },
      { data: emailMsgRows },
    ] = await Promise.all([
      supabase
        .from("contact_logs")
        .select("id, user_id, method, outcome, notes, created_at, follow_up_at, promised_amount, promised_date")
        .eq("org_id", org.org_id)
        .eq("case_id", sel.caseId)
        .order("created_at", { ascending: false }),
      supabase
        .from("text_messages")
        .select("id, case_id, direction, body, status, error_code, created_at")
        .eq("org_id", org.org_id)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: true }),
      supabase
        .from("customers").select("phone, email, sms_consent, preferred_channel, do_not_call, do_not_text, do_not_email").eq("id", customerId).maybeSingle(),
      supabase
        .from("promises").select("id").eq("org_id", org.org_id).eq("case_id", sel.caseId).eq("status", "pending").maybeSingle(),
      supabase
        .from("email_messages")
        .select("id, direction, subject, body, status, error_code, created_at")
        .eq("org_id", org.org_id)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: true }),
    ]);

    // Activity: contact logs for the case (timeline input).
    const logInputs: TimelineLogInput[] = ((actRows as unknown as (ContactLogRow & { user_id: string | null })[]) ?? []).map((r) => ({
      id: r.id, at: r.created_at, method: r.method, outcome: r.outcome, notes: r.notes,
      followUpAt: r.follow_up_at,
      promisedAmount: r.promised_amount == null ? null : Number(r.promised_amount),
      promisedDate: r.promised_date,
      authorLabel: r.user_id ? (ownerLabels.get(r.user_id) ?? null) : null,
    }));

    // Messages: thread by CUSTOMER (one conversation per customer); also carries
    // case_id so we can derive the per-case slice for the timeline.
    const msgRowsTyped = (msgRows as unknown as (SelectedMessageRow & { case_id: string | null })[]) ?? [];
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

    // Consent + phone + email prefs from the customer.
    selectedConsent = (custRow as any)?.sms_consent ?? false;
    selectedPhone = (custRow as any)?.phone ?? null;
    selectedPrefs = resolveCommPrefs(custRow as any);
    selectedCustomerEmail = (custRow as any)?.email ?? null;
    selectedRepInvoiceId = repInvoiceId;

    // Active pending promise id for the cancel form
    selectedPromiseId = ap?.id ?? null;

    // Email thread: per-customer conversation (mirrors SMS thread above).
    selectedEmailMessages = ((emailMsgRows as any[]) ?? []).map((r) => ({
      id: r.id as string,
      direction: r.direction as string,
      subject: (r.subject as string | null) ?? null,
      body: (r.body as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      errorCode: (r.error_code as string | null) ?? null,
      createdAt: r.created_at as string,
    }));
  }

  return data(
    {
      orgName: orgRow?.name ?? "(unknown)",
      userInitials: initials,
      isOwner: org.role === "owner",
      connected,
      syncLabel,
      view,
      sort,
      q,
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
      selectedPhone,
      selectedPrefs,
      selectedPromiseId,
      sms,
      smsEnabled,
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
    isOwner,
    connected,
    syncLabel,
    view,
    sort,
    q,
    tab,
    log,
    logMethod,
    logError,
    promiseError,
    selectedTimeline,
    selectedMessages,
    selectedConsent,
    selectedPhone,
    selectedPrefs,
    selectedPromiseId,
    sms,
    smsEnabled,
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
    denied,
    roster,
    collisions,
    items,
    metrics,
    viewCounts,
    selected,
    comingDueGroups,
    repInvoiceId,
    smsTemplates,
    emailTemplates,
    orgCompany,
    orgPhone,
    orgPaymentLink,
    maxBatch,
  } = useLoaderData<typeof loader>();

  useFlashCleanup();

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
  const clearHref = isFiltered ? "?view=all-open&sort=" + sort : undefined;

  return (
    <AppShell
      orgName={orgName}
      userInitials={userInitials}
      syncLabel={syncLabel}
      connected={connected}
      isOwner={isOwner}
      activeNav="collections"
      headerActions={
        <Link
          to="/focus"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded border border-copper/40 text-copper text-[11px] font-sans font-semibold hover:bg-copper/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          Focus mode
        </Link>
      }
    >
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
          Sent {bulkSent ?? "0"} · Failed {bulkFailed ?? "0"} · Skipped {bulkSkipped ?? "0"}.
        </div>
      ) : null}
      {bulkSms === "disabled" ? (
        <div className="px-6 py-2 bg-hot/10 border-b border-hot/30 text-sm font-sans font-medium text-hot" role="alert">
          Bulk text not sent — text messaging is turned off for this workspace.
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
          <div className="px-6 py-3 border-b border-border bg-panel shrink-0">
            <KpiBand metrics={metrics} view={view} sort={sort} search={q} scopeLabel={scopeLabel} clearHref={clearHref} />
          </div>

          {/* Triage strip — top-3 actionable cases */}
          <TriageStrip items={items} view={view} sort={sort} search={q} />

          {/* Workspace: queue full-width until a case is selected, then two-pane */}
          <div className="flex flex-1 overflow-hidden">
            {/* Work queue — left pane */}
            <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
              <WorkQueue
                items={items}
                view={view}
                sort={sort}
                search={q}
                selectedCaseId={selected?.caseId ?? null}
                totalCount={viewCounts["all-open"]}
                viewCounts={viewCounts}
                roster={roster}
                returnTo={`/dashboard?${new URLSearchParams({ view, sort, ...(q ? { q } : {}) }).toString()}`}
                collisions={collisions}
                smsEnabled={smsEnabled}
                comingDueGroups={comingDueGroups}
                smsTemplates={smsTemplates}
                orgCompany={orgCompany}
                orgPhone={orgPhone}
                orgPaymentLink={orgPaymentLink}
                maxBatch={maxBatch}
              />
            </div>

            {/* Detail panel — slide-in right pane, mounted only when a case is selected */}
            {selected ? (
              <div className="w-96 xl:w-[28rem] shrink-0 overflow-hidden border-l border-border shadow-panel">
                <DetailPanel
                  selected={selected ?? null}
                  repInvoiceId={repInvoiceId ?? null}
                  activeTab={tab}
                  timeline={selectedTimeline}
                  messages={selectedMessages}
                  consent={selectedConsent}
                  prefs={selectedPrefs}
                  phone={selectedPhone}
                  selectedPromiseId={selectedPromiseId}
                  roster={roster}
                  sms={sms}
                  smsEnabled={smsEnabled}
                  emailEnabled={emailEnabled}
                  emailMessages={emailMessages}
                  customerEmail={customerEmail}
                  promiseError={promiseError}
                  view={view}
                  sort={sort}
                  q={q}
                  collision={selected ? (collisions[selected.caseId] ?? null) : null}
                  smsTemplates={smsTemplates}
                  emailTemplates={emailTemplates}
                  orgCompany={orgCompany}
                  orgPhone={orgPhone}
                  orgPaymentLink={orgPaymentLink}
                />
              </div>
            ) : null}
          </div>

          {log && selected ? (
            <LogContactDrawer
              key={selected.caseId}
              selected={selected}
              repInvoiceId={repInvoiceId ?? null}
              returnTo={`/dashboard?${new URLSearchParams({ case: selected.caseId, tab, view, sort, ...(q ? { q } : {}) }).toString()}`}
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
              returnTo={`/dashboard?${new URLSearchParams({ case: selected.caseId, tab, view, sort, ...(q ? { q } : {}) }).toString()}`}
              closeHref={`?${new URLSearchParams({ case: selected.caseId, tab, view, sort, ...(q ? { q } : {}) }).toString()}`}
            />
          ) : null}
        </div>
    </AppShell>
  );
}
