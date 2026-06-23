# NudgePay Phase 6c — Hard Next-Action Invariant + Minimal Exceptions (Design Spec)

**Date:** 2026-06-23
**Status:** Approved (design); pending spec review → writing-plans.
**Builds on:** Phase 6a (case foundation, `1cb6c34`) + 6b (promise/payment loop, `9068680`). Touches `cases.ts`, `worklist.ts`, `contact-log.ts`, `api.contact-logs.tsx`, `promise-create.server.ts`, `dashboard.tsx`, `LogContactDrawer.tsx`, `DetailPanel.tsx`, `WorkQueue.tsx`.
**Closes checklist items:** A2 / A2-impl (hard next-action invariant), the `waiting`/`on_hold` states + review dates, and the minimal exception/dispute placeholder (a slice of C2; the full taxonomy stays Phase 8).

---

## 1. Goal

Make "every active case carries an explicit next action" a hard, enforced invariant, and give reps the vocabulary to defer a case correctly: *waiting on the customer* (auto-resurfaces) or *on hold for an exception* (dispute / payment plan / do-not-contact, suppressed until a review date). Today a contact logged with no follow-up leaves a case `working` with a stale `next_action_at`; 6c closes that gap.

## 2. Architecture

Pure-evaluator + thin-server-write pattern, consistent with 6a/6b. The forward action is a **required `nextStep`** captured at log time and applied as a single case-state write in the contact-log action. The key simplification: **`next_action_at` already means "when to act next,"** so for `waiting`/`on_hold` it doubles as the **review date** — the existing `follow-ups-due` predicate (`next_action_at <= today`) then gives suppression *and* auto-resurfacing with no new code or column.

**Rejected alternatives:** a separate `review_at` column + keeping `outcome` as the promise trigger (two date concepts, conditional "which control drives the action," forfeits free suppression); an event-sourced case-actions table (over-engineered — the durable next-action already lives on the case).

## 3. Locked decisions (from brainstorming)

1. **Enforcement:** `nextStep` is **required** at log time; the server action rejects a log without a valid next step. Auto-opened cases already seed `contact@today`.
2. **Deferred states:** `waiting` = waiting on the customer (review date; auto-resurfaces in follow-ups-due at/after it). `on_hold` = an exception/dispute WE paused (reason + review date; suppressed until review). `on_hold` IS the minimal exception placeholder.
3. **Exception reason:** a minimal fixed enum `disputed / payment_plan / do_not_contact / other` + optional free-text note. The full dispute taxonomy + workflow is Phase 8 / C2.
4. **Queue visibility:** deferred cases stay in **All-open** with a status chip, drop out of **Follow-ups-due** until their review date (then resurface), and gain a dedicated **Waiting** saved view.
5. **`nextStep` is the single forward-action driver (A1):** `outcome` becomes purely descriptive; the promise trigger moves from `outcome === 'promise-to-pay'` to `nextStep === 'promise'`.

## 4. State machine

`nextStep` → case-state mapping, applied in `api.contact-logs.tsx`:

| `nextStep` | `status` | `next_action_type` | `next_action_at` | exception cols | promise |
|---|---|---|---|---|---|
| `follow_up` | `working` | `follow_up` | chosen follow-up date | cleared | leaves any pending promise intact |
| `promise` | `promised` | `promise` | `grace_until` | cleared | creates promise (`createPromiseForLog`) |
| `waiting` | `waiting` | `waiting` | review date | cleared | **cancels** any pending promise |
| `exception` | `on_hold` | `exception` | review date | `reason` + `note` set | **cancels** any pending promise |

- A **review date is required** for `waiting` and `exception` (so even `do_not_contact` gets a revisit date) — guaranteeing `next_action_at` is never null on an active case.
- `status` enum already includes `waiting`/`on_hold`; `next_action_type` already includes `waiting`/`exception` (0009). No enum migration.

**Invariant guarantee.** Every case-touching path writes a non-null `next_action_at`: `today` on auto-open / broken-promise / cancel; a chosen/review/grace date on every logged next-step. An active case can never lack a next action.

**Promise interaction (edge case).** `nextStep ∈ {waiting, exception}` cancels any `pending` promise for the case (set `cancelled`, `resolved_at=now()`, **without** the case reset that the manual cancel route performs) — a dispute/hold supersedes a payment promise and prevents `applyPromiseEvaluation` from later flipping the deferred case back to `working`. `follow_up` leaves a pending promise intact.

