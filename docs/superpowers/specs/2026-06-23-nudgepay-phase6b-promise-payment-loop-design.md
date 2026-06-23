# NudgePay Phase 6b — Promise + Payment Loop (Design Spec)

**Date:** 2026-06-23
**Status:** Approved (design); pending spec review → writing-plans.
**Builds on:** Phase 6a (case foundation, merged `1cb6c34`). Schema `0001`–`0009`; `cases.ts`, `case-lifecycle.server.ts`, `qbo-sync.server.ts`, `qbo-webhook.server.ts`, `qbo-mappers.server.ts`, `qbo-api.server.ts`, `contact-log.ts`, `api.contact-logs.tsx`, `dashboard.tsx`, `DetailPanel.tsx`, `WorkQueue.tsx`, `LogContactDrawer.tsx`.
**Closes checklist items:** B1, B2, B3 (+ B3-bug), and the 6b carry-ins (last-contact by `case_id`; populate `promise`/`brokenPromise`). The webhook CloudEvents migration is folded in here.

---

## 1. Goal

Turn the static case workspace into an operational loop: capture promises-to-pay as a first-class entity, sync payments and credit memos from QBO, and **automatically classify each promise as kept / partially kept / broken using invoice balance deltas** — payment-validated, grace-period-aware. Fix the periodic-sync staleness bug (paid invoices lingering as overdue) along the way.

## 2. Architecture

Mirrors the proven 6a lifecycle pattern: **pure evaluators + a server applier wired into the existing sync paths**. No new infrastructure.

- A pure `evaluatePromises(...)` (no I/O) computes status transitions from promise rows + current linked-invoice balances + today.
- A pure `addBusinessDays(...)` computes grace deadlines (weekend-skip).
- A server applier `applyPromiseEvaluation(service, orgId, today)` runs immediately after `applyCaseReconciliation` in `syncOverdueInvoices`, `applyInvoiceWebhook` / `applyPaymentWebhook`, `runCdcCatchup`, and the daily cron. Each step is try/caught to log-and-continue — never aborts a sync.
- Promise *state* lives in a new `promises` table (authoritative). The `contact_logs.promised_amount/date` columns remain only as the immutable log snapshot for the activity timeline.

**Rejected alternatives:** DB views/triggers (business-day + grace math is painful in SQL, not unit-testable, splits domain logic); event-driven-only evaluation (cannot fire the no-payment-by-deadline transition without a time-based sweep, so it collapses into the chosen approach plus extra moving parts).

## 3. Locked decisions (from brainstorming)

1. **Grace period:** fixed **2 business days**, weekend-skip, **no holiday calendar** and **no per-org config** (deferred to C7 / Phase 8). Constant `GRACE_BUSINESS_DAYS = 2`.
2. **Classification by amount, via baseline snapshot:** snapshot the linked invoices' total balance at promise creation (`baseline_balance`); `received = max(0, baseline − current)`.
   - `received ≥ promised_amount` → **kept**
   - past grace & `received > 0` → **partially_kept**
   - past grace & `received ≈ 0` → **broken**
   - before grace & not fully kept → **pending**
3. **Lifecycle:** a new promise **auto-supersedes** the prior `pending` one (old → `renegotiated`, `replacement_promise_id` → new); **one active promise per case** (DB-enforced). A manual **Cancel promise** action ships in 6b.
4. Both cash **Payments** and **CreditMemos** count as qualifying (both reduce invoice balance — verified against Intuit docs). No payment→invoice line attribution required for classification.
5. Terminal states are terminal in 6b: a payment arriving after a promise already broke does **not** un-break it (the case still auto-resolves when fully paid via balance reconciliation).

## 4. Data model — migration `0010_promise_payment_loop.sql`

All tables get RLS `... using (is_org_member(org_id))` and the standard grants, matching every prior table.

