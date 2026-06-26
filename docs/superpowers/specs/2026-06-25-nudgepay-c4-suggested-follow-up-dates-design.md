# NudgePay C4 — Suggested Follow-up Dates (Design Spec)

**Created:** 2026-06-25
**Phase:** 8 (P1 throughput & consistency)
**Gap item:** C4 — "Suggest a cadence-based next date instead of manual-only `follow_up_at`."
**Builds on:** 6c next-action invariant (every active case carries a scheduled follow-up / pending promise / waiting-review / exception / closed) and the `LogContactDrawer` next-step picker; B5 priority model (`priority.ts`).

---

## 1. Problem

When a user logs a contact and chooses **Follow up** as the next step, the Log-Contact drawer presents a bare `<input type="date" name="followUpAt" required>` with **no default**. Every follow-up date is typed by hand. This is friction on the single most common next step, and it produces inconsistent cadences across reps (one rep revisits a Critical case in 2 days, another in 2 weeks).

C4 closes the gap by **suggesting** a follow-up date driven by the case's priority, pre-filled and fully editable.

## 2. Goal

When **Follow up** is selected in the drawer, the date field opens **pre-filled** with a priority-cadence suggestion and a **one-line rationale**. The user accepts it with no typing, or edits it freely.

Non-goals (YAGNI): outcome-driven cadence, per-org configurable intervals (deferred to C7), suggestions for the waiting/exception revisit dates, holiday awareness (deferred to C7), and any change to server-side validation or persisted behavior.

## 3. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Cadence driver | **Priority level** (reuses the rich B5 model: age + balance + broken-promise + silence). Not outcome, not aging-only. |
| Which date fields | **Follow-up only.** Waiting/exception revisit dates stay manual (situational judgment, not a cadence). |
| UI model | **Pre-fill + rationale caption**, fully editable. No quick-pick chips. |
| Weekend handling | **Add calendar interval, then roll to next weekday** if it lands on Sat/Sun (Sat → +2, Sun → +1). |
| Level source | `CaseItem.effectiveLevel` (override-aware) — a manual priority pin changes the cadence accordingly. |
| Configurability | Frozen named constants now; per-org tuning deferred to C7 (consistent with `priority.ts` weights). |

## 4. Cadence table

Interval is **calendar days** added to `today`, then rolled to the next weekday if it lands on a weekend.

| `effectiveLevel` | Interval (calendar days) |
|---|---|
| Critical | 2 |
| High | 3 |
| Medium | 7 |
| Low | 14 |

`scorePriority` always returns one of these four levels (minimum `Low`), so **every case yields a suggestion**.

## 5. Architecture

Pure derivation computed at load time inside the existing `buildCaseItems` path, surfaced on `CaseItem`, and consumed by the drawer. No new I/O, no migration, no route change.

### 5.1 `app/lib/business-days.ts` (modify)

Add two pure helpers beside the existing `addBusinessDays`, reusing its UTC-component pattern (no timezone drift):

```ts
// Add n calendar days to a YYYY-MM-DD string (UTC-component math).
export function addCalendarDays(dateISO: string, n: number): string;

// If dateISO is a Saturday, roll +2 to Monday; if Sunday, roll +1 to Monday;
// otherwise return unchanged. YYYY-MM-DD in/out.
export function rollToWeekday(dateISO: string): string;
```

`rollToWeekday` is distinct from `addBusinessDays` on purpose: the chosen semantics are "add N calendar days, *then* roll the result off a weekend," not "add N business days" (which would stretch a 7-day cadence to ~9 calendar days).

### 5.2 `app/lib/follow-up-cadence.ts` (create)

Pure module (no `.server`, no I/O), single source of truth for the cadence policy:

```ts
import type { PriorityLevel } from "./priority";
import { addCalendarDays, rollToWeekday } from "./business-days";

export const CADENCE_DAYS: Readonly<Record<PriorityLevel, number>> = Object.freeze({
  Critical: 2,
  High: 3,
  Medium: 7,
  Low: 14,
});

export type FollowUpSuggestion = { date: string; intervalDays: number };

export function suggestFollowUpDate(input: {
  level: PriorityLevel;
  today: string; // YYYY-MM-DD
}): FollowUpSuggestion {
  const intervalDays = CADENCE_DAYS[input.level];
  const date = rollToWeekday(addCalendarDays(input.today, intervalDays));
  return { date, intervalDays };
}
```

`intervalDays` is the **pre-roll** interval (used only for the human rationale, e.g. "3-day cadence"); `date` is the post-roll suggested date.

### 5.3 `app/lib/cases.ts` (modify)

`CaseItem` gains one field:

```ts
suggestedFollowUpAt: string; // YYYY-MM-DD, priority-cadence suggestion, override-aware
```

`buildCaseItems` sets it from the level it already computes:

