# Phase 5c — Messages Tab + SMS Templates — Design

**Status:** Approved (design) — 2026-06-23
**Project:** NudgePay (AR-collections workspace for QuickBooks Online; Chancey Heating & Cooling)
**Predecessors:** Phases 1–5b complete and merged to `main`. 5a built the read-only worklist; 5b made the detail panel write-capable (contact logging + promise tracking).

## 1. Goal

Turn the detail panel's **Messages** tab from a placeholder into a real, design-system SMS thread for the selected account: view the conversation, toggle consent, pick a starter template, and send a text — all without leaving the dashboard. Retire the standalone prototype `/invoices/:id` page by folding its capability into the tab.

## 2. Background — what already exists (Phase 4)

The messaging backend is built and is **not** re-architected in this slice:

- **`text_messages`** table (0001): `org_id, invoice_id, customer_id, sent_by_user_id, direction ('outbound'|'inbound'), twilio_message_sid, status, error_code, from_number, to_number, body, created_at`. Indexed by `org_id`, `(org_id, invoice_id)`, `(org_id, customer_id)`, and `twilio_message_sid` (0006).
- **`customers.sms_consent`** boolean — the outbound gate.
- **`messaging_config`** — per-org sender (messaging service SID or from-number).
- **`/api/text/send`** (`api.text.send.tsx`) — action route. Calls `sendInvoiceText` (`twilio-messaging.server.ts`), which enforces consent + a linked customer/phone, sends via Twilio, and records the outbound row. Uses the **service client** for the send/insert, org-scoped by `org_id` + invoice `id`.
- **Inbound + status webhooks** — `recordInboundMessage` threads inbound replies to the most-recent outbound invoice and auto-toggles `sms_consent` on STOP/START keywords; `updateMessageStatus` updates delivery status by SID.
- **`/invoices/:id`** (`invoices.$id.tsx`) — a working but prototype-grade standalone thread page (inline styles, sans-serif, off-design-system). Has its own consent-toggle action. **Deleted in this slice.**

The dashboard loader already reads `text_messages` (RLS user client) for last-contact signals, so adding a selected-invoice message read is a natural extension of an existing pattern.

## 3. Scope (locked decisions)

| Decision | Choice |
| --- | --- |
| SMS templates | **Hardcoded starter set** in a pure module; no DB, no CRUD UI. Editable templates are a future enhancement. |
| Thread UX | **Inline in the Messages tab** — a persistent conversation view (thread scrolls, composer below). Not a slide-over. |
| Standalone `/invoices/:id` | **Deleted** — route registration + `invoices.$id.tsx` removed. Its consent action moves to a new resource route. |

## 4. Architecture

Reads flow through the dashboard **loader** (RLS user client), consistent with 5a/5b. Writes flow through **resource routes** (consistent with `api.contact-logs`, `api.text.send`):

- **Send** → existing `/api/text/send`, made `returnTo`-aware.
- **Consent toggle** → new `/api/sms-consent` action route (RLS user client).

Templates are a **pure module** (`app/lib/sms-templates.ts`, suffix-free) so the client `DetailPanel` can import it without tripping the RR7 `.server` bundler rule.

## 5. Components & data flow

### 5.1 `app/lib/sms-templates.ts` (NEW — pure, suffix-free)

```ts
export type SmsTemplate = { id: string; label: string; body: string };
export type TemplateVars = {
  customer: string; invoice: string; balance: string; dueDate: string;
};
export const SMS_TEMPLATES: SmsTemplate[];          // the four starters in §7
export function applyTemplate(body: string, vars: TemplateVars): string;
```

`applyTemplate` substitutes `{customer}`, `{invoice}`, `{balance}`, `{dueDate}` literally. An unknown `{token}` is left intact (no throw). Pure and unit-tested.

### 5.2 Dashboard loader additions

For the **selected** invoice only (invoice-gated, mirroring `selectedActivity`):

- **`selectedMessages`** — RLS read of `text_messages` for `org_id` + the selected `invoice_id`, ascending by `created_at`. Mapped to an exported `MessageEntry = { id; direction; body; status; errorCode; createdAt }`.
- **`selectedConsent: boolean`** and **`selectedPhone: string | null`** — from the selected invoice's customer (`sms_consent`, `phone`). Reuses the customer the loader already resolves; reads `sms_consent` where it currently reads name/phone/email.

