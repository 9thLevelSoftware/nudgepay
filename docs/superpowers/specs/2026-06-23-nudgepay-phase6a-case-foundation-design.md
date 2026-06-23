# Phase 6a — Case Foundation — Design

**Status:** Approved (design) — 2026-06-23
**Project:** NudgePay (AR-collections workspace for QuickBooks Online; Chancey Heating & Cooling)
**Predecessors:** Phases 1–5d complete and merged to `main`.
**Parent:** Phase 6 — the operational loop. Decomposed into **6a (case foundation, this doc)**, 6b (promise + payment loop), 6c (hard next-action invariant + minimal exceptions).
**Checklist:** `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` (items A1-impl; partial A2 scaffolding).

## 1. Goal

Promote the **customer account** to the primary collections workspace (decision A1). Introduce a durable **collection case** per customer that auto-opens when the customer has overdue work and auto-resolves when it clears. Refactor the work queue from one-row-per-invoice to **one-row-per-case**, with invoices shown *inside* the customer workspace and the SMS conversation keyed per-customer. This lays the structural foundation the promise/payment loop (6b) and the hard next-action invariant (6c) build on.

## 2. Background — current state

- The queue is **invoice-centric**: `WorkItem` is one-per-invoice (`worklist.ts:11`); `buildWorkItems`/`applyView`/`computeMetrics` are pure and unit-tested. Selection is `?invoice=<id>` in the dashboard loader.
- `customers.owner` (uuid FK, `0008`/5d) already provides per-customer ownership; the queue OWNER column + Overview assign control render it.
- `contact_logs` has `invoice_id` (required by `parseContactLogForm`), `customer_id`, `outcome`, `notes`, `follow_up_at`, and the two promise columns (`promised_amount`/`promised_date`, `0007`).
- `text_messages` already carries `customer_id` (`0006`) alongside `invoice_id` — so a customer-level thread is reachable without a migration.
- Status/next-action are **derived** today (`nextActionOf()`, `worklist.ts:76`) — no durable record. There is no case entity.
- RLS gates all tables via `is_org_member(org_id)` (`0001`/`0002`). User client for reads + writes; service client only for connection status + member roster.

## 3. Locked decisions (Phase 6 cross-cutting)

| Decision | Choice |
| --- | --- |
| Workspace model (A1) | **Customer account primary**; dedicated `collection_cases` table (not fields on `customers`, not derived). |
| Next-action invariant (A2) | **Hard invariant** — enforced in 6c. 6a defines the schema and keeps next-action durable when a contact is logged. |
| Case lifecycle | **Auto open + auto close.** |
| Exceptions | **Minimal placeholder** (`on_hold` + review date) — wired in 6c; column/check defined in 6a. |
| Promise matching | **Invoice balance-delta** — implemented in 6b. |
| Twilio tenancy | **Platform-owned + provisioned** (affects the later Connections phase, not 6a). |

## 4. Architecture

A nullable-FK **`collection_cases`** table holds the durable per-customer collections state (status, next-action, lifecycle timestamps). A **pure** `reconcileCases` function computes open/resolve operations from the current overdue set and existing open cases; a thin server applier runs it after every invoice-write path (sync, webhook, CDC) and as a cron safety net. The work queue is rebuilt around **`CaseItem`** (one per open case), aggregating the customer's invoices; invoices render inside the customer workspace. The SMS thread queries by `customer_id`. Interactions gain a `case_id` link.

## 5. Components & data flow

### 5.1 Migration `supabase/migrations/0009_collection_cases.sql`

```sql
create table collection_cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  status text not null default 'new'
    check (status in ('new','working','promised','waiting','on_hold','resolved')),
  next_action_type text
    check (next_action_type in ('contact','follow_up','promise','waiting','exception')),
  next_action_at date,
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz,
  created_at timestamptz not null default now()
);

-- At most ONE open case per customer (enforces auto-open singularity + idempotent reconcile).
create unique index collection_cases_one_open_per_customer
  on collection_cases (customer_id) where closed_at is null;
create index collection_cases_org_status_idx     on collection_cases (org_id, status);
create index collection_cases_org_nextaction_idx on collection_cases (org_id, next_action_at);

-- RLS: gate by org membership (mirror 0002).
alter table collection_cases enable row level security;
create policy collection_cases_all on collection_cases
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Interactions link to a case (nullable; historical rows may stay null).
alter table contact_logs  add column case_id uuid references collection_cases(id) on delete set null;
alter table text_messages add column case_id uuid references collection_cases(id) on delete set null;
create index contact_logs_org_case_idx  on contact_logs  (org_id, case_id);
create index text_messages_org_case_idx on text_messages (org_id, case_id);
```

