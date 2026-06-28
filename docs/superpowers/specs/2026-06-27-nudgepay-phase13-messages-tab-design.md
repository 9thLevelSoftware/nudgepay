# Phase 13 — Messages Tab (cross-customer SMS inbox) — Design

**Status:** Approved (design) — 2026-06-27
**Project:** NudgePay (AR-collections workspace for QuickBooks Online; Chancey Heating & Cooling)
**Predecessors:** Phases 1–12 complete and merged to `main`. Phase 5c built the per-customer SMS thread *inside* the dashboard DetailPanel; Phases 11 (Accounts) and 12 (Promises) established the top-level "tab" pattern this phase mirrors.

---

## 1. Goal

Activate the last inert side-nav item (**Messages**) as a dedicated top-level surface: a **cross-customer SMS inbox** that lets a rep see every conversation in one place, triage which threads need a reply or have a delivery problem, and respond inline — without hunting customer-by-customer through the dashboard.

This is **subsystem #1** of a three-part initiative (decided during brainstorming, 2026-06-27). The other two — (#2) in-UI channel/provider configuration in Settings, and (#3) a real transactional **email** backend — are **separate, later specs**. This phase is **SMS-only** but **channel-aware in shape** so email slots in later without reshaping the data model.

## 2. Background — what already exists (no re-architecture here)

- **`text_messages`** (0001/0006): `org_id, invoice_id, customer_id, case_id, sent_by_user_id, direction ('outbound'|'inbound'), twilio_message_sid, status, error_code, from_number, to_number, body, created_at`. Indexed by `org_id`, `(org_id, invoice_id)`, `(org_id, customer_id)`, `twilio_message_sid`.
- **`customers.sms_consent`** (legal/TCPA gate) + C6 comm-prefs (`preferred_channel`, `do_not_call`, `do_not_text`). `canSendSms(prefs, smsConsent)` is the single eligibility source of truth (`app/lib/comm-prefs.ts`).
- **`/api/text/send`** (`api.text.send.tsx` → `sendInvoiceText` in `twilio-messaging.server.ts`) — `returnTo`-aware action route; enforces consent + contact-block + `do_not_text`, sends via Twilio, records the outbound `text_messages` row. **Invoice-scoped** (requires `invoiceId`). Uses the Phase-4 service client (intentional, scoped by `org_id` + invoice `id`).
- **`/api/sms-consent`** (`api.sms-consent.tsx`) — RLS user-client consent toggle, `returnTo`-aware.
- **Inbound + status webhooks** — `recordInboundMessage` threads inbound replies to the customer's most-recent outbound `invoice_id` (may be null) and toggles `sms_consent` on STOP/START; `updateMessageStatus` writes `status`/`error_code` by SID.
- **`app/lib/sms-templates.ts`** — pure starter templates + `applyTemplate({customer},{invoice},{balance},{dueDate})`.
- **DetailPanel Messages tab** — the existing per-customer thread (bubbles + consent + composer) lives *inside* `DetailPanel.tsx`.

The Accounts (`accounts.tsx`) and Promises (`promises.tsx`) loaders establish the exact prelude, connect-gate, RLS-read, build-rows-via-pure-lib, and `?selector=` quick-view structure this phase copies.

## 3. Scope (locked decisions — brainstorming 2026-06-27)

| Decision | Choice |
| --- | --- |
| Surface | New top-level route `/messages`, mirroring Accounts/Promises (metrics strip + list + `?customerId=` quick-view). |
| Thread unit | **Per customer** (SMS is per-customer). One row per customer that has ≥1 message. |
| Reply model | **Inline reply** in the quick-view — reuse `/api/text/send` + `/api/sms-consent` (`returnTo=/messages?...`). **No new write routes.** |
| "Needs reply" | **Derived from data** — latest message is inbound. **No read/unread schema.** |
| Delivery failures | **Surfaced** — a "Needs attention" signal/tab/KPI for threads whose latest outbound has an `error_code` or undelivered/failed `status`. Closes the long-standing "undeliverable not surfaced in UI" gap. No schema change. |
| Tabs | Single pill dimension (like Promises): **Needs reply** (default) · **Needs attention** · **Active** · **Inactive** · **All**, count per pill. *Active* = open collection case; *Inactive* = no open case. |
| Reply anchor invoice | Latest message's `invoice_id` → fallback to the customer's most-recent invoice of **any** status. Reply disabled **only** if the customer has no invoice at all. |
| Email | **Out of scope.** Deferred to its own phase. Only a `channel: "sms"` field is reserved on the row type. |
| Migration | **None.** |

