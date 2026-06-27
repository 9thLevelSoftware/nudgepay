# Phase 13 — Messages Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the last inert side-nav item as a cross-customer SMS inbox at `/messages` — triage threads (needs-reply / failed-delivery / active / inactive), and reply inline reusing the existing send/consent routes.

**Architecture:** Mirror the Phase 11/12 (Accounts/Promises) tab pattern exactly: one pure deriver lib (`message-inbox.ts`), one RLS loader route (`messages.tsx`) reusing the connect-gate prelude, and presentational components (metrics strip + inbox list + `?customerId=` quick-view). Reads via the RLS user client; writes reuse `/api/text/send` and `/api/sms-consent` (already `returnTo`-aware). The shared message-bubble renderer is extracted from `DetailPanel` so both surfaces render identically. SMS-only but channel-aware (`channel: "sms"` reserved for future email). No migration, no new write routes, no messaging-backend changes.

**Tech Stack:** React Router v7 (framework mode) on Cloudflare Workers · Supabase (RLS via `is_org_member`) · Tailwind v4 (CSS-first, literal class maps) · Vitest against local Supabase.

## Global Constraints

- React Router v7 framework mode on Cloudflare Workers. No `node:*` imports in `app/**`. No client→`.server.ts` module-graph reference; pure modules stay suffix-free (`message-inbox.ts`, `sms-templates.ts`, `comm-prefs.ts`).
- Tailwind v4 CSS-first; static **literal** class strings only (no dynamic `bg-${x}`). Phase-10 warm tokens: cool/warm/hot, copper accent, ink/panel/surface/paper/border/text/muted.
- Supabase RLS via `is_org_member(org_id)`; **user client** for reads + the consent write; **service client** only where Phase 4 already uses it (the send via `/api/text/send`). The browser never touches the DB.
- Vitest against local Supabase; per-test fresh orgs + globally-unique data; never global truncation. Run via `npx vitest run`.
- Conventional Commits. Never commit secrets (`.env.test`/`.dev.vars` gitignored). Never `git add` untracked prototype dirs / local-only scripts.
- **No new migration; no new write routes; no messaging-backend changes** in this phase. Email is out of scope (only `channel: "sms"` reserved).
- Gates per task that touches `app/**`: `npx vitest run` green · `npx tsc --noEmit` exit 0 · `npx react-router build` clean. Run all commands from `nudgepay-app/`.

---

### Task 1: Pure deriver — `app/lib/message-inbox.ts`

**Files:**
- Create: `nudgepay-app/app/lib/message-inbox.ts`
- Test: `nudgepay-app/tests/message-inbox.test.ts`

**Interfaces:**
- Consumes: `CommPrefs`, `canSendSms` from `./comm-prefs` (existing).
- Produces (later tasks rely on these exact names/types):
  - `MESSAGE_TABS: readonly MessageTab[]`, `type MessageTab = "needs-reply"|"needs-attention"|"active"|"inactive"|"all"`
  - `MESSAGE_SORTS: readonly MessageSort[]`, `type MessageSort = "recent"|"oldest-waiting"|"name"`
  - `type ThreadMessageInput`, `type ThreadCustomerInput`, `type ThreadRow`
  - `buildThreadRows(customers: ThreadCustomerInput[], messages: ThreadMessageInput[], ownerLabels: Map<string,string>): ThreadRow[]`
  - `applyMessageTab(rows: ThreadRow[], tab: MessageTab): ThreadRow[]`
  - `sortThreadRows(rows: ThreadRow[], sort: MessageSort): ThreadRow[]`
  - `computeMessageMetrics(rows: ThreadRow[]): { needsReply: number; needsAttention: number; active: number; unanswered: number }`

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/message-inbox.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  buildThreadRows, applyMessageTab, sortThreadRows, computeMessageMetrics,
  MESSAGE_TABS, MESSAGE_SORTS,
  type ThreadCustomerInput, type ThreadMessageInput,
} from "../app/lib/message-inbox";
import { DEFAULT_COMM_PREFS } from "../app/lib/comm-prefs";

const prefs = (over = {}) => ({ ...DEFAULT_COMM_PREFS, ...over });