These are added to the loader's returned data and passed into `DetailPanel`.

### 5.3 `DetailPanel` — Messages tab

Replaces the `PlaceholderTab` for `activeTab === "messages"` with, top to bottom:

1. **Consent row** — shows "SMS consent: yes/no"; a `Form` POSTing to `/api/sms-consent` with a `returnTo` back to this tab and the flipped value (Mark consented / Revoke consent), same member-attests semantics as the deleted page.
2. **Thread** — message bubbles: outbound right-aligned in copper, inbound left-aligned in panel. Each shows the body and a status line (`direction` · `status`, and `error_code` when present). Empty state when no messages. Thermal tokens only; no inline styles.
3. **Template picker** — the four `SMS_TEMPLATES` as buttons; clicking fills the composer textarea with `applyTemplate(body, vars)` for the selected account (client-side React state). Does **not** auto-send.
4. **Composer** — `Form method="post" action="/api/text/send"` with hidden `invoiceId` + `returnTo`; a `<textarea name="body">`; Send button **disabled when `selectedConsent` is false**, with an inline hint. A `?sms=sent|noconsent|error` banner reflects the last send.

The Messages tab is interactive (template fill needs React state), so its body is a small client subcomponent receiving `selectedMessages`, `selectedConsent`, `selectedPhone`, the account vars, and the current `invoice/view/sort/q` for `returnTo`.

### 5.4 `/api/text/send` — return-aware

Add a validated `returnTo` hidden field. Reuse the `safeReturnTo` guard pattern from `api.contact-logs` (accept only paths starting with `/` and not `//`; fall back to `/dashboard`). On each outcome, redirect to `returnTo` with `&sms=sent|noconsent|error` appended (preserving existing query). The legacy `/invoices/:id?sms=…` redirects are removed. Default `returnTo` when absent: `/dashboard`.

### 5.5 `/api/sms-consent` (NEW — action-only resource route)

RLS user client (`requireUser` + `resolveOrg`). Reads form `invoiceId`, `consent` ("true"|"false"), `returnTo`. Resolves the invoice's `customer_id` (RLS-scoped — a member can only see own-org invoices), updates `customers.sms_consent`, and redirects to `safeReturnTo(returnTo)`. On error, redirect to `returnTo` with `&sms=error`. Registered in `routes.ts` as `route("api/sms-consent", "routes/api.sms-consent.tsx")`.

### 5.6 DetailPanel "Text" action button — repointed

From `to={`/invoices/${selected.invoiceId}`}` to the Messages tab:
`?${new URLSearchParams({ invoice, tab: "messages", view, sort, ...(q?{q}:{}) })}` — same pattern as the Log button.

### 5.7 Deletions

- `app/routes/invoices.$id.tsx` — removed.
- The `route("invoices/:id", …)` line in `routes.ts` — removed.

## 6. Security boundary

- **Reads** (`selectedMessages`, consent/phone): RLS user client — a member sees only own-org rows. Consistent with 5a/5b.
- **Consent write** (`/api/sms-consent`): RLS user client; the invoice lookup is RLS-scoped, so cross-org `invoiceId` resolves to nothing and updates nothing.
- **Send** (`/api/text/send`): **deliberately keeps its Phase-4 service client** for the Twilio call + `text_messages` insert. It is org-scoped (`sendInvoiceText` filters `org_id` + invoice `id`, verifies the customer + consent server-side). Re-architecting messaging onto the RLS client is out of scope for a UI slice; this carry-over is intentional and called out here so a reviewer does not flag it as an inconsistency.
- `returnTo` on both write routes is validated (`safeReturnTo`): only same-site absolute paths, never protocol-relative `//host`. No open redirect.
- No secrets/tokens to the client; the browser never touches the DB.

## 7. Starter templates

Four, escalating in firmness. Variables: `{customer} {invoice} {balance} {dueDate}`.