### 4.1 `promises`
| column | type | notes |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `org_id` | uuid not null → organizations(id) on delete cascade | RLS scope |
| `case_id` | uuid not null → collection_cases(id) on delete cascade | |
| `customer_id` | uuid not null → customers(id) on delete cascade | denormalized for queries |
| `status` | text not null default `'pending'` | check in (`pending`,`kept`,`partially_kept`,`broken`,`renegotiated`,`cancelled`) |
| `promised_amount` | numeric(12,2) not null | check `> 0` |
| `promised_date` | date not null | |
| `grace_until` | date not null | `addBusinessDays(promised_date, 2)`, computed at creation |
| `baseline_balance` | numeric(12,2) not null | sum of linked invoices' balance at creation |
| `amount_received` | numeric(12,2) not null default 0 | `baseline − current`, written at each eval (display) |
| `replacement_promise_id` | uuid → promises(id) on delete set null | set on the **old** promise when superseded |
| `contact_log_id` | uuid → contact_logs(id) on delete set null | provenance |
| `created_by` | uuid → auth.users(id) on delete set null | |
| `created_at` | timestamptz not null default now() | |
| `resolved_at` | timestamptz | set when status leaves `pending` |

Indexes:
- `create unique index promises_one_active_per_case on promises (case_id) where status = 'pending';`
- `(org_id, case_id)`, `(org_id, status)`.

### 4.2 `promise_invoices`
- `promise_id` uuid not null → promises(id) on delete cascade
- `invoice_id` uuid not null → invoices(id) on delete cascade
- `org_id` uuid not null (RLS scope)
- `baseline_balance` numeric(12,2) not null (per-invoice snapshot)
- primary key `(promise_id, invoice_id)`

At creation, link **all of the case's currently-overdue invoices**; the promise's `baseline_balance` = sum of these. (Rep selecting a subset is a later enhancement.)

### 4.3 `payments`
| column | type | notes |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `org_id` | uuid not null → organizations(id) on delete cascade | RLS scope |
| `customer_id` | uuid → customers(id) on delete set null | |
| `qbo_id` | text not null | the Payment/CreditMemo `Id` |
| `type` | text not null | check in (`payment`,`credit_memo`) |
| `amount` | numeric(12,2) not null | NaN-guarded from QBO |
| `txn_date` | date | from QBO `TxnDate` |
| `qbo_sync_at` | timestamptz not null | |
| `created_at` | timestamptz not null default now() | |

- `unique (org_id, qbo_id, type)` → idempotent upsert (`onConflict 'org_id,qbo_id,type'`). `type` is in the key because Payment and CreditMemo Id namespaces are independent.
- Stored to know **which customers' invoices to re-pull** (B3-bug) and for a future payment timeline. Not consumed by the classifier.

### 4.4 Backfill
`0010` backfills one `promises` row per existing `contact_logs` with non-null `promised_amount`:
- link that log's `invoice_id` (when present) into `promise_invoices`;
- `baseline_balance` = best-effort current balance of the linked invoice (historical baselines are unreconstructable);
- `status` by date rule: `promised_date < current_date` → `broken`, else `pending`;
- `grace_until` = `promised_date` (best effort for historical rows);
- `case_id` resolved from the open case for that customer.
Production carries little real promise data yet; the demo seed is the main consumer. Best-effort is acceptable and noted.

The `contact_logs.promised_amount/date` columns are **not** dropped — they remain the log's own snapshot.

## 5. QBO sync & webhook changes

### 5.1 Webhook dual-format parser (`qbo-webhook.server.ts`)
`parseQboWebhook` normalizes both payload shapes into the existing `QboWebhookEntity[]`:
- **Legacy:** `payload.eventNotifications[].dataChangeEvent.entities[]` (`name`,`id`,`operation`; `n.realmId`).
- **CloudEvents:** events with `type: "qbo.<entity>.<event>.v1"` → `entityName` = `<entity>` (capitalized to match: `Invoice`/`Customer`/`Payment`/`CreditMemo`), `operation` = `<event>`, `id` = `intuitentityid`, `realmId` = `intuitaccountid`.
- Detection: `payload.eventNotifications` present → legacy; otherwise CloudEvents. Both supported during Intuit's transition.
- ⚠️ **Implementation-time verification:** confirm exact CloudEvents field casing/nesting against a real Intuit payload before merge; tests cover both documented shapes. Signature verification (HMAC-SHA256, `intuit-signature`) is unchanged.