## 4. Architecture

```
/messages (loader, RLS user client, connect-gate prelude)
  ├─ reads: text_messages, customers (+comm-prefs), collection_cases, invoices, org members
  ├─ buildThreadRows() ── pure ── app/lib/message-inbox.ts
  ├─ applyMessageTab / sortThreadRows / computeMessageMetrics ── pure
  └─ render:
       MessagesMetrics      (KPI strip)
       MessagesInbox        (pill tabs + sort + search + thread rows)
       MessageThreadPanel   (?customerId= quick-view: bubbles + consent + composer)
                              └─ MessageBubbles (shared, extracted from DetailPanel)
writes (reused, returnTo-aware): /api/text/send, /api/sms-consent
```

Reads flow through the loader (RLS user client) exactly as Accounts/Promises. Writes reuse the two existing return-aware routes. No backend, route, or schema changes beyond the new read surface.

## 5. Components & data flow

### 5.1 `app/lib/message-inbox.ts` (NEW — pure, suffix-free)

```ts
export const MESSAGE_TABS = ["needs-reply", "needs-attention", "active", "inactive", "all"] as const;
export type MessageTab = (typeof MESSAGE_TABS)[number];
export const MESSAGE_SORTS = ["recent", "oldest-waiting", "name"] as const;
export type MessageSort = (typeof MESSAGE_SORTS)[number];

export type ThreadMessageInput = {
  customerId: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string | null;
  errorCode: string | null;
  invoiceId: string | null;
  createdAt: string;
};

export type ThreadCustomerInput = {
  customerId: string;
  name: string;
  ownerId: string | null;
  smsConsent: boolean;
  commPrefs: CommPrefs;          // from comm-prefs.ts
  hasOpenCase: boolean;
  openCaseId: string | null;
  anchorInvoiceId: string | null; // latest msg invoice → fallback latest invoice (any status)
};

export type ThreadRow = {
  channel: "sms";                 // reserved for future "email"
  customerId: string;
  customerName: string;
  ownerLabel: string | null;
  lastMessage: {
    direction: "inbound" | "outbound";
    snippet: string;              // body, trimmed/elided for the list
    status: string | null;
    errorCode: string | null;
    createdAt: string;
  } | null;
  unansweredInbound: number;      // inbound since the last outbound
  needsReply: boolean;            // latest message is inbound
  needsAttention: boolean;        // latest outbound failed/undelivered
  active: boolean;                // hasOpenCase
  canReply: boolean;             // canSendSms(prefs, consent) && anchorInvoiceId != null
  replyDisabledReason: string | null;
  openCaseId: string | null;
  anchorInvoiceId: string | null;
  searchText: string;            // lowercased name (+ owner) for the search box
};

export function buildThreadRows(
  customers: ThreadCustomerInput[],
  messages: ThreadMessageInput[],         // ALL messages, any order
  ownerLabels: Map<string, string>,
): ThreadRow[];

export function applyMessageTab(rows: ThreadRow[], tab: MessageTab): ThreadRow[];
export function sortThreadRows(rows: ThreadRow[], sort: MessageSort): ThreadRow[];
export function computeMessageMetrics(rows: ThreadRow[]): {
  needsReply: number; needsAttention: number; active: number; unanswered: number;
};
```