One-time backfill (in the migration, after the table exists): for each customer with ≥1 overdue invoice (`balance>0 AND due_date<current_date`) and no open case, insert a case (`status='new'`, `next_action_type='contact'`, `next_action_at=current_date`); then set `case_id` on existing `contact_logs`/`text_messages` to that customer's open case. Rows whose customer has no open case (already resolved) stay null.

Default privileges (`0001`) already grant DML to `authenticated`/`service_role`; RLS restricts rows. Owner stays on `customers.owner` — no per-case owner column in 6a.

### 5.2 `app/lib/cases.ts` (pure, no I/O, no `.server` suffix)

```ts
export type CaseStatus = "new" | "working" | "promised" | "waiting" | "on_hold" | "resolved";
export type NextActionType = "contact" | "follow_up" | "promise" | "waiting" | "exception";

export type CaseRow = {
  id: string; customerId: string; status: CaseStatus;
  nextActionType: NextActionType | null; nextActionAt: string | null;
};

export type CaseInvoice = {
  invoiceId: string; docNumber: string | null; balance: number;
  dueDate: string | null; ageDays: number; heat: Heat;
};

export type CaseItem = {
  caseId: string; customerId: string; customerName: string;
  owner: string; ownerId: string | null;
  status: CaseStatus; nextActionType: NextActionType | null; nextActionAt: string | null;
  totalOverdue: number; invoiceCount: number; oldestAgeDays: number;
  heat: Heat; priority: Priority; lastContact: LastContact;
  phone: string | null; email: string | null;
  promise: { amount: number; date: string } | null;  // populated in 6b; null in 6a
  brokenPromise: boolean;                              // populated in 6b; false in 6a
  followUpDue: boolean;                                // nextActionAt != null && <= today
  searchText: string;
  invoices: CaseInvoice[];
};

export type ReconcileOp =
  | { kind: "open"; customerId: string }
  | { kind: "resolve"; caseId: string };

// Pure: given the current overdue set per customer and the existing OPEN cases,
// return the open/resolve operations needed. Idempotent (empty when already correct).
export function reconcileCases(
  overdueCustomerIds: Set<string>,
  openCases: { id: string; customerId: string }[],
  today: string,
): ReconcileOp[];

// Pure: group invoices by customer/case, aggregate, derive heat/priority from the
// OLDEST overdue invoice, resolve owner label, build searchText. Invoices with a
// null customer_id are excluded (and counted by the caller for a guard log).
export function buildCaseItems(
  cases: CaseRow[], invoices: InvoiceInput[], customers: CustomerInput[],
  lastContacts: LastContactInput[], today: string,
  ownerLabels: Map<string, string>,
): CaseItem[];

export function applyCaseView(items: CaseItem[], view: ViewId, today: string, currentUserId: string | null): CaseItem[];
export function sortCaseItems(items: CaseItem[], sort: SortId): CaseItem[];
export function computeCaseMetrics(items: CaseItem[], today: string): Metrics;
```

- `cases.ts` imports `heatOf`, `priorityOf`, `HeatBand`/`Heat`/`Priority`/`Metric(s)`/`ViewId`/`SortId`/`InvoiceInput`/`CustomerInput`/`LastContactInput`/`LastContact` from `worklist.ts` (kept as the invoice-level helper home). No duplication of heat/priority logic.
- `heat`/`priority` derive from `oldestAgeDays` (max age across the case's overdue invoices). `neverContacted` is case-wide (no contact on any of the case's invoices).
- View predicates (same 7 `ViewId`s): `all-open` → all; `30-plus` → `oldestAgeDays>=30`; `high-value` → `totalOverdue>=HIGH_VALUE_THRESHOLD`; `never-contacted` → `lastContact===null`; `follow-ups-due` → `nextActionAt!=null && nextActionAt<=today`; `broken-promises` → `brokenPromise` (false-set in 6a; real in 6b); `my-work` → `ownerId!=null && ownerId===currentUserId`.
- `searchText` = customer name + all doc numbers + phone + email + owner label, lowercased.

### 5.3 `app/lib/case-lifecycle.server.ts`

```ts
// Thin Supabase applier around reconcileCases. Service or user client per caller.
export async function applyCaseReconciliation(client: SupabaseClient, orgId: string, today: string): Promise<{ opened: number; resolved: number }>;
```

