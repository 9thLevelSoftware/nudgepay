# Phase 11 — Accounts Tab — Design Spec

Date: 2026-06-27
Status: Approved (brainstorming) — pending plan
Reference: builds on the Phase 10 Collections re-skin design system and the
customer-centric model locked in A1 (`docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md`).

## Summary

Build the **Accounts** tab — currently an inert side-nav item
(`AppShell` `NAV_ITEMS` → `{ name: "accounts", icon: "user" }`) — into a working
surface. Accounts is the **customer directory**: a searchable/sortable list of
**all** customers (paid-up, zero-balance, and overdue alike), each opening a
**360° profile** that also supports editing the org-owned customer fields.

This complements, and does not duplicate, Collections (`/dashboard`):

- **Collections** = the active *work queue* — customer-centric cases that need
  collection action, prioritized by heat, filtered to overdue/at-risk.
- **Accounts** = the *directory* — every customer, with a full profile and
  inline editing of org-owned fields. Action-taking (SMS, logging, promises)
  stays in Collections; the profile links across.

The build reuses the Phase 10 warm-parchment design system and the codebase's
established discipline: a pure lib (`accounts.ts`) → a thin loader → presentational
components, with Node-only unit tests (no jsdom, no `.tsx` render tests).

## Decisions (from brainstorming)