`unanswered` = count of rows with `unansweredInbound > 0` (a customer waiting on us). All four metrics are derived purely from `rows` — no date/`today` reference, so `computeMessageMetrics` stays deterministic and trivially testable.

Derivation rules (pure, unit-tested):
- A customer with **zero** messages produces **no** row (the inbox lists conversations, not the whole directory).
- `lastMessage` = max `createdAt` for the customer. `needsReply` = `lastMessage.direction === "inbound"`. `needsAttention` = `lastMessage.direction === "outbound"` AND (`errorCode` present OR `status` in the undelivered/failed set).
- `unansweredInbound` = count of inbound messages newer than the most-recent outbound (0 if the latest is outbound).
- **Undelivered/failed status set** — a frozen list (`failed`, `undelivered`) checked case-insensitively; `errorCode` presence also trips `needsAttention` regardless of status string.
- `canReply` = `canSendSms(prefs, consent)` AND `anchorInvoiceId != null`; `replyDisabledReason` is the first failing reason (no consent / opted out / no invoice).
- Tab filters: `needs-reply`→`needsReply`; `needs-attention`→`needsAttention`; `active`→`active`; `inactive`→`!active`; `all`→all.

### 5.2 `app/routes/messages.tsx` (NEW — loader + page)

- **Prelude** copied verbatim from `promises.tsx` (requireUser → resolveOrg → `/onboarding` redirect → service-client connect check → **`if (!connected) redirect("/settings")`** → sync label → `isOwner`).
- **URL params**: `tab` (validated against `MESSAGE_TABS`, default `needs-reply`), `sort` (default `recent`), `q`, `customerId`.
- **Reads (RLS user client, explicit `org_id`)**:
  - `text_messages` — `customer_id, direction, body, status, error_code, invoice_id, created_at` for the org. (At Chancey scale this whole-org read mirrors how the dashboard/accounts loaders already read messages.)
  - `customers` — `id, name, owner, sms_consent, preferred_channel, do_not_call, do_not_text` for the message-referenced customer ids → `resolveCommPrefs`.
  - `collection_cases` — `id, customer_id, closed_at` → `hasOpenCase`/`openCaseId` per customer (open = `closed_at is null`).
  - `invoices` — `id, customer_id, created_at` (and `balance` for template vars on the selected thread) to resolve `anchorInvoiceId` (latest msg invoice → fallback latest invoice, any status).
  - Org member roster (`listOrgMembers`, service client) → `ownerLabels`.
- Build rows via `buildThreadRows`; compute `metrics`, per-tab `counts`, `rows = sortThreadRows(applyMessageTab(searched, tab), sort)`; `selected = customerId ? rows-source.find(...) : null`.
- **Selected thread extras** (only when `customerId` set): the customer's **full** ascending message list (`MessageEntry`-shaped), consent/phone, the anchor invoice's `qbo_doc_number`/`balance`/`due_date` for template vars, and deep-link targets (`openCaseId`, customerId for `/accounts/:id`).

### 5.3 `app/components/MessageBubbles.tsx` (NEW — extracted shared renderer)

Pure presentational component rendering an ascending message list as thermal-token bubbles (outbound right/copper, inbound left/panel; per-bubble status line with `error_code` when present; empty state). **Extracted from `DetailPanel.tsx`** and consumed by both `DetailPanel` and `MessageThreadPanel` so the two surfaces render identically. `DetailPanel` is refactored to import it (behavior-preserving).

### 5.4 `app/components/MessagesInbox.tsx` (NEW)

Pill tabs (with counts) + sort `<select>` + search `<Form>` (GET, preserves params like Accounts) + the thread-row list. Each row: customer name, owner, last-message snippet + relative time, a **needs-reply** dot and a **needs-attention** (failed) chip when set, `unansweredInbound` badge. Row links to `?customerId=…` preserving `tab/sort/q`. Selected row highlighted. Empty state per tab.

### 5.5 `app/components/MessageThreadPanel.tsx` (NEW — quick-view, inline reply)

