# C7 — Configurable Grace Periods & Business Days Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the promise grace window, follow-up cadence, and business-day/weekend roll per-org configurable, with a per-org holiday calendar honored by both grace math and the follow-up roll — engine + storage only, no settings UI.

**Architecture:** A new pure `org-config.ts` defines `OrgConfig` + `DEFAULT_ORG_CONFIG` + `resolveOrgConfig`. The existing pure date modules (`business-days.ts`, `follow-up-cadence.ts`) gain optional config so callers pass working-days/holidays/cadence in while defaults preserve today's behavior exactly. A thin `org-config.server.ts` loads two new tables (`org_settings`, `org_holidays`, migration `0016`) and resolves them; the dashboard loader and promise-create path consume it.

**Tech Stack:** TypeScript, React Router (framework mode), Supabase/Postgres + RLS, Vitest.

## Global Constraints

- Pure libs (`business-days.ts`, `follow-up-cadence.ts`, `org-config.ts`, `cases.ts`) have **no I/O, no `node:*`, no `.server` suffix** — they are imported by client components via type-only imports.
- Date math uses **UTC-component arithmetic** on `YYYY-MM-DD` strings (no timezone drift) — consistent with `app/lib/dates.ts`.
- Working-day numbers are **0=Sun … 6=Sat** (matches `Date.getUTCDay()`); default working set is `{1,2,3,4,5}` (Mon–Fri).
- **Backward compatibility is mandatory:** an org with no `org_settings` row and no `org_holidays` rows must behave identically to pre-C7. Existing 2-arg calls to `addBusinessDays` must keep working.
- `GRACE_BUSINESS_DAYS` (value `2`) and `CADENCE_DAYS` (`{Critical:2, High:3, Medium:7, Low:14}`) remain the canonical default values; `DEFAULT_ORG_CONFIG` references them.
- RLS pattern mirrors existing migrations: `is_org_member(org_id)` for reads; a new `is_org_owner(org_id)` for writes.
- Conventional Commits; commit after each task.
- Run tests after each change. Note: DB-integration tests require a local Supabase stack on `127.0.0.1:54321` (`supabase start`); pure-unit tests do not.

---

### Task 1: Holiday/working-day aware `business-days.ts`

**Files:**
- Modify: `nudgepay-app/app/lib/business-days.ts`
- Test: `nudgepay-app/tests/business-days.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export const DEFAULT_WORKING_DAYS: ReadonlySet<number>` (= `{1,2,3,4,5}`)
  - `export const NO_HOLIDAYS: ReadonlySet<string>` (empty)
  - `addBusinessDays(dateISO: string, n: number, opts?: { workingDays?: ReadonlySet<number>; holidays?: ReadonlySet<string> }): string`
  - `nextWorkingDay(dateISO: string, opts?: { workingDays?: ReadonlySet<number>; holidays?: ReadonlySet<string> }): string` (replaces `rollToWeekday`)
  - `addCalendarDays(dateISO: string, n: number): string` (unchanged)
  - `GRACE_BUSINESS_DAYS = 2` (unchanged)

- [ ] **Step 1: Write the failing tests** — replace the body of `tests/business-days.test.ts` with:

```ts
import { expect, test } from "vitest";
import {
  addBusinessDays, addCalendarDays, nextWorkingDay,
  GRACE_BUSINESS_DAYS, DEFAULT_WORKING_DAYS, NO_HOLIDAYS,
} from "../app/lib/business-days";

test("GRACE_BUSINESS_DAYS is 2 and defaults are Mon-Fri / no holidays", () => {
  expect(GRACE_BUSINESS_DAYS).toBe(2);
  expect([...DEFAULT_WORKING_DAYS].sort()).toEqual([1, 2, 3, 4, 5]);
  expect(NO_HOLIDAYS.size).toBe(0);
});

test("addBusinessDays skips weekends by default", () => {
  expect(addBusinessDays("2026-07-01", 2)).toBe("2026-07-03"); // Wed +2 = Fri
  expect(addBusinessDays("2026-07-02", 2)).toBe("2026-07-06"); // Thu +2 = Mon
  expect(addBusinessDays("2026-07-03", 2)).toBe("2026-07-07"); // Fri +2 = Tue
});

test("addBusinessDays with 0 returns the same date", () => {
  expect(addBusinessDays("2026-07-01", 0)).toBe("2026-07-01");
});

test("addBusinessDays skips holidays in addition to weekends", () => {
  // Wed 2026-07-01 +2 business days, but Thu 2026-07-02 is a holiday ->
  // Thu(skip holiday) Fri(1) ... actually count: Thu holiday skipped, Fri=1, Mon=2.
  const holidays = new Set(["2026-07-02"]);
  expect(addBusinessDays("2026-07-01", 2, { holidays })).toBe("2026-07-06");
});

test("addBusinessDays honors a custom working-days set (Sat working)", () => {
  // Working week includes Saturday (6). Fri 2026-07-03 +1 = Sat 2026-07-04.
  const workingDays = new Set([1, 2, 3, 4, 5, 6]);
  expect(addBusinessDays("2026-07-03", 1, { workingDays })).toBe("2026-07-04");
});

test("nextWorkingDay leaves working days unchanged and rolls weekends to Monday", () => {
  expect(nextWorkingDay("2026-06-26")).toBe("2026-06-26"); // Fri
  expect(nextWorkingDay("2026-06-27")).toBe("2026-06-29"); // Sat -> Mon
  expect(nextWorkingDay("2026-06-28")).toBe("2026-06-29"); // Sun -> Mon
});

test("nextWorkingDay rolls over a holiday that follows a weekend", () => {
  // Sat 2026-06-27 -> Sun 28 -> Mon 29 is a holiday -> Tue 30.
  const holidays = new Set(["2026-06-29"]);
  expect(nextWorkingDay("2026-06-27", { holidays })).toBe("2026-06-30");
});

test("addCalendarDays adds calendar days including weekends", () => {
  expect(addCalendarDays("2026-06-25", 2)).toBe("2026-06-27");
  expect(addCalendarDays("2026-06-25", 0)).toBe("2026-06-25");
  expect(addCalendarDays("2026-06-29", 7)).toBe("2026-07-06");
});

test("nextWorkingDay throws on an impossible config rather than hanging", () => {
  const workingDays = new Set([1, 2, 3, 4, 5]);
  // Every weekday for a year is a holiday -> no working day reachable.
  const holidays = new Set<string>();
  let d = new Date(Date.UTC(2026, 0, 1));
  for (let i = 0; i < 800; i++) {
    holidays.add(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  expect(() => nextWorkingDay("2026-01-01", { workingDays, holidays })).toThrow();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd nudgepay-app && npx vitest run tests/business-days.test.ts`
