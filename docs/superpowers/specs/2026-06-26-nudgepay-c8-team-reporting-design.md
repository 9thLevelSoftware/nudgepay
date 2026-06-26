# NudgePay C8 — Team Performance & Workload Reporting (Design Spec)

**Created:** 2026-06-26
**Phase:** 8 (P1 throughput & consistency)
**Gap item:** C8 — "Team performance / workload reporting. Per-employee throughput, collection rate by aging bucket, promise-kept rate, time-to-first-contact, adoption metrics. Reporting layer essentially unbuilt today (only org-wide KPI counts + my-work count)."
**Builds on:** the case pipeline (`buildCaseItems`/`computeCaseMetrics` in `cases.ts`), the promise loop (`promises.created_by`/`status`/`resolved_at`, 6b), contact logging (`contact_logs.user_id`/`created_at`/`case_id`), case lifecycle (`collection_cases.opened_at`), and the org roster (`memberships`).

---

## 1. Problem

The only reporting today is the org-wide KPI strip (`computeCaseMetrics`: 30+, high-value, never-contacted, all-open, follow-ups-due, broken-promises, on-hold) and a "my work" count. A manager cannot answer: who is contacting accounts and how much, who keeps their promises, how fast new cases get first contact, or who is overloaded. C8 adds a per-team reporting surface for those questions.

## 2. Goal

An **owner-only `/reports`** page presenting four metrics over a **selectable 7 / 30 / 90-day window** (default 30), computed **live** from existing tables (no new tables, no materialized views), following the established pure-aggregation pattern (`computeCaseMetrics`).

Non-goals (YAGNI / deferred): collection rate by aging bucket (requires payment→invoice line attribution the app deliberately avoids — balance-delta only); CSV export; charts/graphs (numbers + tables first); historical trend lines; per-rep time-to-first-contact.

## 3. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Metrics shipped | Throughput, promise-kept rate, time-to-first-contact, workload snapshot. |
| Collection-rate-by-bucket | **Deferred** — no payment→invoice/bucket attribution in the data model. |
| Surface | Dedicated **`/reports`** route (keeps the dashboard focused). |
| Access | **Owner-only** (UX/surface gate; the underlying rows are RLS-readable by any member, so this is not a security boundary — stated honestly). |
| Time window | Selectable presets **7 / 30 / 90 days** via `?range=`, default 30. Workload snapshot is current-state (no window). |
| Compute | **On-the-fly pure aggregation** from RLS reads. No new tables. |
| `partially_kept` in headline rate | Counts as **NOT kept** (strict); shown as its own column. |
| Time-to-first-contact granularity | **Team-level** summary, not per-rep (attribution is ambiguous). |

## 4. Architecture

- **`app/lib/reports.ts`** (new, **pure** — no I/O, no `node:*`, no `.server`; imported by the route + tests): `buildTeamReport(input) → TeamReport`. Single responsibility: shape primitive inputs into the report. Mirrors `computeCaseMetrics`.
- **`app/routes/reports.tsx`** (new): owner-gated loader performs the RLS reads (user client), shapes them into the pure aggregator's inputs, calls `buildTeamReport`, and renders. Reuses the existing `buildCaseItems` for the workload snapshot (no duplicate priority pipeline).
- **`app/components/AppShell.tsx`**: the existing (currently inert) "Reports" nav item becomes a live `Link` to `/reports` **for owners only**; for non-owners it stays inert. AppShell already receives `isOwner`.

## 5. Owner gating

The `reports.tsx` loader resolves the current user's `memberships.role` for the active org (the same role the dashboard already derives for `isOwner`). Non-owners are redirected to `/dashboard`. The nav link is rendered only when `isOwner`. This is a **surface gate, not a security boundary** — every metric is computed from rows a member can already read via RLS; C8 introduces no new RLS. (A future hardening pass could add owner-scoped RLS, but that is out of scope.)

## 6. Metric definitions

Roster `R` = active org members (`userId → label`), from `memberships` joined to the display-name source the dashboard already uses for `ownerLabels`. `windowStart` = `today − range` days (UTC calendar date). All "in window" comparisons are inclusive of `windowStart`.

### 6.1 Throughput (per rep, windowed)
From `contact_logs` with `created_at ≥ windowStart`:
- `contactsLogged` = count of rows where `user_id = rep`.
- `casesTouched` = count of **distinct** `case_id` where `user_id = rep` (ignores null `case_id`).
Reps with zero activity appear with zeros (full roster shown).

