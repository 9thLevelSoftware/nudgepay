import { useLoaderData, data, type LoaderFunctionArgs } from "react-router";
import { useFlashCleanup } from "../lib/use-flash-cleanup";
import { getEnv } from "../lib/env.server";
import { loadWorkspaceChrome } from "../lib/workspace.server";
import { listOrgMembers } from "../lib/orgs.server";
import { resolveCommPrefs } from "../lib/comm-prefs";
import { isContactBlocked } from "../lib/exceptions";
import { resolveChannelSettings } from "../lib/channel-settings";
import { resolveEmailSettings } from "../lib/email-settings";
import {
  buildThreadRows, applyMessageTab, sortThreadRows, computeMessageMetrics,
  applyChannelFilter,
  MESSAGE_TABS, MESSAGE_SORTS, CHANNEL_FILTERS,
  type MessageTab, type MessageSort, type ChannelFilter,
  type ThreadCustomerInput, type ThreadMessageInput,
} from "../lib/message-inbox";
import type { MessageEntry, EmailMessageEntry } from "./dashboard";
import type { TemplateVars } from "../lib/sms-templates";
import { formatUSD } from "../lib/format";
import { formatDate } from "../lib/dates";
import { AppShell } from "../components/AppShell";
import { MessagesMetrics } from "../components/MessagesMetrics";
import { MessagesInbox } from "../components/MessagesInbox";
import { MessageThreadPanel } from "../components/MessageThreadPanel";
import { pageTitle } from "../lib/meta";
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
    supabase, service, headers, isOwner, org,
    orgName, initials, connected, syncLabel,
  } = await loadWorkspaceChrome(request, env);
  // requireQbo defaults true — gate already handled inside helper

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
  const { data: msgRows } = await supabase
    .from("text_messages")
    .select("customer_id, direction, body, status, error_code, invoice_id, created_at")
    .eq("org_id", org.org_id)
    .not("customer_id", "is", null);
  const rawMessages = (msgRows as any[]) ?? [];

  const { data: emailRows } = await supabase
    .from("email_messages")
    .select("customer_id, direction, body, subject, status, error_code, invoice_id, created_at")
    .eq("org_id", org.org_id)
    .not("customer_id", "is", null);
  const rawEmails = (emailRows as any[]) ?? [];

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
  let custRows: any[] = [];
  if (customerIds.length > 0) {
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone, email, owner, sms_consent, preferred_channel, do_not_call, do_not_text, do_not_email")
      .eq("org_id", org.org_id).in("id", customerIds);
    custRows = (data as any[]) ?? [];
  }

  // Open cases for those customers → hasOpenCase / openCaseId / contactBlocked.
  const openCaseByCustomer = new Map<string, string>();
  const blockedByCustomer = new Map<string, boolean>();
  if (customerIds.length > 0) {
    const { data: caseRows } = await supabase
      .from("collection_cases").select("id, customer_id, closed_at, exception_reason")
      .eq("org_id", org.org_id).in("customer_id", customerIds).is("closed_at", null);
    for (const c of (caseRows as any[]) ?? []) {
      openCaseByCustomer.set(c.customer_id as string, c.id as string);
      if (isContactBlocked(c.exception_reason as any)) {
        blockedByCustomer.set(c.customer_id as string, true);
      }
    }
  }

  // Latest invoice (any status) per customer → anchor fallback + selected template vars.
  // Order by created_at desc and keep the first seen per customer.
  const latestInvoiceByCustomer = new Map<string, { id: string; docNumber: string | null; balance: number; dueDate: string | null }>();
  const invoiceById = new Map<string, { docNumber: string | null; balance: number; dueDate: string | null }>();
  if (customerIds.length > 0) {
    const { data: invRows } = await supabase
      .from("invoices").select("id, customer_id, qbo_doc_number, balance, due_date")
      .eq("org_id", org.org_id).in("customer_id", customerIds)
      .order("created_at", { ascending: false });
    for (const r of (invRows as any[]) ?? []) {
      const meta = {
        docNumber: (r.qbo_doc_number as string | null) ?? null,
        balance: Number(r.balance ?? 0),
        dueDate: (r.due_date as string | null) ?? null,
      };
      invoiceById.set(r.id as string, meta);
      const cid = r.customer_id as string;
      if (!latestInvoiceByCustomer.has(cid)) latestInvoiceByCustomer.set(cid, { id: r.id as string, ...meta });
    }
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

  const roster = await listOrgMembers(service, org.org_id);
  const ownerLabels = new Map(roster.map((m) => [m.userId, m.label]));

  const allRows = buildThreadRows(customersInput, messagesInput, ownerLabels);
  const query = q.trim().toLowerCase();
  const searched = query === "" ? allRows : allRows.filter((r) => r.searchText.includes(query));

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
  let selectedPhone: string | null = null;
  let selectedEmail: string | null = null;
  let selectedVars: TemplateVars = { customer: "", invoice: "", balance: "", dueDate: "" };
  if (selected) {
    const cust = custRows.find((c) => c.id === selected.customerId);
    selectedConsent = Boolean(cust?.sms_consent);
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
    };
  }

  const { data: mcfg } = await supabase.from("messaging_config")
    .select("sms_enabled").eq("org_id", org.org_id).maybeSingle();
  const smsEnabled = resolveChannelSettings(mcfg as { sms_enabled?: boolean | null } | null).smsEnabled;

  const { data: ecfg } = await supabase.from("email_config")
    .select("email_enabled, from_address, from_name").eq("org_id", org.org_id).maybeSingle();
  const emailEnabled = resolveEmailSettings(ecfg as any).emailEnabled;

  return data(
    {
      orgName,
      initials, syncLabel, connected, isOwner,
      rows, metrics, counts, tab, sort, q,
      channel, channelCounts, emailEnabled,
      selected, selectedMessages, selectedEmailMessages,
      selectedConsent, selectedPhone, selectedEmail,
      selectedVars, sms, smsEnabled,
    },
    { headers },
  );
}

export default function Messages() {
  const d = useLoaderData<typeof loader>();
  useFlashCleanup();
  return (
    <AppShell
      orgName={d.orgName}
      userInitials={d.initials}
      syncLabel={d.syncLabel}
      connected={d.connected}
      isOwner={d.isOwner}
      activeNav="messages"
    >
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <MessagesMetrics metrics={d.metrics} />
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <MessagesInbox
            rows={d.rows}
            tab={d.tab}
            sort={d.sort}
            search={d.q}
            counts={d.counts}
            selectedId={d.selected?.customerId ?? null}
            selectedChannel={d.selected?.channel ?? null}
            channel={d.channel}
            channelCounts={d.channelCounts}
          />
          <MessageThreadPanel
            thread={d.selected}
            messages={d.selectedMessages}
            emailMessages={d.selectedEmailMessages}
            consent={d.selectedConsent}
            phone={d.selectedPhone}
            vars={d.selectedVars}
            sms={d.sms}
            smsEnabled={d.smsEnabled}
            emailEnabled={d.emailEnabled}
            selectedEmail={d.selectedEmail}
            tab={d.tab}
            sort={d.sort}
            q={d.q}
          />
        </div>
      </div>
    </AppShell>
  );
}