Expected: FAIL — `nextWorkingDay` / `DEFAULT_WORKING_DAYS` / `NO_HOLIDAYS` not exported.

- [ ] **Step 3: Rewrite `app/lib/business-days.ts`**

```ts
// Pure business-day arithmetic for promise grace deadlines and follow-up rolls.
// No I/O, no .server. Date-only strings (YYYY-MM-DD) in and out; UTC-component
// math so there is no timezone drift (consistent with app/lib/dates.ts).
// Working days and holidays are configurable per org (C7); the defaults below
// reproduce the original weekend-only behavior.

export const GRACE_BUSINESS_DAYS = 2;
export const DEFAULT_WORKING_DAYS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);
export const NO_HOLIDAYS: ReadonlySet<string> = new Set<string>();

const MAX_ROLL = 366; // safety bound: an org should never block a full year of days

type DayOpts = { workingDays?: ReadonlySet<number>; holidays?: ReadonlySet<string> };

function isWorkingDay(dt: Date, workingDays: ReadonlySet<number>, holidays: ReadonlySet<string>): boolean {
  return workingDays.has(dt.getUTCDay()) && !holidays.has(dt.toISOString().slice(0, 10));
}

function parse(dateISO: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Advance `n` working days, skipping non-working weekdays and holidays.
export function addBusinessDays(dateISO: string, n: number, opts: DayOpts = {}): string {
  const workingDays = opts.workingDays ?? DEFAULT_WORKING_DAYS;
  const holidays = opts.holidays ?? NO_HOLIDAYS;
  const dt = parse(dateISO);
  let added = 0;
  let steps = 0;
  while (added < n) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    if (++steps > (n + 1) * MAX_ROLL) {
      throw new Error(`addBusinessDays: no working day within range for ${dateISO}`);
    }
    if (isWorkingDay(dt, workingDays, holidays)) added += 1;
  }
  return dt.toISOString().slice(0, 10);
}

// Add n calendar days (weekends included). UTC-component math, no drift.
export function addCalendarDays(dateISO: string, n: number): string {
  const dt = parse(dateISO);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// If dateISO is not a working day (weekend or holiday), roll forward to the next
// working, non-holiday day; an already-valid day is returned unchanged.
export function nextWorkingDay(dateISO: string, opts: DayOpts = {}): string {
  const workingDays = opts.workingDays ?? DEFAULT_WORKING_DAYS;
  const holidays = opts.holidays ?? NO_HOLIDAYS;
  const dt = parse(dateISO);
  let steps = 0;
  while (!isWorkingDay(dt, workingDays, holidays)) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    if (++steps > MAX_ROLL) {
      throw new Error(`nextWorkingDay: no working day within a year of ${dateISO}`);
    }
  }
  return dt.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/business-days.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/business-days.ts nudgepay-app/tests/business-days.test.ts
git commit -m "feat(dates): holiday + working-day aware business-day math (C7)"
```

---

### Task 2: Config-aware `follow-up-cadence.ts`

**Files:**
- Modify: `nudgepay-app/app/lib/follow-up-cadence.ts`
- Test: `nudgepay-app/tests/follow-up-cadence.test.ts`

**Interfaces:**
- Consumes: `addCalendarDays`, `nextWorkingDay` (Task 1); `OrgConfig` type (Task 3, type-only — safe to reference before its runtime exists because TypeScript erases type imports).
- Produces: `suggestFollowUpDate(input: { level: PriorityLevel; today: string; config?: Pick<OrgConfig, "cadenceDays" | "workingDays" | "holidays"> }): { date: string; intervalDays: number }`; `CADENCE_DAYS` unchanged.

- [ ] **Step 1: Write the failing tests** — replace `tests/follow-up-cadence.test.ts` with:

