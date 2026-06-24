# NudgePay Phase 7b — Multi-factor, Override-able Priority (Design Spec)

**Date:** 2026-06-24
**Status:** Approved (design); pending spec review → writing-plans.
**Scope:** Gap item **B5** (multi-factor + override-able priority). Second of three Phase 7 sub-phases (7a outcomes+timeline ✅ · **7b multi-factor priority** · 7c sync visibility), mirroring the 6a/6b/6c decomposition.

---

## 1. Goal

Today a case's priority is a single-factor, age-only computation, and it is **invisible**: `priorityOf(ageDays, neverContacted)` produces `{ level, tone, reason, rank }`, but only `rank` is used (for the default "Recommended" sort) and `level`/`reason` appear in **no** `.tsx` file. The at-a-glance signal a rep actually sees is the age-based **ThermalBand** (COOL/WARM/HOT + days).

Phase 7b (a) replaces the age-only computation with a **multi-factor weighted score** over age, balance, broken-promise, silence (time-since-last-contact), and follow-up-due; (b) adds a **manual override** that pins a case's effective level in either direction while leaving all financial/contact data untouched; and (c) **surfaces** the priority — an effective-level badge in the queue row plus a "Why this priority" breakdown in the DetailPanel — so the score is explainable and the override is usable.

### Findings that motivated this scope (verified against `main`)
- **Priority is computed but never rendered.** `priority.level`/`priority.reason` are in the data shape only; no component reads them (`grep` over `app/**/*.tsx`). Making the score visible is part of B5, not pre-existing.
- **The "neverContacted boost" does not affect ordering.** In `priorityOf` (`worklist.ts:66`), `neverContacted` only swaps the *reason string* at the Critical band; `rank` is a pure function of age buckets (90/60/30). Today's scorer is genuinely single-factor.
- **The invoice-level path is dead.** `buildWorkItems` / `nextActionOf` and the invoice-level use of `priorityOf` are referenced only by `tests/worklist.test.ts`; no route imports them (the live queue is `buildCaseItems` in `cases.ts`). Removing that dead path is **out of scope** for 7b but recorded here for a later cleanup.

## 2. Architecture

Work with the codebase grain: a small **pure module** plus thin loader/markup/migration wiring, mirroring how 7a isolated `timeline.ts`.

- **New pure module `app/lib/priority.ts`** (no I/O, no `node:*`, no `.server` suffix — imported by `cases.ts` and by tests). It owns: factor weights (named constants), the scorer, the level thresholds, the factor breakdown, and override resolution.
- **`cases.ts`** stops calling `priorityOf(oldestAgeDays, neverContacted)` and calls the new `scorePriority(factors)`. `buildCaseItems` gains two threaded inputs — `daysSinceContact` (derived from the existing per-case `lastContact.date`) and `priorAttempts` (a per-case interaction count) — and reads the four override columns off `CaseRow`.
- **`worklist.ts` `priorityOf` is left untouched.** Mutating its signature would break the dead invoice path *and* its existing tests for zero live benefit. The new scorer is additive.
- **One migration `0012`** adds override columns to `collection_cases`. No other schema change — silence and attempts are computed at read time from data already loaded.

**Rejected alternatives** (from brainstorming):
- *Mutate `priorityOf` in place* — breaks `worklist.ts` + `worklist.test.ts`; couples the live case scorer to a dead invoice helper.
- *Points → discrete level only* (no continuous score) — loses within-level ordering granularity and the natural factor-contribution breakdown.
- *Age-primary + factor boosts* — barely multi-factor; keeps age dominant, which is the behavior B5 exists to fix.
- *Signed score offset as the override* — flexible but opaque to reps ("what does +30 mean?") and awkward to explain in the UI.
- *Attempts as a score contributor* — direction is contentious (escalate vs. diminishing-returns) and overlaps the silence factor; using it purely as a tiebreaker is the narrow, defensible reading of the requirement.

## 3. Locked decisions (from brainstorming)

