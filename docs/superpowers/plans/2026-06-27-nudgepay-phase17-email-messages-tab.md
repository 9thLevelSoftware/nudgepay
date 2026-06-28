# Phase 17 — Email in the Messages tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface email conversations in the `/messages` inbox alongside SMS — channel-aware deriver, channel filter + badge, and a channel-adaptive thread panel + reply composer — without changing any send/inbound/status logic.

**Architecture:** Generalize the pure `message-inbox.ts` deriver so every message carries a channel and every thread row is one `(customer, channel)` conversation. SMS behavior is preserved exactly (regression-guarded); email rows reuse the #3a `/api/email/send` route and templates. The loader reads both `text_messages` and `email_messages`.

**Tech Stack:** React Router v7 on Cloudflare Workers, Supabase + RLS (user client reads), Tailwind v4 (literal class strings, warm tokens), Vitest.

## Global Constraints

- Depends on Phase 15 (`email_messages`, `/api/email/send`, `EMAIL_TEMPLATES`, `do_not_email`, `canSendEmail`, `resolveEmailSettings`) and Phase 16 (inbound rows + delivery statuses).
- Model: **one row per `(customer, channel)`**. SMS and email are separate conversations.
- SMS behavior must be byte-identical to pre-#3c (regression test required) — this is the primary risk.
- `#3c is read + render + route-the-reply only` — no new send/inbound/status code.
- All reads use the user client (RLS) with explicit `org_id`, exactly as `messages.tsx` does today.
- Pure `message-inbox.ts`: no I/O, no `node:*`, no `.server`; imported by route loader, components (type-only), and tests.
- Tailwind: literal class strings only; reuse warm tokens (copper/cool/hot/ink, bg-surface/panel/paper, border-border, text-text/muted).
- Tests: per-test fresh orgs with `Math.random()` uniqueness; never global truncation.
- Never `git add -A`; never commit secrets.

---

### Task 1: Channel-aware `message-inbox.ts`

**Files:**
- Modify: `nudgepay-app/app/lib/message-inbox.ts`
- Test: `nudgepay-app/test/message-inbox.test.ts` (extend)

**Interfaces:**
- Consumes: `canSendSms`, `canSendEmail`, `CommPrefs` from `comm-prefs.ts` (Phase 15).
- Produces: `Channel = "sms"|"email"`; `ThreadMessageInput` + `channel` + `subject`; `ThreadCustomerInput` + `email`; `ThreadRow` + `channel:Channel` + `subjectSnippet`; `applyChannelFilter(rows, "all"|"sms"|"email")`. Consumed by Tasks 2, 3, 4.