For the `?customerId=` thread:
1. Header: customer name + "View account" (`/accounts/:id`) and "Open in Collections" (`/dashboard?case=` when `openCaseId`).
2. **`MessageBubbles`** — the full conversation.
3. **Consent row** — `Form` → `/api/sms-consent` with `returnTo=/messages?customerId=…&tab=…`.
4. **Template picker + composer** — `Form method="post" action="/api/text/send"` with hidden `invoiceId` (= anchor invoice), `returnTo`; template buttons fill the textarea client-side via `applyTemplate` using the anchor invoice's vars. **Send disabled when `!canReply`**, showing `replyDisabledReason`. A `?sms=sent|noconsent|error` banner reflects the last send (same param `/api/text/send` already emits).

### 5.6 `app/components/MessagesMetrics.tsx` (NEW)

KPI tiles in the Phase-10 warm style: **Needs reply**, **Needs attention** (failed delivery), **Active threads**, **Unanswered** (threads with the customer waiting on us).

### 5.7 `AppShell.tsx` — wire the nav (the inert item goes live)

- Add `"messages"` to the `activeNav` union.
- Add `messages: "/messages"` to `NAV_TARGETS` and `messages: "Messages"` to `SECTION_TITLES`.
- `"messages"` now takes the live-link branch; the inert/`aria-disabled` branch no longer matches it. Update the JSDoc (Messages is no longer "inert"; no inert items remain).

### 5.8 `routes.ts`

Add `route("messages", "routes/messages.tsx")` (alongside `accounts`/`promises`).

## 6. Security boundary

- **Reads** (threads, customers, cases, invoices): RLS user client — a member sees only own-org rows. Identical to Accounts/Promises.
- **Reply send** (`/api/text/send`): keeps its intentional Phase-4 service client (org-scoped by `org_id` + invoice `id`; verifies customer + consent + contact-block server-side). Carry-over, not a regression — same boundary Phase 5c documented.
- **Consent write** (`/api/sms-consent`): RLS user client; invoice lookup is RLS-scoped.
- `returnTo` on both routes is `safeReturnTo`-validated (same-site absolute paths only; never `//host`). `/messages?...` is accepted; no open redirect.
- No secrets to the client; the browser never touches the DB.

## 7. Error & edge handling

- **No messages for the org** — inbox shows an empty state; metrics all zero.
- **Customer with messages but no invoice ever** (inbound-only contact) — `anchorInvoiceId` null → reply disabled with "No invoice on file to attach." Bubbles + consent still render.
- **No consent / `do_not_text`** — composer disabled with the specific reason; an attempted send (consent revoked between load and submit) is re-blocked server-side → `sms=noconsent`/`error` banner.
- **Contact-block (legal/agency hold)** — server-side `sendInvoiceText` throws → `sms=error`; the case-level hold dominates (existing precedence).
- **Latest-outbound delivery failure** — surfaced as `needsAttention` (row chip + KPI + tab); per-bubble status line shows `error_code`.
- **Closed case** — `openCaseId` null → "Open in Collections" omitted (dashboard only loads open cases); "View account" still shown.
- **Unmapped/cross-org `customerId`** — `selected` resolves to null (RLS-scoped read) → panel shows its empty/placeholder state.

## 8. Testing (TDD)

