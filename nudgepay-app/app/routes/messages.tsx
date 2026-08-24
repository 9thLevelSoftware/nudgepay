import { useCallback, useEffect, useRef, useState } from "react";
import { useLoaderData, useFetcher, useRevalidator, data, type LoaderFunctionArgs } from "react-router";
import { useToast } from "../components/Toasts";
import { useFlashCleanup } from "../lib/use-flash-cleanup";
import { getEnv } from "../lib/env.server";
import { loadWorkspaceChrome } from "../lib/workspace.server";
import { listOrgMembers } from "../lib/orgs.server";
import { resolveCommPrefs } from "../lib/comm-prefs";
import { isContactBlocked } from "../lib/exceptions";
import { resolveChannelSettings } from "../lib/channel-settings";
import { isWithinSendWindow, quietHoursWindowLabel } from "../lib/quiet-hours";
import { resolveEmailSettings } from "../lib/email-settings";
import { loadOrgConfig } from "../lib/org-config.server";
import { loadTemplates } from "../lib/message-templates.server";
import {
  buildThreadRows, applyMessageTab, sortThreadRows, computeMessageMetrics,
  applyChannelFilter, threadReadKey,
  MESSAGE_TABS, MESSAGE_SORTS, CHANNEL_FILTERS,
  type MessageTab, type MessageSort, type ChannelFilter,
  type ThreadCustomerInput, type ThreadMessageInput,
} from "../lib/message-inbox";
import type { MessageEntry, EmailMessageEntry } from "./dashboard";
import type { TemplateVars } from "../lib/sms-templates";
import { formatUSD } from "../lib/format";
import { formatDate } from "../lib/dates";
import { AppShell } from "../components/AppShell";
import { SyncIssues } from "../components/SyncIssues";
import { MessagesMetrics } from "../components/MessagesMetrics";
import { MessagesInbox } from "../components/MessagesInbox";
import { MessageThreadPanel } from "../components/MessageThreadPanel";
import { DrawerShell } from "../components/DrawerShell";
import { pageTitle } from "../lib/meta";
import {
  absorbRealtimeInboundFingerprint,
  applyPollInboundFingerprint,
  shouldToastInbound,
  subscribeMessageEvents,
} from "../lib/messages-realtime";
import { chunkIds, honestListState, orderPage, pageAllChunkedHonest, pageAllHonest, PAGE_ALL_MAX_ROWS } from "../lib/page-all";
import { LoadErrorBanner, TruncationBanner } from "../components/TruncationBanner";
import type { Route } from "./+types/messages";

export const meta: Route.MetaFunction = () => pageTitle("Messages");