**Auto open/close compatibility.** A `waiting`/`on_hold` case still has overdue invoices; full payment still auto-resolves it via reconciliation regardless of status. Stale exception cols on a resolved row are harmless.

## 5. Data model — migration `0011_case_exceptions.sql`

The only schema change (no new date column — `next_action_at` is the review date for `waiting`/`on_hold`):

```sql
alter table collection_cases
  add column exception_reason text
    check (exception_reason in ('disputed','payment_plan','do_not_contact','other')),
  add column exception_note text;
```

RLS/grants unchanged (columns inherit `collection_cases` policy). No backfill (existing cases have null exception cols, consistent with no current exception).

## 6. Parser + action

### 6.1 `contact-log.ts` (`parseContactLogForm`, pure)
Add a required `nextStep ∈ {follow_up, promise, waiting, exception}` with per-branch validation:
- `follow_up` → valid `followUpAt` (else `next-step-date`).
- `promise` → `promisedAmount > 0` + valid `promisedDate` (existing `promise-required` / `bad-amount` / `bad-date`).
- `waiting` → valid `reviewAt` (else `next-step-date`).
- `exception` → `exceptionReason ∈ {disputed, payment_plan, do_not_contact, other}` (else `bad-exception`) + valid `reviewAt` (else `next-step-date`); `exceptionNote` optional (trimmed, nullable).
- missing/invalid `nextStep` → `bad-next-step`.

`ContactLogFields` gains `nextStep: NextStep`, `reviewAt: string | null`, `exceptionReason: ExceptionReason | null`, `exceptionNote: string | null`. `outcome` stays (descriptive). Date validity uses the existing `validDate` helper.

