// Shared data-fetching for the case work queue. Used by both the /dashboard
// loader and /focus loader. All queries use the RLS-scoped user client except
// for listOrgMembers (service client) and readPresence.
//
// Nothing dashboard-specific (URL params, selected-case detail, collision
// assembly, coming-due groups) belongs here — keep it in the route loaders.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceInput, CustomerInput } from "./worklist";
import type {
  CaseRow, CaseStatus, NextActionType,
  CasePromiseInput, CaseLastContactInput,
} from "./cases";
import type { PriorityOverrideLevel } from "./priority";
import type { ExceptionReason } from "./contact-log";
import type { OrgConfig } from "./org-config";
import { DEFAULT_ORG_CONFIG } from "./org-config";
import { listOrgMembers, type OrgMember } from "./orgs.server";
import { loadOrgConfig } from "./org-config.server";
import { resolveCommPrefs } from "./comm-prefs";
import { resolveChannelSettings } from "./channel-settings";
import { isWithinSendWindow, quietHoursWindowLabel } from "./quiet-hours";
import { readPresence } from "./presence.server";
import type { RecentContactInput } from "./collision";
import { loadTemplates } from "./message-templates.server";
import { resolveTemplates, type OrgTemplates } from "./message-templates";

// ---------------------------------------------------------------------------
// Row shapes returned by the Supabase queries (internal)
// ---------------------------------------------------------------------------