function mapSms(r: any): Omit<ThreadMessageInput, "channel" | "subject"> {
  return {
    customerId: r.customer_id as string,
    direction: r.direction as "inbound" | "outbound",
    body: (r.body as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    errorCode: (r.error_code as string | null) ?? null,
    invoiceId: (r.invoice_id as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const {
    supabase, service, headers, isOwner, org, user,
    orgName, initials, userLabel, connected, syncLabel,
    syncIssues,
  } = await loadWorkspaceChrome(request, env);

  // --- URL params ---
  const url = new URL(request.url);
  const sp = url.searchParams;
  const tab: MessageTab = (MESSAGE_TABS as string[]).includes(sp.get("tab") ?? "")
    ? (sp.get("tab") as MessageTab) : "needs-reply";
  const sort: MessageSort = (MESSAGE_SORTS as string[]).includes(sp.get("sort") ?? "")
    ? (sp.get("sort") as MessageSort) : "recent";
  const q = sp.get("q") ?? "";
  const customerId = sp.get("customerId");
  const sms = sp.get("sms");
  const channel: ChannelFilter = (CHANNEL_FILTERS as string[]).includes(sp.get("channel") ?? "")
    ? (sp.get("channel") as ChannelFilter) : "all";

  // --- Reads (USER client, explicit org_id) ---
  type SmsRow = {
    customer_id: string; direction: string; body: string | null; status: string | null;
    error_code: string | null; invoice_id: string | null; created_at: string;
  };
  type EmailRow = SmsRow & { subject: string | null };
  const [msgPage, emailPage] = await Promise.all([
    pageAllHonest<SmsRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("text_messages")
            .select("customer_id, direction, body, status, error_code, invoice_id, created_at", { count: "exact" })
            .eq("org_id", org.org_id)
            .not("customer_id", "is", null),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAllHonest<EmailRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("email_messages")
            .select("customer_id, direction, body, subject, status, error_code, invoice_id, created_at", { count: "exact" })
            .eq("org_id", org.org_id)
            .not("customer_id", "is", null),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
  ]);
  const rawMessages = msgPage.rows;
  const rawEmails = emailPage.rows;

  const messagesInput: ThreadMessageInput[] = [
    ...rawMessages.map((r) => ({ ...mapSms(r), channel: "sms" as const, subject: null })),
    ...rawEmails.map((r) => ({
      customerId: r.customer_id as string,
      channel: "email" as const,
      direction: r.direction as "inbound" | "outbound",
      body: (r.body as string | null) ?? null,
      subject: (r.subject as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      errorCode: (r.error_code as string | null) ?? null,
      invoiceId: (r.invoice_id as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
  ];

  // Only customers referenced by a message (either channel).
  const customerIds = Array.from(new Set(messagesInput.map((m) => m.customerId)));
  const custChunks = chunkIds(customerIds, 100);
  type CustRow = {
    id: string; name: string | null; phone: string | null; email: string | null; owner: string | null;
    sms_consent: boolean | null;
    sms_consent_source: "inbound_stop" | "inbound_start" | "staff" | "import" | "unknown" | null;
    preferred_channel: string | null; do_not_call: boolean | null;
    do_not_text: boolean | null; do_not_email: boolean | null;
  };
  type CaseLookupRow = { id: string; customer_id: string; closed_at: string | null; exception_reason: string | null };
  type InvLookupRow = {
    id: string; customer_id: string | null; qbo_doc_number: string | null; balance: number | string | null; due_date: string | null;
  };
  const emptyHonest = { rows: [] as never[], truncated: false, error: null };
  const [custPage, casePage, invPage] = customerIds.length === 0
    ? [
        { ...emptyHonest, rows: [] as CustRow[] },
        { ...emptyHonest, rows: [] as CaseLookupRow[] },
        { ...emptyHonest, rows: [] as InvLookupRow[] },
      ]
    : await Promise.all([
        pageAllChunkedHonest<CustRow>(
          custChunks,
          (ids, from, to) =>
            orderPage(
              supabase
                .from("customers")
                .select("id, name, phone, email, owner, sms_consent, sms_consent_source, preferred_channel, do_not_call, do_not_text, do_not_email", { count: "exact" })
                .eq("org_id", org.org_id)
                .in("id", ids),
            ).range(from, to),
          { maxRows: PAGE_ALL_MAX_ROWS },
        ),
        pageAllChunkedHonest<CaseLookupRow>(
          custChunks,
          (ids, from, to) =>
            orderPage(
              supabase
                .from("collection_cases")
                .select("id, customer_id, closed_at, exception_reason", { count: "exact" })
                .eq("org_id", org.org_id)
                .in("customer_id", ids)
                .is("closed_at", null),
            ).range(from, to),
          { maxRows: PAGE_ALL_MAX_ROWS },
        ),
        pageAllChunkedHonest<InvLookupRow>(
          custChunks,
          (ids, from, to) =>
            orderPage(
              supabase
                .from("invoices")
                .select("id, customer_id, qbo_doc_number, balance, due_date", { count: "exact" })
                .eq("org_id", org.org_id)
                .in("customer_id", ids),
            ).range(from, to),
          { maxRows: PAGE_ALL_MAX_ROWS },
        ),
      ]);
  const custRows = custPage.rows;

  const openCaseByCustomer = new Map<string, string>();
  const blockedByCustomer = new Map<string, boolean>();
  for (const c of casePage.rows) {
    openCaseByCustomer.set(c.customer_id, c.id);
    if (isContactBlocked(c.exception_reason as any)) {
      blockedByCustomer.set(c.customer_id, true);
    }
  }

  const latestInvoiceByCustomer = new Map<string, { id: string; docNumber: string | null; balance: number; dueDate: string | null }>();
  const invoiceById = new Map<string, { docNumber: string | null; balance: number; dueDate: string | null }>();
  for (const r of invPage.rows) {
    const meta = {
      docNumber: r.qbo_doc_number ?? null,
      balance: Number(r.balance ?? 0),
      dueDate: r.due_date ?? null,
    };
    invoiceById.set(r.id, meta);
    const cid = r.customer_id;
    if (cid && !latestInvoiceByCustomer.has(cid)) latestInvoiceByCustomer.set(cid, { id: r.id, ...meta });
  }

  const customersInput: ThreadCustomerInput[] = custRows.map((c) => ({
    customerId: c.id as string,
    name: (c.name as string) ?? "(unknown customer)",
    ownerId: (c.owner as string | null) ?? null,
    smsConsent: Boolean(c.sms_consent),
    commPrefs: resolveCommPrefs(c),
    phone: (c.phone as string | null) ?? null,
    email: (c.email as string | null) ?? null,
    hasOpenCase: openCaseByCustomer.has(c.id as string),
    openCaseId: openCaseByCustomer.get(c.id as string) ?? null,
    latestInvoiceId: latestInvoiceByCustomer.get(c.id as string)?.id ?? null,
    contactBlocked: blockedByCustomer.get(c.id as string) ?? false,
  }));

  const [roster, orgConfig, templates] = await Promise.all([
    listOrgMembers(service, org.org_id),
    loadOrgConfig(supabase, org.org_id),
    loadTemplates(supabase, org.org_id).catch(() => ({ sms: [], email: [] })),
  ]);
  const ownerLabels = new Map(roster.map((m) => [m.userId, m.label]));
  const orgVars = {
    company: orgName,
    phone: orgConfig.companyProfile.phone ?? "",
    paymentLink: orgConfig.companyProfile.paymentPortalUrl ?? "",
  };

  const lastReadByKey = new Map<string, string>();
  const readPage = await pageAllHonest<{ customer_id: string; channel: "sms" | "email"; last_read_at: string }>(
    (from, to) =>
      supabase
        .from("thread_reads")
        .select("customer_id, channel, last_read_at", { count: "exact" })
        .eq("org_id", org.org_id)
        .eq("user_id", user.id)
        .order("customer_id", { ascending: false })
        .order("channel", { ascending: false })
        .range(from, to),
    { maxRows: PAGE_ALL_MAX_ROWS },
  );
  const listState = honestListState([msgPage, emailPage, custPage, casePage, invPage, readPage]);
  const loadError = listState.loadError ? "Could not load inbox" : null;
  const truncated = listState.truncated;
  if (!loadError) {
    for (const r of readPage.rows) {
      lastReadByKey.set(threadReadKey(r.customer_id, r.channel), r.last_read_at);
    }
  }

  const allRows = loadError ? [] : buildThreadRows(customersInput, messagesInput, ownerLabels, lastReadByKey);
  const query = q.trim().toLowerCase();
  const searched = query === "" ? allRows : allRows.filter((r) => r.searchText.includes(query));

  // Newest inbound activity across channels — the client polls for changes to
  // this fingerprint and toasts when a new customer reply arrives.
  const lastInboundAt = messagesInput.reduce<string | null>((acc, m) => {
    if (m.direction !== "inbound" || !m.createdAt) return acc;
    return acc == null || m.createdAt > acc ? m.createdAt : acc;
  }, null);

  const channelFiltered = applyChannelFilter(searched, channel);
  const metrics = computeMessageMetrics(channelFiltered);
  const counts = Object.fromEntries(
    MESSAGE_TABS.map((t) => [t, applyMessageTab(channelFiltered, t).length]),
  ) as Record<MessageTab, number>;
  const rows = sortThreadRows(applyMessageTab(channelFiltered, tab), sort);
  const channelCounts = {
    all: searched.length,
    sms: searched.filter((r) => r.channel === "sms").length,
    email: searched.filter((r) => r.channel === "email").length,
  };

  // --- Selected thread ---
  const selChannel = sp.get("channel") === "email" ? "email" : sp.get("channel") === "sms" ? "sms" : null;
  const selected = customerId
    ? (allRows.find((r) => r.customerId === customerId && (selChannel == null || r.channel === selChannel)) ?? null)
    : null;
  let selectedMessages: MessageEntry[] = [];
  let selectedEmailMessages: EmailMessageEntry[] = [];
  let selectedConsent = false;
  let selectedSmsConsentSource: "inbound_stop" | "inbound_start" | "staff" | "import" | "unknown" | null = null;
  let selectedPhone: string | null = null;
  let selectedEmail: string | null = null;
  let selectedVars: TemplateVars = { customer: "", invoice: "", balance: "", dueDate: "", company: "", phone: "", paymentLink: "" };
  if (selected) {
    const cust = custRows.find((c) => c.id === selected.customerId);
    selectedConsent = Boolean(cust?.sms_consent);
    selectedSmsConsentSource = cust?.sms_consent_source ?? null;
    selectedPhone = (cust?.phone as string | null) ?? null;
    selectedEmail = (cust?.email as string | null) ?? null;
    if (selected.channel === "email") {
      selectedEmailMessages = rawEmails
        .filter((m) => m.customer_id === selected.customerId)
        .sort((a: any, b: any) => (a.created_at as string).localeCompare(b.created_at as string))
        .map((m: any, i: number) => ({
          id: `${m.customer_id}-email-${i}-${m.created_at}`,
          direction: m.direction as string,
          subject: (m.subject as string | null) ?? null,
          body: (m.body as string | null) ?? null,
          status: (m.status as string | null) ?? null,
          errorCode: (m.error_code as string | null) ?? null,
          createdAt: m.created_at as string,
        }));
    } else {
      selectedMessages = rawMessages
        .filter((m: any) => m.customer_id === selected.customerId)
        .sort((a: any, b: any) => (a.created_at as string).localeCompare(b.created_at as string))
        .map((m: any, i: number) => ({
          id: `${m.customer_id}-${i}-${m.created_at}`,
          direction: m.direction as string,
          body: (m.body as string | null) ?? null,
          status: (m.status as string | null) ?? null,
          errorCode: (m.error_code as string | null) ?? null,
          createdAt: m.created_at as string,
        }));
    }
    const anchor = selected.anchorInvoiceId ? invoiceById.get(selected.anchorInvoiceId) : null;
    selectedVars = {
      customer: selected.customerName,
      invoice: anchor?.docNumber ?? selected.customerName, // mirrors the dashboard composer fallback
      balance: formatUSD(anchor?.balance ?? 0),
      dueDate: formatDate(anchor?.dueDate ?? null),
      ...orgVars,
    };
  }

  const { data: mcfg, error: mcfgErr } = await supabase.from("messaging_config")
    .select("sms_enabled").eq("org_id", org.org_id).maybeSingle();
  if (mcfgErr) throw mcfgErr;
  const smsEnabled = resolveChannelSettings(mcfg as { sms_enabled?: boolean | null } | null).smsEnabled;
  const { startHour, endHour } = orgConfig.quietHours;
  const smsQuietNow = !isWithinSendWindow(new Date(), orgConfig.companyProfile.timezone, startHour, endHour);
  const quietHoursLabel = quietHoursWindowLabel(startHour, endHour);

  const { data: ecfg, error: ecfgErr } = await supabase.from("email_config")
    .select("email_enabled, from_address, from_name").eq("org_id", org.org_id).maybeSingle();
  if (ecfgErr) throw ecfgErr;
  const emailEnabled = resolveEmailSettings(ecfg as any).emailEnabled;

  return data(
    {
      orgName,
      initials, userLabel, syncLabel, connected, isOwner, syncIssues,
      rows, metrics, counts, tab, sort, q,
      channel, channelCounts, emailEnabled, lastInboundAt,
      selected, selectedMessages, selectedEmailMessages,
      selectedConsent, selectedSmsConsentSource, selectedPhone, selectedEmail,
      selectedVars, sms, smsEnabled, smsQuietNow, quietHoursLabel,
      smsTemplates: templates.sms,
      emailTemplates: templates.email,
      timeZone: orgConfig.companyProfile.timezone,
      truncated,
      loadError,
      orgId: org.org_id,
      supabaseUrl: env.SUPABASE_URL,
      supabaseAnonKey: env.SUPABASE_ANON_KEY,
    },
    { headers },
  );
}

export default function Messages() {
  const d = useLoaderData<typeof loader>();
  useFlashCleanup();
  const revalidator = useRevalidator();
  const readFetcher = useFetcher();
  const activityFetcher = useFetcher<{ lastInboundAt: string | null }>();
  const toast = useToast();
  const lastInboundRef = useRef<string | null>(d.lastInboundAt ?? null);
  // Realtime inbound toasts immediately; the next poll/loader fingerprint
  // must advance the cursor without a second toast. 8s lastToastAtRef is
  // only a belt for a poll already in flight (cannot cover the 20s interval).
  const realtimeToastedRef = useRef(false);
  const lastToastAtRef = useRef(0);
  const toastNewInbound = useCallback(() => {
    if (Date.now() - lastToastAtRef.current < 8000) return;
    lastToastAtRef.current = Date.now();
    toast("New inbound message", "info");
  }, [toast]);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Instant path: Supabase Realtime broadcast. Toast inbound-only; omit/unknown
  // direction is silent (poll is the toast fallback). Complements — not replaces —
  // the fingerprint poll: if the socket can't subscribe, poll still catches mail.
  useEffect(() => {
    if (!d.orgId || !d.supabaseUrl || !d.supabaseAnonKey) return;
    const unsubscribe = subscribeMessageEvents({
      supabaseUrl: d.supabaseUrl,
      supabaseAnonKey: d.supabaseAnonKey,
      orgId: d.orgId,
      onEvent: (payload) => {
        if (revalidator.state !== "idle") return;
        const active = document.activeElement as HTMLElement | null;
        if (active && ["TEXTAREA", "INPUT", "SELECT"].includes(active.tagName)) return;
        if (shouldToastInbound(payload)) {
          toastNewInbound();
          realtimeToastedRef.current = true;
        }
        revalidator.revalidate();
      },
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.orgId, d.supabaseUrl, d.supabaseAnonKey]);

  // Poll only a latest-inbound fingerprint. A full route revalidation happens
  // after a new reply is detected, not on every interval.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (revalidator.state !== "idle") return;
      if (activityFetcher.state !== "idle") return;
      const active = document.activeElement as HTMLElement | null;
      if (active && ["TEXTAREA", "INPUT", "SELECT"].includes(active.tagName)) return;
      activityFetcher.load("/api/messages-activity");
    };
    const id = window.setInterval(tick, 20_000);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [activityFetcher, revalidator]);

  // Loader fingerprint after a Realtime inbound toast: absorb, do not toast.
  useEffect(() => {
    const next = absorbRealtimeInboundFingerprint({
      previous: lastInboundRef.current,
      current: d.lastInboundAt ?? null,
      realtimeToasted: realtimeToastedRef.current,
    });
    lastInboundRef.current = next.lastInboundAt;
    realtimeToastedRef.current = next.realtimeToasted;
  }, [d.lastInboundAt]);

  // Toast and refresh when a new inbound customer reply lands via poll.
  // If Realtime already toasted, advance the cursor and stay silent.
  useEffect(() => {
    const next = applyPollInboundFingerprint({
      previous: lastInboundRef.current,
      current: activityFetcher.data?.lastInboundAt ?? null,
      realtimeToasted: realtimeToastedRef.current,
    });
    lastInboundRef.current = next.lastInboundAt;
    realtimeToastedRef.current = next.realtimeToasted;
    if (next.toast) {
      toastNewInbound();
      revalidator.revalidate();
    }
  }, [activityFetcher.data, revalidator, toastNewInbound]);
  useEffect(() => {
    if (!d.selected) return;
    const fd = new FormData();
    fd.set("customerId", d.selected.customerId);
    fd.set("channel", d.selected.channel);
    readFetcher.submit(fd, { method: "post", action: "/api/thread-read" });
    // Mark-read once per open thread; do not retrigger on fetcher identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.selected?.customerId, d.selected?.channel]);
  return (
    <AppShell
      orgName={d.orgName}
      userInitials={d.initials}
      userLabel={d.userLabel}
      syncLabel={d.syncLabel}
      connected={d.connected}
      isOwner={d.isOwner}
      activeNav="messages"
      syncIssues={<SyncIssues issues={d.syncIssues} returnTo="/messages" />}
    >
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {d.loadError ? <LoadErrorBanner message={d.loadError} /> : d.truncated ? <TruncationBanner /> : null}
        <MessagesMetrics metrics={d.metrics} truncated={d.truncated || !!d.loadError} />
        {(() => {
          const threadPanel = (
            <MessageThreadPanel
              thread={d.selected}
              messages={d.selectedMessages}
              emailMessages={d.selectedEmailMessages}
              consent={d.selectedConsent}
              smsConsentSource={d.selectedSmsConsentSource}
              isOwner={d.isOwner}
              phone={d.selectedPhone}
              vars={d.selectedVars}
              sms={d.sms}
              smsEnabled={d.smsEnabled}
              smsQuietNow={d.smsQuietNow}
              quietHoursLabel={d.quietHoursLabel}
              emailEnabled={d.emailEnabled}
              selectedEmail={d.selectedEmail}
              tab={d.tab}
              sort={d.sort}
              q={d.q}
              smsTemplates={d.smsTemplates}
              emailTemplates={d.emailTemplates}
              timeZone={d.timeZone}
            />
          );
          const closeParams = new URLSearchParams({ tab: d.tab, sort: d.sort, channel: d.channel });
          if (d.q) closeParams.set("q", d.q);
          return (
            <>
              <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
                <MessagesInbox
                  rows={d.rows}
                  loadError={d.loadError}
                  truncated={d.truncated}
                  tab={d.tab}
                  sort={d.sort}
                  search={d.q}
                  counts={d.counts}
                  selectedId={d.selected?.customerId ?? null}
                  selectedChannel={d.selected?.channel ?? null}
                  channel={d.channel}
                  channelCounts={d.channelCounts}
                  timeZone={d.timeZone}
                />
                {isDesktop ? <div className="hidden lg:block">{threadPanel}</div> : null}
              </div>
              {/* Below lg the thread opens as a drawer — no dead-end at the page bottom */}
              {d.selected && !isDesktop ? (
                <div className="lg:hidden">
                  <DrawerShell
                    label={`Thread — ${d.selected.customerName}`}
                    closeHref={`?${closeParams.toString()}`}
                    maxWidth="max-w-[420px]"
                  >
                    {threadPanel}
                  </DrawerShell>
                </div>
              ) : null}
            </>
          );
        })()}
      </div>
    </AppShell>
  );
}