### 6.2 Promise-kept rate (per rep, windowed by `resolved_at`)
From `promises` where `created_by = rep`, `resolved_at ≥ windowStart`, and `status ∈ {kept, partially_kept, broken}` (the resolved outcomes):
- `kept`, `partiallyKept`, `broken` = counts by status.
- `resolved` = `kept + partiallyKept + broken`.
- `keptRate` = `resolved === 0 ? null : kept / resolved` (strict — `partially_kept` excluded from the numerator; `null` when no resolved promises, never `NaN`).
`pending`, `renegotiated`, `cancelled` are excluded (not outcomes — superseded/voided).

### 6.3 Time-to-first-contact (team-level, windowed by `opened_at`)
For `collection_cases` with `opened_at ≥ windowStart`:
- For each such case, `firstContactAt` = earliest `contact_logs.created_at` for that `case_id` (any rep), or null if none yet.
- Over cases **with** a first contact: `medianHours`, `avgHours` from `opened_at` to `firstContactAt`; `within24hPct` = share contacted within 24h.
- `uncontacted` = count of in-window cases with no contact yet.
Returns null medians/avg/pct when no contacted cases exist in the window.

### 6.4 Workload snapshot (per owner, current-state)
From `buildCaseItems` output (current open cases), grouped by `ownerId`:
- `openCases` = count of non-suppressed cases owned.
- `overdueTotal` = sum of `totalOverdue`.
- `brokenPromises` = count where `brokenPromise`.
Unassigned cases (`ownerId === null`) group under an "Unassigned" row. Owners with no open cases still appear (from roster) with zeros.

## 7. Data flow

```
reports.tsx loader (RLS user client, owner-gated):
  range          = parse ?range ∈ {7,30,90}, default 30
  today          = new Date().toISOString().slice(0,10)   // consistent with the app's UTC `today`
  windowStart    = addCalendarDays(today, -range)          // reuse business-days.ts
  roster         = members (userId → label)
  contactLogs    = contact_logs {user_id, case_id, created_at} where created_at >= windowStart
  promises       = promises {created_by, status, resolved_at} where resolved_at >= windowStart
  openedCases    = collection_cases {id, opened_at} where opened_at >= windowStart
  firstContacts  = min(contact_logs.created_at) per case_id for openedCases
  workloadCases  = buildCaseItems(...)  // current open snapshot (owner, suppressed, totalOverdue, brokenPromise)
        ↓
  buildTeamReport({ roster, contactLogs, promises, caseFirstContacts, workloadCases, windowStart, today })
        ↓  TeamReport  → render (summary strip + per-rep table + workload table + range toggle)
```

`TeamReport` shape (illustrative):
```ts
type TeamReport = {
  range: 7 | 30 | 90;
  perRep: Array<{ userId: string; label: string;
    contactsLogged: number; casesTouched: number;
    kept: number; partiallyKept: number; broken: number; resolved: number; keptRate: number | null; }>;
  firstContact: { medianHours: number | null; avgHours: number | null; within24hPct: number | null; contacted: number; uncontacted: number };
  workload: Array<{ ownerId: string | null; label: string; openCases: number; overdueTotal: number; brokenPromises: number }>;
};
```

## 8. UI

`/reports` renders inside `AppShell`:
- **Range toggle** (7 / 30 / 90) — links that set `?range=`; current range highlighted.
- **Summary strip** — time-to-first-contact tile (median + within-24h% + uncontacted) and a couple of team totals (total contacts logged, team kept-rate).
- **Per-rep table** — one row per roster member: contacts, cases touched, kept/partial/broken, kept-rate (`—` when null).
- **Workload table** — one row per owner + Unassigned: open cases, overdue $, broken promises.
Styling reuses existing tokens/components (MetricsStrip-style tiles, the dashboard table patterns). Empty-state copy when the org has no activity in the window.

## 9. Testing (TDD)

- **`tests/reports.test.ts`** (pure aggregator):
  - throughput: counts per rep; distinct `case_id`; null `case_id` ignored; zero-activity rep present.
  - kept-rate: kept/partial/broken split; strict rate excludes `partially_kept`; `resolved === 0 → keptRate null` (no `NaN`); `renegotiated`/`cancelled`/`pending` excluded.
  - first-contact: median (odd/even counts), average, within-24h%, uncontacted count; all-null when no contacted cases.
  - workload: grouping by owner; Unassigned bucket; suppressed excluded from `openCases`; owner with no cases present.
  - window boundary: a row exactly at `windowStart` is included.
- **Route-level** (if the test harness supports loader invocation): non-owner redirected from `/reports`; owner sees a report. Otherwise owner-gating is covered by inspection + an `isOwner` nav test.

## 10. Out of scope (deferred)

Collection rate by aging bucket (payment attribution); CSV/print export; charts; trend history; per-rep first-contact; owner-scoped RLS hardening for `/reports`.