1. **Numeric score → derived band.** Each factor contributes weighted points to a numeric `score`; the existing 4 levels (Critical/High/Medium/Low) become threshold cutoffs over that score. The score yields a natural explainable breakdown (rank factor contributions).
2. **Pinned-level override, both directions, transparent.** The override replaces the *effective* level (up or down) but the computed score/level is **always still shown** ("Pinned to Critical by Sam · computed: Medium"). Captures actor + reason + timestamp.
3. **Attempts is a tiebreaker, not a score factor.** Level is driven by age + balance + broken-promise + silence + follow-up-due. `priorAttempts` only orders within an otherwise-tied score (more attempts first). Recency/cooldown is handled independently by the silence factor.
4. **Full surfacing.** Effective-level badge (with a 📌 marker when overridden) in the queue row beside the ThermalBand; a "Why this priority" breakdown + override control in the DetailPanel.
5. **Downward override ≠ status suppression.** A downward pin changes priority *display/ordering* only. Case-status suppression (stop surfacing as urgent) remains the 6c `waiting`/`on_hold` + review-date mechanism; 7b does not touch it.

## 4. B5 — The score

### 4.1 Factors and weights
`scorePriority` sums weighted factor contributions into a 0–100ish `score`. Weights live as **named constants** in `priority.ts` (full configurability is deferred to C7). Proposed defaults:

| Factor | Buckets → points |
|---|---|
| **Age** (oldest overdue invoice, days) | ≥90 → 45 · 60–89 → 32 · 30–59 → 20 · 1–29 → 8 · ≤0 → 0 |
| **Balance** (case total overdue, $) | ≥25,000 → 25 · ≥10,000 → 18 · ≥5,000 → 12 · ≥1,000 → 6 · <1,000 → 2 |
| **Broken promise** | broken → +25 (else 0) |
| **Silence** (days since last contact) | never contacted → +15 · ≥30 → +15 · ≥14 → +10 · ≥7 → +5 · <7 → 0 |
| **Follow-up due** (`nextActionAt ≤ today`) | due → +12 (else 0) |

- `≥5,000` reuses the existing `HIGH_VALUE_THRESHOLD` constant for consistency with the high-value view.
- "Never contacted" (`lastContact === null`) is treated as maximum silence (+15), not zero — we haven't even tried.
- Buckets are graduated step functions (not linear) to keep the scorer pure, explainable, and stable across boundary inputs.

### 4.2 Level thresholds
```
score ≥ 80 → Critical   (rank 0, tone hot)
score ≥ 50 → High       (rank 1, tone warm)
score ≥ 25 → Medium     (rank 2, tone warm)
score < 25 → Low        (rank 3, tone cool)
```
`rank`/`tone` keep the existing `Priority` shape so downstream sort and ThermalBand tone mapping are unaffected.

### 4.3 Deliberate behavior change (blessed at design time)
Age alone no longer guarantees Critical. Worked example: a 92-day case, $3,000 total, contacted 3 days ago, no broken promise, no follow-up due → `45 (age) + 6 (balance) + 0 + 0 + 0 = 51` → **High** (today it would be Critical by the ≥90 age band). Conversely a 92-day, $12,000, broken-promise, 30-day-silent case → `45 + 18 + 25 + 15 = 103` → **Critical**. This re-weighting toward money + promises + silence is the purpose of B5. Weights are tunable constants if buckets need adjusting post-review.

### 4.4 Factor breakdown (explainability)
`scorePriority` returns, alongside `score` and the `Priority`, an ordered breakdown of the contributing factors for the DetailPanel:
```ts
export type PriorityFactor = { key: string; label: string; points: number };
// e.g. [{ key: "age", label: "92 days overdue", points: 45 },
//       { key: "broken", label: "Broken promise", points: 25 },
//       { key: "silence", label: "30 days since contact", points: 15 }]
```
Only non-zero contributors are included, sorted by `points` descending. Labels are static literal strings composed with the numeric inputs (Tailwind-v4-safe; no dynamic class names).

## 5. B5 — The override

