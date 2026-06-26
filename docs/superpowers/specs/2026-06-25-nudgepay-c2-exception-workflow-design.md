# NudgePay C2 — Exception / Dispute Workflow Design

**Phase:** 8c (P1 throughput & consistency)
**Created:** 2026-06-25
**Status:** Approved — ready for implementation plan
**Source gap:** `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` § C2

## Goal

Promote `dispute` from a per-interaction outcome *string* to a real case
**exception state** with a richer taxonomy, defined per-state suppression
behavior, and a hard contact-block for compliance-sensitive states. An active
exception parks the case so the queue stops surfacing it as actionable work
("suppresses generic reminders"), while keeping it visible and recoverable.

## Context — what exists today (6c minimal slice)

- `collection_cases.exception_reason` CHECK enum = `disputed | payment_plan |
  do_not_contact | other` (migration `0011`); plus `exception_note` free text.
- Logging an `exception` next-step sets `status='on_hold'`,
  `next_action_type='exception'`, `next_action_at=reviewAt`
  (`next-step.server.ts: applyNextStep`). `next_action_at` doubles as the
  review/resurface date — there is **no** separate review column.
- The contact-log form (`contact-log.ts: parseContactLogForm`) currently
  **always** requires a `reviewAt` for an exception.
- The queue (`cases.ts`) returns **all** open cases; `applyCaseView`'s default
  shows everything, and the `waiting` view shows `status in (waiting,
  on_hold)`. There is no suppression — an `on_hold` case still appears in the
  default queue and the active metric buckets.
- There is **no automated outreach** (deferred, checklist § E). "Reminders" in
  practice = the queue surfacing a case as actionable work + the
  follow-ups-due / never-contacted surfacing.
- Messaging eligibility is governed solely by phone presence + `sms_consent`
  (+ STOP handling): individual sends choke through
  `twilio-messaging.server.ts: sendInvoiceText`; bulk sends partition through
  `bulk.ts: partitionEligibility` driven by `bulk-send.server.ts: runBulkSms`.

## Decisions (locked during brainstorming 2026-06-25)

1. **States and outcomes stay separate vocabularies.** An *outcome* is what
   happened on one interaction (a `contact_logs` row); an *exception state* is
   the case's current posture (`collection_cases.exception_reason`). The form
   may pre-select a matching state for convenience, but they are independent
   fields. No derive-from-outcome, no merged enum.
2. **Per-state resurface policy** (not all-review-dated, not all-indefinite).
3. **Flat 8-value enum** (no two-tier, no free-text collapse). Plus a retained
   `other` catch-all (see § Data model).
4. **Suppression = drop from active views until review date; keep in an
   Exceptions view.** Review-dated states auto-return when `next_action_at <=
   today`; terminal states only appear in the Exceptions view + customer
   record until manually reopened.
5. **Terminal (indefinite) states = `legal_agency` + `do_not_contact`.** The
   other six are review-dated.
6. **Hard-block outbound messaging for `do_not_contact` + `legal_agency`** —
   ineligible for individual send and excluded from bulk SMS, with a clear
   blocked reason. The other states do not block sending.

## Taxonomy & per-state policy

Canonical enum (snake_case, matching existing `payment_plan` /
`do_not_contact`):

| state | terminal | requiresReview | blocksContact | label |
|---|---|---|---|---|
| `disputed` | no | yes | no | Disputed |
| `incorrect_amount` | no | yes | no | Incorrect amount |
| `work_incomplete` | no | yes | no | Work incomplete |
| `documentation_requested` | no | yes | no | Documentation requested |
| `wrong_contact` | no | yes | no | Wrong contact |
| `payment_plan` | no | yes | no | Payment plan |
| `legal_agency` | **yes** | no | **yes** | Legal / agency |
| `do_not_contact` | **yes** | no | **yes** | Do not contact |
| `other` (retained) | no | yes | no | Other |

- **terminal** → review date optional; `next_action_at` left `null`; never
  auto-resurfaces; only manual reopen returns it to the active queue.
- **requiresReview** → review date mandatory at log time; case auto-resurfaces
  when `next_action_at <= today`.
- **blocksContact** → case is ineligible for outbound SMS (individual + bulk).

`other` is **retained** (not in the proposed 8 but present in `0011`) to avoid
breaking existing rows; it is kept out of the primary picker and behaves as a
review-dated hold. (Alternative considered and rejected: migrate `other` rows
to `disputed` and drop it — retaining is lower-risk and gives a real fallback.)

## Architecture

One new pure module owns the taxonomy + behavior; everything else consumes it.

### Unit 1 — `app/lib/exceptions.ts` (new, pure; no I/O, no `node:*`)

Single source of truth. Exports:

- `EXCEPTION_STATES` — readonly tuple of the 9 values (8 + `other`).
- `type ExceptionState = (typeof EXCEPTION_STATES)[number]`.
- `EXCEPTION_POLICY: Readonly<Record<ExceptionState, { terminal: boolean;
  requiresReview: boolean; blocksContact: boolean; label: string }>>`
  (frozen).