### 5.2 Payment/CreditMemo sync (`qbo-api.server.ts`, `qbo-mappers.server.ts`, `qbo-sync.server.ts`)
- `qboCdc` entities list → `Invoice,Customer,Payment,CreditMemo` (all CDC-supported; still one ≤1000-object shared page).
- `qboQuery`/`qboReadEntity` entity-name unions widen to include `Payment`/`CreditMemo`; `qboCdc` result type gains `payments`/`creditMemos`.
- `mapQboPayment(raw, type, orgId)` → `PaymentUpsert` (NaN-guarded `amount` from `TotalAmt`, `txn_date` from `TxnDate`, `customer_id` resolved from `CustomerRef`).
- `upsertPayments(service, rows)` with `onConflict: 'org_id,qbo_id,type'`; `23505` swallowed.
- Webhook route dispatches `Payment`/`CreditMemo` → new `applyPaymentWebhook(deps, orgId, qboId, type)`.

### 5.3 B3-bug staleness fix
After any payment/credit is synced (periodic, CDC, webhook), collect the affected customers' QBO ids and **re-pull all of their invoices regardless of `Balance>0`**, then upsert. A fully-paid invoice updates to `balance=0`/`status=paid`; `applyCaseReconciliation` then auto-resolves the case. Closes "paid outside the CDC window lingers as overdue" for every payment observed.
- Residual (accepted, unchanged from today): a payment older than the 30-day CDC window that also never produced a webhook is never seen.

### 5.4 Sync-path ordering (each path)
`upsert customers/invoices` → `upsert payments` → `re-pull affected customers' invoices` → `applyCaseReconciliation` → `applyPromiseEvaluation` → update sync timestamps. Every new step try/caught (log-and-continue).

## 6. Promise evaluation engine

### 6.1 `app/lib/business-days.ts` (pure, no `.server`)
- `GRACE_BUSINESS_DAYS = 2`.
- `addBusinessDays(dateISO: string, n: number): string` — adds `n` calendar-aware days skipping Sat/Sun (e.g. Fri + 2 → Tue). Date-only string in/out (UTC-component math, no timezone drift — consistent with the `formatDate` fix).

### 6.2 `app/lib/promises.ts` (pure, no `.server`)
```ts
export type PromiseStatus =
  | "pending" | "kept" | "partially_kept" | "broken" | "renegotiated" | "cancelled";

export type PromiseEvalRow = {
  id: string;
  status: PromiseStatus;
  promisedAmount: number;
  baselineBalance: number;
  graceUntil: string;   // YYYY-MM-DD
};

export type PromiseEvalOp = {
  promiseId: string;
  status: PromiseStatus;          // kept | partially_kept | broken
  amountReceived: number;
  resolvedAt: string;             // `today` — all three returned statuses are terminal
};

export function evaluatePromise(row: PromiseEvalRow, currentLinkedBalance: number, today: string): PromiseEvalOp | null;
export function evaluatePromises(rows: PromiseEvalRow[], balanceByPromiseId: Map<string, number>, today: string): PromiseEvalOp[];
```
- Only `pending` rows are evaluated; all other statuses return `null` (terminal).
- `received = max(0, baselineBalance − currentLinkedBalance)`.
- `received ≥ promisedAmount` → `kept` (`resolvedAt = today`).
- else `today > graceUntil`: `received > 0` → `partially_kept` (`resolvedAt = today`); else → `broken` (`resolvedAt = today`).
- else → `null` (stay pending).
- `amountReceived` is always carried on a returned op for display.

