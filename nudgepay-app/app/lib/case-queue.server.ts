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
  CasePromiseInput, CaseLastContactInput, QueueTruncation,
} from "./cases";
import { isQueueTruncated } from "./cases";
import type { PriorityOverrideLevel } from "./priority";
import type { ExceptionReason } from "./contact-log";
import type { OrgConfig } from "./org-config";
import { listOrgMembers, type OrgMember } from "./orgs.server";
import { loadOrgConfig } from "./org-config.server";
import { resolveCommPrefs } from "./comm-prefs";
import { resolveChannelSettings } from "./channel-settings";
import { isWithinSendWindow, quietHoursWindowLabel } from "./quiet-hours";
import { readPresence } from "./presence.server";
import type { RecentContactInput } from "./collision";
import { loadTemplates } from "./message-templates.server";
import type { OrgTemplates } from "./message-templates";
import {
  chunkIds, honestListState, orderPage, pageAll, pageAllChunked, pageAllChunkedHonest, PAGE_ALL_MAX_ROWS,
} from "./page-all";
import { countsAsCustomerContact } from "./last-contact";

// ---------------------------------------------------------------------------
// Row shapes returned by the Supabase queries (internal)
// ---------------------------------------------------------------------------

type InvoiceRow = {
  id: string;
  qbo_doc_number: string | null;
  balance: number | string | null;
  due_date: string | null;
  customer_id: string | null;
  amount: number | string | null;
  invoice_date: string | null;
  status: string | null;
  paid_date: string | null;
};

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  owner: string | null;
  sms_consent: boolean | null;
  preferred_channel: string | null;
  do_not_call: boolean | null;
  do_not_text: boolean | null;
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
  /** True when Stage-1 overdue / coming-due / open-case / customer pages hit PAGE_ALL_MAX_ROWS. */
  queueTruncated: boolean;
  queueTruncation: QueueTruncation;
  /** True when Stage-2 last-contact / promise pages hit PAGE_ALL_MAX_ROWS. */
  lastContactTruncated: boolean;
  /** Stage-2 list query failed. Empty last-contact is not "never contacted". */
  lastContactLoadError: string | null;
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
  const orgConfig = args.orgConfig ?? await loadOrgConfig(supabase, orgId);
  // Derive the lookahead upper bound from the org-local today (passed in by the
  // caller) rather than UTC Date.now(). This keeps the invoice query window
  // consistent with the org's calendar day — otherwise an east-of-UTC org whose
  // local date has already advanced would miss invoices due on the final day.
  const todayMs = new Date(today + "T00:00:00Z").getTime();
  const plus7 = new Date(todayMs + orgConfig.workflow.comingDueDays * 86_400_000).toISOString().slice(0, 10);

  // Stage 1 — overdue, coming-due, and open cases as separate paged queries so
  // they do not share one PostgREST cap. Query errors still throw; truncation
  // is queueTruncated chrome (10× must not 500).
  const [
    overduePage,
    comingDuePage,
    casePage,
    roster,
    mcfgRes,
    templates,
  ] = await Promise.all([
    pageAll<InvoiceRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("invoices")
            .select("id, qbo_doc_number, balance, due_date, customer_id, amount, invoice_date, status, paid_date", { count: "exact" })
            .eq("org_id", orgId)
            .gt("balance", 0)
            .lt("due_date", today),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAll<InvoiceRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("invoices")
            .select("id, qbo_doc_number, balance, due_date, customer_id, amount, invoice_date, status, paid_date", { count: "exact" })
            .eq("org_id", orgId)
            .gt("balance", 0)
            .gte("due_date", today)
            .lte("due_date", plus7),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAll<CaseRowRaw>(
      (from, to) =>
        orderPage(
          supabase
            .from("collection_cases")
            .select("id, customer_id, status, next_action_type, next_action_at, opened_at, exception_reason, exception_note, priority_override, priority_override_reason, priority_override_by, priority_override_at", { count: "exact" })
            .eq("org_id", orgId)
            .is("closed_at", null),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    listOrgMembers(service, orgId).catch(() => [] as OrgMember[]),
    supabase.from("messaging_config").select("sms_enabled").eq("org_id", orgId).maybeSingle(),
    loadTemplates(supabase, orgId).catch(() => ({ sms: [], email: [] })),
  ]);

  if (mcfgRes.error) throw mcfgRes.error;
  const mcfg = mcfgRes.data;

  const toInvoiceInput = (r: InvoiceRow): InvoiceInput => ({
    id: r.id,
    qbo_doc_number: r.qbo_doc_number,
    customer_id: r.customer_id,
    balance: Number(r.balance ?? 0),
    due_date: r.due_date,
    amount: Number(r.amount ?? 0),
    invoice_date: r.invoice_date ?? null,
    status: r.status ?? null,
    paid_date: r.paid_date ?? null,
  });
  const invoicesInput = overduePage.rows.map(toInvoiceInput);
  const comingDueInvoices = comingDuePage.rows.map(toInvoiceInput);

  const customerIds = [...new Set(
    [
      ...overduePage.rows.map((r) => r.customer_id),
      ...comingDuePage.rows.map((r) => r.customer_id),
      ...casePage.rows.map((r) => r.customer_id),
    ].filter((id): id is string => Boolean(id)),
  )];
  const custPage = customerIds.length === 0
    ? { rows: [] as CustomerRow[], truncated: false }
    : await pageAllChunked<CustomerRow>(
        chunkIds(customerIds, 100),
        (ids, from, to) =>
          orderPage(
            supabase
              .from("customers")
              .select("id, name, phone, email, owner, sms_consent, preferred_channel, do_not_call, do_not_text", { count: "exact" })
              .eq("org_id", orgId)
              .in("id", ids),
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      );
  const queueTruncation: QueueTruncation = {
    overdue: overduePage.truncated,
    comingDue: comingDuePage.truncated,
    cases: casePage.truncated,
    customers: custPage.truncated,
  };
  const queueTruncated = isQueueTruncated(queueTruncation);

  const customerMap = new Map<string, CustomerInput>();
  for (const c of custPage.rows) {
    if (customerMap.has(c.id)) continue;
    customerMap.set(c.id, {
      id: c.id,
      name: c.name ?? "(unknown customer)",
      phone: c.phone ?? null,
      email: c.email ?? null,
      owner: c.owner ?? null,
      smsConsent: c.sms_consent ?? false,
      commPrefs: resolveCommPrefs(c),
    });
  }
  const customersInput: CustomerInput[] = [...customerMap.values()];

  const cases: CaseRow[] = casePage.rows.map((r) => ({
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
  let lastContactTruncated = false;
  let lastContactLoadError: string | null = null;

  type LogRow = { case_id: string | null; method: string | null; created_at: string; user_id: string | null };
  type MsgRow = { case_id: string | null; created_at: string; sent_by_user_id: string | null };
  type PromRow = {
    case_id: string; status: CasePromiseInput["status"]; promised_amount: number | string | null;
    promised_date: string; amount_received: number | string | null;
  };

  // Stage 2 — everything keyed on caseIds. Skipped when there are no open cases.
  // Truncated last-contact is a banner, not an empty queue.
  if (caseIds.length > 0) {
    const chunks = chunkIds(caseIds, 100);
    const [logs, texts, emails, proms, presenceResult] = await Promise.all([
      pageAllChunkedHonest<LogRow>(
        chunks,
        (ids, from, to) =>
          orderPage(
            supabase
              .from("contact_logs")
              .select("case_id, method, created_at, user_id", { count: "exact" })
              .eq("org_id", orgId)
              .in("case_id", ids),
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      ),
      pageAllChunkedHonest<MsgRow>(
        chunks,
        (ids, from, to) =>
          orderPage(
            supabase
              .from("text_messages")
              .select("case_id, created_at, sent_by_user_id", { count: "exact" })
              .eq("org_id", orgId)
              .in("case_id", ids)
              .eq("direction", "outbound"),
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      ),
      pageAllChunkedHonest<MsgRow>(
        chunks,
        (ids, from, to) =>
          orderPage(
            supabase
              .from("email_messages")
              .select("case_id, created_at, sent_by_user_id", { count: "exact" })
              .eq("org_id", orgId)
              .in("case_id", ids)
              .eq("direction", "outbound"),
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      ),
      pageAllChunkedHonest<PromRow>(
        chunks,
        (ids, from, to) =>
          orderPage(
            supabase
              .from("promises")
              .select("case_id, status, promised_amount, promised_date, amount_received, created_at", { count: "exact" })
              .eq("org_id", orgId)
              .in("case_id", ids)
              .neq("status", "cancelled"),
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      ),
      includePresence
        ? readPresence(supabase, { orgId, customerIds: presenceCustomerIds }).catch((e) => {
            console.error("presence read failed (degrading to no presence):", e);
            return [];
          })
        : Promise.resolve([]),
    ]);

    const stage2 = honestListState([logs, texts, emails, proms]);
    if (stage2.loadError) {
      lastContactLoadError = "Could not load contact history";
    } else {
      lastContactTruncated = stage2.truncated;
      const methodLabel: Record<string, string> = { call: "Call", email: "Email", text: "Text", note: "Note" };
      for (const r of logs.rows) {
        if (r.case_id) {
          if (countsAsCustomerContact(r.method as string)) {
            lastContactsInput.push({ caseId: r.case_id, date: r.created_at, channel: methodLabel[r.method ?? ""] ?? "Note" });
          }
          pushRecent(r.case_id, r.user_id ?? null, r.created_at);
        }
      }
      for (const r of texts.rows) {
        if (r.case_id) {
          lastContactsInput.push({ caseId: r.case_id, date: r.created_at, channel: "Text" });
          pushRecent(r.case_id, r.sent_by_user_id ?? null, r.created_at);
        }
      }
      for (const r of emails.rows) {
        if (r.case_id) {
          lastContactsInput.push({ caseId: r.case_id, date: r.created_at, channel: "Email" });
          pushRecent(r.case_id, r.sent_by_user_id ?? null, r.created_at);
        }
      }

      // Active promise per open case (pending preferred, else most-recent non-cancelled).
      const seen = new Set<string>();
      const pendingFirst = [...proms.rows].sort((a, b) =>
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
    queueTruncated,
    queueTruncation,
    lastContactTruncated,
    lastContactLoadError,
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