### 5.1 Storage (migration `0012_priority_override.sql`)
```sql
alter table collection_cases
  add column priority_override        text
    check (priority_override in ('critical','high','medium','low')),
  add column priority_override_reason text,
  add column priority_override_by     uuid,
  add column priority_override_at     timestamptz;
```
- Lowercase enum matches existing column conventions (`status`, `exception_reason`); mapped to/from the `Priority.level` PascalCase in `priority.ts`.
- `priority_override_by` stores the member user id (mirrors the `promises.created_by` actor convention). No FK is required (consistent with existing actor columns); RLS already gates the table by `is_org_member(org_id)`.
- No new index — the dashboard already filters cases by `org_id`; the override columns are read with the row, not queried independently.

### 5.2 Resolution and sort
- `effectiveLevel = overrideLevel ?? computedLevel`; the computed `score`/`level`/breakdown are **always** returned for transparency.
- `effectiveRank` is derived from `effectiveLevel` (Critical 0 … Low 3).
- **Default "Recommended" sort:** `effectiveRank` asc → `score` desc → `priorAttempts` desc → `oldestAgeDays` desc → `totalOverdue` desc. Within an effective level, ordering stays by underlying `score` (per locked decision 2); `priorAttempts` is the next tiebreaker.
- The other sorts (`most-overdue`, `highest-balance`, `customer`) are unchanged.

### 5.3 Lifecycle and permissions
- Override **persists until manually cleared**; setting a new one replaces the prior. No auto-expiry.
- Any org member may set or clear it (same trust model as contact logging). Actor + timestamp are recorded on each set.
- A resolved/closed case drops out of the active queue, so no auto-clear on resolve is needed; the columns remain for history.
- **"Leaves financial data untouched":** the override is its own column set and never writes balance, age, promise, or contact data. The breakdown panel keeps displaying the real computed factors next to the override, so the manual pin can never falsify the financial signal.

### 5.4 Write path
Set/clear flows through a **new dedicated resource route `app/routes/api.priority-override.tsx`**, matching the established codebase pattern — `dashboard.tsx` has no `action`; every case mutation is its own `api.*.tsx` route (`api.assign.tsx`, `api.contact-logs.tsx`, `api.promises.cancel.tsx`). Server-side on the RLS **user client** (no service client). Inputs validated against the four allowed levels (+ a clear action); invalid input rejected. Reason is optional free text; actor = the authenticated member; timestamp = server `now()`. The DetailPanel control posts to this route; on success it redirects back to the dashboard (mirroring `api.assign.tsx`).

## 6. Surfacing (UI)

- **Queue row (`WorkQueue.tsx`):** a compact **effective-level badge** (Critical/High/Medium/Low, tone-colored via the existing token map) with a 📌 marker when `priority_override` is set, rendered alongside the existing `ThermalBand`. The ThermalBand (age signal) stays.
- **DetailPanel "Why this priority" section:**
  - The contributing factors with their points, descending (`PriorityFactor[]`).
  - The computed level + score.
  - If overridden: the override level · who · reason · when, clearly distinguished from the computed value.
  - A **Change / Clear override** control (level select + optional reason → the action route).
- All classes are static literal strings (Tailwind v4); no `text-${x}`.

## 7. Data flow

```
collection_cases (status, next_action_at, override cols) ─┐
invoices (per customer, balances/due dates) ──────────────┤
customers (owner) ────────────────────────────────────────┤
last contact per case (logs + SMS merge, existing) ───────┤── loader → buildCaseItems
contact attempts per case (count of logs + outbound SMS) ─┘        → scorePriority(factors)
                                                                   → CaseItem { priority, score,
                                                                       factors, effectiveLevel,
                                                                       override } → WorkQueue + DetailPanel
```
- `daysSinceContact` is computed from the already-derived per-case `lastContact.date` vs `today`.
- `priorAttempts` is a per-case count of `contact_logs` + **outbound** `text_messages` (inbound customer replies are not our attempts), aggregated in the loader from data already scoped to the org.
- Browser never touches the DB; all reads on the RLS user client, scoped by `org_id`.