### 6.3 `app/lib/promise-evaluation.server.ts`
`applyPromiseEvaluation(service: SupabaseClient, orgId: string, today: string): Promise<{ kept; partiallyKept; broken }>`:
1. Read org's `pending` promises + their `promise_invoices` links (service client, org-scoped — same trust model as `applyCaseReconciliation`).
2. Sum each promise's linked invoices' **current** balance → `balanceByPromiseId`.
3. `evaluatePromises(...)` → ops; apply each via `.update({status, amount_received, resolved_at}).eq("id", promiseId).select("id")`, counting only rows actually updated (the 6a resolved-counter lesson).
4. **Case-state reflection:** for each `broken` op, set its case `status='working'`, `next_action_type='follow_up'`, `next_action_at=today`. Kept/partial leave case status to balance reconciliation (fully paid → auto-resolve; residual → stays `working`).

Wired into all three sync paths + the daily cron, immediately after `applyCaseReconciliation`, so the time-based Pending→Broken transition fires with no new payment.

## 7. Promise creation, supersede, cancel

### 7.1 Creation — `api.contact-logs.tsx` (user client / RLS)
When `outcome === 'promise-to-pay'`, after the `contact_logs` insert:
1. Read the case's currently-overdue invoices for `case_id` (user client — doubles as the cross-org guard; not visible → `missing-case`).
2. **Supersede:** update any existing `pending` promise for the case → `renegotiated`, `resolved_at=now()` (frees the partial-unique slot).
3. Insert the new promise: `status='pending'`, `promised_amount/date` from the form, `grace_until = addBusinessDays(promised_date, 2)`, `baseline_balance` = summed current balance, `contact_log_id`, `created_by`.
4. Insert `promise_invoices` (all those invoices + per-invoice baseline).
5. Set the prior promise's `replacement_promise_id` → new id.
6. Update the case: `status='promised'`, `next_action_type='promise'`, `next_action_at=grace_until`.

Any DB error in this block → `save-failed` (single error-checked path, 6a style). `23505` on the active-promise index (a concurrent second promise) is treated as a superseded race and swallowed.

### 7.2 Cancel — new route `app/routes/api.promises.cancel.tsx` (guarded action, user client)
- Fields: `promiseId`, `returnTo` (validated via `safeReturnTo`, fallback `/dashboard`).
- Read promise by id (RLS cross-org guard); require `status='pending'`; update → `cancelled`, `resolved_at=now()`.
- Update the case → `status='working'`, `next_action_type='follow_up'`, `next_action_at=today` (overdue balance remains; needs a next step).
- Errors → banner param on `returnTo`.

## 8. Case integration & UI

