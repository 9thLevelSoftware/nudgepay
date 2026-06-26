# C4 — Suggested Follow-up Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-fill the Log-Contact drawer's "Follow up" date field with a priority-cadence suggestion (editable) plus a one-line rationale, eliminating manual-only date entry.

**Architecture:** A pure cadence module (`follow-up-cadence.ts`) maps the case's override-aware priority level to a calendar interval, adds it to `today`, and rolls weekends forward to Monday via two new helpers in `business-days.ts`. `buildCaseItems` computes the suggestion server-side and surfaces it as one new `CaseItem` field; `LogContactDrawer` reads that field to pre-fill the date input and renders a rationale caption from the shared `CADENCE_DAYS` constant.

**Tech Stack:** TypeScript 5.9, React Router 7.9.6 (SSR), Tailwind v4, Vitest 4 (node env, no jsdom, `fileParallelism: false`).

## Global Constraints

- Pure libs (`business-days.ts`, `follow-up-cadence.ts`, `cases.ts`) carry **no `.server` suffix, no `node:*` imports, no I/O** — imported by routes, tests, and client components.
- All date math is **UTC-component arithmetic on `YYYY-MM-DD` strings** (consistent with `dates.ts` / `business-days.ts`) — never `new Date("YYYY-MM-DD")` local parsing.
- Cadence intervals are **calendar days**, fixed per level: **Critical 2, High 3, Medium 7, Low 14**. `CADENCE_DAYS` is **frozen** (`Object.freeze`). Per-org tuning is deferred to C7 — do not add config.
- Weekend rule: **add the calendar interval, then roll** Sat → +2 / Sun → +1 to Monday. This is distinct from `addBusinessDays` — do not reuse it for the cadence.
- Cadence is keyed off **`effectiveLevel`** (`overrideLevel ?? scored.level`) so a manual priority pin changes the suggestion.
- No migration, no route/action change, no change to `parseContactLogForm`, no metrics change.
- Tailwind v4: **literal class strings only**, no interpolation into class names.
- Conventional Commits; every commit body ends with the trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Tests run with `npx vitest run <file>` (there is no `npm test` script).

---

## File Structure

| File | Responsibility |
|---|---|
| `app/lib/business-days.ts` (modify) | Add pure `addCalendarDays` + `rollToWeekday` date helpers beside `addBusinessDays`. |
| `app/lib/follow-up-cadence.ts` (create) | Single source of cadence policy: frozen `CADENCE_DAYS` + `suggestFollowUpDate`. |
| `app/lib/cases.ts` (modify) | `CaseItem.suggestedFollowUpAt`; set it in `buildCaseItems` from `effectiveLevel` + `today`. |
| `app/components/LogContactDrawer.tsx` (modify) | Pre-fill the follow-up date input + rationale caption. |
| `tests/business-days.test.ts` (extend) | Cover `addCalendarDays`, `rollToWeekday`. |
| `tests/follow-up-cadence.test.ts` (create) | Cover `CADENCE_DAYS` + `suggestFollowUpDate`. |
| `tests/cases.test.ts` (extend) | Cover `suggestedFollowUpAt` wiring + override-awareness. |

**Day-of-week anchors used in tests (verified, 2026):** 2026-06-19 = Friday, 06-22 = Monday, 06-24 = Wednesday, 06-25 = Thursday, 06-26 = Friday, 06-27 = Saturday, 06-28 = Sunday, 06-29 = Monday, 07-06 = Monday.

---

### Task 1: Calendar-day + weekend-roll helpers

**Files:**
- Modify: `nudgepay-app/app/lib/business-days.ts`
- Test: `nudgepay-app/tests/business-days.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `addCalendarDays(dateISO: string, n: number): string` — adds `n` calendar days to a `YYYY-MM-DD` string, UTC-component math, returns `YYYY-MM-DD`.
  - `rollToWeekday(dateISO: string): string` — if the date is Saturday returns +2 days (Monday), if Sunday returns +1 day (Monday), otherwise returns it unchanged. `YYYY-MM-DD` in/out.

- [ ] **Step 1: Write the failing tests**

Append to `nudgepay-app/tests/business-days.test.ts`:

```ts
import { addCalendarDays, rollToWeekday } from "../app/lib/business-days";