1. **Purpose:** directory → 360° profile → inline edit of org-owned fields. ("All
   three" of directory / deep-dive / data-management collapse into this.)
2. **Layout:** *hybrid*. `/accounts` is a master-detail list + quick-view side
   panel (mirrors Collections' `?caseId=` with `?customerId=`); a quick-view
   "Open full profile →" link navigates to a dedicated full page at
   `/accounts/:id`.
3. **Edit scope:** org-owned fields only — owner, preferred channel, do-not-call,
   do-not-text — **plus** a new NudgePay-only **account notes** field.
   QBO-owned `name`/`email`/`phone` are **read-only** (overwritten on every sync
   by `mapQboCustomer`; editing them locally would be silently clobbered).
   `sms_consent` is read-only (legal record; STOP/START is its sole mutator).
4. **Architecture:** a fresh customer-centric pure lib (`accounts.ts`), separate
   from the case-centric `cases.ts`. The case model enforces the next-action /
   priority invariants and must not be bent to represent caseless customers.

## Verified data-model facts (drive the design)

- **Customers table holds every QBO customer.** `runFullSync` /`qboCdc` map *all*
  customers via `mapQboCustomer` and upsert on `(org_id, qbo_id)` — not only
  those with open invoices. A directory of "all customers" has real backing data,
  including paid-up / zero-balance accounts.
- **QBO owns `name`/`email`/`phone`.** `mapQboCustomer` sets exactly those three
  (+ `qbo_id`/`org_id`) on every sync. They are read-only in this UI.
- **Org-owned customer fields are sync-safe.** `owner` (0008),
  `preferred_channel`/`do_not_call`/`do_not_text` (0017), and the new `notes`
  column are **not** in the upsert column set, so sync never clobbers them.
- **`api.assign`** already keys writes by bare `customerId` + `returnTo` →
  reusable from Accounts verbatim.
- **`api.comm-prefs`** resolves the customer via `caseId` then `invoiceId` and has
  **no bare-`customerId` path**. Accounts needs one (a customer may have neither a
  case nor a chosen invoice). The design adds a small org-scoped `customerId`
  branch, guarded exactly like `api.assign`.
- **`buildTimeline`** (`timeline.ts`) is pure and input-driven. Feeding it the
  customer's `contact_logs` + `text_messages` across *all* their cases yields an
  account-wide history with no new table.

## Architecture & units

### `app/lib/accounts.ts` (new, pure — no I/O, no `node:*`, no secrets)

Mirrors the `worklist.ts`/`cases.ts` shape so it is safe in both bundles and
unit-testable without I/O.

- `buildAccountRows(customers, invoices, cases, lastContacts)` → one
  `AccountRow` per customer, over **all** customers. Aggregates open balance,
  open-invoice count, oldest-overdue age, owner label, comm-pref summary, and
  last-contact.
- `deriveStanding(row)` → `AccountStanding` discriminated union:
  - `current` — no open balance.
  - `overdue` — open balance, no active collection case.
  - `in_collections` — an active (non-suppressed) case exists.
  - `on_hold` — case in an exception/on-hold state.
- `applyAccountFilter(rows, filter)` — `all` / `open-balance` / `paid-up` /
  `unassigned` / `on-hold`.
- `sortAccountRows(rows, sort)` — `name` / `balance` / `last-contact`.
- `computeAccountMetrics(rows)` → `{ totalCustomers, totalOpenAR,
  unassignedCount, paidUpCount }`.

Standing and metrics are pure functions with Node-only unit tests
(`tests/accounts.test.ts`), matching the established constraint.

### Routes

| Route | Kind | Purpose |
|-------|------|---------|
| `routes/accounts.tsx` | page | directory list + quick-view panel; loader reads all customers/invoices/cases/last-contacts for the org |
| `routes/accounts.$id.tsx` | page | full 360 profile; loader reads one customer + their invoices + account-wide timeline inputs |
| `routes/api.account-notes.tsx` | action | write `customers.notes` (user-client, org-scoped, `returnTo`); mirrors `api.assign`'s guard |

Both pages are RLS-scoped via the user client (`requireUser`/`resolveOrg`), with
an explicit `org_id` bind on each customer read (the `api.assign` pattern) so a
multi-org user cannot reach another org's customer.

### Components

- `AppShell` — **activate the Accounts nav item.** The active flag becomes
  route-derived (an `active` prop / current-route check) instead of the hardcoded
  `active: true` on Collections, so both tabs light correctly. Collections nav
  behavior is preserved unchanged.
- `AccountsDirectory` (new) — KPI strip (accounts metrics, `MetricsStrip` visual
  language) + the customer list (warm WorkQueue visual language: paper header
  band, pill filter tabs with counts, search, sort, status chips). Columns:
  customer · standing chip · owner · open balance · # open invoices · comm-pref
  badges · last contact.
- `AccountQuickPanel` (new) — condensed side panel: contact (read-only),
  standing, open balance, comm-pref badges, and **"Open full profile →"** to
  `/accounts/:id`.
- `AccountProfile` (new) — full page:
  - **Header** (ink block, DetailPanel-style): name, standing chip, owner, total
    open balance.
  - **Stat tiles**: total open AR · # open invoices · oldest overdue · lifetime
    invoiced (sum of synced invoices, labeled "synced" — payments coverage is
    partial, so this is not presented as a paid/lifetime-revenue figure).
  - **Contact card**: name/email/phone **read-only** with a "from QuickBooks"
    note; `sms_consent` read-only.
  - **Edit forms** (org-owned only): owner (`api.assign`), comm prefs
    (`api.comm-prefs` + new `customerId` branch), account notes
    (`api.account-notes`). All post with `returnTo=/accounts/:id`.
  - **Invoices table**: ALL invoices (paid + open) — doc #, amount, balance, due
    date, status.
  - **Activity timeline**: account-wide via `buildTimeline`.
  - **"Open in Collections"** link when an active case exists.

Reused without change: the Phase 10 `@theme` palette, `status-style`,
`comm-prefs`, `format`, `timeline`, `Icons`, and (for the active case) the
existing dashboard deep-link.

## Account notes (new write path)

- Migration `0019_account_notes.sql`: `alter table customers add column notes
  text`, `notes_updated_at timestamptz`, `notes_updated_by uuid`. RLS already
  governs `customers` via the existing `customers_all` policy — no new policy.
- `api/account-notes` route: user-client, resolve + org-bind the customer (like
  `api.assign`), `update({ notes, notes_updated_at, notes_updated_by })`, redirect
  to `returnTo`. A failed write throws to the error boundary (no silent success).

## Data flow

Two new loaders, both RLS-scoped:

- `/accounts` — org's customers + invoices (for balance/standing) + active cases
  (for `in_collections`/`on_hold`) + last-contact per customer → `buildAccountRows`
  → `applyAccountFilter`/`sortAccountRows`/`computeAccountMetrics`. The selected
  customer (`?customerId=`) populates the quick panel.
- `/accounts/:id` — one customer + their invoices + their `contact_logs` +
  `text_messages` (account-wide) + owner roster → profile props + `buildTimeline`.

No changes to the Collections loader, cases, priority, or any sync path.

## Error handling

- Unknown/foreign `:id` or `?customerId=` → resolves to nothing under RLS + the
  org bind; the profile route returns a 404-style "account not found" state, the
  directory panel shows the empty quick-view.
- Edit writes reuse the established pattern: org-scope guard, membership guard
  (owner assign), throw-on-write-error to the boundary, `returnTo` redirect.

## Testing

Node-only harness (no jsdom; no `.tsx` render tests — established constraint).

1. `tests/accounts.test.ts` — pure-lib coverage: `deriveStanding` across the four
   standings (incl. a paid-up zero-balance customer and an on-hold case),
   `buildAccountRows` aggregation (open balance, oldest overdue, last contact),
   `applyAccountFilter`, `sortAccountRows`, `computeAccountMetrics`.
2. `api.comm-prefs` `customerId`-branch test (resolves customer directly;
   foreign id no-ops) + `api.account-notes` RLS/org-scope test (mirrors the
   existing assign/RLS tests).
3. `npx react-router typegen && npx tsc -b` → exit 0.
4. `npx vitest run` → green (existing suite unchanged + new tests).
5. `npx react-router build` → clean.
6. Visual confirmation (local, not committed): seeded app, `/accounts` directory
   + quick panel + a `/accounts/:id` profile, confirming the warm palette reads
   correctly and matches the Collections visual language.

## Build phasing (for the plan)

One spec, two build phases:

- **11a** — `accounts.ts` + tests, `/accounts` directory + quick panel,
  `MetricsStrip`-style KPI strip, AppShell nav activation.
- **11b** — `/accounts/:id` full profile, `0019_account_notes` migration +
  `api/account-notes`, `api.comm-prefs` `customerId` branch, account-wide
  timeline.

## Out of scope (explicit)

- No editing of QBO-owned fields (name/email/phone) — read-only with a
  provenance note. No QBO write-back, no local-override layer.
- No new action-taking surfaces on Accounts (SMS composer, contact logging,
  promise creation/cancel) — those remain in Collections; the profile links
  across via "Open in Collections". Accounts is a directory/profile, not a second
  collections console.
- No changes to Collections, `cases.ts`, `worklist.ts`, `priority.ts`, or any
  sync path.
- No bulk operations on the directory (selection/bulk-assign/bulk-SMS stay a
  Collections feature) in this phase.

## Migrations

`0019_account_notes.sql` — additive columns on `customers` (`notes`,
`notes_updated_at`, `notes_updated_by`). No RLS change; no data backfill.