1. **Friendly reminder** — `Hi {customer}, a friendly reminder that invoice {invoice} for {balance} was due {dueDate}. Reply with any questions. — Chancey Heating & Cooling`
2. **Past due** — `Hi {customer}, invoice {invoice} ({balance}) is now past due as of {dueDate}. Please let us know when we can expect payment. — Chancey H&C`
3. **Final notice** — `{customer}, invoice {invoice} for {balance} remains unpaid and is now seriously past due. Please contact us promptly to avoid further action. — Chancey H&C`
4. **Payment received** — `Thanks {customer}! We've received payment for invoice {invoice}. We appreciate your business. — Chancey Heating & Cooling`

Account vars for interpolation come from the selected `WorkItem`/customer: `customer` = customer name; `invoice` = doc number (fallback invoice id); `balance` = USD-formatted invoice balance; `dueDate` = formatted due date.

## 8. Error & edge handling

- **No consent** — composer Send disabled with an inline hint; if a send is attempted anyway (e.g. consent revoked between load and submit), `sendInvoiceText` throws → redirect carries `sms=noconsent` → banner.
- **No phone / no linked customer** — `sendInvoiceText` throws → `sms=error` banner.
- **No messages yet** — thread shows an empty state.
- **Template fill on an unselected account** — not reachable; the Messages tab only renders with a selected account.
- **Twilio/status** — delivery status and `error_code` surface in each bubble's status line as they update via the existing status webhook (no polling added in this slice).

## 9. Testing

- **`tests/sms-templates.test.ts`** — `applyTemplate` substitutes all four vars; leaves unknown tokens intact; each of the four starters renders with a sample account.
- **`tests/dashboard-worklist.test.ts`** (extend) — selected invoice yields `selectedMessages` in ascending order and correct `selectedConsent`/`selectedPhone`.
- **`tests/api-sms-consent.test.ts`** (NEW, DB-backed) — a member toggles own-org `sms_consent` true→false→true; a cross-org `invoiceId` changes nothing; `safeReturnTo` accepts `/dashboard?…`, rejects `//evil` and `https://evil`.
- **`tests/api-text-send.test.ts`** (extend or NEW) — `safeReturnTo`/`returnTo` plumbing: valid path preserved + `sms=` appended; hostile `returnTo` falls back to `/dashboard`.
- **Components** — verified by `npx tsc -b` + `npx react-router build` (no render-test infra). Live Chrome pass on the merged feature: thread render, consent toggle, template fill, send result banner.

## 10. File structure

| Action | File | Responsibility |
| --- | --- | --- |
| Create | `app/lib/sms-templates.ts` | Pure starter templates + `applyTemplate` |
| Create | `app/routes/api.sms-consent.tsx` | RLS consent toggle, return-aware |
| Modify | `app/routes/api.text.send.tsx` | Add validated `returnTo`; redirect to dashboard tab |
| Modify | `app/routes/dashboard.tsx` | Loader: `selectedMessages`, `selectedConsent`, `selectedPhone`; export `MessageEntry` |
| Modify | `app/components/DetailPanel.tsx` | Real Messages tab (consent, thread, templates, composer); repoint Text button |
| Delete | `app/routes/invoices.$id.tsx` | Folded into the Messages tab |
| Modify | `app/routes.ts` | Add `api/sms-consent`; remove `invoices/:id` |
| Create | `tests/sms-templates.test.ts` | Template unit tests |
| Create | `tests/api-sms-consent.test.ts` | DB-backed consent + returnTo guard |
| Modify | `tests/dashboard-worklist.test.ts` | Selected-message read shape |
| Modify/Create | `tests/api-text-send.test.ts` | returnTo plumbing |

## 11. Global constraints (carried)

- React Router v7 framework mode on Cloudflare Workers. No `node:*` imports in `app/**`. No client→`.server.ts` module-graph reference; pure modules stay suffix-free.
- Tailwind v4 CSS-first; static literal class maps only (no dynamic `bg-${x}`). Thermal tokens (cool/warm/hot), copper as sole accent, ink/panel/surface/border/text/muted.
- Supabase RLS via `is_org_member(org_id)`; user client (from `requireUser`) for reads + the consent write; service client only where Phase 4 already uses it (the send). The browser never touches the DB.
- Vitest against local Supabase; per-test fresh orgs + globally-unique data; never global truncation. Run via `npx vitest run`.
- Conventional Commits. Never commit secrets (`.env.test`/`.dev.vars` stay gitignored). Never `git add` untracked prototype dirs or local-only scripts.
- No new migration in this slice — all required columns/tables already exist.