```ts
suggestedFollowUpAt: suggestFollowUpDate({ level: effectiveLevel, today }).date,
```

`effectiveLevel` is already `overrideLevel ?? scored.level` in `buildCaseItems`, so the suggestion honors a manual priority pin with no extra work.

### 5.4 `app/components/LogContactDrawer.tsx` (modify)

The follow-up branch (currently `nextStep === "follow_up"`):

- The date input gains `defaultValue={selected.suggestedFollowUpAt}` (remains `type="date" required`, remains editable — uncontrolled, matching the drawer's existing `defaultValue` inputs).
- A caption is rendered below the input:

  > Suggested from {effectiveLevel} priority · {CADENCE_DAYS[effectiveLevel]}-day cadence

  built from the imported `CADENCE_DAYS` and `selected.effectiveLevel`. The suggested date itself is shown by the pre-filled input, so the caption only explains the *why* (level + interval). The caption uses the same muted helper-text styling as other drawer hints.

No other field changes. No change to `parseContactLogForm` — `followUpAt` is still validated as a required valid `YYYY-MM-DD` (the user can edit the pre-filled value but the field stays required).

## 6. Data flow

```
dashboard loader (today)
  └─ buildCaseItems(..., today)
       ├─ scorePriority → scored.level
       ├─ effectiveLevel = overrideLevel ?? scored.level
       └─ suggestedFollowUpAt = suggestFollowUpDate({ level: effectiveLevel, today }).date
            └─ CaseItem.suggestedFollowUpAt
                 └─ LogContactDrawer: <input defaultValue={...}> + rationale caption
```

The suggestion is a load-time snapshot. It does not depend on the in-form outcome selection (priority-only), so it is computed once server-side and needs no client `today`.

## 7. Error handling / edge cases

- **Every level maps** (Critical/High/Medium/Low) — `CADENCE_DAYS` is total over `PriorityLevel`; a missing key is a type error caught at compile time.
- **Weekend roll is idempotent** for weekdays (`rollToWeekday(weekday) === weekday`).
- **Timezone safety:** all math is UTC-component on `YYYY-MM-DD` strings, consistent with `dates.ts` and `business-days.ts`; the displayed date uses the existing `formatDate` (no drift).
- **Suppressed / on-hold cases:** the field is still pre-filled if a user opens the drawer on such a case and picks Follow up; choosing Follow up un-holds the case per existing `applyNextStep` behavior. Harmless and consistent.
- **User clears the field:** the field is `required`; submitting empty is rejected client-side and by `parseContactLogForm` (`next-step-date`), unchanged from today.

## 8. Testing

Node-env Vitest (no jsdom, `fileParallelism: false`), matching existing convention. No React render tests (the suite has none; UI change verified by tsc + build + manual).

- **`tests/follow-up-cadence.test.ts` (new):**
  - Each level returns its mapped interval (Critical→2, High→3, Medium→7, Low→14).
  - Weekend roll: a `today` chosen so `today + interval` lands on Saturday → suggestion is the following Monday; another landing on Sunday → Monday.
  - A weekday-landing case is unchanged by the roll.
  - `CADENCE_DAYS` is frozen (`Object.isFrozen`).
  - Timezone safety: deterministic string in → deterministic string out (no `Date`-locale dependence).
- **`tests/business-days.test.ts` (extend — file exists):**
  - `rollToWeekday`: Friday→Friday (unchanged), Saturday→Monday, Sunday→Monday.
  - `addCalendarDays`: spans a month boundary correctly; n=0 identity.
- **`tests/cases.test.ts` (extend):**
  - `buildCaseItems` sets `suggestedFollowUpAt` equal to `suggestFollowUpDate({ level: effectiveLevel, today }).date` for a representative case.
  - A case with a **pinned Critical override** (computed level lower) yields the **2-day** cadence — proving override-awareness.

## 9. Out of scope / deferred

- Outcome-modified cadence — explicitly rejected (priority-only).
- Per-org configurable intervals and holiday calendar — **C7**.
- Suggestions for waiting/exception revisit dates — judgment-driven, left manual.
- Quick-pick chips — rejected for UI simplicity.

## 10. File summary

| File | Action |
|---|---|
| `app/lib/business-days.ts` | Modify — add `addCalendarDays`, `rollToWeekday` |
| `app/lib/follow-up-cadence.ts` | Create — `CADENCE_DAYS`, `suggestFollowUpDate` |
| `app/lib/cases.ts` | Modify — `CaseItem.suggestedFollowUpAt`, set in `buildCaseItems` |
| `app/components/LogContactDrawer.tsx` | Modify — pre-fill follow-up date + rationale caption |
| `tests/follow-up-cadence.test.ts` | Create |
| `tests/business-days.test.ts` | Extend (exists) |
| `tests/cases.test.ts` | Extend |

No migration. No route/action change. No metrics change. No RLS surface (pure derivation in an existing read path).