```ts
import { expect, test } from "vitest";
import { CADENCE_DAYS, suggestFollowUpDate } from "../app/lib/follow-up-cadence";

test("CADENCE_DAYS maps each level to its interval and is frozen", () => {
  expect(CADENCE_DAYS).toEqual({ Critical: 2, High: 3, Medium: 7, Low: 14 });
  expect(Object.isFrozen(CADENCE_DAYS)).toBe(true);
});

test("suggestFollowUpDate uses default cadence + weekend roll when no config", () => {
  // 2026-06-22 is a Monday.
  expect(suggestFollowUpDate({ level: "Critical", today: "2026-06-22" }))
    .toEqual({ date: "2026-06-24", intervalDays: 2 });
  expect(suggestFollowUpDate({ level: "Low", today: "2026-06-22" }))
    .toEqual({ date: "2026-07-06", intervalDays: 14 });
  // Weekend roll: Fri 2026-06-26 + 2 = Sun 28 -> Mon 29.
  expect(suggestFollowUpDate({ level: "Critical", today: "2026-06-26" }).date)
    .toBe("2026-06-29");
});

test("suggestFollowUpDate honors per-org cadence override", () => {
  const config = {
    cadenceDays: { Critical: 1, High: 3, Medium: 7, Low: 14 },
    workingDays: new Set([1, 2, 3, 4, 5]),
    holidays: new Set<string>(),
  };
  // Mon 2026-06-22 + 1 = Tue 2026-06-23; intervalDays reflects the org value.
  expect(suggestFollowUpDate({ level: "Critical", today: "2026-06-22", config }))
    .toEqual({ date: "2026-06-23", intervalDays: 1 });
});

test("suggestFollowUpDate rolls off a configured holiday", () => {
  const config = {
    cadenceDays: { Critical: 2, High: 3, Medium: 7, Low: 14 },
    workingDays: new Set([1, 2, 3, 4, 5]),
    holidays: new Set(["2026-06-24"]),
  };
  // Mon 2026-06-22 + 2 = Wed 2026-06-24 (holiday) -> Thu 2026-06-25.
  expect(suggestFollowUpDate({ level: "Critical", today: "2026-06-22", config }).date)
    .toBe("2026-06-25");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd nudgepay-app && npx vitest run tests/follow-up-cadence.test.ts`
Expected: FAIL — config branch / `nextWorkingDay` not yet wired.

- [ ] **Step 3: Rewrite `app/lib/follow-up-cadence.ts`**

```ts
// Pure cadence policy for suggested follow-up dates. No I/O, no node:*, no
// .server suffix. CADENCE_DAYS is the default policy; per-org overrides arrive
// via the optional `config` (C7). Single source of truth for the default
// priority -> interval mapping.

import type { PriorityLevel } from "./priority";
import type { OrgConfig } from "./org-config";
import { addCalendarDays, nextWorkingDay } from "./business-days";

export const CADENCE_DAYS: Readonly<Record<PriorityLevel, number>> = Object.freeze({
  Critical: 2,
  High: 3,
  Medium: 7,
  Low: 14,
});

export type FollowUpSuggestion = { date: string; intervalDays: number };

// Suggest the next follow-up date: add the level's calendar interval to `today`,
// then roll forward off any non-working day (weekend or holiday). `intervalDays`
// is the pre-roll interval, used for the human-facing rationale ("3-day cadence").
export function suggestFollowUpDate(input: {
  level: PriorityLevel;
  today: string; // YYYY-MM-DD
  config?: Pick<OrgConfig, "cadenceDays" | "workingDays" | "holidays">;
}): FollowUpSuggestion {
  const cadence = input.config?.cadenceDays ?? CADENCE_DAYS;
  const intervalDays = cadence[input.level];
  const date = nextWorkingDay(addCalendarDays(input.today, intervalDays), {
    workingDays: input.config?.workingDays,
    holidays: input.config?.holidays,
  });
  return { date, intervalDays };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/follow-up-cadence.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/follow-up-cadence.ts nudgepay-app/tests/follow-up-cadence.test.ts
git commit -m "feat(cadence): per-org cadence + holiday-aware follow-up suggestion (C7)"
```

---

### Task 3: `org-config.ts` pure resolution module

**Files:**
- Create: `nudgepay-app/app/lib/org-config.ts`
- Test: `nudgepay-app/tests/org-config.test.ts`

**Interfaces:**
- Consumes: `CADENCE_DAYS` (Task 2); `GRACE_BUSINESS_DAYS`, `DEFAULT_WORKING_DAYS`, `NO_HOLIDAYS` (Task 1); `PriorityLevel` (`priority.ts`).
- Produces:
  - `type OrgConfig = { promiseGraceDays: number; workingDays: ReadonlySet<number>; holidays: ReadonlySet<string>; cadenceDays: Readonly<Record<PriorityLevel, number>> }`
  - `type OrgSettingsRow` (nullable DB columns)
  - `const DEFAULT_ORG_CONFIG: OrgConfig`
  - `resolveOrgConfig(settings: OrgSettingsRow | null, holidays: { holiday_date: string }[]): OrgConfig`

- [ ] **Step 1: Write the failing test** — create `tests/org-config.test.ts`:

```ts
import { expect, test } from "vitest";
import { DEFAULT_ORG_CONFIG, resolveOrgConfig } from "../app/lib/org-config";

test("DEFAULT_ORG_CONFIG carries the canonical defaults", () => {
  expect(DEFAULT_ORG_CONFIG.promiseGraceDays).toBe(2);
  expect([...DEFAULT_ORG_CONFIG.workingDays].sort()).toEqual([1, 2, 3, 4, 5]);
  expect(DEFAULT_ORG_CONFIG.holidays.size).toBe(0);
  expect(DEFAULT_ORG_CONFIG.cadenceDays).toEqual({ Critical: 2, High: 3, Medium: 7, Low: 14 });
});

test("resolveOrgConfig with null settings returns defaults plus holiday set", () => {
  const cfg = resolveOrgConfig(null, [{ holiday_date: "2026-12-25" }]);
  expect(cfg.promiseGraceDays).toBe(2);
  expect([...cfg.workingDays].sort()).toEqual([1, 2, 3, 4, 5]);
  expect(cfg.holidays.has("2026-12-25")).toBe(true);
  expect(cfg.cadenceDays).toEqual({ Critical: 2, High: 3, Medium: 7, Low: 14 });
});

test("resolveOrgConfig applies row overrides", () => {
  const cfg = resolveOrgConfig({
    promise_grace_days: 5,
    working_days: [1, 2, 3, 4, 5, 6],
    cadence_critical: 1,
    cadence_high: 2,
    cadence_medium: 5,
    cadence_low: 10,
  }, []);
  expect(cfg.promiseGraceDays).toBe(5);
  expect([...cfg.workingDays].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  expect(cfg.cadenceDays).toEqual({ Critical: 1, High: 2, Medium: 5, Low: 10 });
});

test("resolveOrgConfig falls back to default working days when the column is empty", () => {
  const cfg = resolveOrgConfig({
    promise_grace_days: 2,
    working_days: [],
    cadence_critical: 2, cadence_high: 3, cadence_medium: 7, cadence_low: 14,
  }, []);
  expect([...cfg.workingDays].sort()).toEqual([1, 2, 3, 4, 5]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/org-config.test.ts`
Expected: FAIL — module `../app/lib/org-config` not found.

- [ ] **Step 3: Create `app/lib/org-config.ts`**

```ts
// Pure resolution of per-org scheduling config (C7). No I/O, no .server suffix.
// The .server loader reads the rows; this module turns them into an OrgConfig,
// filling every missing piece from DEFAULT_ORG_CONFIG. Default values are owned
// by business-days.ts (grace, working days) and follow-up-cadence.ts (cadence) —
// this module composes them, so there is a single source of default truth.

import type { PriorityLevel } from "./priority";
import { CADENCE_DAYS } from "./follow-up-cadence";
import { GRACE_BUSINESS_DAYS, DEFAULT_WORKING_DAYS, NO_HOLIDAYS } from "./business-days";

export type OrgConfig = {
  promiseGraceDays: number;
  workingDays: ReadonlySet<number>;
  holidays: ReadonlySet<string>;
  cadenceDays: Readonly<Record<PriorityLevel, number>>;
};

// Nullable to match a SELECT against optional columns / an absent row.
export type OrgSettingsRow = {
  promise_grace_days: number | null;
  working_days: number[] | null;
  cadence_critical: number | null;
  cadence_high: number | null;
  cadence_medium: number | null;
  cadence_low: number | null;
};

export const DEFAULT_ORG_CONFIG: OrgConfig = Object.freeze({
  promiseGraceDays: GRACE_BUSINESS_DAYS,
  workingDays: DEFAULT_WORKING_DAYS,
  holidays: NO_HOLIDAYS,
  cadenceDays: CADENCE_DAYS,
});

export function resolveOrgConfig(
  settings: OrgSettingsRow | null,
  holidays: { holiday_date: string }[],
): OrgConfig {
  const holidaySet: ReadonlySet<string> = new Set(holidays.map((h) => h.holiday_date));
  if (!settings) {
    return { ...DEFAULT_ORG_CONFIG, holidays: holidaySet };
  }
  const workingDays: ReadonlySet<number> =
    settings.working_days && settings.working_days.length > 0
      ? new Set(settings.working_days)
      : DEFAULT_WORKING_DAYS;
  return {
    promiseGraceDays: settings.promise_grace_days ?? GRACE_BUSINESS_DAYS,
    workingDays,
    holidays: holidaySet,
    cadenceDays: {
      Critical: settings.cadence_critical ?? CADENCE_DAYS.Critical,
      High: settings.cadence_high ?? CADENCE_DAYS.High,
      Medium: settings.cadence_medium ?? CADENCE_DAYS.Medium,
      Low: settings.cadence_low ?? CADENCE_DAYS.Low,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/org-config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify no import cycle / typecheck**

Run: `cd nudgepay-app && npx tsc --noEmit`
Expected: exit 0. (Runtime edges: `org-config → follow-up-cadence → business-days`; the `follow-up-cadence → org-config` edge is type-only and erased.)

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/lib/org-config.ts nudgepay-app/tests/org-config.test.ts
git commit -m "feat(config): pure per-org scheduling config resolution (C7)"
```

---

### Task 4: Migration `0016` — `org_settings` + `org_holidays` + `is_org_owner`

**Files:**
- Create: `nudgepay-app/supabase/migrations/0016_org_scheduling_config.sql`

**Interfaces:**
- Produces tables `org_settings`, `org_holidays`, and SQL function `is_org_owner(uuid)`; consumed by Task 5's loader.

- [ ] **Step 1: Create the migration file**