## 8. Error handling & constraints

- **Pure & total:** `scorePriority` never throws; tolerates null/zero inputs; unknown/absent override → computed level; empty factor set → Low (score 0). Boundary inputs map deterministically.
- **No mutation of financial data:** override columns are write-isolated; the scorer is read-only over loaded data.
- **RLS boundary unchanged:** reads + override writes on the user client; no service-client use.
- **Tailwind v4:** badge/breakdown classes are static literal strings.
- **No client→`.server` import:** `priority.ts` is pure client-safe; `cases.ts` already is.
- **Backward compatible:** existing `Priority` shape (`level`/`tone`/`reason`/`rank`) preserved; `worklist.ts` and its tests untouched.

## 9. Testing (verification)

- **`tests/priority.test.ts` (new, pure):**
  - Factor-bucket boundaries: age 29/30, 59/60, 89/90; balance 999/1,000, 4,999/5,000, 9,999/10,000, 24,999/25,000; silence 6/7, 13/14, 29/30; never-contacted = max silence (+15).
  - Score→level thresholds at 24/25, 49/50, 79/80.
  - Broken-promise (+25) and follow-up-due (+12) additivity.
  - Override resolution: override wins for `effectiveLevel`; computed score/level/breakdown still returned; clear → computed.
  - Breakdown: only non-zero factors, sorted by points desc; labels composed from inputs.
- **`tests/cases.test.ts` (extend):** `buildCaseItems` threads `daysSinceContact`/`priorAttempts` and the override columns into the scored `CaseItem`; sort tiebreak by `priorAttempts` within equal score.
- **`tests/api-priority-override.test.ts` (new):** the resource route validates the level enum, rejects invalid input, sets/clears on the user client, and redirects back (mirrors `tests/api-assign.test.ts`).
- **Component gate:** `cd nudgepay-app && npx tsc -b && npx react-router build` — both clean.
- **Regression gate:** `npx vitest run` — full suite green (existing + new priority/cases cases).
- **Visual (controller):** screenshot the queue with one case pinned up and one pinned down; confirm the badge + 📌 render, the DetailPanel breakdown lists factors, and ordering matches the effective levels.

## 10. Out of scope

- Removing the dead `buildWorkItems` / `nextActionOf` invoice path (separate cleanup).
- Configurable weights / thresholds UI (C7).
- Auto-expiring or scheduled overrides.
- Collision / recent-contact presence warnings (C1).
- Changing the "last contact" computation (already a logs+SMS merge) or the ThermalBand.
- Sync & error visibility (B6 — Phase 7c).

## 11. File manifest

**New:**
- `app/lib/priority.ts` — weights (constants), `scorePriority`, level thresholds, `PriorityFactor`/breakdown, override resolution + level enum mapping.
- `tests/priority.test.ts` — pure unit tests.
- `supabase/migrations/0012_priority_override.sql` — override columns on `collection_cases`.
- `app/routes/api.priority-override.tsx` — resource route: validate + set/clear the override (RLS user client), redirect back to dashboard.
- `tests/api-priority-override.test.ts` — route test (validation, set/clear, redirect).

**Modified:**
- `app/lib/cases.ts` — `buildCaseItems` threads `daysSinceContact`/`priorAttempts` + override columns; calls `scorePriority`; `CaseItem` gains `score`, `factors`, `effectiveLevel`, `override`; `sortCaseItems` uses `effectiveRank` + `priorAttempts` tiebreak.
- `app/routes/dashboard.tsx` — loader only: aggregate per-case attempt counts, select the override columns, thread `daysSinceContact`/`priorAttempts` into `buildCaseItems`. (No `action` added — the write path is the new resource route.)
- `app/components/WorkQueue.tsx` — effective-level badge + 📌 override marker.
- `app/components/DetailPanel.tsx` — "Why this priority" breakdown + override control.

**No change:** `app/lib/worklist.ts`, `tests/worklist.test.ts` (legacy invoice path stays as-is).