### 8.1 `cases.ts` (pure) — populate the 6b stubs
- `buildCaseItems` gains a `promises` input (the case's active promise = `pending`, else most-recent non-cancelled). Sets `promise: { amount, date }`, `brokenPromise: status === 'broken'`, and adds `promiseStatus: PromiseStatus | null` + `amountReceived: number | null` to `CaseItem` for the workspace chip. The `broken-promises` view (already `filter(i => i.brokenPromise)`) now populates.
- **Last-contact re-thread by `case_id`:** `LastContactInput` gains `caseId`; `buildCaseItems` keys last-contact off `caseId` directly (no more invoice→customer mapping). The merged most-recent-per-case contact is the B7-lite unified signal.

### 8.2 Dashboard loader (`dashboard.tsx`)
- Load open cases' active promises (user client, RLS) → pass to `buildCaseData`.
- Re-thread last-contact: fetch `contact_logs` **and** `text_messages` by `case_id` (both carry `case_id` since 0009), merge to one most-recent-per-case entry.
- Selected-case detail: load the case's promise(s) for the workspace card; activity timeline display unchanged.

### 8.3 UI components
- **DetailPanel** — a **Promise card** for the active promise: amount, promised date, grace deadline, a status chip via a static `PROMISE_STATUS` label+tone map (Tailwind literal-class rule), an `amount_received` line, and a **"Cancel promise"** button (posts to `api.promises.cancel` with `returnTo`) shown only when `pending`. All dates via `formatDate`.
- **WorkQueue** — a small `Promised` / `Promise broken` indicator on the row derived from `promiseStatus`.
- **LogContactDrawer** — promise inputs already exist; unchanged (creation is now server-side).

## 9. Error handling & edge cases

- Every new sync step (payments upsert, re-pull, evaluation, case reflection) try/caught to log-and-continue; a failure never aborts the sync.
- Promise creation/cancel collapse to single error-checked writes → user-facing banner.
- `23505` swallowed on idempotent payment upserts and the active-promise race.
- Promise with a linked invoice later deleted/voided: FK cascade drops the link; the current-balance sum shifts while baseline stays — possible misclassification in a rare void case. Accepted for 6b; noted.
- Terminal-state promises are never re-evaluated; a late payment does not un-break a broken promise (case still auto-resolves on full payment).

## 10. Testing (Vitest; local Supabase; fresh org + globally-unique data per test; no global truncation)

- **Pure:** `business-days.test.ts` (weekend rolls incl. Fri→Tue, multi-week); `promises.test.ts` (kept / partial / broken / pending-before-grace / received clamp at 0 / terminal no-op); `cases.test.ts` additions (`promise` + `brokenPromise` + `promiseStatus`; case-keyed last-contact merging logs + texts).
- **Mappers/parsers:** `mapQboPayment` (payment + credit_memo + NaN guard); `parseQboWebhook` legacy **and** CloudEvents shapes.
- **DB/RLS:** promises + promise_invoices cross-org isolation; supersede frees the partial-unique slot and sets `replacement_promise_id`; cancel transition; B3-bug re-pull resolving a paid case; `applyPromiseEvaluation` end-to-end (pending→broken at deadline, pending→kept on balance drop, case-state reflection).
- **Route:** contact-log promise creation + supersede; `api.promises.cancel` guard + transition + `safeReturnTo`.
- **Component:** verified with `npx tsc -b` + `npx react-router build` (RR7 bundler is the real gate; pure modules must not use `.server`).

## 11. Out of scope (later phases)

- Per-org configurable grace + holiday calendar (C7 / Phase 8).
- Rep selecting a subset of invoices for a promise (multi-invoice linkage exists; selection UI later).
- Full exception/dispute state machine (C2 / 6c+), forced next-action invariant UX (6c).
- Unified channel-agnostic activity timeline beyond the last-contact merge (B7 full).
- Expanded structured outcomes / SMS-emitted outcomes (B4 / Phase 7).

## 12. File manifest

**New:**
- `supabase/migrations/0010_promise_payment_loop.sql`
- `app/lib/business-days.ts`
- `app/lib/promises.ts`
- `app/lib/promise-evaluation.server.ts`
- `app/routes/api.promises.cancel.tsx`
- tests: `business-days.test.ts`, `promises.test.ts`, `promise-evaluation-rls.test.ts`, `payments-mappers.test.ts`, `qbo-webhook.test.ts` (CloudEvents additions), `api-promises-cancel.test.ts`

**Modified:**
- `app/lib/qbo-api.server.ts` (Payment/CreditMemo query + CDC)
- `app/lib/qbo-mappers.server.ts` (`mapQboPayment`, `PaymentUpsert`)
- `app/lib/qbo-webhook.server.ts` (dual-format parse)
- `app/lib/qbo-sync.server.ts` (`upsertPayments`, `applyPaymentWebhook`, B3-bug re-pull, `applyPromiseEvaluation` wiring)
- `app/lib/qbo-cron.server.ts` (evaluation in the daily sweep)
- `app/routes/webhooks.qbo.tsx` (Payment/CreditMemo dispatch)
- `app/lib/cases.ts` (`promise`/`brokenPromise`/`promiseStatus`; case-keyed last-contact)
- `app/lib/contact-log.ts` (unchanged validation; promise creation moves to the action)
- `app/routes/api.contact-logs.tsx` (promise creation + supersede)
- `app/routes/dashboard.tsx` (load promises; re-thread last-contact by case_id)
- `app/components/DetailPanel.tsx` (promise card + cancel)
- `app/components/WorkQueue.tsx` (promise indicator)
- tests: `cases.test.ts`, `dashboard-worklist.test.ts`, `contact-log.test.ts` / `api-contact-logs.test.ts`