- [ ] **Step 1: Add the regression + email tests** (extend `message-inbox.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import {
  buildThreadRows, applyChannelFilter, computeMessageMetrics,
  type ThreadCustomerInput, type ThreadMessageInput,
} from "../app/lib/message-inbox";
import { resolveCommPrefs } from "../app/lib/comm-prefs";

const labels = new Map<string, string>([["u1", "Owner One"]]);

function cust(over: Partial<ThreadCustomerInput> = {}): ThreadCustomerInput {
  return {
    customerId: "c1", name: "Acme", ownerId: "u1",
    smsConsent: true, commPrefs: resolveCommPrefs({}), phone: "5551234567",
    email: "a@acme.com", hasOpenCase: true, openCaseId: "case1", latestInvoiceId: "inv1",
    ...over,
  };
}
function msg(over: Partial<ThreadMessageInput> = {}): ThreadMessageInput {
  return {
    customerId: "c1", channel: "sms", direction: "outbound", body: "hi", subject: null,
    status: "sent", errorCode: null, invoiceId: "inv1", createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("message-inbox channel awareness", () => {
  it("REGRESSION: an SMS-only customer yields one sms row with the old gate", () => {
    const rows = buildThreadRows([cust()], [msg({ channel: "sms", direction: "inbound" })], labels);
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("sms");
    expect(rows[0].canReply).toBe(true);
    expect(rows[0].needsReply).toBe(true);
    expect(rows[0].subjectSnippet).toBeNull();
  });

  it("a customer with both channels yields two rows", () => {
    const rows = buildThreadRows([cust()], [
      msg({ channel: "sms" }),
      msg({ channel: "email", subject: "Invoice 1001", body: "please pay" }),
    ], labels);
    expect(rows.map((r) => r.channel).sort()).toEqual(["email", "sms"]);
    const email = rows.find((r) => r.channel === "email")!;
    expect(email.subjectSnippet).toBe("Invoice 1001");
  });

  it("email gate: opted out", () => {
    const rows = buildThreadRows([cust({ commPrefs: resolveCommPrefs({ do_not_email: true }) })],
      [msg({ channel: "email", subject: "x" })], labels);
    expect(rows[0].canReply).toBe(false);
    expect(rows[0].replyDisabledReason).toMatch(/opted out of email/i);
  });

  it("email gate: no email on file", () => {
    const rows = buildThreadRows([cust({ email: null })], [msg({ channel: "email", subject: "x" })], labels);
    expect(rows[0].canReply).toBe(false);
    expect(rows[0].replyDisabledReason).toMatch(/no email/i);
  });

  it("email gate: no invoice to attach", () => {
    const rows = buildThreadRows([cust({ latestInvoiceId: null })],
      [msg({ channel: "email", subject: "x", invoiceId: null })], labels);
    expect(rows[0].canReply).toBe(false);
    expect(rows[0].replyDisabledReason).toMatch(/invoice/i);
  });

  it("bounced/complained trip needsAttention", () => {
    const bounced = buildThreadRows([cust()], [msg({ channel: "email", subject: "x", status: "bounced" })], labels);
    expect(bounced[0].needsAttention).toBe(true);
  });

  it("applyChannelFilter narrows by channel", () => {
    const rows = buildThreadRows([cust()], [msg({ channel: "sms" }), msg({ channel: "email", subject: "x" })], labels);
    expect(applyChannelFilter(rows, "sms").map((r) => r.channel)).toEqual(["sms"]);
    expect(applyChannelFilter(rows, "email").map((r) => r.channel)).toEqual(["email"]);
    expect(applyChannelFilter(rows, "all")).toHaveLength(2);
  });

  it("metrics count across both channels", () => {
    const rows = buildThreadRows([cust()], [
      msg({ channel: "sms", direction: "inbound" }),
      msg({ channel: "email", subject: "x", direction: "inbound" }),
    ], labels);
    expect(computeMessageMetrics(rows).needsReply).toBe(2);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd nudgepay-app && npx vitest run test/message-inbox.test.ts`
Expected: FAIL (type errors / `applyChannelFilter` missing / `channel` required).

- [ ] **Step 3: Replace `message-inbox.ts` with the channel-aware version**

```ts
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
```

> Note the grouping uses `key.lastIndexOf("::")` so a customerId containing `::` still parses (UUIDs won't, but this is robust). `active` counts each `(customer,channel)` row — so a both-channels customer counts twice in metrics; this is acceptable (metrics describe conversations, not customers) and matches the per-conversation model. If product wants per-customer `active`, dedupe in a later phase — out of scope here.

- [ ] **Step 4: Run, verify pass**

Run: `cd nudgepay-app && npx vitest run test/message-inbox.test.ts`
Expected: PASS (all regression + email cases).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/message-inbox.ts nudgepay-app/test/message-inbox.test.ts
git commit -m "feat(messages): channel-aware inbox deriver (sms + email)"
```

---

### Task 2: `messages.tsx` loader — read email + channel filter + selection

**Files:**
- Modify: `nudgepay-app/app/routes/messages.tsx`

**Interfaces:**
- Consumes: channel-aware `buildThreadRows`/`applyChannelFilter`/`CHANNEL_FILTERS` (Task 1), `resolveEmailSettings` (Phase 15).
- Produces: loader data with channel-filtered rows, `channel` selection, `emailEnabled`, channel counts. Consumed by Tasks 3, 4.

> Read the current `messages.tsx` loader (it is the template). All new reads use the user client with explicit `org_id`, exactly as the existing `text_messages` read.

- [ ] **Step 1: Read `email_messages`** alongside `text_messages`:

```ts
const { data: emailRows } = await supabase
  .from("email_messages")
  .select("customer_id, direction, body, subject, status, error_code, invoice_id, created_at")
  .eq("org_id", org.org_id)
  .not("customer_id", "is", null);
const rawEmails = (emailRows as any[]) ?? [];
```

- [ ] **Step 2: Tag both sets with channel and concat into `messagesInput`:**

```ts
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
```

(`mapSms` = the existing per-row mapping; add `subject: null` to the SMS shape.)

- [ ] **Step 3: Union the customer set** from `messagesInput` (both channels) for the `customers`/cases/invoices reads. Extend the `customers` select to include `email`:

```ts
.select("id, name, phone, email, owner, sms_consent, preferred_channel, do_not_call, do_not_text, do_not_email")
```

and add `email: (c.email as string | null) ?? null,` to each `ThreadCustomerInput`.

- [ ] **Step 4: Parse `?channel=`** and apply the filter before tab/sort:

```ts
import { CHANNEL_FILTERS, applyChannelFilter, type ChannelFilter } from "../lib/message-inbox";
const channel: ChannelFilter = (CHANNEL_FILTERS as string[]).includes(sp.get("channel") ?? "")
  ? (sp.get("channel") as ChannelFilter) : "all";
// after search:
const channelFiltered = applyChannelFilter(searched, channel);
const metrics = computeMessageMetrics(channelFiltered);
const counts = Object.fromEntries(MESSAGE_TABS.map((t) => [t, applyMessageTab(channelFiltered, t).length])) as Record<MessageTab, number>;
const rows = sortThreadRows(applyMessageTab(channelFiltered, tab), sort);
const channelCounts = {
  all: searched.length,
  sms: searched.filter((r) => r.channel === "sms").length,
  email: searched.filter((r) => r.channel === "email").length,
};
```

- [ ] **Step 5: Key the selected thread by `(customerId, channel)`:**

```ts
const selChannel = sp.get("channel") === "email" ? "email" : sp.get("channel") === "sms" ? "sms" : null;
const selected = customerId
  ? (allRows.find((r) => r.customerId === customerId && (selChannel == null || r.channel === selChannel)) ?? null)
  : null;
```

Load the selected thread's messages from the matching raw set (sms → `rawMessages`, email → `rawEmails`), including `subject` for email. `selectedConsent`/`selectedPhone` stay for SMS; add `selectedEmail`/`selectedDoNotEmail` for email composer gating.

- [ ] **Step 6: Load `emailEnabled`:**

```ts
import { resolveEmailSettings } from "../lib/email-settings";
const { data: ecfg } = await supabase.from("email_config")
  .select("email_enabled, from_address, from_name").eq("org_id", org.org_id).maybeSingle();
const emailEnabled = resolveEmailSettings(ecfg as any).emailEnabled;
```

Return `channel`, `channelCounts`, `emailEnabled`, `selectedEmail`, `selectedDoNotEmail`, and the selected row's `channel` in the loader `data(...)`. Pass them through to the components.

- [ ] **Step 7: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add nudgepay-app/app/routes/messages.tsx
git commit -m "feat(messages): load email threads + channel filter + selection"
```

---

### Task 3: `MessagesInbox` — channel badge + filter control

**Files:**
- Modify: `nudgepay-app/app/components/MessagesInbox.tsx`

**Interfaces:**
- Consumes: `rows` (each with `.channel`/`.subjectSnippet`), `channel`/`channelCounts` props (Task 2).

> Read the current `MessagesInbox.tsx` and the existing tab/sort filter controls; mirror their link-building (preserve `tab`/`sort`/`q` in query params) for the new channel control.

- [ ] **Step 1: Add an "All / SMS / Email" filter control** above the row list, each a link that sets `?channel=` while preserving `tab`/`sort`/`q`. Show `channelCounts` next to each label. Style with warm-token active/inactive classes matching the existing tab control.

- [ ] **Step 2: Add a channel badge per row** (e.g. a small `SMS` / `Email` pill using literal warm-token classes — copper for one, cool for the other). For email rows, show `subjectSnippet` above/with the message snippet.

- [ ] **Step 3: Carry `&channel=<row.channel>`** on each row's selection link so the thread panel opens the correct conversation.

- [ ] **Step 4: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/components/MessagesInbox.tsx
git commit -m "feat(messages): channel badge + channel filter in inbox"
```

---

### Task 4: `MessageThreadPanel` — channel-aware thread + composer

**Files:**
- Modify: `nudgepay-app/app/components/MessageThreadPanel.tsx`

**Interfaces:**
- Consumes: the selected row's `channel`, `messages` (with `subject` for email), `emailEnabled`, `selectedEmail`/`selectedDoNotEmail`, `canReply`/`replyDisabledReason`, `EMAIL_TEMPLATES`/`applyEmailTemplate` (Phase 15), `/api/email/send` + `/api/text/send`.

> Read the current `MessageThreadPanel.tsx` SMS composer; add an email branch that mirrors the DetailPanel email composer from Phase 15.

- [ ] **Step 1: Render the thread per channel.** For email, show the subject line on each bubble; for SMS, unchanged.

- [ ] **Step 2: Branch the composer on the selected row's channel:**
  - **SMS** (unchanged): SMS templates → `/api/text/send`, gated by `smsEnabled` + `canReply`/`replyDisabledReason`.
  - **Email**: a `<form method="post" action="/api/email/send">` with hidden `invoiceId` (= `anchorInvoiceId`) + `returnTo` (= current `/messages?...&channel=email&customerId=...`), an email-template `<select>` (fills subject+body via `applyEmailTemplate` and `vars`), a subject input, a body textarea, gated by `emailEnabled` + `canReply`/`replyDisabledReason`.

- [ ] **Step 3: Result banners** — handle both `?sms=` and `?email=` codes (sent/disabled/optout/blocked/error), mirroring the existing SMS banner.

- [ ] **Step 4: Disabled-with-reason** — when the row's `canReply` is false (or the channel is disabled at workspace level), show the reason and disable the composer; never silently no-op.

- [ ] **Step 5: Typecheck + build + full suite**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/components/MessageThreadPanel.tsx
git commit -m "feat(messages): channel-aware thread panel + email composer"
```

---

## Self-Review notes

- **Spec coverage:** §A→T1, §B→T2, §C→T3+T4. All covered.
- **Regression guard:** T1 Step 1 asserts SMS-only rows keep the old gate/metrics. This is the highest-risk change — the reviewer must confirm no SMS behavior drift.
- **Type consistency:** `ThreadMessageInput.channel`/`subject` and `ThreadCustomerInput.email` (T1) are produced by the loader (T2) and consumed (type-only) by components (T3, T4). `ChannelFilter`/`applyChannelFilter` (T1) used in T2/T3.
- **Reply routing:** email composer reuses the Phase 15 `/api/email/send` (no new send path). `returnTo` must include `channel=email` so the post-send redirect reopens the email conversation.
- **`customers.email` dependency:** loader selects `email` — confirmed present (`0001` line 42).
```
