# NudgePay — Phase 12: Promises Tab (promise pipeline / ledger)

**Created:** 2026-06-27
**Status:** Approved — ready for implementation planning
**Builds on:** Phase 6b (promise-to-pay state machine), Phase 10 (warm re-skin), Phase 11 (Accounts tab — the structural template this phase mirrors).

---

## 1. Purpose

A **promise pipeline / ledger**: a cross-customer, promise-centric lens that complements
Collections (the case work queue) and Accounts (the customer directory). It answers one
question well — *"what did customers commit to, and is it landing?"*

The promise backend already exists end-to-end (Phase 6b: the `promises` table, the
balance-delta `evaluatePromises` classifier, multi-invoice linkage, auto-supersede, the
`api.promises.cancel` route). Today that data is only visible **inside** Collections — the
`broken-promises` saved view and the per-case DetailPanel. There is no cross-customer,
promise-first surface. This tab fills exactly that gap.

It is a **monitoring + follow-up surface**, not a new action workspace:
- Surfaces existing data only. **No new write routes.**
- Activates the already-present-but-inert `promises` side-nav item (`AppShell.tsx`).
- Deep-links into Collections / Accounts to take action.

---

## 2. Architecture (mirrors Phase 11 Accounts)

The tab follows the exact structural template proven by the Accounts tab.

### Pure deriver — `app/lib/promise-ledger.ts`
No I/O, no `.server`, fully unit-tested. Single source of truth for:
- The ledger **row shape** (`PromiseRow`).
- The temporal **display-bucket** derivation (see §3).
- Tab filtering (`applyPromiseTab`), sorting (`sortPromiseRows`), and metric
  aggregation (`computePromiseMetrics`).
- Frozen constants: `PROMISE_TABS`, `PROMISE_SORTS`.

### Loader — `app/routes/promises.tsx`
One RLS-scoped loader reusing the dashboard/accounts **prelude verbatim**:
`requireUser` → `resolveOrg` (→ `/onboarding` if none) → org name → user initials →
connection status via the service client → **connect-gate redirect to `/settings` when
QBO is not connected** → sync label. Then:
- Read `promises` (org-scoped by RLS) joined to `customers` (name/owner),
  `collection_cases` (case id for deep-link), and `promise_invoices` → `invoices`
  (linked invoice numbers/balances).
- For the selected `?promiseId=`, additionally read the originating `contact_logs` note.
- Map rows through `buildPromiseRows`, apply tab + sort, compute metrics.

### Components (reuse Phase 10 warm design system)
- `PromisesMetrics` — KPI strip (counterpart to `AccountsMetrics` / `MetricsStrip`).
- `PromisesLedger` — pill tabs + heat rail + warm rows (counterpart to `WorkQueue` /
  `AccountsDirectory`).
- `PromiseQuickPanel` — the `?promiseId=` quick-view side panel (counterpart to
  `AccountQuickPanel`).

Reuse existing utilities: `status-style.ts`, `format.ts`, `timeline.ts`, `dates.ts`,
`Icons`.

### Wiring
- `routes.ts`: add `route("promises", "routes/promises.tsx")`.
- `AppShell.tsx`: extend the `activeNav` union to include `"promises"`, add it to
  `NAV_TARGETS` (`/promises`) and the section-title map, so the nav item becomes a live
  link with the copper active rail. Drop it from the inert-nav branch.

---

## 3. Data model & the grace-lag subtlety

Source of truth is the `promises` table:
`status` (`pending|kept|partially_kept|broken|renegotiated|cancelled`),
`promised_amount`, `promised_date`, `grace_until`, `baseline_balance`,
`amount_received`, `resolved_at`, and FKs `case_id` / `customer_id` / `org_id`.
Linked invoices come from `promise_invoices`.

**The one real subtlety.** A `pending` promise whose `grace_until` has passed *should*
already have been flipped to `broken` / `partially_kept` by the evaluator — but the
evaluator only runs on sync/cron, which lags. So `status` alone cannot drive the buckets.
The deriver therefore computes a pure, read-time **display bucket** from dates (the DB
`status` is **never mutated by this tab**):