// c1 latest=inbound → needsReply; c2 latest=outbound failed → needsAttention;
// c3 latest=outbound delivered, open case → active; c4 no open case → inactive;
// c5 has NO messages → excluded entirely; c6 no consent → canReply false.
const CUSTOMERS: ThreadCustomerInput[] = [
  { customerId: "c1", name: "Acme",    ownerId: "u1",  smsConsent: true,  commPrefs: prefs(),                 hasOpenCase: true,  openCaseId: "k1", latestInvoiceId: "i1" },
  { customerId: "c2", name: "Globex",  ownerId: null,  smsConsent: true,  commPrefs: prefs(),                 hasOpenCase: true,  openCaseId: "k2", latestInvoiceId: "i2" },
  { customerId: "c3", name: "Initech", ownerId: "u1",  smsConsent: true,  commPrefs: prefs(),                 hasOpenCase: true,  openCaseId: "k3", latestInvoiceId: "i3" },
  { customerId: "c4", name: "Umbrella",ownerId: "u1",  smsConsent: true,  commPrefs: prefs(),                 hasOpenCase: false, openCaseId: null, latestInvoiceId: "i4" },
  { customerId: "c5", name: "Stark",   ownerId: "u1",  smsConsent: true,  commPrefs: prefs(),                 hasOpenCase: true,  openCaseId: "k5", latestInvoiceId: "i5" },
  { customerId: "c6", name: "Wayne",   ownerId: "u1",  smsConsent: false, commPrefs: prefs({ doNotText: true }), hasOpenCase: true, openCaseId: "k6", latestInvoiceId: null },
];

const MESSAGES: ThreadMessageInput[] = [
  { customerId: "c1", direction: "outbound", body: "Hi",       status: "delivered", errorCode: null, invoiceId: "i1",  createdAt: "2026-06-20T10:00:00Z" },
  { customerId: "c1", direction: "inbound",  body: "Calling",  status: null,        errorCode: null, invoiceId: "i1",  createdAt: "2026-06-21T10:00:00Z" },
  { customerId: "c2", direction: "outbound", body: "Past due", status: "failed",    errorCode: "30007", invoiceId: "i2", createdAt: "2026-06-19T10:00:00Z" },
  { customerId: "c3", direction: "outbound", body: "Reminder", status: "delivered", errorCode: null, invoiceId: null,  createdAt: "2026-06-18T10:00:00Z" },
  { customerId: "c4", direction: "inbound",  body: "Paid?",    status: null,        errorCode: null, invoiceId: null,  createdAt: "2026-06-17T10:00:00Z" },
  { customerId: "c6", direction: "inbound",  body: "Stop pls", status: null,        errorCode: null, invoiceId: null,  createdAt: "2026-06-16T10:00:00Z" },
];
const LABELS = new Map([["u1", "diskin"]]);

test("frozen constants list every tab and sort", () => {
  expect(MESSAGE_TABS).toEqual(["needs-reply", "needs-attention", "active", "inactive", "all"]);
  expect(MESSAGE_SORTS).toEqual(["recent", "oldest-waiting", "name"]);
});

test("customers with zero messages are excluded; owner label resolves", () => {
  const rows = buildThreadRows(CUSTOMERS, MESSAGES, LABELS);
  expect(rows.map((r) => r.customerId).sort()).toEqual(["c1", "c2", "c3", "c4", "c6"]); // no c5
  const byId = new Map(rows.map((r) => [r.customerId, r]));
  expect(byId.get("c1")!.ownerLabel).toBe("diskin");
  expect(byId.get("c2")!.ownerLabel).toBe("Unassigned"); // null owner
  expect(byId.get("c1")!.channel).toBe("sms");
});

test("needsReply, needsAttention, active, unansweredInbound derivation", () => {
  const byId = new Map(buildThreadRows(CUSTOMERS, MESSAGES, LABELS).map((r) => [r.customerId, r]));
  expect(byId.get("c1")!.needsReply).toBe(true);       // latest inbound
  expect(byId.get("c1")!.unansweredInbound).toBe(1);
  expect(byId.get("c2")!.needsAttention).toBe(true);   // latest outbound failed
  expect(byId.get("c2")!.needsReply).toBe(false);
  expect(byId.get("c3")!.needsAttention).toBe(false);  // delivered
  expect(byId.get("c3")!.active).toBe(true);           // open case
  expect(byId.get("c4")!.active).toBe(false);          // no open case
  expect(byId.get("c3")!.unansweredInbound).toBe(0);   // latest outbound
  expect(byId.get("c1")!.lastMessage!.direction).toBe("inbound");
});

test("needsAttention also trips on errorCode regardless of status string", () => {
  const msgs: ThreadMessageInput[] = [
    { customerId: "c1", direction: "outbound", body: "x", status: "sent", errorCode: "30008", invoiceId: "i1", createdAt: "2026-06-22T10:00:00Z" },
  ];
  const r = buildThreadRows([CUSTOMERS[0]], msgs, LABELS)[0];
  expect(r.needsAttention).toBe(true);
});

test("anchorInvoiceId: latest message's invoice, else customer's latest invoice, else null", () => {
  const byId = new Map(buildThreadRows(CUSTOMERS, MESSAGES, LABELS).map((r) => [r.customerId, r]));
  expect(byId.get("c1")!.anchorInvoiceId).toBe("i1"); // from messages
  expect(byId.get("c3")!.anchorInvoiceId).toBe("i3"); // messages have null invoice → fallback latestInvoiceId
  expect(byId.get("c6")!.anchorInvoiceId).toBe(null); // no msg invoice, no latest invoice
});