```sql
-- Phase 8 (C7): per-org scheduling config. Engine + storage only; the editing UI
-- lands in Phase 9. Both tables are optional per org — absence => app defaults
-- (grace 2 business days, Mon-Fri working week, no holidays, default cadence).

-- Owner-only write helper, mirroring is_org_member (no owner helper existed before).
create or replace function public.is_org_owner(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

create table org_settings (
  org_id uuid primary key references organizations(id) on delete cascade,
  promise_grace_days int not null default 2 check (promise_grace_days >= 0),
  working_days int[] not null default '{1,2,3,4,5}' check (array_length(working_days, 1) >= 1),
  cadence_critical int not null default 2 check (cadence_critical > 0),
  cadence_high int not null default 3 check (cadence_high > 0),
  cadence_medium int not null default 7 check (cadence_medium > 0),
  cadence_low int not null default 14 check (cadence_low > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table org_holidays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  holiday_date date not null,
  label text,
  created_at timestamptz not null default now(),
  unique (org_id, holiday_date)
);
create index org_holidays_org_idx on org_holidays (org_id);

alter table org_settings enable row level security;
alter table org_holidays enable row level security;

-- Members read; owners write. Multiple permissive policies are OR'd, so an owner
-- (also a member) can both read and write; a plain member can only read.
create policy org_settings_member_read on org_settings
  for select using (is_org_member(org_id));
create policy org_settings_owner_write on org_settings
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));

create policy org_holidays_member_read on org_holidays
  for select using (is_org_member(org_id));
create policy org_holidays_owner_write on org_holidays
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));
```

- [ ] **Step 2: Apply the migration to the local stack**

Run: `cd nudgepay-app && supabase db reset`
Expected: all migrations `0001`–`0016` apply with no error; final line reports a successful reset. (Requires `supabase start` first.)

- [ ] **Step 3: Verify the schema landed**

Run: `cd nudgepay-app && supabase db diff --schema public 2>&1 | head -5`
Expected: no pending diff (the migration matches the DB).

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/supabase/migrations/0016_org_scheduling_config.sql
git commit -m "feat(db): org_settings + org_holidays + is_org_owner (C7, migration 0016)"
```

---

### Task 5: `org-config.server.ts` loader

**Files:**
- Create: `nudgepay-app/app/lib/org-config.server.ts`
- Test: `nudgepay-app/tests/org-config-loader.test.ts`

**Interfaces:**
- Consumes: `resolveOrgConfig`, `OrgConfig` (Task 3); the tables from Task 4; the test DB helper `tests/fd.ts` (service client factory used by existing integration tests).
- Produces: `loadOrgConfig(client: SupabaseClient, orgId: string): Promise<OrgConfig>`.

- [ ] **Step 1: Inspect the existing integration-test helper**

Run: `cd nudgepay-app && sed -n '1,40p' tests/fd.ts`
Expected: shows how existing tests obtain a service/admin Supabase client and seed an org. Reuse that exact pattern in Step 2 (do not invent a new fixture API). If the helper exports a service client factory under a different name, use that name.

- [ ] **Step 2: Write the failing integration test** — create `tests/org-config-loader.test.ts` (adapt the client/seed calls to whatever `tests/fd.ts` actually exports):

```ts
import { expect, test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadOrgConfig } from "../app/lib/org-config.server";

const svc = createClient(
  process.env.SUPABASE_URL ?? "http://127.0.0.1:54321",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  { auth: { persistSession: false } },
);

test("loadOrgConfig returns defaults for an org with no settings/holiday rows", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "C7 defaults" }).select("id").single();
  const orgId = org!.id as string;
  const cfg = await loadOrgConfig(svc, orgId);
  expect(cfg.promiseGraceDays).toBe(2);
  expect([...cfg.workingDays].sort()).toEqual([1, 2, 3, 4, 5]);
  expect(cfg.holidays.size).toBe(0);
  expect(cfg.cadenceDays).toEqual({ Critical: 2, High: 3, Medium: 7, Low: 14 });
});

test("loadOrgConfig reflects stored settings and holidays", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "C7 custom" }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("org_settings").insert({
    org_id: orgId, promise_grace_days: 3, working_days: [1, 2, 3, 4, 5, 6],
    cadence_critical: 1, cadence_high: 2, cadence_medium: 5, cadence_low: 10,
  });
  await svc.from("org_holidays").insert({ org_id: orgId, holiday_date: "2026-12-25", label: "Christmas" });
  const cfg = await loadOrgConfig(svc, orgId);
  expect(cfg.promiseGraceDays).toBe(3);
  expect([...cfg.workingDays].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  expect(cfg.holidays.has("2026-12-25")).toBe(true);
  expect(cfg.cadenceDays.Critical).toBe(1);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/org-config-loader.test.ts`
Expected: FAIL — module `../app/lib/org-config.server` not found.

- [ ] **Step 4: Create `app/lib/org-config.server.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveOrgConfig, type OrgConfig, type OrgSettingsRow } from "./org-config";