- **Active** — every `pending` promise.
- **Due soon** — `pending` AND (`promised_date` within the next **N = 3 business days**,
  *or* already past `promised_date` but still `≤ grace_until`). This is the proactive
  watch list. A row that is `pending` but already past `grace_until` is shown here with an
  **"awaiting evaluation"** marker (it explains *why* it hasn't flipped yet, instead of
  inventing a status the DB doesn't have).
- **Broken** — `status = broken`.
- **Kept** — `status in (kept, partially_kept)`; `partially_kept` rows carry a **"partial"**
  badge. (Not a separate tab — decided.)
- **All** — every promise; `renegotiated` / `cancelled` shown muted as *superseded*.

The "N business days" window reuses `business-days.ts` so it honors the org working-day /
holiday calendar (consistent with grace computation). N is a frozen constant in the
deriver for now (no per-org setting — YAGNI; revisit if requested).

---

## 4. Layout

### KPI strip — `PromisesMetrics`
Four cards, each cross-linking to its tab:
- **Active** — count + Σ `promised_amount`.
- **Due soon** — count + Σ `promised_amount`.
- **Broken** — count + Σ outstanding (`promised_amount − amount_received`, floored at 0).
- **Kept rate** — `kept / (kept + partially_kept + broken)` as a %, **null-safe** (renders
  "—" not `NaN` when the denominator is 0). `partially_kept` counts toward the numerator's
  context but is reported so the rate is honest (mirrors the strict framing in C8 reports).

Aggregates are computed org-wide by `computePromiseMetrics`, independent of the active tab.

### Pill tabs + heat rail
`Active · Due soon · Broken · Kept · All`. **Default landing tab = Due soon.** Each tab
shows its count; the heat rail mirrors the Collections/Accounts visual treatment.

### Ledger rows — `PromisesLedger`
Per row: customer name · promised amount · promised date + grace (relative, via `dates.ts`)
· received-so-far progress (`amount_received` / `promised_amount`) · status chip
(`status-style.ts`) · owner label. Sortable by **due date (default)**, amount, or customer
(`PROMISE_SORTS`). Clicking a row sets `?promiseId=` and opens the quick panel. Empty-state
per tab.

### Quick-view side panel — `PromiseQuickPanel` (`?promiseId=`, URL-addressable)
- Customer, promised amount, promised & grace dates, baseline balance, received-so-far.
- Linked invoices (number + current balance) from `promise_invoices`.
- The originating contact note (from `contact_logs`).
- Deep-links: **"Open in Collections"** (`/dashboard?case=…`) and **"View account"**
  (`/accounts/:id`).

---

## 5. Error handling, testing, scope

### Error handling
- **Connect-gate**: mirrors `/accounts` — redirect to `/settings` when QBO is not
  connected.
- **Empty states**: a clear zero-promises message and per-tab empty states.
- Numeric coercion at the loader boundary (`Number(...) || 0`) as in the dashboard loader;
  kept-rate denominator guarded.

### Testing
- `tests/promise-ledger.test.ts` (pure): bucket derivation with emphasis on the
  **past-grace-still-pending** edge, the **due-soon business-day window**, **kept-rate
  null-safety**, the **partial** badge, and superseded muting; plus filter/sort/metric
  cases.
- A loader / RLS test mirroring the accounts loader test (org-scoping, connect-gate
  redirect, `?promiseId=` selection).
- Gate on `vitest` (all green) + `tsc` 0 errors + clean `build`, consistent with every
  prior phase.

### Out of scope (deep-link instead)
- Cancelling, renegotiating, logging contact, or sending SMS — all remain in Collections
  (those routes already exist; duplicating them here risks two surfaces disagreeing).
- Kept-rate **trends / by-rep / historical** analytics stay in `/reports` (C8). This tab is
  **current-state**, not historical reporting — no overlap.
- No new migration, no schema change, no per-org "due soon" window setting.

---

## 6. Decisions locked during brainstorming
- Core purpose: **promise pipeline / ledger** (monitoring + follow-up).
- Action model: **read + deep-link**, like Accounts. No new write routes.
- Segmentation: **lifecycle status pill tabs** (Active · Due soon · Broken · Kept · All).
- Row click: **quick-view side panel** via `?promiseId=`.
- KPI strip: **bucket counts + $ at risk + kept rate**; default landing tab **Due soon**.
- "Due soon" window: **3 business days** (frozen constant, org-calendar aware).
- `partially_kept`: lives under **Kept** with a badge — not its own tab.
- Default sort: **due date**.