- Reads the org's overdue invoice customer ids (`balance>0 AND due_date<today`) and current open cases (`closed_at is null`); calls `reconcileCases`; applies:
  - **open** → `insert collection_cases (org_id, customer_id, status='new', next_action_type='contact', next_action_at=today)`. A unique-index conflict (concurrent open) is caught and treated as no-op.
  - **resolve** → `update collection_cases set status='resolved', closed_at=now(), next_action_at=null where id=…`.
- Idempotent; safe to call repeatedly and concurrently.

### 5.4 `app/lib/qbo-sync.server.ts`

Call `applyCaseReconciliation(deps.service, orgId, today)` at the end of `syncOverdueInvoices`, `applyInvoiceWebhook` (after the upsert), and `runCdcCatchup`. Failures in reconciliation must not abort the sync write (log + continue); the cron safety net re-converges.

### 5.5 `app/lib/contact-log.ts` + `app/routes/api.contact-logs.tsx`

- `parseContactLogForm`: **require `caseId`**, make `invoiceId` **optional** (a contact can be case-level or invoice-specific). All other validation unchanged.
- `api.contact-logs` action: after inserting the log (with `case_id`, optional `invoice_id`), update the case — `next_action_at = followUpAt` (when provided), `status = 'working'`. Cross-org guard: the case must belong to the caller's org (user-client read before write). `safeReturnTo` unchanged.
- The 6b promise path will additionally set `status='promised'`; not in 6a.

### 5.6 Dashboard loader (`app/routes/dashboard.tsx`)

- Load open cases for the org (`collection_cases where closed_at is null`), overdue invoices (existing query) + their `customers(name, phone, email, owner)` embed, last contacts, and the roster (existing).
- Build via `buildCaseItems` → `applyCaseView` → `sortCaseItems`; counts via `computeCaseMetrics`.
- **Selection** moves to `?case=<caseId>` with optional `&invoice=<id>` sub-selection. For the selected case load: the customer's invoices (for Overview), the SMS thread by **`customer_id`** ascending (Messages), and the contact logs for the case (Activity).
- Return `currentUserId`, `roster` (existing), and the case-shaped data.

### 5.7 Components