test("addCalendarDays adds calendar days including weekends", () => {
  // 2026-06-25 (Thu) + 2 calendar days = 2026-06-27 (Sat), no skipping.
  expect(addCalendarDays("2026-06-25", 2)).toBe("2026-06-27");
  // n = 0 is identity.
  expect(addCalendarDays("2026-06-25", 0)).toBe("2026-06-25");
  // Crosses a month boundary.
  expect(addCalendarDays("2026-06-29", 7)).toBe("2026-07-06");
});

test("rollToWeekday leaves weekdays unchanged", () => {
  expect(rollToWeekday("2026-06-26")).toBe("2026-06-26"); // Friday
  expect(rollToWeekday("2026-06-25")).toBe("2026-06-25"); // Thursday
});

test("rollToWeekday rolls Saturday and Sunday forward to Monday", () => {
  expect(rollToWeekday("2026-06-27")).toBe("2026-06-29"); // Sat -> Mon
  expect(rollToWeekday("2026-06-28")).toBe("2026-06-29"); // Sun -> Mon
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd nudgepay-app && npx vitest run tests/business-days.test.ts`
Expected: FAIL — `addCalendarDays`/`rollToWeekday` are not exported (import error / not a function).

- [ ] **Step 3: Implement the helpers**

Append to `nudgepay-app/app/lib/business-days.ts` (after `addBusinessDays`):

```ts
// Add n calendar days (weekends included) to a YYYY-MM-DD string. UTC-component
// math, consistent with addBusinessDays — no timezone drift.
export function addCalendarDays(dateISO: string, n: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// If dateISO falls on a weekend, roll forward to the following Monday
// (Sat -> +2, Sun -> +1); weekdays are returned unchanged.
export function rollToWeekday(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0 = Sun, 6 = Sat
  if (day === 6) return addCalendarDays(dateISO, 2);
  if (day === 0) return addCalendarDays(dateISO, 1);
  return dateISO;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/business-days.test.ts`
Expected: PASS (all tests in the file, including the pre-existing `addBusinessDays` ones).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/business-days.ts nudgepay-app/tests/business-days.test.ts
git commit -m "feat(dates): add calendar-day and weekend-roll helpers (C4)"
```

---

### Task 2: Follow-up cadence module

**Files:**
- Create: `nudgepay-app/app/lib/follow-up-cadence.ts`
- Test: `nudgepay-app/tests/follow-up-cadence.test.ts`

**Interfaces:**
- Consumes: `addCalendarDays`, `rollToWeekday` from `./business-days` (Task 1); `PriorityLevel` from `./priority` (existing: `"Critical" | "High" | "Medium" | "Low"`).
- Produces:
  - `CADENCE_DAYS: Readonly<Record<PriorityLevel, number>>` — frozen `{ Critical: 2, High: 3, Medium: 7, Low: 14 }`.
  - `type FollowUpSuggestion = { date: string; intervalDays: number }`.
  - `suggestFollowUpDate(input: { level: PriorityLevel; today: string }): FollowUpSuggestion` — `intervalDays = CADENCE_DAYS[level]` (pre-roll, for rationale); `date = rollToWeekday(addCalendarDays(today, intervalDays))`.

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/follow-up-cadence.test.ts`:

```ts
import { expect, test } from "vitest";
import { CADENCE_DAYS, suggestFollowUpDate } from "../app/lib/follow-up-cadence";

test("CADENCE_DAYS maps each level to its interval and is frozen", () => {
  expect(CADENCE_DAYS).toEqual({ Critical: 2, High: 3, Medium: 7, Low: 14 });
  expect(Object.isFrozen(CADENCE_DAYS)).toBe(true);
});

test("suggestFollowUpDate returns the pre-roll interval for the level", () => {
  // 2026-06-22 is a Monday, so none of these land on a weekend.
  expect(suggestFollowUpDate({ level: "Critical", today: "2026-06-22" }))
    .toEqual({ date: "2026-06-24", intervalDays: 2 }); // Mon + 2 = Wed
  expect(suggestFollowUpDate({ level: "High", today: "2026-06-22" }))
    .toEqual({ date: "2026-06-25", intervalDays: 3 }); // Mon + 3 = Thu
  expect(suggestFollowUpDate({ level: "Medium", today: "2026-06-22" }))
    .toEqual({ date: "2026-06-29", intervalDays: 7 }); // Mon + 7 = next Mon
  expect(suggestFollowUpDate({ level: "Low", today: "2026-06-22" }))
    .toEqual({ date: "2026-07-06", intervalDays: 14 }); // Mon + 14 = Mon
});

test("suggestFollowUpDate rolls a weekend landing forward to Monday", () => {
  // 2026-06-25 (Thu) + 2 = 2026-06-27 (Sat) -> Monday 2026-06-29.
  expect(suggestFollowUpDate({ level: "Critical", today: "2026-06-25" }).date)
    .toBe("2026-06-29");
  // 2026-06-26 (Fri) + 2 = 2026-06-28 (Sun) -> Monday 2026-06-29.
  expect(suggestFollowUpDate({ level: "Critical", today: "2026-06-26" }).date)
    .toBe("2026-06-29");
});

test("suggestFollowUpDate is a pure string transform (timezone-independent)", () => {
  // Same input -> same output, no Date-locale dependence.
  const a = suggestFollowUpDate({ level: "Medium", today: "2026-01-30" });
  const b = suggestFollowUpDate({ level: "Medium", today: "2026-01-30" });
  expect(a).toEqual(b);
  expect(a.date).toBe("2026-02-06"); // Jan 30 (Fri) + 7 = Feb 6 (Fri)
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd nudgepay-app && npx vitest run tests/follow-up-cadence.test.ts`
Expected: FAIL — module `../app/lib/follow-up-cadence` does not exist.

- [ ] **Step 3: Implement the module**

Create `nudgepay-app/app/lib/follow-up-cadence.ts`:

```ts
// Pure cadence policy for suggested follow-up dates. No I/O, no node:*, no
// .server suffix (imported by cases.ts, the drawer, and tests). Single source
// of truth for the priority -> interval mapping. Per-org tuning is deferred to
// C7; intervals are fixed named constants here.

import type { PriorityLevel } from "./priority";
import { addCalendarDays, rollToWeekday } from "./business-days";

export const CADENCE_DAYS: Readonly<Record<PriorityLevel, number>> = Object.freeze({
  Critical: 2,
  High: 3,
  Medium: 7,
  Low: 14,
});

export type FollowUpSuggestion = { date: string; intervalDays: number };

// Suggest the next follow-up date: add the level's calendar interval to `today`,
// then roll off a weekend. `intervalDays` is the pre-roll interval, used only for
// the human-facing rationale ("3-day cadence").
export function suggestFollowUpDate(input: {
  level: PriorityLevel;
  today: string; // YYYY-MM-DD
}): FollowUpSuggestion {
  const intervalDays = CADENCE_DAYS[input.level];
  const date = rollToWeekday(addCalendarDays(input.today, intervalDays));
  return { date, intervalDays };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/follow-up-cadence.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/follow-up-cadence.ts nudgepay-app/tests/follow-up-cadence.test.ts
git commit -m "feat(cadence): priority-driven follow-up date suggestion module (C4)"
```

---

### Task 3: Surface the suggestion on CaseItem

**Files:**
- Modify: `nudgepay-app/app/lib/cases.ts`
- Test: `nudgepay-app/tests/cases.test.ts`

**Interfaces:**
- Consumes: `suggestFollowUpDate` from `./follow-up-cadence` (Task 2). `buildCaseItems` already computes `overrideLevel ?? scored.level` (currently inline at the return as `effectiveLevel`) and has `today` in scope.
- Produces: `CaseItem.suggestedFollowUpAt: string` — the priority-cadence follow-up date (override-aware), `YYYY-MM-DD`.

- [ ] **Step 1: Write the failing tests**

Add to `nudgepay-app/tests/cases.test.ts`. First extend the import at the top of the file (it currently imports from `../app/lib/cases` only) by adding this new import line near the other imports:

```ts
import { suggestFollowUpDate } from "../app/lib/follow-up-cadence";
```

Then append these tests at the end of the file:

```ts
test("buildCaseItems sets suggestedFollowUpAt from effectiveLevel + today", () => {
  // Acme (c1) scores High at SCORE_TODAY with no override.
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, [], [], SCORE_TODAY, LABELS);
  const acme = items.find((c) => c.customerId === "c1")!;
  expect(acme.effectiveLevel).toBe("High");
  expect(acme.suggestedFollowUpAt).toBe(
    suggestFollowUpDate({ level: "High", today: SCORE_TODAY }).date,
  );
  // Sanity: High = 3-day cadence; SCORE_TODAY 2026-06-19 (Fri) + 3 = Mon 2026-06-22.
  expect(acme.suggestedFollowUpAt).toBe("2026-06-22");
});

test("a priority override drives the suggested follow-up cadence", () => {
  // today = Monday 2026-06-22 so Critical (2d) and High (3d) yield distinct dates.
  const today = "2026-06-22";
  const cases: CaseRow[] = [
    { id: "case-1", customerId: "c1", status: "working", nextActionType: "follow_up", nextActionAt: "2026-06-20",
      exceptionReason: null, exceptionNote: null,
      priorityOverride: "critical", priorityOverrideReason: "CEO escalation",
      priorityOverrideBy: "u1", priorityOverrideAt: "2026-06-24T00:00:00Z" },
  ];
  const items = buildCaseItems(cases, INVOICES, CUSTOMERS, [], [], today, LABELS);
  const c = items[0];
  expect(c.effectiveLevel).toBe("Critical");
  // Pinned Critical -> 2-day cadence: Mon 2026-06-22 + 2 = Wed 2026-06-24.
  expect(c.suggestedFollowUpAt).toBe(suggestFollowUpDate({ level: "Critical", today }).date);
  expect(c.suggestedFollowUpAt).toBe("2026-06-24");
  // And it differs from the computed-High suggestion, proving the override drives it.
  expect(c.suggestedFollowUpAt).not.toBe(suggestFollowUpDate({ level: "High", today }).date);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: FAIL — `suggestedFollowUpAt` is `undefined` on `CaseItem` (assertions miss; also a TS error that the property does not exist).

- [ ] **Step 3: Implement the field**

In `nudgepay-app/app/lib/cases.ts`:

1. Add the import beside the existing `./exceptions` import (around line 16):

```ts
import { suggestFollowUpDate } from "./follow-up-cadence";
```

2. Add the field to the `CaseItem` type. Find this block (around lines 82-84):

```ts
  suppressed: boolean;
  contactBlocked: boolean;
  followUpDue: boolean;
```

Replace it with:

```ts
  suppressed: boolean;
  contactBlocked: boolean;
  suggestedFollowUpAt: string;
  followUpDue: boolean;
```

3. In `buildCaseItems`, hoist `effectiveLevel` into a local so it can feed both the existing field and the suggestion. Find this line (currently around line 175):

```ts
    const overrideLevel = overrideToLevel(cse.priorityOverride ?? null);
```

Add directly below it:

```ts
    const effectiveLevel = overrideLevel ?? scored.level;
```

4. In the returned object, change the `effectiveLevel` line (around line 194) to use the local, and add `suggestedFollowUpAt`. Find:

```ts
      effectiveLevel: overrideLevel ?? scored.level,
```

Replace with:

```ts
      effectiveLevel,
```

Then find this line (around line 210):

```ts
      contactBlocked: isContactBlocked(cse.exceptionReason),
```

Add directly below it:

```ts
      suggestedFollowUpAt: suggestFollowUpDate({ level: effectiveLevel, today }).date,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: PASS (the two new tests plus all pre-existing `cases.test.ts` tests).

- [ ] **Step 5: Typecheck (CaseItem is consumed widely)**

Run: `cd nudgepay-app && npx tsc --noEmit`
Expected: exit 0 — no consumer of `CaseItem` breaks from the added required field (object literals that build a `CaseItem` are only in `buildCaseItems`; everywhere else reads it).

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/lib/cases.ts nudgepay-app/tests/cases.test.ts
git commit -m "feat(cases): surface suggestedFollowUpAt on CaseItem (C4)"
```

---

### Task 4: Pre-fill the drawer follow-up date + rationale

**Files:**
- Modify: `nudgepay-app/app/components/LogContactDrawer.tsx`

**Interfaces:**
- Consumes: `selected.suggestedFollowUpAt` and `selected.effectiveLevel` from `CaseItem` (Task 3); `CADENCE_DAYS` from `../lib/follow-up-cadence` (Task 2).
- Produces: no exported interface change — UI only.

This task has no unit test (the suite is node-env with no jsdom; the drawer has no existing render tests). It is verified by `tsc` + production build + reading the diff. Follow the steps exactly.

- [ ] **Step 1: Add the import**

In `nudgepay-app/app/components/LogContactDrawer.tsx`, find the existing import (around line 6):

```ts
import { PRIMARY_EXCEPTION_STATES, requiresReviewDate, isContactBlocked, type ExceptionState } from "../lib/exceptions";
```

Add directly below it:

```ts
import { CADENCE_DAYS } from "../lib/follow-up-cadence";
```

- [ ] **Step 2: Pre-fill the follow-up date input and add the rationale caption**

Find the `follow_up` block (currently around lines 216-222):

```tsx
          {nextStep === "follow_up" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Follow up on</span>
              <input name="followUpAt" type="date" required
                className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper" />
            </label>
          )}
```

Replace it with:

```tsx
          {nextStep === "follow_up" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Follow up on</span>
              <input name="followUpAt" type="date" required defaultValue={selected.suggestedFollowUpAt}
                className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper" />
              <span className="text-xs font-sans text-muted">
                Suggested from {selected.effectiveLevel} priority · {CADENCE_DAYS[selected.effectiveLevel]}-day cadence
              </span>
            </label>
          )}
```

- [ ] **Step 3: Typecheck**

Run: `cd nudgepay-app && npx tsc --noEmit`
Expected: exit 0. (`selected.effectiveLevel` is a `PriorityLevel`, which is exactly the key type of `CADENCE_DAYS` — no index error.)

- [ ] **Step 4: Production build**

Run: `cd nudgepay-app && npx react-router build`
Expected: `✓ built` with exit 0.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/components/LogContactDrawer.tsx
git commit -m "feat(drawer): pre-fill follow-up date with priority cadence + rationale (C4)"
```

---

## Final Verification (after all tasks)

- [ ] Full suite: `cd nudgepay-app && npx vitest run` — expected all green (current baseline 285 + the new follow-up-cadence/business-days/cases tests).
- [ ] Typecheck: `cd nudgepay-app && npx tsc --noEmit` — exit 0.
- [ ] Build: `cd nudgepay-app && npx react-router build` — exit 0.
- [ ] Update the gap checklist: mark **C4** `[x]` with the phase tag (8d) in `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md`, then commit with `docs:`.

---

## Self-Review

**Spec coverage:**
- Cadence table (Critical 2 / High 3 / Medium 7 / Low 14) → Task 2 `CADENCE_DAYS` + tests.
- Priority-driven, override-aware (`effectiveLevel`) → Task 3 + override test.
- Weekend roll (add-then-roll) → Task 1 `rollToWeekday` + Task 2 weekend test.
- Follow-up only (not waiting/exception) → Task 4 touches only the `follow_up` block.
- Pre-fill + rationale, editable, still `required` → Task 4.
- Server-computed, one `CaseItem` field, no `today` to client → Task 3.
- No migration / no route / no validation change / no metrics change → none of the tasks touch those files. ✓
- Frozen constants, per-org config deferred → Task 2 freeze + test. ✓

**Placeholder scan:** none — every code and test block is complete and concrete.

**Type consistency:** `suggestFollowUpDate({ level, today })` signature and `FollowUpSuggestion` shape are identical across Tasks 2 and 3. `CADENCE_DAYS` keyed by `PriorityLevel` matches `selected.effectiveLevel: PriorityLevel` in Task 4. `addCalendarDays`/`rollToWeekday` names match between Task 1 (produce) and Task 2 (consume). `CaseItem.suggestedFollowUpAt: string` defined in Task 3 matches its read in Task 4.