// Loads per-org scheduling config: one read of org_settings (optional row) plus
// the org's holiday rows. Absent rows resolve to DEFAULT_ORG_CONFIG. All reads go
// through the supplied client (user/RLS client in the loader; service in tests).
export async function loadOrgConfig(client: SupabaseClient, orgId: string): Promise<OrgConfig> {
  const [settingsRes, holidaysRes] = await Promise.all([
    client
      .from("org_settings")
      .select("promise_grace_days, working_days, cadence_critical, cadence_high, cadence_medium, cadence_low")
      .eq("org_id", orgId)
      .maybeSingle(),
    client.from("org_holidays").select("holiday_date").eq("org_id", orgId),
  ]);
  const settings = (settingsRes.data as OrgSettingsRow | null) ?? null;
  const holidays = (holidaysRes.data ?? []) as { holiday_date: string }[];
  return resolveOrgConfig(settings, holidays);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/org-config-loader.test.ts`
Expected: PASS (2 tests). (Requires local Supabase with migration `0016` applied — Task 4.)

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/lib/org-config.server.ts nudgepay-app/tests/org-config-loader.test.ts
git commit -m "feat(config): loadOrgConfig server reader for per-org scheduling (C7)"
```

---

### Task 6: Per-org grace in `promise-create.server.ts`

**Files:**
- Modify: `nudgepay-app/app/lib/promise-create.server.ts:2` (imports) and `:32` (grace calc)
- Test: `nudgepay-app/tests/promise-create-grace.test.ts`

**Interfaces:**
- Consumes: `loadOrgConfig` (Task 5), `addBusinessDays` (Task 1).
- Produces: no signature change to `createPromiseForLog`; `grace_until` now honors per-org grace days + holidays.

- [ ] **Step 1: Write the failing integration test** — create `tests/promise-create-grace.test.ts` (adapt seeding to `tests/fd.ts`; seed an org, a customer with an overdue invoice, and a contact log, then call `createPromiseForLog`):

```ts
import { expect, test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createPromiseForLog } from "../app/lib/promise-create.server";

const svc = createClient(
  process.env.SUPABASE_URL ?? "http://127.0.0.1:54321",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  { auth: { persistSession: false } },
);

async function seedOrgCaseInvoice() {
  const { data: org } = await svc.from("organizations").insert({ name: "C7 grace" }).select("id").single();
  const orgId = org!.id as string;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c1", name: "Acme" }).select("id").single();
  const customerId = cust!.id as string;
  await svc.from("invoices").insert({ org_id: orgId, qbo_id: "i1", customer_id: customerId, balance: 100, due_date: "2026-06-01" });
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: customerId, status: "working" }).select("id").single();
  return { orgId, customerId, caseId: cse!.id as string };
}

test("grace_until uses the org's configured grace days", async () => {
  const { orgId, customerId, caseId } = await seedOrgCaseInvoice();
  await svc.from("org_settings").insert({ org_id: orgId, promise_grace_days: 5 });
  const res = await createPromiseForLog(svc, {
    orgId, caseId, customerId, userId: null as unknown as string,
    contactLogId: null, promisedAmount: 100, promisedDate: "2026-06-22", // Monday
  });
  expect(res.ok).toBe(true);
  const { data: prom } = await svc.from("promises").select("grace_until").eq("case_id", caseId).single();
  // Mon 2026-06-22 + 5 business days = Mon 2026-06-29.
  expect(prom!.grace_until).toBe("2026-06-29");
});

test("grace_until skips a configured holiday", async () => {
  const { orgId, customerId, caseId } = await seedOrgCaseInvoice();
  await svc.from("org_settings").insert({ org_id: orgId, promise_grace_days: 2 });
  await svc.from("org_holidays").insert({ org_id: orgId, holiday_date: "2026-06-24" });
  const res = await createPromiseForLog(svc, {
    orgId, caseId, customerId, userId: null as unknown as string,
    contactLogId: null, promisedAmount: 100, promisedDate: "2026-06-22", // Monday
  });
  expect(res.ok).toBe(true);
  const { data: prom } = await svc.from("promises").select("grace_until").eq("case_id", caseId).single();
  // Mon +2 business days, but Wed 2026-06-24 is a holiday: Tue=1, Thu=2 -> 2026-06-25.
  expect(prom!.grace_until).toBe("2026-06-25");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/promise-create-grace.test.ts`
Expected: FAIL — grace currently fixed at 2 weekend-only business days (first test expects `2026-06-29` but gets `2026-06-24`).

- [ ] **Step 3: Edit `app/lib/promise-create.server.ts`**

Replace the import on line 2:

```ts
import { addBusinessDays } from "./business-days";
import { loadOrgConfig } from "./org-config.server";
```

Replace the grace calculation on line 32:

```ts
  const config = await loadOrgConfig(client, input.orgId);
  const graceUntil = addBusinessDays(input.promisedDate, config.promiseGraceDays, {
    workingDays: config.workingDays,
    holidays: config.holidays,
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/promise-create-grace.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the existing promise suite to confirm no regression**

Run: `cd nudgepay-app && npx vitest run tests/promises.test.ts tests/api-promises-cancel.test.ts tests/promise-evaluation-rls.test.ts tests/api-contact-logs.test.ts`
Expected: PASS (default-config orgs still get a 2-business-day grace).

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/lib/promise-create.server.ts nudgepay-app/tests/promise-create-grace.test.ts
git commit -m "feat(promises): per-org grace window + holidays at promise creation (C7)"
```

---

### Task 7: `buildCaseItems` config param + `suggestedFollowUpIntervalDays`

**Files:**
- Modify: `nudgepay-app/app/lib/cases.ts:17` (import), `:85` (CaseItem field), `:114-122` (signature), `:214` (computation)
- Test: `nudgepay-app/tests/cases.test.ts`

**Interfaces:**
- Consumes: `OrgConfig`, `DEFAULT_ORG_CONFIG` (Task 3); `suggestFollowUpDate` (Task 2).
- Produces: `CaseItem.suggestedFollowUpIntervalDays: number`; `buildCaseItems(..., ownerLabels: Map<string,string>, config: OrgConfig): CaseItem[]` (new last param).

- [ ] **Step 1: Add the failing test** — append to `tests/cases.test.ts` (reuse the file's existing `buildCaseItems` fixture/builder; if helpers differ, match them). Add at the end:

```ts
import { DEFAULT_ORG_CONFIG } from "../app/lib/org-config";

test("buildCaseItems surfaces suggestedFollowUpAt + interval from the config", () => {
  // Minimal fixture: one open case with one overdue invoice. Reuse the helpers
  // already defined in this file for the other buildCaseItems tests.
  const today = "2026-06-22"; // Monday
  const config = {
    ...DEFAULT_ORG_CONFIG,
    cadenceDays: { Critical: 1, High: 3, Medium: 7, Low: 14 },
  };
  const items = buildCaseItems(
    sampleCases, sampleInvoices, sampleCustomers, [], [], today, sampleOwnerLabels, config,
  );
  const item = items[0];
  // Interval comes from the config; date is computed from effectiveLevel.
  expect(item.suggestedFollowUpIntervalDays).toBe(config.cadenceDays[item.effectiveLevel]);
  expect(item.suggestedFollowUpAt).toBeTruthy();
});
```

> Note for implementer: `sampleCases`/`sampleInvoices`/`sampleCustomers`/`sampleOwnerLabels` are placeholders for whatever fixtures `tests/cases.test.ts` already uses to call `buildCaseItems`. Read the file first and reuse them; the only new assertions are on `suggestedFollowUpIntervalDays` and the config-driven interval.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: FAIL — `buildCaseItems` takes 7 args / `suggestedFollowUpIntervalDays` missing.

- [ ] **Step 3: Edit `app/lib/cases.ts`**

Add the import near line 17:

```ts
import { suggestFollowUpDate } from "./follow-up-cadence";
import type { OrgConfig } from "./org-config";
```

Add the field to `CaseItem` next to `suggestedFollowUpAt` (line 85):

```ts
  suggestedFollowUpAt: string;
  suggestedFollowUpIntervalDays: number;
```

Add `config` as the new last parameter (lines 114-122):

```ts
export function buildCaseItems(
  cases: CaseRow[],
  invoices: InvoiceInput[],
  customers: CustomerInput[],
  lastContacts: CaseLastContactInput[],
  promises: CasePromiseInput[],
  today: string,
  ownerLabels: Map<string, string>,
  config: OrgConfig,
): CaseItem[] {
```

Replace the `suggestedFollowUpAt` computation (line 214). First, just above the `return {` for the item (after `effectiveLevel` is computed, ~line 178), add:

```ts
    const followUp = suggestFollowUpDate({ level: effectiveLevel, today, config });
```

Then in the returned object replace line 214 with:

```ts
      suggestedFollowUpAt: followUp.date,
      suggestedFollowUpIntervalDays: followUp.intervalDays,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/cases.ts nudgepay-app/tests/cases.test.ts
git commit -m "feat(cases): thread OrgConfig into buildCaseItems + expose interval (C7)"
```

---

### Task 8: Dashboard loader plumbing (`buildCaseData` + loader)

**Files:**
- Modify: `nudgepay-app/app/routes/dashboard.tsx:57-69` (`buildCaseData` signature + `buildCaseItems` call), `:247`/`:418-421` (loader: load config, pass it)
- Test: `nudgepay-app/tests/dashboard-build-case-data.test.ts`

**Interfaces:**
- Consumes: `buildCaseItems` (Task 7), `loadOrgConfig` (Task 5), `OrgConfig`/`DEFAULT_ORG_CONFIG` (Task 3).
- Produces: `buildCaseData(..., currentUserId, config: OrgConfig)` — new last param.

- [ ] **Step 1: Write the failing test** — create `tests/dashboard-build-case-data.test.ts`. `buildCaseData` is exported from the route module; pass a config with a custom cadence and assert the selected item reflects it. Reuse `tests/cases.test.ts` fixtures conceptually (inline a minimal one here):

```ts
import { expect, test } from "vitest";
import { buildCaseData } from "../app/routes/dashboard";
import { DEFAULT_ORG_CONFIG } from "../app/lib/org-config";

// Implementer: build the smallest valid inputs that yield one CaseItem, mirroring
// the fixtures in tests/cases.test.ts. The assertion below is the point of the test.
test("buildCaseData passes the config through to suggested intervals", () => {
  const config = { ...DEFAULT_ORG_CONFIG, cadenceDays: { Critical: 1, High: 1, Medium: 1, Low: 1 } };
  const data = buildCaseData(
    sampleCases, sampleInvoices, sampleCustomers, [], [],
    { view: "all-open", sort: "priority", q: "", caseId: sampleCases[0].id, invoice: null, tab: "overview" },
    "2026-06-22", sampleOwnerLabels, "user-1", config,
  );
  expect(data.selected?.suggestedFollowUpIntervalDays).toBe(1);
});
```

> Note: `sample*` are the same minimal fixtures used in Task 7's test — reuse them. Match `DashboardParams` field names by reading `dashboard.tsx` (`view, sort, q, caseId, invoice, tab`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/dashboard-build-case-data.test.ts`
Expected: FAIL — `buildCaseData` takes 9 args, not 10.

- [ ] **Step 3: Edit `buildCaseData` (dashboard.tsx:57-69)**

Add the param and forward it:

```ts
export function buildCaseData(
  cases: CaseRow[],
  invoices: InvoiceInput[],
  customers: CustomerInput[],
  lastContacts: CaseLastContactInput[],
  promises: CasePromiseInput[],
  params: DashboardParams,
  today: string,
  ownerLabels: Map<string, string>,
  currentUserId: string | null,
  config: OrgConfig,
): DashboardData {
  const { view, sort, q, caseId } = params;
  const allItems = buildCaseItems(cases, invoices, customers, lastContacts, promises, today, ownerLabels, config);
```

Add the import at the top of `dashboard.tsx` (with the other `../lib/cases` / config imports):

```ts
import { loadOrgConfig } from "../lib/org-config.server";
import { DEFAULT_ORG_CONFIG, type OrgConfig } from "../lib/org-config";
```

- [ ] **Step 4: Edit the loader to load + pass config**

In the loader, inside the `if (connected) {` block and before the `buildCaseData(...)` call (line ~418), add:

```ts
    const orgConfig = await loadOrgConfig(supabase, org.org_id);
```

Update the call (line 418-421):

```ts
    dashboardData = buildCaseData(
      cases, invoicesInput, customersInput, lastContactsInput, promisesInput,
      { view, sort, q, caseId, invoice, tab }, today, ownerLabels, user.id, orgConfig,
    );
```

(The `DEFAULT_ORG_CONFIG` import is the safe fallback for any other `buildCaseData` caller; the loader uses the real `orgConfig`.)

- [ ] **Step 5: Run the test + typecheck + build**

Run: `cd nudgepay-app && npx vitest run tests/dashboard-build-case-data.test.ts && npx tsc --noEmit && npx react-router build`
Expected: test PASS, tsc exit 0, build clean.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/routes/dashboard.tsx nudgepay-app/tests/dashboard-build-case-data.test.ts
git commit -m "feat(dashboard): load per-org config and thread into case build (C7)"
```

---

### Task 9: Drawer caption from per-org interval

**Files:**
- Modify: `nudgepay-app/app/components/LogContactDrawer.tsx:7` (remove import), `:222-224` (caption)

**Interfaces:**
- Consumes: `CaseItem.suggestedFollowUpIntervalDays` (Task 7).
- Produces: no new exports.

- [ ] **Step 1: Remove the `CADENCE_DAYS` import (line 7)**

Delete this line:

```ts
import { CADENCE_DAYS } from "../lib/follow-up-cadence";
```

- [ ] **Step 2: Update the caption (lines 222-224)**

Replace:

```tsx
              <span className="text-xs font-sans text-muted">
                Suggested from {selected.effectiveLevel} priority · {CADENCE_DAYS[selected.effectiveLevel]}-day cadence
              </span>
```

with:

```tsx
              <span className="text-xs font-sans text-muted">
                Suggested from {selected.effectiveLevel} priority · {selected.suggestedFollowUpIntervalDays}-day cadence
              </span>
```

- [ ] **Step 3: Typecheck + build to confirm the drawer compiles**

Run: `cd nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: tsc exit 0 (no remaining `CADENCE_DAYS` reference), build clean.

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/components/LogContactDrawer.tsx
git commit -m "feat(drawer): caption reflects per-org cadence interval (C7)"
```

---

### Task 10: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `cd nudgepay-app && npx vitest run`
Expected: all tests pass (PR baseline was 294; this plan adds ~21 and modifies several). Requires local Supabase running with `0016` applied.

- [ ] **Step 2: Typecheck + production build**

Run: `cd nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: tsc exit 0; build clean.

- [ ] **Step 3: Update the gap checklist**

Edit `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` line 49 (`C7`): change `[ ]` to `[x]` and append a completion note, e.g.:

```markdown
- [x] **C7 — Configurable grace periods / business days.** ✅ **8 (C7).** Per-org `org_settings` (grace days, working-days set, follow-up cadence) + `org_holidays` calendar (migration 0016, `is_org_owner` write RLS). Pure `org-config.ts` (`resolveOrgConfig`/`DEFAULT_ORG_CONFIG`) composes defaults from `business-days.ts` + `follow-up-cadence.ts`; `addBusinessDays`/`nextWorkingDay` skip non-working days + holidays; `suggestFollowUpDate` takes per-org cadence. `loadOrgConfig` server reader wired into promise-create grace and the dashboard case build; drawer caption shows the per-org interval. No settings UI (deferred to Phase 9). Empty/impossible configs are CHECK-guarded + bounded-loop-throwing.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md
git commit -m "docs: mark C7 complete in gap checklist (Phase 8)"
```

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin phase8-c7-configurable-grace
gh pr create --title "feat(8/C7): configurable grace periods & business days" --body "Implements C7 per the design spec: per-org grace window, follow-up cadence, working-days, and holiday calendar. Engine + storage only; settings UI deferred to Phase 9."
```

---

## Self-Review Notes

- **Spec coverage:** §4 storage → Task 4; §5 config resolution → Task 3; §6 pure date logic → Tasks 1–2; §7 server plumbing → Tasks 5,6,8; §8 client/`CaseItem` → Tasks 7,9; §9 edge cases → Tasks 1 (bounded loop), 3 (empty working-days fallback), 4 (CHECKs); §10 testing → each task's tests + Task 10. All covered.
- **Type consistency:** `OrgConfig` fields (`promiseGraceDays`, `workingDays`, `holidays`, `cadenceDays`) are identical across Tasks 2,3,5,7,8. `addBusinessDays`/`nextWorkingDay` opts shape (`{ workingDays?, holidays? }`) is identical in Tasks 1,2,6. `suggestedFollowUpIntervalDays` named identically in Tasks 7,8,9.
- **Import cycle:** the only back-edge (`follow-up-cadence → org-config`) is type-only; verified by Task 3 Step 5 `tsc`.
- **Backward compat:** Task 1 keeps `addBusinessDays(date, n)` 2-arg calls valid; default-config orgs reproduce pre-C7 behavior (Task 6 Step 5 regression check).