test("canReply truth table + replyDisabledReason precedence", () => {
  const byId = new Map(buildThreadRows(CUSTOMERS, MESSAGES, LABELS).map((r) => [r.customerId, r]));
  expect(byId.get("c1")!.canReply).toBe(true);
  expect(byId.get("c1")!.replyDisabledReason).toBe(null);
  expect(byId.get("c6")!.canReply).toBe(false);
  expect(byId.get("c6")!.replyDisabledReason).toBe("Customer has not consented to SMS");
  // consent ok but no invoice
  const noInv: ThreadCustomerInput = { ...CUSTOMERS[0], customerId: "c9", latestInvoiceId: null };
  const msgs: ThreadMessageInput[] = [
    { customerId: "c9", direction: "inbound", body: "hi", status: null, errorCode: null, invoiceId: null, createdAt: "2026-06-22T10:00:00Z" },
  ];
  const r = buildThreadRows([noInv], msgs, LABELS)[0];
  expect(r.canReply).toBe(false);
  expect(r.replyDisabledReason).toBe("No invoice on file to attach");
});

test("applyMessageTab partitions by tab", () => {
  const rows = buildThreadRows(CUSTOMERS, MESSAGES, LABELS);
  const ids = (tab: any) => applyMessageTab(rows, tab).map((r) => r.customerId).sort();
  expect(ids("needs-reply")).toEqual(["c1", "c4", "c6"]);     // latest inbound
  expect(ids("needs-attention")).toEqual(["c2"]);
  expect(ids("active")).toEqual(["c1", "c2", "c3", "c6"]);    // open case
  expect(ids("inactive")).toEqual(["c4"]);
  expect(applyMessageTab(rows, "all").length).toBe(5);
});

test("sortThreadRows: recent desc, oldest-waiting (needs-reply oldest first), name asc", () => {
  const rows = buildThreadRows(CUSTOMERS, MESSAGES, LABELS);
  expect(sortThreadRows(rows, "recent").map((r) => r.customerId)[0]).toBe("c1"); // 06-21 newest
  expect(sortThreadRows(rows, "name").map((r) => r.customerName)[0]).toBe("Acme");
  const ow = sortThreadRows(rows, "oldest-waiting").map((r) => r.customerId);
  expect(ow.slice(0, 3)).toEqual(["c6", "c4", "c1"]); // needs-reply rows, oldest createdAt first
});

