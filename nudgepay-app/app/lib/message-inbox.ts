// app/lib/message-inbox.ts
// Pure deriver for the Messages tab (cross-customer inbox). No I/O, no node:*,
// no .server. Channel-aware: every message carries a channel and every row is one
// (customer, channel) conversation. SMS and email are separate conversations
// because their reply eligibility differs (TCPA consent + phone vs. opt-out +
// address).

import { canSendSms, canSendEmail, type CommPrefs } from "./comm-prefs";

export type Channel = "sms" | "email";

export type MessageTab = "needs-reply" | "needs-attention" | "active" | "inactive" | "all";
export const MESSAGE_TABS: MessageTab[] = ["needs-reply", "needs-attention", "active", "inactive", "all"];

export type MessageSort = "recent" | "oldest-waiting" | "name";
export const MESSAGE_SORTS: MessageSort[] = ["recent", "oldest-waiting", "name"];

export type ChannelFilter = "all" | "sms" | "email";
export const CHANNEL_FILTERS: ChannelFilter[] = ["all", "sms", "email"];

// Terminal-failure statuses (case-insensitive). Twilio: failed/undelivered.
// Resend: bounced/complained. errorCode presence also trips needsAttention.
const FAILED_STATUSES = new Set(["failed", "undelivered", "bounced", "complained"]);

export type ThreadMessageInput = {
  customerId: string;
  channel: Channel;
  direction: "inbound" | "outbound";
  body: string | null;
  subject: string | null; // null for sms
  status: string | null;
  errorCode: string | null;
  invoiceId: string | null;
  createdAt: string; // ISO timestamp
};

export type ThreadCustomerInput = {
  customerId: string;
  name: string;
  ownerId: string | null;
  smsConsent: boolean;
  commPrefs: CommPrefs;
  phone: string | null;
  email: string | null;
  hasOpenCase: boolean;
  openCaseId: string | null;
  latestInvoiceId: string | null;
};

export type ThreadRow = {
  channel: Channel;
  customerId: string;
  customerName: string;
  ownerLabel: string;
  lastMessage: {
    direction: "inbound" | "outbound";
    snippet: string;
    status: string | null;
    errorCode: string | null;
    createdAt: string;
  } | null;
  subjectSnippet: string | null; // last email subject; null for sms
  unansweredInbound: number;
  needsReply: boolean;
  needsAttention: boolean;
  active: boolean;
  canReply: boolean;
  replyDisabledReason: string | null;
  openCaseId: string | null;
  anchorInvoiceId: string | null;
  searchText: string;
};

function isFailed(status: string | null, errorCode: string | null): boolean {
  if (errorCode) return true;
  return status != null && FAILED_STATUSES.has(status.toLowerCase());
}

function smsGate(c: ThreadCustomerInput, anchorInvoiceId: string | null): { canReply: boolean; reason: string | null } {
  const reason = !c.smsConsent
    ? "Customer has not consented to SMS"
    : c.commPrefs.doNotText
      ? "Customer opted out of texts"
      : !c.phone
        ? "Customer has no phone number"
        : anchorInvoiceId == null
          ? "No invoice on file to attach"
          : null;
  return { canReply: canSendSms(c.commPrefs, c.smsConsent) && !!c.phone && anchorInvoiceId != null, reason };
}

function emailGate(c: ThreadCustomerInput, anchorInvoiceId: string | null): { canReply: boolean; reason: string | null } {
  const reason = c.commPrefs.doNotEmail
    ? "Customer opted out of email"
    : !c.email
      ? "Customer has no email on file"
      : anchorInvoiceId == null
        ? "No invoice on file to attach"
        : null;
  return { canReply: canSendEmail(c.commPrefs) && !!c.email && anchorInvoiceId != null, reason };
}