type InvoiceRow = {
  id: string;
  qbo_doc_number: string | null;
  balance: number | string | null;
  due_date: string | null;
  customer_id: string | null;
  customers: {
    name: string | null;
    phone: string | null;
    email: string | null;
    owner: string | null;
    sms_consent: boolean | null;
    preferred_channel: string | null;
    do_not_call: boolean | null;
    do_not_text: boolean | null;
  } | null;
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

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CaseQueueSource = {
  cases: CaseRow[];
  /** Overdue invoices (due_date < today) — feeds buildCaseItems / totalOverdue. */
  invoicesInput: InvoiceInput[];
  /** Non-overdue invoices (due_date >= today) — awareness only (coming-due groups). */
  comingDueInvoices: InvoiceInput[];
  customersInput: CustomerInput[];
  lastContactsInput: CaseLastContactInput[];
  promisesInput: CasePromiseInput[];
  /** Per-case recent contacts (for collision detection). */
  recentByCase: Map<string, RecentContactInput[]>;
  /** Raw presence heartbeat rows. Empty when includePresence=false. */
  presenceRows: { customer_id: string; user_id: string; last_seen_at: string }[];
  roster: OrgMember[];
  ownerLabels: Map<string, string>;
  orgConfig: OrgConfig;
  smsEnabled: boolean;
  /** True when the org's SMS send window (quiet hours) currently excludes "now". */
  smsQuietNow: boolean;
  /** Human-readable send-window label, e.g. "8:00 AM – 9:00 PM", for the quiet-hours notice. */
  quietHoursLabel: string;
  templates: OrgTemplates;
};

export type LoadCaseQueueArgs = {
  supabase: SupabaseClient;
  service: SupabaseClient;
  orgId: string;
  today: string;
  /** When true, reads presence heartbeats (C1 collision detection). */
  includePresence: boolean;
  /**
   * Pre-loaded org config, when the caller already fetched it (e.g. to derive
   * org-local `today` via todayInTz before calling this function). Skips the
   * internal org_settings read when provided.
   */
  orgConfig?: OrgConfig;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function loadCaseQueueSource(args: LoadCaseQueueArgs): Promise<CaseQueueSource> {
  const { supabase, service, orgId, today, includePresence } = args;

  // Org config is loaded first (one org_settings read) because the invoice
  // query's lookahead window is sized from orgConfig.workflow.comingDueDays —
  // it must be known before the invoices query below can be built. Callers
  // that already loaded it (e.g. to derive org-local `today`) pass it through
  // to avoid a second org_settings read.
  const orgConfig = args.orgConfig ?? await loadOrgConfig(supabase, orgId).catch(() => DEFAULT_ORG_CONFIG);
  const plus7 = new Date(Date.now() + orgConfig.workflow.comingDueDays * 86_400_000).toISOString().slice(0, 10);

  // Stage 1 — everything that needs only orgId. PostgREST builders resolve
  // with { data, error } (never reject), so Promise.all won't short-circuit.
  const [
    { data: invRows },
    { data: caseRows },
    roster,
    { data: mcfg },
    templates,
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, qbo_doc_number, balance, due_date, customer_id, customers(name, phone, email, owner, sms_consent, preferred_channel, do_not_call, do_not_text)")
      .eq("org_id", orgId)
      .gt("balance", 0)
      .lte("due_date", plus7),
    supabase
      .from("collection_cases")
      .select("id, customer_id, status, next_action_type, next_action_at, opened_at, exception_reason, exception_note, priority_override, priority_override_reason, priority_override_by, priority_override_at")
      .eq("org_id", orgId)
      .is("closed_at", null),
    listOrgMembers(service, orgId).catch(() => [] as OrgMember[]),
    supabase.from("messaging_config").select("sms_enabled").eq("org_id", orgId).maybeSingle(),
    loadTemplates(supabase, orgId).catch(() => resolveTemplates([])),
  ]);

  // Map raw invoice rows → InvoiceInput, split overdue / coming-due.
  const rawInvoices = (invRows as unknown as InvoiceRow[]) ?? [];
  const allInvoicesInput: InvoiceInput[] = rawInvoices.map((r) => ({
    id: r.id,
    qbo_doc_number: r.qbo_doc_number,
    customer_id: r.customer_id,
    balance: Number(r.balance ?? 0),
    due_date: r.due_date,
  }));
  const invoicesInput = allInvoicesInput.filter((i) => i.due_date != null && i.due_date < today);
  const comingDueInvoices = allInvoicesInput.filter((i) => i.due_date != null && i.due_date >= today);

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

  // Map raw case rows → CaseRow (domain shape).
  const cases: CaseRow[] = ((caseRows as CaseRowRaw[]) ?? []).map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    status: r.status as CaseStatus,
    nextActionType: r.next_action_type as NextActionType | null,
    nextActionAt: r.next_action_at,
    exceptionReason: r.exception_reason as ExceptionReason | null,
    exceptionNote: r.exception_note,
    priorityOverride: (r.priority_override as PriorityOverrideLevel | null) ?? null,
    priorityOverrideReason: r.priority_override_reason,
    priorityOverrideBy: r.priority_override_by,
    priorityOverrideAt: r.priority_override_at,
  }));

  // Per-case last contact + collision-input maps.
  const caseIds = cases.map((c) => c.id);
  const lastContactsInput: CaseLastContactInput[] = [];
  const recentByCase = new Map<string, RecentContactInput[]>();
  const pushRecent = (caseId: string, userId: string | null, at: string) => {
    const list = recentByCase.get(caseId) ?? [];
    list.push({ userId, at });
    recentByCase.set(caseId, list);
  };

  const presenceCustomerIds = [...new Set(cases.map((c) => c.customerId))];
  const promisesInput: CasePromiseInput[] = [];
  let presenceRows: { customer_id: string; user_id: string; last_seen_at: string }[] = [];

  // Stage 2 — everything keyed on caseIds. Skipped when there are no open cases.
  if (caseIds.length > 0) {
    const [{ data: logRows }, { data: msgRows }, { data: promRows }, presenceResult] = await Promise.all([
      supabase
        .from("contact_logs")
        .select("case_id, method, created_at, user_id")
        .eq("org_id", orgId).in("case_id", caseIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("text_messages")
        .select("case_id, created_at, sent_by_user_id")
        .eq("org_id", orgId).in("case_id", caseIds).eq("direction", "outbound")
        .order("created_at", { ascending: false }),
      supabase
        .from("promises")
        .select("case_id, status, promised_amount, promised_date, amount_received, created_at")
        .eq("org_id", orgId).in("case_id", caseIds)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false }),
      includePresence
        ? readPresence(supabase, { orgId, customerIds: presenceCustomerIds }).catch((e) => {
            console.error("presence read failed (degrading to no presence):", e);
            return [];
          })
        : Promise.resolve([]),
    ]);

    const methodLabel: Record<string, string> = { call: "Call", email: "Email", text: "Text", note: "Note" };
    for (const r of (logRows as any[]) ?? []) {
      if (r.case_id) {
        lastContactsInput.push({ caseId: r.case_id, date: r.created_at, channel: methodLabel[r.method] ?? "Note" });
        pushRecent(r.case_id, r.user_id ?? null, r.created_at);
      }
    }
    for (const r of (msgRows as any[]) ?? []) {
      if (r.case_id) {
        lastContactsInput.push({ caseId: r.case_id, date: r.created_at, channel: "Text" });
        pushRecent(r.case_id, r.sent_by_user_id ?? null, r.created_at);
      }
    }

    // Active promise per open case (pending preferred, else most-recent non-cancelled).
    const seen = new Set<string>();
    const pendingFirst = [...((promRows as any[]) ?? [])].sort((a, b) =>
      (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1));
    for (const r of pendingFirst) {
      if (seen.has(r.case_id)) continue;
      seen.add(r.case_id);
      promisesInput.push({
        caseId: r.case_id,
        status: r.status,
        promisedAmount: Number(r.promised_amount) || 0,
        promisedDate: r.promised_date,
        amountReceived: Number(r.amount_received) || 0,
      });
    }

    presenceRows = presenceResult;
  }

  const ownerLabels = new Map(roster.map((m) => [m.userId, m.label]));
  const smsEnabled = resolveChannelSettings(mcfg as { sms_enabled?: boolean | null } | null).smsEnabled;
  const { startHour, endHour } = orgConfig.quietHours;
  const smsQuietNow = !isWithinSendWindow(new Date(), orgConfig.companyProfile.timezone, startHour, endHour);
  const quietHoursLabel = quietHoursWindowLabel(startHour, endHour);

  return {
    cases,
    invoicesInput,
    comingDueInvoices,
    customersInput,
    lastContactsInput,
    promisesInput,
    recentByCase,
    presenceRows,
    roster,
    ownerLabels,
    orgConfig,
    smsEnabled,
    smsQuietNow,
    quietHoursLabel,
    templates,
  };
}
