import { useLoaderData, redirect, data, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { listOrgMembers, type OrgMember } from "../lib/orgs.server";
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
import { MetricsStrip } from "../components/MetricsStrip";
import { WorkQueue } from "../components/WorkQueue";
import { DetailPanel } from "../components/DetailPanel";
import { LogContactDrawer } from "../components/LogContactDrawer";
import { CommPrefsDrawer } from "../components/CommPrefsDrawer";
import { buildTimeline, type TimelineEntry, type TimelineLogInput, type TimelineSmsInput } from "~/lib/timeline";
import { collisionState, type Collision, type RecentContactInput } from "../lib/collision";
import { readPresence } from "../lib/presence.server";
import { loadOrgConfig } from "../lib/org-config.server";
import { DEFAULT_ORG_CONFIG, type OrgConfig } from "../lib/org-config";
import { resolveCommPrefs, DEFAULT_COMM_PREFS, type CommPrefs } from "../lib/comm-prefs";
import { resolveChannelSettings } from "../lib/channel-settings";
import { resolveEmailSettings } from "../lib/email-settings";

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
};

const ALL_VIEWS: ViewId[] = ["all-open", "30-plus", "high-value", "never-contacted", "follow-ups-due", "broken-promises", "waiting", "on-hold", "my-work"];

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
): DashboardData {
  const { view, sort, q, caseId } = params;
  const allItems = buildCaseItems(cases, invoices, customers, lastContacts, promises, today, ownerLabels, config);
  const searched = q.trim() === "" ? allItems : allItems.filter((i) => i.searchText.includes(q.toLowerCase()));
  const metrics = computeCaseMetrics(searched, today);
  const viewCounts = Object.fromEntries(
    ALL_VIEWS.map((v) => [v, applyCaseView(searched, v, today, currentUserId).length]),
  ) as Record<ViewId, number>;
  const items = sortCaseItems(applyCaseView(searched, view, today, currentUserId), sort);
  const selected = caseId != null ? (searched.find((i) => i.caseId === caseId) ?? null) : null;
  return { items, metrics, viewCounts, selected };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

// Supabase row shapes returned by the invoice+customer embed query
type InvoiceRow = {
  id: string;
  qbo_doc_number: string | null;
  balance: number | string | null;
  due_date: string | null;
  customer_id: string | null;
  customers: { name: string | null; phone: string | null; email: string | null; owner: string | null; sms_consent: boolean | null; preferred_channel: string | null; do_not_call: boolean | null; do_not_text: boolean | null } | null;
};

type TextMessageRow = {
  invoice_id: string;
  created_at: string;
};

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


type CaseRowRaw = {
  id: string;
  customer_id: string;
  status: string;
  next_action_type: string | null;
  next_action_at: string | null;
  opened_at: string;
  exception_reason: string | null;
  exception_note: string | null;
  priority_override: string | null;
  priority_override_reason: string | null;
  priority_override_by: string | null;
  priority_override_at: string | null;
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
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  // Org name
  const { data: orgRow } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", org.org_id)
    .single();

  // User initials from email
  const emailParts = (user.email ?? "").split("@")[0].split(/[.\-_]/);
  const initials = emailParts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

  // Connection status — service client only (no RLS needed for own org's connection)
  const service = createSupabaseServiceClient(env);
  const conn = await getConnectionStatus(service, org.org_id);
  const connected = conn?.status === "connected";
  if (!connected) throw redirect("/settings", { headers });

  // Sync label from last_sync_at (connected is guaranteed true here — redirect above)
  const { data: connMeta } = await service
    .from("qbo_connections")
    .select("last_sync_at")
    .eq("org_id", org.org_id)
    .maybeSingle();
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

  const VALID_VIEWS: ViewId[] = ["all-open", "30-plus", "high-value", "never-contacted", "follow-ups-due", "broken-promises", "waiting", "on-hold", "my-work"];
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

  const today = new Date().toISOString().slice(0, 10);

  let selectedTimeline: TimelineEntry[] = [];
  let selectedMessages: MessageEntry[] = [];
  let selectedConsent = false;
  let selectedPhone: string | null = null;
  let selectedPrefs: CommPrefs = DEFAULT_COMM_PREFS;
  let selectedRepInvoiceId: string | null = null;
  let selectedPromiseId: string | null = null;
  let roster: OrgMember[] = [];
  let collisions: Record<string, Collision> = {};
  let smsEnabled = true;
  let emailEnabled = false;
  let selectedEmailMessages: EmailMessageEntry[] = [];
  let selectedCustomerEmail: string | null = null;
  let dashboardData: DashboardData = {
    items: [],
    metrics: {
      thirtyPlus: { count: 0, amount: 0 },
      highValue: { count: 0, amount: 0 },
      neverContacted: { count: 0, amount: 0 },
      allOpen: { count: 0, amount: 0 },
      followUpsDue: { count: 0, amount: 0 },
      brokenPromises: { count: 0, amount: 0 },
      onHold: { count: 0, amount: 0 },
    },
    viewCounts: {
      "all-open": 0, "30-plus": 0, "high-value": 0,
      "never-contacted": 0, "follow-ups-due": 0, "broken-promises": 0, "waiting": 0, "on-hold": 0, "my-work": 0,
    },
    selected: null,
  };

  if (connected) {
    // RLS-scoped invoice read (USER client)
    const { data: invRows } = await supabase
      .from("invoices")
      .select("id, qbo_doc_number, balance, due_date, customer_id, customers(name, phone, email, owner, sms_consent, preferred_channel, do_not_call, do_not_text)")
      .eq("org_id", org.org_id)
      .gt("balance", 0)
      .lt("due_date", today);

    const rawInvoices = (invRows as unknown as InvoiceRow[]) ?? [];

    // Build InvoiceInput arrays
    const invoicesInput: InvoiceInput[] = rawInvoices.map((r) => ({
      id: r.id,
      qbo_doc_number: r.qbo_doc_number,
      customer_id: r.customer_id,
      balance: Number(r.balance ?? 0),
      due_date: r.due_date,
    }));

    // Deduplicate customers from the embedded rows
    const customerMap = new Map<string, CustomerInput>();
    for (const r of rawInvoices) {
      if (r.customer_id && r.customers && !customerMap.has(r.customer_id)) {
        customerMap.set(r.customer_id, {
          id: r.customer_id,
          name: r.customers.name ?? "(unknown customer)",
          phone: r.customers.phone ?? null,
          email: r.customers.email ?? null,
          owner: r.customers.owner ?? null,
          smsConsent: r.customers.sms_consent ?? false,
          commPrefs: resolveCommPrefs(r.customers),
        });
      }
    }
    const customersInput: CustomerInput[] = [...customerMap.values()];

    // Load open cases (USER client)
    const { data: caseRows } = await supabase
      .from("collection_cases")
      .select("id, customer_id, status, next_action_type, next_action_at, opened_at, exception_reason, exception_note, priority_override, priority_override_reason, priority_override_by, priority_override_at")
      .eq("org_id", org.org_id)
      .is("closed_at", null);
    const cases: CaseRow[] = ((caseRows as CaseRowRaw[]) ?? []).map((r) => ({
      id: r.id, customerId: r.customer_id, status: r.status as CaseStatus,
      nextActionType: r.next_action_type as NextActionType | null, nextActionAt: r.next_action_at,
      exceptionReason: r.exception_reason as ExceptionReason | null, exceptionNote: r.exception_note,
      priorityOverride: (r.priority_override as PriorityOverrideLevel | null) ?? null,
      priorityOverrideReason: r.priority_override_reason,
      priorityOverrideBy: r.priority_override_by,
      priorityOverrideAt: r.priority_override_at,
    }));

    // Per-case last contact: contact_logs and outbound texts are both keyed by
    // case_id, so we can read both by case_id directly — no customer mapping needed.
    const caseIds = cases.map((c) => c.id);
    const lastContactsInput: CaseLastContactInput[] = [];
    const recentByCase = new Map<string, RecentContactInput[]>();
    const pushRecent = (caseId: string, userId: string | null, at: string) => {
      const list = recentByCase.get(caseId) ?? [];
      list.push({ userId, at });
      recentByCase.set(caseId, list);
    };
    if (caseIds.length > 0) {
      const { data: logRows } = await supabase
        .from("contact_logs")
        .select("case_id, method, created_at, user_id")
        .eq("org_id", org.org_id).in("case_id", caseIds)
        .order("created_at", { ascending: false });
      const methodLabel: Record<string, string> = { call: "Call", email: "Email", text: "Text", note: "Note" };
      for (const r of (logRows as any[]) ?? []) {
        if (r.case_id) {
          lastContactsInput.push({ caseId: r.case_id, date: r.created_at, channel: methodLabel[r.method] ?? "Note" });
          pushRecent(r.case_id, r.user_id ?? null, r.created_at);
        }
      }
      // Outbound texts now carry case_id (stamped at send time, 7c), so key on it
      // directly — no customer mapping / opened_at window needed.
      const { data: msgRows } = await supabase
        .from("text_messages")
        .select("case_id, created_at, sent_by_user_id")
        .eq("org_id", org.org_id).in("case_id", caseIds).eq("direction", "outbound")
        .order("created_at", { ascending: false });
      for (const r of (msgRows as any[]) ?? []) {
        if (r.case_id) {
          lastContactsInput.push({ caseId: r.case_id, date: r.created_at, channel: "Text" });
          pushRecent(r.case_id, r.sent_by_user_id ?? null, r.created_at);
        }
      }
    }

    // Active promise per open case (pending preferred, else most-recent non-cancelled).
    const promisesInput: CasePromiseInput[] = [];
    if (caseIds.length > 0) {
      const { data: promRows } = await supabase
        .from("promises")
        .select("case_id, status, promised_amount, promised_date, amount_received, created_at")
        .eq("org_id", org.org_id).in("case_id", caseIds)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });
      const seen = new Set<string>();
      const pendingFirst = [...((promRows as any[]) ?? [])].sort((a, b) =>
        (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1));
      for (const r of pendingFirst) {
        if (seen.has(r.case_id)) continue;
        seen.add(r.case_id);
        promisesInput.push({
          caseId: r.case_id, status: r.status, promisedAmount: Number(r.promised_amount) || 0,
          promisedDate: r.promised_date, amountReceived: Number(r.amount_received) || 0,
        });
      }
    }

    roster = await listOrgMembers(service, org.org_id);
    const ownerLabels = new Map(roster.map((m) => [m.userId, m.label]));

    // Presence (C1): advisory. Degrade to empty on error — never throw the loader.
    const presenceCustomerIds = [...new Set(cases.map((c) => c.customerId))];
    let presenceRows: { customer_id: string; user_id: string; last_seen_at: string }[] = [];
    try {
      presenceRows = await readPresence(supabase, { orgId: org.org_id, customerIds: presenceCustomerIds });
    } catch (e) {
      console.error("presence read failed (degrading to no presence):", e);
      presenceRows = [];
    }
    const presenceByCustomer = new Map<string, { userId: string; lastSeenAt: string }[]>();
    for (const r of presenceRows) {
      const list = presenceByCustomer.get(r.customer_id) ?? [];
      list.push({ userId: r.user_id, lastSeenAt: r.last_seen_at });
      presenceByCustomer.set(r.customer_id, list);
    }

    // Per-case collision (self-excluded). Plain object so it serializes over the loader.
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

    let orgConfig;
    try {
      orgConfig = await loadOrgConfig(supabase, org.org_id);
    } catch {
      orgConfig = DEFAULT_ORG_CONFIG;
    }

    const { data: mcfg } = await supabase.from("messaging_config")
      .select("sms_enabled").eq("org_id", org.org_id).maybeSingle();
    smsEnabled = resolveChannelSettings(mcfg as { sms_enabled?: boolean | null } | null).smsEnabled;

    const { data: ecfg } = await supabase.from("email_config")
      .select("email_enabled").eq("org_id", org.org_id).maybeSingle();
    emailEnabled = resolveEmailSettings(ecfg as any).emailEnabled;

    dashboardData = buildCaseData(
      cases, invoicesInput, customersInput, lastContactsInput, promisesInput,
      { view, sort, q, caseId, invoice, tab }, today, ownerLabels, user.id, orgConfig,
    );

    const sel = dashboardData.selected;
    if (sel) {
      const customerId = sel.customerId;
      const repInvoiceId =
        (invoice && sel.invoices.some((iv) => iv.invoiceId === invoice))
          ? invoice
          : (sel.invoices[0]?.invoiceId ?? null);

      // Activity: contact logs for the case (timeline input).
      const { data: actRows } = await supabase
        .from("contact_logs")
        .select("id, method, outcome, notes, created_at, follow_up_at, promised_amount, promised_date")
        .eq("org_id", org.org_id)
        .eq("case_id", sel.caseId)
        .order("created_at", { ascending: false });
      const logInputs: TimelineLogInput[] = ((actRows as unknown as ContactLogRow[]) ?? []).map((r) => ({
        id: r.id, at: r.created_at, method: r.method, outcome: r.outcome, notes: r.notes,
        followUpAt: r.follow_up_at,
        promisedAmount: r.promised_amount == null ? null : Number(r.promised_amount),
        promisedDate: r.promised_date,
      }));

      // Messages: thread by CUSTOMER (one conversation per customer); also carries
      // case_id so we can derive the per-case slice for the timeline.
      const { data: msgRows } = await supabase
        .from("text_messages")
        .select("id, case_id, direction, body, status, error_code, created_at")
        .eq("org_id", org.org_id)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: true });
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
      const { data: custRow } = await supabase
        .from("customers").select("phone, email, sms_consent, preferred_channel, do_not_call, do_not_text, do_not_email").eq("id", customerId).maybeSingle();
      selectedConsent = (custRow as any)?.sms_consent ?? false;
      selectedPhone = (custRow as any)?.phone ?? null;
      selectedPrefs = resolveCommPrefs(custRow as any);
      selectedCustomerEmail = (custRow as any)?.email ?? null;
      selectedRepInvoiceId = repInvoiceId;

      // Active pending promise id for the cancel form
      const { data: ap } = await supabase
        .from("promises").select("id").eq("org_id", org.org_id).eq("case_id", sel.caseId).eq("status", "pending").maybeSingle();
      selectedPromiseId = ap?.id ?? null;

      // Email thread: per-customer conversation (mirrors SMS thread above).
      const { data: emailMsgRows } = await supabase
        .from("email_messages")
        .select("id, direction, subject, body, status, error_code, created_at")
        .eq("org_id", org.org_id)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: true });
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
      roster,
      collisions,
      currentUserId: user.id,
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
    roster,
    collisions,
    items,
    metrics,
    viewCounts,
    selected,
    repInvoiceId,
  } = useLoaderData<typeof loader>();


  return (
    <AppShell
      orgName={orgName}
      userInitials={userInitials}
      syncLabel={syncLabel}
      connected={connected}
      isOwner={isOwner}
      activeNav="collections"
    >
      {saved ? (
        <div className="px-6 py-2 bg-cool/10 border-b border-cool/30 text-sm font-sans font-medium text-cool" role="status">
          Contact logged successfully.
        </div>
      ) : null}
      {bulkAssign === "done" ? (
        <div className="px-6 py-2 bg-cool/10 border-b border-cool/30 text-sm font-sans font-medium text-cool" role="status">
          Reassigned {bulkAssignCount ?? "0"} account(s).
        </div>
      ) : null}
      {bulkSms === "done" ? (
        <div className="px-6 py-2 bg-cool/10 border-b border-cool/30 text-sm font-sans font-medium text-cool" role="status">
          Sent {bulkSent ?? "0"} · Failed {bulkFailed ?? "0"} · Skipped {bulkSkipped ?? "0"}.
        </div>
      ) : null}
      {bulkSms === "disabled" ? (
        <div className="px-6 py-2 bg-hot/10 border-b border-hot/30 text-sm font-sans font-medium text-hot" role="status">
          Bulk text not sent — text messaging is turned off for this workspace.
        </div>
      ) : null}
      {bulkSms === "error" ? (
        <div className="px-6 py-2 bg-hot/10 border-b border-hot/30 text-sm font-sans font-medium text-hot" role="status">
          Could not send the bulk text — please try again.
        </div>
      ) : null}

      <div className="flex flex-col h-full">
          {/* Metrics strip */}
          <div className="px-6 py-3 border-b border-border bg-panel shrink-0">
            <MetricsStrip metrics={metrics} view={view} sort={sort} search={q} />
          </div>

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