test("computeMessageMetrics counts", () => {
  const m = computeMessageMetrics(buildThreadRows(CUSTOMERS, MESSAGES, LABELS));
  expect(m.needsReply).toBe(3);
  expect(m.needsAttention).toBe(1);
  expect(m.active).toBe(4);
  expect(m.unanswered).toBe(3); // rows with unansweredInbound > 0 (c1, c4, c6)
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/message-inbox.test.ts`
Expected: FAIL — `Cannot find module '../app/lib/message-inbox'`.

- [ ] **Step 3: Write minimal implementation**

Create `nudgepay-app/app/lib/message-inbox.ts`:

```ts
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/message-inbox.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Run full suite + typecheck**

Run: `cd nudgepay-app && npx vitest run && npx tsc --noEmit`
Expected: full suite green; tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/lib/message-inbox.ts nudgepay-app/tests/message-inbox.test.ts
git commit -m "feat(messages): pure thread-inbox deriver + tests"
```

---

### Task 2: Extract shared `MessageBubbles` from `DetailPanel`

**Files:**
- Create: `nudgepay-app/app/components/MessageBubbles.tsx`
- Modify: `nudgepay-app/app/components/DetailPanel.tsx` (remove inline `BUBBLE` map + thread `<ol>`; import + use `MessageBubbles`)

**Interfaces:**
- Produces: `MessageBubbles({ messages }: { messages: ThreadBubble[] })`, `type ThreadBubble = { id: string; direction: string; body: string | null; status: string | null; errorCode: string | null }`. Renders the ascending bubble list (assumes the caller has already handled the empty state). Consumed by `DetailPanel` (Task 2) and `MessageThreadPanel` (Task 3).

This is a behavior-preserving refactor — no unit test (no render-test infra); verified by `tsc` + `build`.

- [ ] **Step 1: Create the shared component**

Create `nudgepay-app/app/components/MessageBubbles.tsx`:

```tsx
// app/components/MessageBubbles.tsx
// Shared ascending SMS-thread bubble renderer. Extracted from DetailPanel so the
// dashboard detail panel and the Messages-tab quick-view render identically.
// Callers handle their own empty state; this renders the bubble list only.

// Static direction → bubble alignment/color. Literal strings for the Tailwind v4 scanner.
const BUBBLE: Record<string, { wrap: string; bubble: string }> = {
  outbound: { wrap: "items-end", bubble: "bg-ink text-surface border border-ink" },
  inbound: { wrap: "items-start", bubble: "bg-paper text-text border border-border" },
};

export type ThreadBubble = {
  id: string;
  direction: string;
  body: string | null;
  status: string | null;
  errorCode: string | null;
};

export function MessageBubbles({ messages }: { messages: ThreadBubble[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m) => {
        const side = BUBBLE[m.direction] ?? BUBBLE.inbound;
        return (
          <li key={m.id} className={`flex flex-col gap-0.5 ${side.wrap}`}>
            <span className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm font-sans whitespace-pre-wrap ${side.bubble}`}>
              {m.body}
            </span>
            <span className="font-mono text-[11px] text-muted">
              {m.direction}
              {m.status ? ` · ${m.status}` : ""}
              {m.errorCode ? ` · ${m.errorCode}` : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 2: Refactor `DetailPanel.tsx` to use it**

In `nudgepay-app/app/components/DetailPanel.tsx`:

1. Add the import near the other `~/components` imports (after the `Icon` import on line 5):

```tsx
import { MessageBubbles } from "~/components/MessageBubbles";
```

2. Delete the now-unused `BUBBLE` const (the block at lines 86–90):

```tsx
// Static direction → bubble alignment/color. Literal strings for Tailwind.
const BUBBLE: Record<string, { wrap: string; bubble: string }> = {
  outbound: { wrap: "items-end",   bubble: "bg-ink text-surface border border-ink" },
  inbound:  { wrap: "items-start", bubble: "bg-paper text-text border border-border" },
};
```

3. Replace the thread `<ol>…</ol>` (lines 199–215, inside the `messages.length === 0 ? (…) : (` ternary) with:

```tsx
          <MessageBubbles messages={messages} />
```

The surrounding empty-state branch (`messages.length === 0 ? (<div>…No messages yet…</div>) : (…)`) stays exactly as is.

- [ ] **Step 3: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: tsc exit 0; build clean (no unused-var error for `BUBBLE`; `MessageBubbles` resolves).

- [ ] **Step 4: Run the suite (no behavior change)**

Run: `cd nudgepay-app && npx vitest run`
Expected: full suite green (unchanged).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/components/MessageBubbles.tsx nudgepay-app/app/components/DetailPanel.tsx
git commit -m "refactor(messages): extract shared MessageBubbles from DetailPanel"
```

---

### Task 3: The `/messages` surface — loader, page, components, route

**Files:**
- Create: `nudgepay-app/app/routes/messages.tsx` (loader + page)
- Create: `nudgepay-app/app/components/MessagesMetrics.tsx`
- Create: `nudgepay-app/app/components/MessagesInbox.tsx`
- Create: `nudgepay-app/app/components/MessageThreadPanel.tsx`
- Modify: `nudgepay-app/app/routes.ts` (register `messages`)

**Interfaces:**
- Consumes: everything from Task 1 (`buildThreadRows`, `applyMessageTab`, `sortThreadRows`, `computeMessageMetrics`, `MESSAGE_TABS`, `MESSAGE_SORTS`, `MessageTab`, `MessageSort`, `ThreadRow`, `MessageMetrics`, `ThreadCustomerInput`, `ThreadMessageInput`); `MessageBubbles`/`ThreadBubble` from Task 2; `MessageEntry` from `~/routes/dashboard`; `SMS_TEMPLATES`/`applyTemplate`/`TemplateVars` from `~/lib/sms-templates`; `resolveCommPrefs` from `~/lib/comm-prefs`; `formatUSD` from `~/lib/format`; `formatDate` from `~/lib/dates`; `listOrgMembers` from `~/lib/orgs.server`.
- Produces: route `/messages`. No exported API consumed by later tasks except `activeNav="messages"` (Task 4 wires the nav).

No new unit tests (loader is DB-backed and thin; all derivation logic is unit-tested in Task 1 — same decision as Promises, which has no loader unit test). Verified by `tsc` + `build`, then a live Chrome pass in Task 4.

- [ ] **Step 1: Create `MessagesMetrics.tsx`**

Create `nudgepay-app/app/components/MessagesMetrics.tsx`:

```tsx
// app/components/MessagesMetrics.tsx
import { Link } from "react-router";
import type { MessageMetrics } from "../lib/message-inbox";

type Accent = "copper" | "hot" | "ink" | "cool";
const ACCENT_TEXT: Record<Accent, string> = { copper: "text-copper", hot: "text-hot", ink: "text-text", cool: "text-cool" };
const ACCENT_DOT: Record<Accent, string> = { copper: "bg-copper", hot: "bg-hot", ink: "bg-ink", cool: "bg-cool" };

function Tile({ to, label, value, sub, accent }: { to: string; label: string; value: string; sub: string; accent: Accent }) {
  return (
    <Link
      to={to}
      className="relative flex flex-col p-4 rounded-tile overflow-hidden min-w-0 bg-paper border border-border hover:border-copper/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
    >
      <span aria-hidden="true" className={`absolute top-0 inset-x-0 h-0.5 ${ACCENT_DOT[accent]}`} />
      <span className="flex items-center gap-1.5 mb-2">
        <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${ACCENT_DOT[accent]}`} />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted truncate">{label}</span>
      </span>
      <span className="font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-text">{value}</span>
      <span className={`mt-1.5 text-xs ${ACCENT_TEXT[accent]}`}>{sub}</span>
    </Link>
  );
}

export function MessagesMetrics({ metrics }: { metrics: MessageMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-4" aria-label="Messages summary metrics">
      <Tile to="?tab=needs-reply"     label="Needs reply"     value={String(metrics.needsReply)}     sub="customer waiting on us" accent="copper" />
      <Tile to="?tab=needs-attention" label="Needs attention" value={String(metrics.needsAttention)} sub="delivery failed"        accent="hot" />
      <Tile to="?tab=active"          label="Active threads"  value={String(metrics.active)}         sub="open collection case"   accent="ink" />
      <Tile to="?tab=all"             label="Unanswered"      value={String(metrics.unanswered)}     sub="threads with replies"   accent="cool" />
    </div>
  );
}
```

- [ ] **Step 2: Create `MessagesInbox.tsx`**

Create `nudgepay-app/app/components/MessagesInbox.tsx`:

```tsx
// app/components/MessagesInbox.tsx
import { Form, Link } from "react-router";
import type { ThreadRow, MessageTab, MessageSort } from "../lib/message-inbox";
import { formatDate } from "../lib/dates";

const TABS: { id: MessageTab; label: string }[] = [
  { id: "needs-reply", label: "Needs reply" },
  { id: "needs-attention", label: "Needs attention" },
  { id: "active", label: "Active" },
  { id: "inactive", label: "Inactive" },
  { id: "all", label: "All" },
];
const SORTS: { id: MessageSort; label: string }[] = [
  { id: "recent", label: "Most recent" },
  { id: "oldest-waiting", label: "Oldest waiting" },
  { id: "name", label: "Customer (A–Z)" },
];

interface Props {
  rows: ThreadRow[];
  tab: MessageTab;
  sort: MessageSort;
  search: string;
  counts: Record<MessageTab, number>;
  selectedId: string | null;
}

export function MessagesInbox({ rows, tab, sort, search, counts, selectedId }: Props) {
  const tabHref = (id: MessageTab) =>
    `?${new URLSearchParams({ tab: id, sort, ...(search ? { q: search } : {}) }).toString()}`;
  const rowHref = (customerId: string) =>
    `?${new URLSearchParams({ tab, sort, ...(search ? { q: search } : {}), customerId }).toString()}`;

  return (
    <section className="flex flex-col bg-surface border border-border rounded-card overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 bg-paper border-b border-border">
        <h2 className="font-display text-sm font-semibold text-text">Messages</h2>
        <span className="text-xs text-muted">{rows.length} matching</span>
        <Form method="get" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="tab" value={tab} />
          {selectedId ? <input type="hidden" name="customerId" value={selectedId} /> : null}
          <label className="sr-only" htmlFor="msg-search">Search</label>
          <input
            id="msg-search" name="q" defaultValue={search} placeholder="Search customer…"
            className="h-8 px-2 rounded border border-border bg-surface text-sm"
          />
          <label className="sr-only" htmlFor="msg-sort">Sort</label>
          <select
            id="msg-sort" name="sort" defaultValue={sort}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-8 px-2 rounded border border-border bg-surface text-sm"
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Form>
      </header>

      <nav className="flex flex-wrap gap-2 px-4 py-2 border-b border-border" aria-label="Message thread filters">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <Link
              key={t.id} to={tabHref(t.id)} aria-current={active ? "page" : undefined}
              className={[
                "inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium border",
                active ? "bg-ink text-surface border-ink" : "bg-paper text-muted border-border hover:border-copper/50",
              ].join(" ")}
            >
              {t.label}
              <span className={active ? "text-surface/70" : "text-muted/70"}>{counts[t.id]}</span>
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">No threads in this view.</p>
      ) : (
        <ul role="list" className="divide-y divide-border">
          {rows.map((r) => {
            const selected = r.customerId === selectedId;
            return (
              <li key={r.customerId} className={selected ? "bg-copper/5" : ""}>
                <Link
                  to={rowHref(r.customerId)}
                  aria-current={selected ? "true" : undefined}
                  className={[
                    "relative flex flex-col gap-1 px-4 py-3",
                    "hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset",
                  ].join(" ")}
                >
                  {selected ? <span className="absolute left-0 inset-y-0 w-0.5 bg-copper" aria-hidden="true" /> : null}
                  <div className="flex items-center gap-2">
                    {r.needsReply ? <span className="w-1.5 h-1.5 rounded-full bg-copper shrink-0" aria-label="Needs reply" /> : null}
                    <span className="font-medium text-text truncate">{r.customerName}</span>
                    {r.needsAttention ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-hot/10 text-hot">Failed</span>
                    ) : null}
                    {r.unansweredInbound > 0 ? (
                      <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold bg-copper/10 text-copper">{r.unansweredInbound}</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="truncate">
                      {r.lastMessage ? (
                        <>
                          <span className="font-mono">{r.lastMessage.direction === "inbound" ? "← " : "→ "}</span>
                          {r.lastMessage.snippet || "(no text)"}
                        </>
                      ) : "No messages"}
                    </span>
                    {r.lastMessage ? <span className="ml-auto shrink-0 font-mono">{formatDate(r.lastMessage.createdAt)}</span> : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Create `MessageThreadPanel.tsx`**

Create `nudgepay-app/app/components/MessageThreadPanel.tsx`:

```tsx
// app/components/MessageThreadPanel.tsx
import { useEffect, useState } from "react";
import { Form, Link } from "react-router";
import type { ThreadRow } from "../lib/message-inbox";
import type { MessageEntry } from "~/routes/dashboard";
import { MessageBubbles } from "./MessageBubbles";
import { SMS_TEMPLATES, applyTemplate, type TemplateVars } from "../lib/sms-templates";
import { Icon } from "./Icons";

const SMS_BANNER: Record<string, { text: string; tone: string }> = {
  sent: { text: "Text sent.", tone: "text-cool" },
  noconsent: { text: "Not sent — customer has not consented to SMS.", tone: "text-hot" },
  optout: { text: "Not sent — customer opted out of texts.", tone: "text-hot" },
  error: { text: "Could not send the text.", tone: "text-hot" },
  blocked: { text: "Not sent — this case is marked do-not-contact / legal.", tone: "text-hot" },
};

interface Props {
  thread: ThreadRow | null;
  messages: MessageEntry[];
  consent: boolean;
  phone: string | null;
  vars: TemplateVars;
  sms: string | null;
  tab: string;
  sort: string;
  q: string;
}

export function MessageThreadPanel({ thread, messages, consent, phone, vars, sms, tab, sort, q }: Props) {
  const [body, setBody] = useState("");
  useEffect(() => { setBody(""); }, [thread?.customerId]);

  if (!thread) {
    return (
      <aside className="hidden lg:flex flex-col items-center justify-center bg-surface border border-border rounded-card p-8 text-center text-muted">
        <Icon name="message" size={28} className="mb-2 text-muted/60" />
        <p className="text-sm">Select a thread to preview it here.</p>
      </aside>
    );
  }

  const params = new URLSearchParams({ tab, sort, ...(q ? { q } : {}), customerId: thread.customerId });
  const returnTo = `/messages?${params.toString()}`;
  const banner = sms ? SMS_BANNER[sms] : null;

  return (
    <aside className="flex flex-col bg-surface border border-border rounded-card overflow-hidden">
      <header className="bg-ink text-surface px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-surface/50">Thread</p>
        <h2 className="font-display text-lg font-semibold leading-tight">{thread.customerName}</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {thread.openCaseId ? (
            <Link to={`/dashboard?case=${thread.openCaseId}`} className="inline-flex items-center gap-1 text-xs text-copper hover:underline">
              Open in Collections <Icon name="chevronRight" size={13} />
            </Link>
          ) : null}
          <Link to={`/accounts/${thread.customerId}`} className="inline-flex items-center gap-1 text-xs text-surface/70 hover:underline">
            View account
          </Link>
        </div>
      </header>

      {/* Consent row */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
        <span className="text-xs text-muted">
          SMS consent:{" "}
          <span className={consent ? "font-semibold text-cool" : "font-semibold text-hot"}>{consent ? "yes" : "no"}</span>
          {phone ? <span className="text-muted"> · {phone}</span> : null}
        </span>
        <Form method="post" action="/api/sms-consent">
          <input type="hidden" name="invoiceId" value={thread.anchorInvoiceId ?? ""} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="consent" value={consent ? "false" : "true"} />
          <button type="submit" className="text-xs font-medium text-copper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded">
            {consent ? "Revoke consent" : "Mark consented"}
          </button>
        </Form>
      </div>

      {banner ? <p className={`px-4 py-2 text-xs font-medium ${banner.tone}`}>{banner.text}</p> : null}

      {/* Thread */}
      <div className="max-h-[420px] overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Icon name="message" size={24} className="text-border" aria-hidden />
            <p className="text-sm font-semibold text-text">No messages yet.</p>
          </div>
        ) : (
          <MessageBubbles messages={messages} />
        )}
      </div>

      {/* Templates + composer */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Message templates">
          {SMS_TEMPLATES.map((t) => (
            <button
              key={t.id} type="button" onClick={() => setBody(applyTemplate(t.body, vars))}
              className="text-xs text-muted border border-border rounded-md px-2 py-1 hover:text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
            >
              {t.label}
            </button>
          ))}
        </div>
        <Form method="post" action="/api/text/send" className="flex flex-col gap-2">
          <input type="hidden" name="invoiceId" value={thread.anchorInvoiceId ?? ""} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <textarea
            name="body" rows={3} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Type a message…" required
            className="w-full resize-none rounded-md border border-border bg-panel px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
          <div className="flex items-center justify-between gap-2">
            {thread.canReply ? <span /> : <span className="text-xs text-muted">{thread.replyDisabledReason}</span>}
            <button
              type="submit" disabled={!thread.canReply}
              className="inline-flex items-center gap-1.5 rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-surface hover:bg-copper/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Icon name="message" size={14} aria-hidden /> Send text
            </button>
          </div>
        </Form>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Create the `messages.tsx` route (loader + page)**

Create `nudgepay-app/app/routes/messages.tsx`:

```tsx
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
  const selected = customerId ? (searched.find((r) => r.customerId === customerId) ?? null) : null;
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
      invoice: anchor?.docNumber ?? selected.customerName,
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
```

> **Note on `activeNav="messages"`:** this will be a TS error until Task 4 widens the `AppShell` `activeNav` union. That's expected — Task 3's `tsc` gate is run *after* registering the route but the union widening lands in Task 4. To keep Task 3 independently green, **do Task 4's AppShell type change as part of this build check** is NOT required; instead, this plan orders the AppShell union widening into Task 4 and accepts that the combined `tsc` gate passes at the end of Task 4. Run the Step-6 build check below; if `tsc` flags only the `activeNav="messages"` union, proceed to Task 4 and re-run. (If you prefer a strictly-green Task 3, widen the `activeNav` union in `AppShell.tsx` now — it is harmless without the nav wiring.)

- [ ] **Step 5: Register the route**

In `nudgepay-app/app/routes.ts`, add the `messages` line immediately after the `promises` route (line 14):

```ts
  route("promises", "routes/promises.tsx"),
  route("messages", "routes/messages.tsx"),
```

- [ ] **Step 6: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: clean — **except** possibly the single `activeNav="messages"` union error noted above, which Task 4 resolves. If that is the only error, continue to Task 4. To make this task green standalone, apply the one-line `activeNav` union widening from Task 4 Step 1 now.

- [ ] **Step 7: Run the suite**

Run: `cd nudgepay-app && npx vitest run`
Expected: full suite green (Task 1 tests included; no route tests added).

- [ ] **Step 8: Commit**

```bash
git add nudgepay-app/app/routes/messages.tsx nudgepay-app/app/components/MessagesMetrics.tsx nudgepay-app/app/components/MessagesInbox.tsx nudgepay-app/app/components/MessageThreadPanel.tsx nudgepay-app/app/routes.ts
git commit -m "feat(messages): /messages inbox loader, components, and route"
```

---

### Task 4: Wire the side-nav (Messages goes live) + verify

**Files:**
- Modify: `nudgepay-app/app/components/AppShell.tsx` (widen `activeNav`; add `messages` to `NAV_TARGETS` + `SECTION_TITLES`; update JSDoc)

**Interfaces:**
- Consumes: the `/messages` route from Task 3.
- Produces: `messages` as a live nav link with the copper active rail; `activeNav="messages"` becomes a valid prop.

- [ ] **Step 1: Widen the `activeNav` union**

In `nudgepay-app/app/components/AppShell.tsx`, change the `activeNav` prop type (line 13):

```tsx
  /** Which primary section is active (drives the nav rail + topbar title). */
  activeNav?: "collections" | "accounts" | "promises" | "messages";
```

- [ ] **Step 2: Add `messages` to titles + targets**

Replace the `SECTION_TITLES` and `NAV_TARGETS` maps (lines 67–73) with:

```tsx
  const SECTION_TITLES: Record<string, string> = {
    collections: "Collections", accounts: "Accounts", promises: "Promises", messages: "Messages",
  };
  const sectionTitle = SECTION_TITLES[activeNav] ?? "Collections";
  const NAV_TARGETS: Record<string, string> = {
    collections: "/dashboard", accounts: "/accounts", promises: "/promises", messages: "/messages",
  };
```

(Because `messages` now has a `NAV_TARGETS` entry, the nav `map` renders it through the live-link branch — the `aria-disabled` inert branch no longer matches it. No other nav code changes.)

- [ ] **Step 3: Update the JSDoc**

In the `AppShell` doc block, replace the side-nav description line (around lines 39–41) so it no longer calls Messages inert:

```tsx
 *   - `ink` left icon side-nav: Collections / Accounts / Promises / Messages
 *     (live links, copper left-edge indicator on the active section);
 *     Reports (link, owners only). Settings is reached from the top bar
 *     (gear icon + sync chip), not the side-nav.
```

- [ ] **Step 4: Full gates**

Run: `cd nudgepay-app && npx vitest run && npx tsc --noEmit && npx react-router build`
Expected: suite green; tsc exit 0 (the `activeNav="messages"` in `messages.tsx` now resolves); build clean.

- [ ] **Step 5: Live Chrome verification**

Start the dev server and sign in as the seeded connected/synced org (`diskin@chancey.test` / `password123` per the gap-checklist verification notes; seed via the demo-seed script if needed). Then:

1. Click the **Messages** side-nav item → lands on `/messages`, copper active rail on Messages, topbar title "Messages".
2. KPI strip shows Needs reply / Needs attention / Active / Unanswered counts.
3. **Needs reply** tab (default) lists threads whose latest message is inbound; counts on each pill match.
4. A thread with a failed/undelivered latest outbound shows the red **Failed** chip and appears under **Needs attention**.
5. Click a thread → quick-view shows the full conversation (bubbles), consent state, "Open in Collections"/"View account" deep-links.
6. With consent on + an invoice present: pick a template (fills the textarea with interpolated vars), send → returns to `/messages?...&sms=sent`, banner shows "Text sent.", new bubble appears.
7. With consent off (or no invoice): composer is disabled with the correct reason; consent toggle flips state and revalidates.
8. Search + sort (most recent / oldest waiting / name) re-filter the list and preserve the selected thread.

Capture a short GIF of steps 1–6 for the PR (optional but recommended).

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/components/AppShell.tsx
git commit -m "feat(messages): wire Messages side-nav live"
```

- [ ] **Step 7: Update the gap checklist (docs)**

Append a Phase 13 section (mirroring the J. Promises entry) to `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` recording: Messages tab built (cross-customer SMS inbox), the failed-delivery surfacing now closing the long-standing "undeliverable not surfaced in UI" non-feature, inline reply via reused routes, no migration, and that email + Settings channel/provider config remain deferred subsystems (#2/#3). Commit:

```bash
git add docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md
git commit -m "docs: record Phase 13 Messages tab in gap checklist"
```

---

## Self-Review

**1. Spec coverage:**
- §3 surface / per-customer thread / inline reply / derived needs-reply / failed surfacing / 5 tabs / anchor-invoice / no migration → Tasks 1 (derivation, tabs, anchor, needs-attention) + 3 (loader/components/reply) + 4 (nav). ✅
- §5.1 pure lib API → Task 1 (note: spec's `ThreadCustomerInput.anchorInvoiceId` refined to `latestInvoiceId` + derived `anchorInvoiceId` inside `buildThreadRows`, so the precedence rule is pure and unit-tested — internally consistent across Tasks 1/3). ✅
- §5.3 `MessageBubbles` extraction → Task 2. ✅
- §5.4/5.5/5.6/5.7/5.8 components/loader/route/nav → Tasks 3 + 4. ✅
- §6 security (RLS reads; reused service-client send; `safeReturnTo`) → loader uses user client; reply/consent reuse existing validated routes. ✅
- §7 edge cases (no messages → no row; no invoice → reply disabled; no consent; closed case → no Collections link) → Task 1 tests + Task 3 component branches + Task 4 live checks. ✅
- §8 testing (pure-lib unit tests; tsc/build; live pass) + §10 constraints → covered; deliberate no-loader-unit-test matches Promises, stated in Task 3. ✅
- §11 deferrals (email; Settings config; customer-scoped send) → not built; `channel:"sms"` reserved in Task 1; recorded in Task 4 Step 7. ✅

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". Every code step shows full code. The one forward-reference (`activeNav` union) is explicitly explained with a concrete resolution, not a vague deferral. ✅

**3. Type consistency:** `buildThreadRows`/`applyMessageTab`/`sortThreadRows`/`computeMessageMetrics`, `MessageTab`/`MessageSort`, `ThreadRow`/`ThreadCustomerInput`/`ThreadMessageInput`/`MessageMetrics` used identically across Tasks 1/3. `MessageBubbles({messages})` + `ThreadBubble`/`MessageEntry` shapes match (id/direction/body/status/errorCode). `TemplateVars` keys (customer/invoice/balance/dueDate) match `sms-templates.ts`. `/api/text/send` + `/api/sms-consent` field names (`invoiceId`/`returnTo`/`consent`/`body`) match the existing routes. ✅