export function buildThreadRows(
  customers: ThreadCustomerInput[],
  messages: ThreadMessageInput[],
  ownerLabels: Map<string, string>,
): ThreadRow[] {
  // Group messages by customer + channel.
  const byKey = new Map<string, ThreadMessageInput[]>();
  for (const m of messages) {
    const key = `${m.customerId}::${m.channel}`;
    const list = byKey.get(key);
    if (list) list.push(m);
    else byKey.set(key, [m]);
  }

  const custById = new Map(customers.map((c) => [c.customerId, c]));
  const rows: ThreadRow[] = [];

  for (const [key, msgs] of byKey) {
    if (msgs.length === 0) continue;
    const sep = key.lastIndexOf("::");
    const customerId = key.slice(0, sep);
    const channel = key.slice(sep + 2) as Channel;
    const c = custById.get(customerId);
    if (!c) continue; // message without a loaded customer (shouldn't happen)

    const sorted = [...msgs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = sorted[sorted.length - 1];

    let lastOutboundIdx = -1;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].direction === "outbound") { lastOutboundIdx = i; break; }
    }
    let unansweredInbound = 0;
    for (let i = lastOutboundIdx + 1; i < sorted.length; i++) {
      if (sorted[i].direction === "inbound") unansweredInbound++;
    }

    let anchorInvoiceId: string | null = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].invoiceId) { anchorInvoiceId = sorted[i].invoiceId; break; }
    }
    if (anchorInvoiceId == null) anchorInvoiceId = c.latestInvoiceId;

    const needsReply = last.direction === "inbound";
    const needsAttention = last.direction === "outbound" && isFailed(last.status, last.errorCode);

    const gate = channel === "sms" ? smsGate(c, anchorInvoiceId) : emailGate(c, anchorInvoiceId);

    let subjectSnippet: string | null = null;
    if (channel === "email") {
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].subject) { subjectSnippet = sorted[i].subject; break; }
      }
    }

    const ownerLabel = c.ownerId ? (ownerLabels.get(c.ownerId) ?? "Unknown") : "Unassigned";

    rows.push({
      channel,
      customerId: c.customerId,
      customerName: c.name,
      ownerLabel,
      lastMessage: {
        direction: last.direction,
        snippet: (last.body ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
        status: last.status,
        errorCode: last.errorCode,
        createdAt: last.createdAt,
      },
      subjectSnippet,
      unansweredInbound,
      needsReply,
      needsAttention,
      active: c.hasOpenCase,
      canReply: gate.canReply,
      replyDisabledReason: gate.reason,
      openCaseId: c.openCaseId,
      anchorInvoiceId,
      searchText: `${c.name} ${ownerLabel}`.toLowerCase(),
    });
  }
  return rows;
}

export function applyChannelFilter(rows: ThreadRow[], channel: ChannelFilter): ThreadRow[] {
  if (channel === "all") return rows;
  return rows.filter((r) => r.channel === channel);
}

export function applyMessageTab(rows: ThreadRow[], tab: MessageTab): ThreadRow[] {
  if (tab === "needs-reply") return rows.filter((r) => r.needsReply);
  if (tab === "needs-attention") return rows.filter((r) => r.needsAttention);
  if (tab === "active") return rows.filter((r) => r.active);
  if (tab === "inactive") return rows.filter((r) => !r.active);
  return rows; // "all"
}

function lastAt(r: ThreadRow): string {
  return r.lastMessage?.createdAt ?? "";
}

export function sortThreadRows(rows: ThreadRow[], sort: MessageSort): ThreadRow[] {
  const copy = [...rows];
  if (sort === "name") {
    return copy.sort((a, b) => a.customerName.localeCompare(b.customerName));
  }
  if (sort === "oldest-waiting") {
    return copy.sort((a, b) => {
      if (a.needsReply !== b.needsReply) return a.needsReply ? -1 : 1;
      if (a.needsReply) return lastAt(a).localeCompare(lastAt(b));
      return lastAt(b).localeCompare(lastAt(a));
    });
  }
  return copy.sort((a, b) =>
    lastAt(a) === lastAt(b) ? a.customerName.localeCompare(b.customerName) : lastAt(b).localeCompare(lastAt(a)),
  );
}

export type MessageMetrics = { needsReply: number; needsAttention: number; active: number; unanswered: number };

export function computeMessageMetrics(rows: ThreadRow[]): MessageMetrics {
  return {
    needsReply: rows.filter((r) => r.needsReply).length,
    needsAttention: rows.filter((r) => r.needsAttention).length,
    active: rows.filter((r) => r.active).length,
    unanswered: rows.filter((r) => r.unansweredInbound > 0).length,
  };
}