### 6.2 `api.contact-logs.tsx`
After the cross-org case guard, optional invoice guard, and `contact_logs` insert (which still snapshots `promised_amount`/`promised_date` when `nextStep === 'promise'`):
- `nextStep === 'promise'` → `createPromiseForLog(...)` (sets `promised`/`promise`/`grace_until` **and clears exception cols** — one added field in that helper's case update). `createPromiseForLog` already supersedes a prior pending promise.
- else → cancel any pending promise for the case **iff** `nextStep ∈ {waiting, exception}` (single update: `status='cancelled', resolved_at=now()` where `case_id` AND `status='pending'`; `23505`-safe; error → `save-failed`), then a single error-checked case update per the §4 mapping (error → `save-failed`).

The `contact_logs` row stays the descriptive record: it stores `follow_up_at = followUpAt` when `nextStep === 'follow_up'` and `promised_amount`/`promised_date` when `nextStep === 'promise'`; the `waiting`/`exception` review date lives on the case (`next_action_at`), not on the log row. The activity timeline (`ActivityEntry`) is unchanged.

The server `nextStep` validation is the enforcement guard; the drawer enforces it client-side too.

New error codes surfaced: `bad-next-step`, `next-step-date`, `bad-exception`.

## 7. cases.ts + views

- `CaseItem` gains `exceptionReason: ExceptionReason | null` and `exceptionNote: string | null` (the review date is `nextActionAt`). `buildCaseItems` reads them from the `CaseRow` input and passes them through. `CaseRow` gains the two fields.
- New `ViewId` member `waiting` (in `worklist.ts`). `applyCaseView`: `view === 'waiting'` → `items.filter(i => i.status === 'waiting' || i.status === 'on_hold')`.
- `viewCounts` gains a `waiting` entry (built in `buildCaseData`). No new top-line KPI `Metric` (minimal) — `Metrics` type unchanged.
- `follow-ups-due` predicate unchanged: a future review date excludes a deferred case; at/after the review date it resurfaces.

## 8. UI

### 8.1 `LogContactDrawer`
- Replace the optional "Follow up" field with a **required "Next step" `<select>`** (Follow up / Promise to pay / Waiting on customer / Exception — hold), default `follow_up`, driven by component state like today's `outcome`/promise toggle.
- Conditional fields by `nextStep`:
  - `follow_up` → required date input `followUpAt` ("Follow up on").
  - `promise` → the existing amount + `promisedDate` block (now gated on `nextStep === 'promise'`, not `outcome`).
  - `waiting` → required date `reviewAt` ("Revisit on").
  - `exception` → reason `<select>` `exceptionReason` (Disputed / Payment plan / Do not contact / Other) + optional `exceptionNote` textarea + required date `reviewAt`.
- The **Outcome** `<select>` stays (descriptive). Hidden `nextStep` value submitted. Add `bad-next-step` / `next-step-date` / `bad-exception` to `ERROR_MESSAGE`.

### 8.2 `DetailPanel`
- The Overview next-action line already renders `next_action_type · formatDate(next_action_at)` → `Waiting · Jul 8` / `Exception · Jul 8` automatically (STATUS_LABEL already maps `waiting`/`on_hold`).
- For `on_hold`, additionally render the exception reason label (static map: disputed→"Disputed", payment_plan→"Payment plan", do_not_contact→"Do not contact", other→"Other") + the note, in a small panel (Tailwind literal classes only).

### 8.3 `WorkQueue`
- Add the **Waiting** tab to `SAVED_VIEWS`. The status cell already renders `STATUS_LABEL[status]` + the next-action date, so `Waiting`/`On hold` rows display correctly with no further change.

## 9. Error handling & edge cases

- Parser rejects an invalid/missing `nextStep` or its required date/reason → drawer banner.
- The promise-cancel-on-defer and the case update are each error-checked → `save-failed` (no swallowed errors).
- `nextStep === 'promise'` with a case already `on_hold`: `createPromiseForLog` clears the exception cols and sets `promised` — the rep is explicitly choosing a promise over the hold (expected).
- A `waiting` case whose review date passes resurfaces in `follow-ups-due` (it's overdue for action) — correct.
- Concurrent transition: the pending-promise cancel guards on `status='pending'` (zero rows = already terminal, no-op).

## 10. Testing (Vitest; local Supabase; fresh org + globally-unique data; no global truncation)

- **Pure (`contact-log.test.ts`)**: `nextStep` required + per-branch validation (each missing-date / bad-reason / bad-next-step path); valid follow_up / promise / waiting / exception parse to the right fields.
- **Route/DB (`api-contact-logs.test.ts`)**: each `nextStep` writes the correct `status` / `next_action_type` / `next_action_at`; `exception` stores reason+note; non-exception clears exception cols; `waiting`/`exception` cancels a pending promise (and `follow_up` does not); `promise` path still creates the promise via `nextStep=promise`.
- **Pure (`cases.test.ts`)**: `waiting` view = status in (waiting, on_hold); `CaseItem` carries exception fields; a waiting case with a future review date is excluded from `follow-ups-due` and a past one is included.
- **Loader (`dashboard-worklist.test.ts`)**: `waiting` viewCount; exception fields loaded onto items.
- **Migration/DB**: `0011` columns exist + the `exception_reason` check rejects an invalid value.
- **Components**: `npx tsc -b` + `npx react-router build` clean (no client→`.server` import; Tailwind literal classes only).

## 11. Out of scope (later phases)

- Full dispute/exception taxonomy + workflow (C2 / Phase 8): incorrect-amount, work-incomplete, documentation-requested, wrong-contact, legal/agency, etc.
- A standalone "set next step" control outside the log drawer (every advance currently routes through a logged contact — clean audit trail).
- Suggested/cadence-based follow-up dates (C4), bulk assignment (C5), reporting (C8).

## 12. File manifest

**New:** `supabase/migrations/0011_case_exceptions.sql`.

**Modified:** `app/lib/contact-log.ts` (nextStep parse), `app/routes/api.contact-logs.tsx` (nextStep state write + promise-cancel-on-defer), `app/lib/promise-create.server.ts` (clear exception cols in its case update), `app/lib/cases.ts` (waiting view + exception fields on CaseItem/CaseRow + viewCounts), `app/lib/worklist.ts` (`ViewId += 'waiting'`), `app/routes/dashboard.tsx` (load exception cols + waiting viewCount), `app/components/LogContactDrawer.tsx` (next-step UX), `app/components/DetailPanel.tsx` (exception display), `app/components/WorkQueue.tsx` (Waiting tab).

**Tests:** `tests/contact-log.test.ts`, `tests/api-contact-logs.test.ts`, `tests/cases.test.ts`, `tests/dashboard-worklist.test.ts`, + a `0011` migration/exception DB test (extend an existing cases DB test file or add `tests/case-exceptions-rls.test.ts`).
