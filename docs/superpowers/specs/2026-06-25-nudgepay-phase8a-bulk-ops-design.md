# NudgePay Phase 8a — Bulk Assignment & Batch Messaging (Design Spec)

**Date:** 2026-06-25
**Status:** Approved (design); pending spec review → writing-plans.
**Scope:** Gap item **C5** (bulk assignment + batch messaging). First Phase 8 (P1 throughput) sub-phase. Builds directly on `main @ 0fbbf54` (post PR #4 UI refinements).

---

## 1. Goal

Eliminate the headline documented pain: *"50+ invoices, handled one account at a time."* Add multi-select to the work queue, then two bulk actions over the selected cases:

1. **Bulk reassign owner** — set/clear the owner on every selected case's customer in one action.
2. **Batch templated SMS** — send one templated text per selected case, with server-side eligibility filtering, a mandatory preview/confirm step, and a per-batch send cap.

Both actions are **case-centric** (queue rows are cases, one per customer) so a given customer is acted on at most once per batch.

### Findings that motivated this scope (verified against `main @ 0fbbf54`)

- **Everything is one-at-a-time today.** `api.assign.tsx` updates a single `customers.owner`; `api.text.send.tsx` → `sendInvoiceText` sends to a single invoice. No multi-select exists.
- **The queue is 100% server-rendered.** `WorkQueue.tsx` rows are whole-row `<Link>`s; navigation is GET-form + `<Link>` only. There is **no client state** for queue data. Bulk selection introduces the queue's first interactive client state.
- **The row is a single `<Link>`.** A checkbox cannot be nested inside it (clicking would navigate). The row must be restructured to `[checkbox cell] + [<Link> spanning the rest]`.
- **`sms_consent` is not loaded in the queue path.** The dashboard invoice embed selects `customers(name, phone, email, owner)` (no consent); the single-send composer loads consent separately per selected case (`dashboard.tsx:418`). Batch eligibility needs consent for *all* selected cases at once.
- **Display helpers moved (PR #4).** `formatUSD` and `STATUS_LABEL` now live in `app/lib/format.ts` (not inline in `WorkQueue.tsx`). New code reuses these.
- **Templates are per-account.** `SMS_TEMPLATES` + `applyTemplate(body, {customer, invoice, balance, dueDate})` already do per-account variable substitution — the natural primitive for personalized batch sends.

---

## 2. Architecture

Work with the codebase grain: a small **pure module** (`app/lib/bulk.ts`) for all testable logic, plus thin route/component/loader wiring. Mirrors how 7a/7b/7c isolated `timeline.ts` / `priority.ts` / `sync-errors.server.ts`.

- **New pure module `app/lib/bulk.ts`** (no I/O, no `node:*`, no `.server` suffix — imported by routes, components, and tests). Owns: per-batch cap constant, eligibility partition, and per-case body rendering.
- **`WorkQueue.tsx`** gains selection: a `Set<caseId>` in client state, per-row checkbox + header "select all matching" checkbox, and a sticky `BulkActionBar`. Row restructured so the checkbox sits beside (not inside) the `<Link>`.
- **`dashboard.tsx` loader** adds `sms_consent` to the invoice→customer embed and threads it through `CustomerInput` → `CaseItem.smsConsent`, so the client can show a live eligibility count and the SMS action can pre-filter.
- **Two new action routes:** `api.bulk-assign.tsx` (USER client, org+membership guarded) and `api.bulk-sms.tsx` (service client, like single send).
- **One small component each** for the action UIs: `BulkActionBar.tsx` (the sticky bar) and `BulkSmsDrawer.tsx` (template pick + eligibility + preview + confirm). Bulk-assign uses a compact owner `<select>` inside the bar (no drawer needed).

**Rejected alternatives** (from brainstorming):
- *Selection persists across filters (URL/store).* Lets you accumulate a set across views but risks acting on off-screen rows you forgot. Rejected for clarity; selection clears on filter/sort/search navigation.
- *Select-all-matching only (no per-row checkboxes).* Fast for "message everyone 30+ days" but no granular pick-and-choose. Rejected — checkboxes give both (select-all + individual).
- *One SMS per overdue invoice.* Exact per-invoice tokens, but a 5-invoice customer gets 5 texts in one batch (spammy, multiplies volume + cost). Rejected for case-level (one text per case, totals).
- *Background job queue + status table + polling.* Survives huge batches but adds a whole subsystem. Rejected at Chancey scale; synchronous-capped is right-sized.
- *Sync send, no cap.* A 200-case batch risks Worker subrequest/time limits and dying mid-send. Rejected in favor of `MAX_BATCH = 50`.

---

## 3. Locked decisions (from brainstorming)

1. **Both halves, one phase.** Bulk-assign and batch-SMS ship together because they share the selection UI and action bar. Plan may sequence assign-first internally.
2. **Checkbox selection + sticky action bar.** Per-row + "select all matching" checkboxes; selection is client state, **cleared on any filter/sort/search navigation**. Bar shows `N selected · M can be texted · [Assign owner ▾] [Send SMS] [Clear]`.
3. **`MAX_BATCH = 50`.** Enforced in the client (select-all clamps; bar notes the cap) **and** server (routes reject/clamp). Ties to Cloudflare Worker subrequest + time limits.
4. **One SMS per case, totals.** Exactly one text per selected case. `{balance}` = the case's total overdue; `{dueDate}` and `{invoice}` come from the **oldest overdue invoice** (the representative). The recorded `text_messages` row carries that `invoice_id` + the case's `case_id`.
5. **Synchronous, sequential, capped send.** Send in-request, one after another, recording each `text_messages` row as it goes (a mid-request death keeps everything already sent). Redirect to a results-count banner.
6. **Mandatory two-step confirm for SMS.** Sends are irreversible and cost money, so the drawer requires an explicit confirm after showing the eligibility breakdown and a rendered sample.

---

## 4. Component & route specifications

### 4.1 `app/lib/bulk.ts` (pure)

```ts
import { applyTemplate, type SmsTemplate } from "./sms-templates";
import { formatUSD } from "./format";
import { formatDate } from "./dates";
import type { CaseItem } from "./cases";

export const MAX_BATCH = 50;

export type SkipReason = "no-phone" | "no-consent";
export type EligibilitySplit = {
  eligible: CaseItem[];
  skipped: { caseId: string; name: string; reason: SkipReason }[];
};

// Partition selected cases into textable vs skipped (phone + consent required).
// An OPEN case always has >=1 overdue invoice, so "no-invoice" is not a case.
export function partitionEligibility(cases: CaseItem[]): EligibilitySplit { /* ... */ }

// Render one personalized body for a case using totals + the oldest overdue
// invoice as the representative. Unknown {tokens} pass through (applyTemplate).
export function renderCaseBody(templateBody: string, c: CaseItem): string {
  const oldest = c.invoices[0] ?? null; // invoices are sorted oldest-first in buildCaseItems
  return applyTemplate(templateBody, {
    customer: c.customerName,
    invoice: oldest?.docNumber ?? "your account",
    balance: formatUSD(c.totalOverdue),
    dueDate: oldest?.dueDate ? formatDate(oldest.dueDate) : "",
  });
}

// Clamp a selected-id list to MAX_BATCH (server + client share one rule).
export function clampBatch<T>(ids: T[]): T[] { return ids.slice(0, MAX_BATCH); }
```

- **Consumes:** `CaseItem` (gains `smsConsent: boolean`), `SMS_TEMPLATES`/`applyTemplate`, `formatUSD`, `formatDate`.
- **Produces:** `MAX_BATCH`, `partitionEligibility`, `renderCaseBody`, `clampBatch` — used by `api.bulk-sms.tsx`, `BulkSmsDrawer.tsx`, and tests.
- **Eligibility rule:** `phone != null && smsConsent === true`. Phone-missing → `no-phone`; phone present but no consent → `no-consent`.

### 4.2 `CaseItem.smsConsent` threading

- `app/lib/worklist.ts` `CustomerInput` gains `smsConsent?: boolean | null`.
- `app/lib/cases.ts` `buildCaseItems` sets `smsConsent: cust?.smsConsent ?? false` on each `CaseItem`; add `smsConsent: boolean` to the `CaseItem` type.
- `dashboard.tsx` loader: invoice embed becomes `customers(name, phone, email, owner, sms_consent)`; the customer dedup map sets `smsConsent: r.customers.sms_consent ?? false`.
- No new migration — `customers.sms_consent` already exists.

### 4.3 `WorkQueue.tsx` selection

- New client state: `const [selected, setSelected] = useState<Set<string>>(new Set())`.
- **Clear on navigation:** the queue re-renders via full navigation on filter/sort/search. Because `WorkQueue` remounts/receives new `items`, reset selection in a `useEffect` keyed on `[view, sort, search]` (selection does not survive a filter change — locked decision 2).
- **Row restructure:** wrap each row in a grid container; column 1 is a checkbox `<label>` (a sibling of the `<Link>`, not a child). The `<Link>` spans the remaining tracks. Prepend one `auto` track to the row grid templates and the column-header grid template. The checkbox `onChange` toggles the id in `selected` and calls `stopPropagation` so it never triggers row navigation.
- **Header "select all matching":** a checkbox in the column header; checked when all visible `items` are selected, indeterminate when some are. Toggling selects/deselects `clampBatch(items.map(i => i.caseId))` — i.e. at most `MAX_BATCH`.
- **Mobile cards** get the same checkbox in the card header.
- Render `<BulkActionBar>` when `selected.size > 0`.

### 4.4 `BulkActionBar.tsx`

- Props: `{ selectedCaseIds: string[]; selectedCases: CaseItem[]; eligibleCount: number; returnTo: string; roster: RosterMember[]; onClear: () => void; onOpenSms: () => void }`.
- Sticky bottom bar: `N selected · M can be texted`, an **owner `<select>` + Assign** mini-form, a **Send SMS** button (opens the drawer), and **Clear**.
- Assign posts a `<Form method="post" action="/api/bulk-assign">` with hidden `caseIds` (comma-joined or repeated fields), `ownerId` (the select value; `""` = unassign), and `returnTo`.
- Notes the cap when `selected.size === MAX_BATCH` ("Max 50 per batch").

### 4.5 `BulkSmsDrawer.tsx`

- Props: `{ open: boolean; onClose: () => void; selectedCases: CaseItem[]; returnTo: string }`.
- **Step 1 (compose):** template `<select>` (from `SMS_TEMPLATES`) or a custom `<textarea>` body; live eligibility line from `partitionEligibility(selectedCases)` — `M of N eligible · K skipped` with a small reasons breakdown; a **rendered sample** for the first eligible case via `renderCaseBody`.
- **Step 2 (confirm):** "Send to M customers? This cannot be undone." Confirm submits the `<Form method="post" action="/api/bulk-sms">` with hidden `caseIds`, `templateId` (or `body` for custom), and `returnTo`.
- The confirm button disables while `useNavigation().state !== "idle"` (double-submit guard).

### 4.6 `app/routes/api.bulk-assign.tsx`

- USER client (RLS), mirrors `api.assign.tsx` guards.
- Parse `caseIds` (clamp to `MAX_BATCH`), `ownerId` (`""` → `null`), `returnTo` (via `safeReturnTo`).
- Resolve org. If `ownerId`, verify it is a member of the resolved org (one `memberships` query); reject otherwise (redirect back).
- Map the selected case ids → their `customer_id`s via a single `collection_cases` read bound `.eq("org_id", org.org_id).in("id", caseIds)`; dedupe customer ids.
- **One** write: `supabase.from("customers").update({ owner: ownerId }).eq("org_id", org.org_id).in("id", customerIds)`. **Throw on error** (no silent redirect — mirrors the 7c fix to `api.assign.tsx`).
- Redirect `${returnTo}?bulkAssign=done&count=${customerIds.length}`.

### 4.7 `app/routes/api.bulk-sms.tsx`

- Service client (like `api.text.send.tsx`), but **every read bound `.eq("org_id", org.org_id)`**.
- Parse `caseIds` (clamp to `MAX_BATCH`), `templateId`|`body`, `returnTo`. Resolve template body server-side from `SMS_TEMPLATES` if `templateId` given; else use trimmed custom `body`. Empty body → redirect back with error.
- Load the selected cases + their customers (phone, `sms_consent`) + each case's oldest overdue invoice (id, doc_number, due_date) + the case total overdue — all bound to the org. Build minimal `CaseItem`-shaped inputs and run `partitionEligibility`.
- **Sequential** loop over `eligible`: `await sendInvoiceText(deps, { orgId, invoiceId: representativeInvoiceId, userId, body: renderCaseBody(templateBody, case) })`, wrapped in per-case `try/catch`. Tally `sent` / `failed`. Each `sendInvoiceText` records its own `text_messages` row (consent re-checked inside it as defense-in-depth).
- Redirect `${returnTo}?bulkSms=done&sent=${sent}&failed=${failed}&skipped=${skipped.length}`.

### 4.8 Dashboard result banners

- `dashboard.tsx` reads `bulkAssign` / `bulkSms` query params and renders a dismissible banner: assign → "Reassigned N accounts."; sms → "Sent X · Failed Y · Skipped Z." Per-recipient failure detail is inspectable in each case's Messages tab (Twilio `status`/`error_code` already render there).

---

## 5. Data flow

```
Select rows (client Set<caseId>)
  → BulkActionBar shows N selected · M eligible
  ├─ Assign:  POST /api/bulk-assign {caseIds, ownerId}
  │             → cases→customerIds (org-scoped) → one customers UPDATE → banner
  └─ Send SMS: BulkSmsDrawer (compose → confirm)
                → POST /api/bulk-sms {caseIds, templateId|body}
                  → load cases+customers+oldest-invoice (org-scoped)
                  → partitionEligibility → sequential sendInvoiceText (record each)
                  → banner (sent/failed/skipped)
```

---

## 6. Error handling, security, reliability

- **RLS (critical):** `is_org_member` permits every org the caller belongs to, so **every** user-client read/write binds `.eq("org_id", org.org_id)` and captures errors. `api.bulk-assign` (USER client): org-scoped case read + customers update + membership guard on `ownerId`; **throws** on write error. `api.bulk-sms` (service client, bypasses RLS): every case/customer/invoice read explicitly bound `.eq("org_id", org.org_id)`.
- **Cap enforcement:** `clampBatch` applied in the client (select-all) and re-applied server-side in both routes — never trust the client's id list length.
- **Eligibility re-validated server-side.** The client preview is advisory; `api.bulk-sms` recomputes eligibility from the DB and only sends to eligible cases. `sendInvoiceText` also re-checks consent/phone internally (defense-in-depth).
- **Partial failure:** per-case `try/catch`; failures are tallied, not fatal. Already-sent rows persist (recorded incrementally). No rollback — sent texts are real.
- **Double-submit:** confirm/assign buttons disable on submit via `useNavigation`. Full idempotency (a batch token) is **deferred** — at Chancey scale, disable + mandatory confirm is the accepted mitigation. Recorded as residual risk.
- **Cross-org isolation:** a multi-org user cannot assign or text another org's cases — the org-bound reads return nothing for foreign ids, so they are silently dropped (and the membership guard blocks foreign owners).

---

## 7. Testing (matches existing harness — pure unit + node integration, no jsdom)

- **Pure `tests/bulk.test.ts`:**
  - `partitionEligibility`: all-eligible; `no-phone`; `no-consent`; mixed set returns correct counts + reasons.
  - `renderCaseBody`: totals + oldest-invoice tokens fill correctly; multi-invoice case uses the oldest invoice's doc/due-date and the case total for `{balance}`; unknown `{token}` passes through; missing doc number → "your account".
  - `clampBatch`: ≤50 unchanged; >50 truncated to 50.
- **Integration `tests/api-bulk-assign.test.ts`:** updates `owner` on all selected customers in one query; non-member `ownerId` rejected (no write); cross-org case id silently dropped; `ownerId=""` clears owner.
- **Integration `tests/api-bulk-sms.test.ts`:** records one `text_messages` row per eligible case (correct `case_id` + representative `invoice_id` + rendered body); skips `no-consent`/`no-phone` cases (no row); a single bad recipient fails without aborting siblings (others still recorded); `>MAX_BATCH` selection processes only 50.
- **Existing suites stay green:** adding `smsConsent` to `CaseItem`/`CustomerInput` must not break `cases.test.ts` / `worklist.test.ts` (field is optional on input, defaulted in build).

---

## 8. Out of scope (flagged, not built)

- Background job queue / async send with progress polling.
- Batch email or click-to-call (C3), scheduled/drip sends, per-recipient custom body edits.
- Selection persistence across filter/sort/search changes.
- Full send idempotency (batch token / dedupe window).
- Configurable `MAX_BATCH` per org.

## 9. Housekeeping

- **Fix the stale B5 checkmark.** `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` still lists **B5** as `[ ]` "no override"; B5 shipped in Phase 7b (PR #1). Mark it `[x]` with the 7b reference as part of this phase. When C5 ships, mark C5 `[x]` too.