- Helpers (all pure, total over `ExceptionState | null`):
  - `isTerminal(state): boolean`
  - `requiresReviewDate(state): boolean`
  - `isContactBlocked(state: ExceptionState | null): boolean`
  - `exceptionLabel(state: ExceptionState | null): string`
  - `isCaseSuppressed(args: { status: CaseStatus; exceptionReason:
    ExceptionState | null; nextActionAt: string | null; today: string }):
    boolean` — `true` when `status === 'on_hold'` AND exception is set AND
    (`isTerminal` OR `nextActionAt == null` OR `nextActionAt > today`).

The canonical enum **moves here** from `contact-log.ts`. `contact-log.ts`
keeps only form parsing and imports `EXCEPTION_STATES`/`ExceptionState`.
`format.ts` imports `exceptionLabel` so there is one label vocabulary.

### Unit 2 — Validation & apply

- `contact-log.ts`: import the enum from `exceptions.ts`. The exception branch
  of `parseContactLogForm` requires `reviewAt` **only when**
  `requiresReviewDate(state)`; for terminal states `reviewAt` is optional
  (parsed if present, else `null`). Unknown states still rejected
  (`bad-exception`). `ExceptionReason` type alias re-exported for back-compat
  or replaced by `ExceptionState` throughout.
- `next-step.server.ts`: `NextStepInput.exceptionReason` widens to
  `ExceptionState | null`. The exception branch sets `next_action_at = reviewAt`
  for review-dated states and `null` for terminal states. (`waiting`/`follow_up`
  branches unchanged; the pending-promise cancel for `exception` is unchanged.)

### Unit 3 — Suppression in the queue — `cases.ts` + `dashboard.tsx`

- `buildCaseItems`: add a derived boolean `suppressed` to each `CaseItem`,
  computed via `isCaseSuppressed`. (`exceptionReason` is already on `CaseItem`.)
- `applyCaseView`:
  - **default** view returns `items.filter(i => !i.suppressed)`.
  - **`never-contacted`** also excludes suppressed.
  - **`follow-ups-due`** unchanged (its `next_action_at <= today` predicate
    already drops future-review and terminal-null cases) — but verify a
    resurfaced review-dated case (`next_action_at <= today`) is **not**
    suppressed and DOES appear in the default queue.
  - **`waiting`** view becomes the **Exceptions / On hold** view: shows all
    parked cases (`status in (waiting, on_hold)`), including terminal ones.
- `computeCaseMetrics`: active buckets (`allOpen`, `neverContacted`,
  `thirtyPlus`, `highValue`) exclude suppressed cases; add an `onHold` bucket
  = count/amount of suppressed cases so the count stays visible. (`Metrics`
  type gains `onHold`.)
- `dashboard.tsx`: thread the new metric to the header; no other loader change
  (exception_reason is already selected for the case rows).

### Unit 4 — Messaging hard-block — `do_not_contact` + `legal_agency`

- `twilio-messaging.server.ts`:
  - Extend the open-case lookup to also return `exception_reason` (either widen
    `activeCaseId` to return `{ id, exceptionReason }` or add a sibling read).
    Preferred: add `activeCaseForSend(service, orgId, customerId): Promise<{ id:
    string | null; exceptionReason: ExceptionState | null }>` and have
    `sendInvoiceText` use it; keep `activeCaseId` for the inbound path.
  - In `sendInvoiceText`, after resolving the case, if
    `isContactBlocked(exceptionReason)` → `throw new Error("Contact blocked:
    " + state)` **before** calling Twilio. (Reads still bind `org_id`; errors
    thrown, not swallowed — consistent with the module.)
- `api.text.send.tsx`: in the catch, map `/blocked/i` to a new flash reason
  `blocked` (alongside `noconsent`/`error`); surface a clear message.
- `bulk.ts`:
  - `SkipReason` gains `"do-not-contact"`.
  - `TextableCase` gains `contactBlocked?: boolean`.
  - `partitionEligibility` checks `contactBlocked` **first** (ahead of phone,
    then consent) and pushes a `"do-not-contact"` skip.
- `bulk-send.server.ts`: `runBulkSms` selects `exception_reason` on the
  `collection_cases` query and sets `contactBlocked =
  isContactBlocked(exception_reason)` on each built case.

### Unit 5 — UI surfacing