- **`tests/message-inbox.test.ts`** (NEW, pure): `buildThreadRows` — customers with zero messages excluded; `needsReply`/`needsAttention`/`unansweredInbound`/`active` derivation incl. the failed-status set and `errorCode`-without-failed-status; `anchorInvoiceId` precedence (msg invoice → latest-any-status → null); `canReply`/`replyDisabledReason` truth table (no consent / opted out / no invoice). `applyMessageTab` for all five tabs; `sortThreadRows` (recent / oldest-waiting / name); `computeMessageMetrics` counts.
- **Loader shape test** (NEW or extend an existing worklist test): selected `customerId` yields the full ascending thread + anchor-invoice vars; tab/sort/search plumbing.
- **Reuse coverage**: `/api/text/send` and `/api/sms-consent` `returnTo` guards already tested (`api-text-send`, `api-sms-consent`); a `/messages?...` `returnTo` is the same `safeReturnTo` path — no redundant route test added (note in plan self-review).
- **Components**: verified by `npx tsc --noEmit` + `npx react-router build` (no render-test infra). Live Chrome pass on the merged feature (seed + connected/synced org): inbox renders, tab counts correct, failed-delivery chip shows, thread quick-view + inline reply + consent toggle work, deep-links land.
- **Gates (unchanged):** `npx vitest run` green · `npx tsc --noEmit` exit 0 · `npx react-router build` clean.

## 9. File structure

| Action | File | Responsibility |
| --- | --- | --- |
| Create | `app/lib/message-inbox.ts` | Pure thread-row build/filter/sort/metrics + frozen tabs/sorts |
| Create | `app/routes/messages.tsx` | RLS loader + page (prelude, params, reads, render) |
| Create | `app/components/MessagesMetrics.tsx` | KPI strip |
| Create | `app/components/MessagesInbox.tsx` | Pill tabs + sort + search + thread list |
| Create | `app/components/MessageThreadPanel.tsx` | `?customerId=` quick-view: bubbles + consent + composer |
| Create | `app/components/MessageBubbles.tsx` | Shared thread-bubble renderer (extracted) |
| Modify | `app/components/DetailPanel.tsx` | Consume `MessageBubbles` (behavior-preserving refactor) |
| Modify | `app/components/AppShell.tsx` | Wire `messages` nav (live link; drop from inert; JSDoc) |
| Modify | `app/routes.ts` | Add `route("messages", "routes/messages.tsx")` |
| Create | `tests/message-inbox.test.ts` | Pure-lib unit tests |
| Modify/Create | loader-shape test | Selected-thread + plumbing |

## 10. Global constraints (carried)

- React Router v7 framework mode on Cloudflare Workers. No `node:*` in `app/**`. No client→`.server.ts` module-graph reference; pure modules stay suffix-free (`message-inbox.ts`, `sms-templates.ts`, `comm-prefs.ts`).
- Tailwind v4 CSS-first; static literal class maps only. Phase-10 warm thermal tokens (cool/warm/hot, copper accent, ink/panel/surface/border/text/muted). Reuse Accounts/Promises visual language.
- Supabase RLS via `is_org_member(org_id)`; user client for reads + consent write; service client only where Phase 4 already uses it (the send). Browser never touches the DB.
- Vitest against local Supabase; per-test fresh orgs + globally-unique data; never global truncation. `npx vitest run`.
- Conventional Commits. Never commit secrets (`.env.test`/`.dev.vars` gitignored). Never `git add` untracked prototype dirs / local-only scripts.
- **No new migration; no new write routes; no messaging-backend changes** in this slice.

## 11. Out of scope (deferred to their own specs)

- **#2 Settings — channel/provider config:** make the read-only G2 "Text messaging" panel writable for **sender** selection (messaging-service SID / from-number) and add per-org channel enable/disable toggles. **Twilio stays platform-managed** (account SID/auth token remain deploy-time secrets per the 2026-06-23 credential architecture — no bring-your-own-Twilio).
- **#3 Email channel (real transactional send):** provider integration (Resend/SendGrid/SES/Postmark), domain auth (SPF/DKIM), send + capture in an `email_messages` thread model, opt-out/CAN-SPAM unsubscribe, email templates. The Messages tab's `channel` field is reserved for this; nothing email is built now.
- **Read/unread state**, mark-thread-resolved, push/desktop notifications for new inbound.
- **Fully customer-scoped send** (`text_messages.invoice_id` nullable; `sendInvoiceText` accepting a bare `customerId`) — the proper long-term fix that would remove the anchor-invoice indirection entirely. Deferred so this UI slice doesn't touch the messaging backend.