- **`WorkQueue`** — rows are cases. Columns: Customer · Status · Owner · Total overdue · Oldest age (heat) · Next action (+ due) · # invoices. The 7 saved-view tabs + count badges unchanged (now case-scoped).
- **`DetailPanel`** — customer/case workspace. Header: customer, total overdue, owner assign control (existing), case status + next action. Tabs: *Overview* (contact info, owner, status/next-action, **the customer's invoices listed inside the case** with per-invoice balance/age/heat), *Messages* (thread by `customer_id`), *Activity* (case contact logs). Invoice-specific actions (log a contact / send SMS referencing an invoice) carry an optional `invoice` sub-selection.
- **`MetricsStrip`** — labels reflect case counts.
- No new route registration in 6a (selection is a dashboard query param; `api.assign`/`api.contact-logs` already exist).

## 6. Security boundary

- New `collection_cases` table is RLS-gated by `is_org_member(org_id)`; reads and the contact-driven case update go through the **user client**. The lifecycle applier may use the service client within sync (already service-scoped per org) but is org-scoped by `org_id` on every query.
- Cross-org guards: the contact-log action reads the case via the user client before writing; a foreign `caseId` changes nothing.
- No secrets to the client. The browser never touches the DB. `safeReturnTo` unchanged on all redirects.
- No `node:*` in `app/**`; `cases.ts` is pure and suffix-free; type-only imports from `worklist.ts` (a pure module) are safe.

## 7. Error & edge handling

- **Partial payment** (balance reduced, not cleared) → case stays open. Auto-resolve only when no overdue/open balance remains.
- **Cleared → re-delinquent** → first case auto-resolves; a new case opens on the next overdue (partial-unique index prevents duplicate open cases).
- **Concurrent reconcile** (webhook + cron) → unique-index conflict on open is caught and treated as already-open (no-op).
- **Orphan invoice** (`customer_id` null) → excluded from the case queue and counted/logged (guard; Chancey QBO invoices always have a customer).
- **Selecting a just-resolved case** (load/resolve race) → loader degrades gracefully (no selection / resolved state).
- **Owner left org** → `customers.owner on delete set null` (5d); case shows "Unassigned".
- **Not connected** → no cases; all view-count badges 0 (mirrors existing default).
- **`case_id` backfill** leaves resolved-customer history rows null — threads/activity still render via `customer_id`.

## 8. Testing

- **Pure units `tests/cases.test.ts`** — `reconcileCases` (open for overdue-no-case; resolve for open-case-no-overdue; no-op when correct; re-delinquent opens fresh; idempotent). `buildCaseItems` (aggregates `totalOverdue`/`invoiceCount`/`oldestAgeDays`; heat/priority from oldest; `lastContact` = most recent across case; `searchText` includes owner + doc numbers; orphan invoices excluded). `applyCaseView` (all 7 predicates incl. `my-work`, `follow-ups-due` via `nextActionAt`, `high-value` via `totalOverdue`). `computeCaseMetrics` (case counts + summed overdue).
- **DB-backed RLS `tests/cases-rls.test.ts`** — a member reads only own-org cases; cross-org isolation; `collection_cases_one_open_per_customer` holds (second open insert conflicts). Lifecycle applier against local Supabase: upsert overdue invoice → case opens; clear balance → case resolves; re-delinquent → new case.
- **`tests/api-contact-logs.test.ts` extended** — logging a contact updates the case (`next_action_at`, `status='working'`); case-anchored with optional invoice; cross-org guard rejects a foreign case.
- **`tests/dashboard-worklist.test.ts` extended** — `buildCaseItems` composition feeding the loader's case shape + `viewCounts`.
- **Migration/backfill** — currently-overdue customers get cases; `case_id` backfilled on their logs/messages; resolved-customer rows stay null.
- **Components** — `npx tsc -b` + `npx react-router build`. Live Chrome: case-centric queue → open workspace → invoices inside → per-customer SMS thread → log a contact updates next-action → a saved view filters by case.

## 9. File structure

| Action | File | Responsibility |
| --- | --- | --- |
| Create | `supabase/migrations/0009_collection_cases.sql` | table + RLS + indexes + `case_id` columns + one-time reconcile/backfill |
| Create | `app/lib/cases.ts` | pure `reconcileCases`, `CaseItem`, `buildCaseItems`, `applyCaseView`, `sortCaseItems`, `computeCaseMetrics` |
| Create | `app/lib/case-lifecycle.server.ts` | `applyCaseReconciliation` Supabase applier |
| Modify | `app/lib/qbo-sync.server.ts` | invoke applier after invoice upserts (sync/webhook/CDC) |
| Modify | `app/lib/contact-log.ts` | `caseId` required, `invoiceId` optional |
| Modify | `app/routes/api.contact-logs.tsx` | resolve case, update next-action/status on save |
| Modify | `app/routes/dashboard.tsx` | loader builds cases; select by `case`; load selected case invoices/thread/activity |
| Modify | `app/components/WorkQueue.tsx` | case rows + columns |
| Modify | `app/components/DetailPanel.tsx` | customer/case workspace; invoices inside; thread by `customer_id`; status/next-action header |
| Modify | `app/components/MetricsStrip.tsx` | case-count labels |
| Create | `tests/cases.test.ts` | pure unit tests |
| Create | `tests/cases-rls.test.ts` | DB-backed RLS + lifecycle |
| Modify | `tests/api-contact-logs.test.ts`, `tests/dashboard-worklist.test.ts` | case update + composition |

## 10. Global constraints (carried)

- React Router v7 framework mode on Cloudflare Workers. No `node:*` in `app/**`. No client→`.server.ts` module-graph reference; pure modules (`worklist.ts`, `cases.ts`) stay suffix-free. Type-only imports from route/pure modules are erased at build and safe.
- Tailwind v4 CSS-first; static literal class strings only. Thermal tokens (cool/warm/hot), copper sole accent, ink/panel/surface/border/text/muted.
- Supabase RLS via `is_org_member(org_id)`; user client for reads + the contact-driven case write; service client only for connection status / member roster / sync-time reconciliation (org-scoped). The browser never touches the DB. `safeReturnTo` on all redirects.
- Vitest against local Supabase; per-test fresh orgs + globally-unique data; never global truncation. Run via `npx vitest run`.
- Conventional Commits. Never commit secrets. Never `git add` untracked prototype dirs or local-only scripts.
- Migrations applied via `npx supabase migration up` against local Supabase.

## 11. Out of scope (later sub-phases / phases)

- Promise state machine, payment/credit sync, balance-delta evaluation, webhook CloudEvents format fix + reconciliation sweep → **6b**.
- Hard next-action invariant forced UX, `waiting`/`on_hold` review-date states, minimal exception placeholder → **6c**.
- Multi-factor/override priority, structured-outcome expansion, unified timeline, sync-error visibility → Phase 7.
- In-UI Connections & Settings (Connect QuickBooks CTA, sender/A2P status) → Phase 9.