- `LogContactDrawer.tsx`: exception sub-form reason picker expands to the 8
  primary labels (from `exceptionLabel`); the review-date input renders only
  when `requiresReviewDate(selectedState)`; an inline note appears when a
  terminal/blocking state is selected ("Parks this case indefinitely and
  blocks outbound messages").
- `DetailPanel.tsx`: case header/banner shows the exception label + "parked
  until \<date\>" (review-dated) or "parked indefinitely" (terminal). For a
  blocking state, show a "Messaging blocked" indicator and disable the SMS
  composer / send control.
- `WorkQueue.tsx`: parked cases that appear (Exceptions view) carry an
  exception badge with the state label. Suppressed cases simply do not appear
  in active views.

Tailwind: literal class strings only (no interpolation), per project rule.

## Data flow

1. User logs a contact with next-step = exception, choosing a state.
   `parseContactLogForm` validates (review date required iff review-dated).
2. The action calls `applyNextStep` → case `status='on_hold'`,
   `exception_reason=state`, `next_action_at = reviewAt | null`.
3. Dashboard loader builds `CaseItem`s; `isCaseSuppressed` marks parked cases.
4. `applyCaseView`/`computeCaseMetrics` drop suppressed cases from active views
   and count them under `onHold`; the Exceptions view lists them.
5. On the review date, a review-dated case's `next_action_at <= today` →
   `isCaseSuppressed` returns `false` → it reappears in the active queue and
   follow-ups-due. Terminal cases stay parked until a human reopens.
6. Any outbound SMS to a `do_not_contact`/`legal_agency` case is rejected:
   `sendInvoiceText` throws (`blocked` flash); bulk SMS partitions it into
   `skipped` with reason `do-not-contact`.

## Error handling

- All new DB reads bind `.eq("org_id", …)` and throw on error (no silent
  null) — consistent with `sendInvoiceText`/`activeCaseId`. The service client
  is used only where it already is (messaging paths); user/RLS client elsewhere.
- The contact-block throw happens **before** the Twilio call, so a blocked
  case never reaches the carrier and records no `text_messages` row.
- Bulk send tallies blocked cases as `skipped` (never `failed`), matching the
  existing partial-failure model.

## Testing

- **`exceptions.test.ts`** (pure, new): `EXCEPTION_POLICY` correctness —
  terminal set is exactly `{legal_agency, do_not_contact}`; `blocksContact`
  set is the same two; `requiresReview` true for the other seven (incl.
  `other`); every state has a label; `isCaseSuppressed` truth table (terminal
  parked, review-dated future-parked, review-dated resurfaced, non-on_hold not
  suppressed).
- **`cases.test.ts`** (extend): default view + active metrics exclude
  suppressed; resurfaced review-dated case appears in default + follow-ups-due;
  Exceptions view includes terminal + review-dated parked; `onHold` bucket
  counts/sums suppressed.
- **`contact-log.test.ts`** (extend): review-dated state without `reviewAt` →
  error; terminal state without `reviewAt` → ok; new enum values accepted;
  unknown value → `bad-exception`.
- **`bulk.test.ts`** (extend): `partitionEligibility` skips `contactBlocked`
  with reason `do-not-contact`; blocked is checked ahead of phone/consent.
- **Integration** (Supabase local): `applyNextStep` sets `next_action_at`
  `null` for terminal, `reviewAt` for review-dated; `sendInvoiceText` throws
  for a blocked open case (and records no row); `runBulkSms` skips a blocked
  case; org_id bound on every read.
- **Migration** (`0015`): new values accepted, bogus rejected, existing `other`
  rows survive the constraint swap.

## Files

**Create**
- `app/lib/exceptions.ts`
- `supabase/migrations/0015_case_exception_taxonomy.sql`
- `tests/exceptions.test.ts`

**Modify**
- `app/lib/contact-log.ts`
- `app/lib/next-step.server.ts`
- `app/lib/cases.ts`
- `app/lib/format.ts`
- `app/lib/twilio-messaging.server.ts`
- `app/lib/bulk.ts`
- `app/lib/bulk-send.server.ts`
- `app/routes/api.text.send.tsx`
- `app/routes/dashboard.tsx`
- `app/components/LogContactDrawer.tsx`
- `app/components/DetailPanel.tsx`
- `app/components/WorkQueue.tsx`
- `tests/cases.test.ts`, `tests/contact-log.test.ts`, `tests/bulk.test.ts`
  (+ integration tests as above)

## Global constraints (binding for implementation)

- **RLS:** every user/RLS-client read/write binds `.eq("org_id", org.org_id)`
  and captures+throws errors; `is_org_member` permits every org the caller
  belongs to. The service client (messaging paths only) bypasses RLS — keep it
  scoped exactly where it is today.
- **Tailwind v4:** literal class strings only, no interpolation.
- **Pure modules** (`exceptions.ts`, `cases.ts`, `contact-log.ts`, `bulk.ts`):
  no I/O, no `node:*`, no `.server` suffix.
- **Constants/taxonomy** live only in `exceptions.ts`; other modules import.
- **Tests:** `npx vitest run` (no `npm test` script); node env, no jsdom,
  `fileParallelism: false`. Integration tests need local Supabase
  (`npx supabase db reset`).
- **Conventional Commits**; commit-body trailer
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Out of scope (YAGNI)

- Configurable per-state review cadences (overlaps C4/C7).
- Per-channel contact preferences (C6) — `blocksContact` here is SMS-only
  since SMS is the only live outbound channel.
- Reopen-from-terminal automation — manual status change is sufficient.
- Suppressing the case from QBO sync / case auto-close lifecycle — exceptions
  affect surfacing only, not the open/resolve reconcile.
