// app/lib/message-inbox.ts
// Pure deriver for the Messages tab (cross-customer SMS inbox). No I/O, no
// node:*, no .server — imported by the route loader, components (type-only),
// and tests. Mirrors app/lib/promise-ledger.ts in shape. SMS-only but
// channel-aware: every row carries channel:"sms" so email slots in later.

import { canSendSms, type CommPrefs } from "./comm-prefs";

export type MessageTab = "needs-reply" | "needs-attention" | "active" | "inactive" | "all";
export const MESSAGE_TABS: MessageTab[] = ["needs-reply", "needs-attention", "active", "inactive", "all"];

export type MessageSort = "recent" | "oldest-waiting" | "name";
export const MESSAGE_SORTS: MessageSort[] = ["recent", "oldest-waiting", "name"];

// Twilio terminal-failure statuses (checked case-insensitively). errorCode
// presence also trips needsAttention regardless of the status string.
const FAILED_STATUSES = new Set(["failed", "undelivered"]);

export type ThreadMessageInput = {
  customerId: string;
  direction: "inbound" | "outbound";
  body: string | null;
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
  hasOpenCase: boolean;
  openCaseId: string | null;
  latestInvoiceId: string | null; // most-recent invoice of ANY status — anchor fallback
};

export type ThreadRow = {
  channel: "sms"; // reserved for future "email"
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

export function buildThreadRows(
  customers: ThreadCustomerInput[],
  messages: ThreadMessageInput[],
  ownerLabels: Map<string, string>,
): ThreadRow[] {
  // Group messages by customer.
  const byCustomer = new Map<string, ThreadMessageInput[]>();
  for (const m of messages) {
    const list = byCustomer.get(m.customerId);
    if (list) list.push(m);
    else byCustomer.set(m.customerId, [m]);
  }

  const rows: ThreadRow[] = [];
  for (const c of customers) {
    const msgs = byCustomer.get(c.customerId);
    if (!msgs || msgs.length === 0) continue; // inbox lists conversations, not the directory

    const sorted = [...msgs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = sorted[sorted.length - 1];

    // unansweredInbound = inbound messages newer than the last outbound (all inbound if none).
    let lastOutboundIdx = -1;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].direction === "outbound") { lastOutboundIdx = i; break; }
    }
    let unansweredInbound = 0;
    for (let i = lastOutboundIdx + 1; i < sorted.length; i++) {
      if (sorted[i].direction === "inbound") unansweredInbound++;
    }

    // anchor invoice: latest message (scan desc) with a non-null invoiceId, else customer's latest.
    let anchorInvoiceId: string | null = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].invoiceId) { anchorInvoiceId = sorted[i].invoiceId; break; }
    }
    if (anchorInvoiceId == null) anchorInvoiceId = c.latestInvoiceId;

    const needsReply = last.direction === "inbound";
    const needsAttention = last.direction === "outbound" && isFailed(last.status, last.errorCode);

    const consentOk = canSendSms(c.commPrefs, c.smsConsent);
    const replyDisabledReason = !c.smsConsent
      ? "Customer has not consented to SMS"
      : c.commPrefs.doNotText
        ? "Customer opted out of texts"
        : anchorInvoiceId == null
          ? "No invoice on file to attach"
          : null;
    const canReply = consentOk && anchorInvoiceId != null;

    const ownerLabel = c.ownerId ? (ownerLabels.get(c.ownerId) ?? "Unknown") : "Unassigned";

    rows.push({
      channel: "sms",
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
      unansweredInbound,
      needsReply,
      needsAttention,
      active: c.hasOpenCase,
      canReply,
      replyDisabledReason,
      openCaseId: c.openCaseId,
      anchorInvoiceId,
      searchText: `${c.name} ${ownerLabel}`.toLowerCase(),
    });
  }
  return rows;
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
    // needs-reply rows first (oldest last-message first), everything else after by recency.
    return copy.sort((a, b) => {
      if (a.needsReply !== b.needsReply) return a.needsReply ? -1 : 1;
      if (a.needsReply) return lastAt(a).localeCompare(lastAt(b));      // oldest first
      return lastAt(b).localeCompare(lastAt(a));                        // recent first
    });
  }
  // "recent": newest last-message first; ties by customer name.
  return copy.sort((a, b) =>
    lastAt(a) === lastAt(b) ? a.customerName.localeCompare(b.customerName) : lastAt(b).localeCompare(lastAt(a)),
  );
}

export type MessageMetrics = { needsReply: number; needsAttention: number; active: number; total: number };

export function computeMessageMetrics(rows: ThreadRow[]): MessageMetrics {
  return {
    needsReply: rows.filter((r) => r.needsReply).length,
    needsAttention: rows.filter((r) => r.needsAttention).length,
    active: rows.filter((r) => r.active).length,
    total: rows.length,
  };
}
