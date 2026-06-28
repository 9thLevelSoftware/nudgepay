import { useLoaderData, redirect, data, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { listOrgMembers } from "../lib/orgs.server";
import { resolveCommPrefs } from "../lib/comm-prefs";
import {
  buildThreadRows, applyMessageTab, sortThreadRows, computeMessageMetrics,
  MESSAGE_TABS, MESSAGE_SORTS,
  type MessageTab, type MessageSort, type ThreadCustomerInput, type ThreadMessageInput,
} from "../lib/message-inbox";
import type { MessageEntry } from "./dashboard";
import type { TemplateVars } from "../lib/sms-templates";
import { formatUSD } from "../lib/format";
import { formatDate } from "../lib/dates";
import { AppShell } from "../components/AppShell";
import { MessagesMetrics } from "../components/MessagesMetrics";
import { MessagesInbox } from "../components/MessagesInbox";
import { MessageThreadPanel } from "../components/MessageThreadPanel";

export async function loader({ request, context }: LoaderFunctionArgs) {
  // --- Prelude: mirrors promises.tsx / accounts.tsx exactly ---
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const { data: orgRow } = await supabase
    .from("organizations").select("name").eq("id", org.org_id).single();

  const emailParts = (user.email ?? "").split("@")[0].split(/[.\-_]/);
  const initials =
    emailParts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";

  const service = createSupabaseServiceClient(env);
  const conn = await getConnectionStatus(service, org.org_id);
  const connected = conn?.status === "connected";
  if (!connected) throw redirect("/settings", { headers });

  const { data: connMeta } = await service
    .from("qbo_connections").select("last_sync_at").eq("org_id", org.org_id).maybeSingle();
  const lastSyncAt = (connMeta?.last_sync_at as string | null) ?? null;
  let syncLabel: string;
  if (lastSyncAt) {
    const diffMin = Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / 60_000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    if (diffMin < 2) syncLabel = "Synced just now";
    else if (diffMin < 60) syncLabel = `Synced ${diffMin}m ago`;
    else if (diffHr < 24) syncLabel = `Synced ${diffHr}h ago`;
    else syncLabel = `Synced ${diffDay}d ago`;
  } else {
    syncLabel = "Connected";
  }
  const isOwner = org.role === "owner";

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

  // --- Reads (USER client, explicit org_id) ---
  const { data: msgRows } = await supabase
    .from("text_messages")
    .select("customer_id, direction, body, status, error_code, invoice_id, created_at")
    .eq("org_id", org.org_id)
    .not("customer_id", "is", null);
  const rawMessages = (msgRows as any[]) ?? [];

  const messagesInput: ThreadMessageInput[] = rawMessages.map((r) => ({
    customerId: r.customer_id as string,
    direction: (r.direction as "inbound" | "outbound"),
    body: (r.body as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    errorCode: (r.error_code as string | null) ?? null,
    invoiceId: (r.invoice_id as string | null) ?? null,
    createdAt: r.created_at as string,
  }));

  // Only customers referenced by a message.
  const customerIds = Array.from(new Set(messagesInput.map((m) => m.customerId)));
  let custRows: any[] = [];
  if (customerIds.length > 0) {
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone, owner, sms_consent, preferred_channel, do_not_call, do_not_text")
      .eq("org_id", org.org_id).in("id", customerIds);
    custRows = (data as any[]) ?? [];
  }

  // Open cases for those customers → hasOpenCase / openCaseId.
  const openCaseByCustomer = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: caseRows } = await supabase
      .from("collection_cases").select("id, customer_id, closed_at")
      .eq("org_id", org.org_id).in("customer_id", customerIds).is("closed_at", null);
    for (const c of (caseRows as any[]) ?? []) openCaseByCustomer.set(c.customer_id as string, c.id as string);
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
    hasOpenCase: openCaseByCustomer.has(c.id as string),
    openCaseId: openCaseByCustomer.get(c.id as string) ?? null,
    latestInvoiceId: latestInvoiceByCustomer.get(c.id as string)?.id ?? null,
  }));

  const roster = await listOrgMembers(service, org.org_id);
  const ownerLabels = new Map(roster.map((m) => [m.userId, m.label]));

  const allRows = buildThreadRows(customersInput, messagesInput, ownerLabels);
  const searched = q.trim() === "" ? allRows : allRows.filter((r) => r.searchText.includes(q.toLowerCase()));
  const metrics = computeMessageMetrics(searched);
  const counts = Object.fromEntries(
    MESSAGE_TABS.map((t) => [t, applyMessageTab(searched, t).length]),
  ) as Record<MessageTab, number>;
  const rows = sortThreadRows(applyMessageTab(searched, tab), sort);

  // --- Selected thread ---
  const selected = customerId ? (allRows.find((r) => r.customerId === customerId) ?? null) : null;
  let selectedMessages: MessageEntry[] = [];
  let selectedConsent = false;
  let selectedPhone: string | null = null;
  let selectedVars: TemplateVars = { customer: "", invoice: "", balance: "", dueDate: "" };
  if (selected) {
    const cust = custRows.find((c) => c.id === selected.customerId);
    selectedConsent = Boolean(cust?.sms_consent);
    selectedPhone = (cust?.phone as string | null) ?? null;
    selectedMessages = rawMessages
      .filter((m) => m.customer_id === selected.customerId)
      .sort((a, b) => (a.created_at as string).localeCompare(b.created_at as string))
      .map((m, i) => ({
        id: `${m.customer_id}-${i}-${m.created_at}`,
        direction: m.direction as string,
        body: (m.body as string | null) ?? null,
        status: (m.status as string | null) ?? null,
        errorCode: (m.error_code as string | null) ?? null,
        createdAt: m.created_at as string,
      }));
    const anchor = selected.anchorInvoiceId ? invoiceById.get(selected.anchorInvoiceId) : null;
    selectedVars = {
      customer: selected.customerName,
      invoice: anchor?.docNumber ?? "",
      balance: formatUSD(anchor?.balance ?? 0),
      dueDate: formatDate(anchor?.dueDate ?? null),
    };
  }

  return data(
    {
      orgName: orgRow?.name ?? "(unknown)",
      initials, syncLabel, connected, isOwner,
      rows, metrics, counts, tab, sort, q,
      selected, selectedMessages, selectedConsent, selectedPhone, selectedVars, sms,
    },
    { headers },
  );
}

export default function Messages() {
  const d = useLoaderData<typeof loader>();
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
          />
          <MessageThreadPanel
            thread={d.selected}
            messages={d.selectedMessages}
            consent={d.selectedConsent}
            phone={d.selectedPhone}
            vars={d.selectedVars}
            sms={d.sms}
            tab={d.tab}
            sort={d.sort}
            q={d.q}
          />
        </div>
      </div>
    </AppShell>
  );
}
