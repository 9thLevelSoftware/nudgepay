# NudgePay C7 — Configurable Grace Periods & Business Days (Design Spec)

**Created:** 2026-06-26
**Phase:** 8 (P1 throughput & consistency)
**Gap item:** C7 — "Configurable grace periods / business days. Prerequisite for B2 and the weekend/holiday promise scenario. Currently absent."
**Absorbs deferrals:** C4's "per-org cadence tuning + holiday calendar" and B2's "configurable grace + holiday calendar" were both explicitly deferred to C7.
**Builds on:** 6b promise/grace loop (`addBusinessDays`, `GRACE_BUSINESS_DAYS`, `grace_until`), C4 follow-up cadence (`follow-up-cadence.ts`, `CADENCE_DAYS`, `rollToWeekday`/`addCalendarDays` in `business-days.ts`), the bare `organizations` table (0001).

---

## 1. Problem

Three scheduling constants are hardcoded app-wide, identical for every org:

- **Promise grace window** — `GRACE_BUSINESS_DAYS = 2` (`business-days.ts`), applied at promise creation (`promise-create.server.ts:32`) to compute `grace_until`.
- **Follow-up cadence** — frozen `CADENCE_DAYS` (Critical 2 / High 3 / Medium 7 / Low 14, `follow-up-cadence.ts`).
- **Business-day definition** — Sat/Sun are the only non-working days; **no holiday awareness** anywhere.

Real collections teams differ: a longer grace window, a Saturday-working shop, regional holidays, a tighter or looser follow-up cadence. The "promise date on weekend/holiday" high-risk scenario (gap checklist section F) cannot be exercised because holidays don't exist in the model.

## 2. Goal

Make all three constants **per-org configurable**, and add a **per-org holiday calendar** that both business-day math (grace) and the follow-up weekend roll honor.

**Engine + storage only.** No settings/management UI in C7 — that belongs to Phase 9 (Connections & Settings, G1–G3). Orgs run on defaults; the editing surface lands in Phase 9 against the schema built here.

**Backward-compatible by construction:** an org with no `org_settings` row and no `org_holidays` rows behaves **exactly** as today. Defaults equal the current hardcoded values.

Non-goals (YAGNI): settings management UI (Phase 9); recurring/region holiday rule imports (explicit dated rows only); retroactive recompute of already-stored `grace_until` values; half-day or per-channel scheduling.

## 3. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Capabilities | All four: configurable grace, holiday calendar, working-days definition, per-org cadence tuning. |
| Delivery | Engine + per-org storage with code-applied defaults; **management UI deferred to Phase 9.** |
| Holiday storage | Dedicated `org_holidays` table (clean RLS + `unique(org_id, holiday_date)`), not a JSON column. |
| Scalar config storage | Dedicated `org_settings` table (1:1 with org), keeps `organizations` bare and leaves room to grow. |
| Row optionality | Both tables optional per org; absence ⇒ `DEFAULT_ORG_CONFIG`. |
| Default source of truth | `DEFAULT_ORG_CONFIG` references the existing `CADENCE_DAYS` / `GRACE_BUSINESS_DAYS`, which stay the canonical default values. |
| Purity | Date math stays pure: config is passed in. Only a thin `.server` loader touches the DB. |
| Drawer caption | Surface the per-org interval from the server (`CaseItem.suggestedFollowUpIntervalDays`); **drop the drawer's direct `CADENCE_DAYS` import** so the caption is per-org accurate. |
| Retroactivity | Config changes apply forward only. Existing `grace_until` values are untouched; live-computed suggestions reflect current config immediately. |
| Seeded holidays | None. No country assumed; empty calendar preserves current weekend-only behavior. |

## 4. Storage — migration `0016_org_scheduling_config.sql`

### `org_settings` (1:1 with org; row optional)
| Column | Type | Notes |
|---|---|---|
| `org_id` | `uuid` PK | `references organizations(id) on delete cascade` |
| `promise_grace_days` | `int not null default 2` | `check (promise_grace_days >= 0)` |
| `working_days` | `int[] not null default '{1,2,3,4,5}'` | weekday numbers, 0=Sun … 6=Sat; `check (array_length(working_days,1) >= 1)` |
| `cadence_critical` | `int not null default 2` | `check (> 0)` |
| `cadence_high` | `int not null default 3` | `check (> 0)` |
| `cadence_medium` | `int not null default 7` | `check (> 0)` |
| `cadence_low` | `int not null default 14` | `check (> 0)` |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | |

### `org_holidays` (per-org list)
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `org_id` | `uuid not null` | `references organizations(id) on delete cascade` |
| `holiday_date` | `date not null` | |
| `label` | `text` | optional human label |
| `created_at` | `timestamptz not null default now()` | |
| | | `unique (org_id, holiday_date)` |

### RLS (migration adds policies, mirroring existing `is_org_member` pattern)
- **SELECT:** any org member (`is_org_member(org_id)`).
- **INSERT / UPDATE / DELETE:** org owners only (role check), even though the editing UI is Phase 9 — so seed scripts and Phase 9 work need no further migration.

No rows are seeded for any org. Behavior is identical to pre-C7.

## 5. Config resolution (pure) — `app/lib/org-config.ts`

```ts
export type OrgConfig = {
  promiseGraceDays: number;
  workingDays: ReadonlySet<number>;   // 0–6
  holidays: ReadonlySet<string>;      // YYYY-MM-DD
  cadenceDays: Readonly<Record<PriorityLevel, number>>;
};

export const DEFAULT_ORG_CONFIG: OrgConfig; // grace 2, {1..5}, {}, CADENCE_DAYS

export function resolveOrgConfig(
  settings: OrgSettingsRow | null,
  holidays: { holiday_date: string }[],
): OrgConfig;
```

`resolveOrgConfig` fills every missing piece from `DEFAULT_ORG_CONFIG`. A defensively-empty `working_days` (should be blocked by the CHECK) falls back to the default working set so the date loops can never hang.

## 6. Pure date logic — `business-days.ts`, `follow-up-cadence.ts`

Functions take the relevant config slice and stay pure (no I/O):

- `addBusinessDays(dateISO, n, opts: { workingDays, holidays })` — advance, counting only days that are working **and** not holidays.
- `nextWorkingDay(dateISO, opts: { workingDays, holidays })` — generalizes `rollToWeekday`: roll forward to the first working, non-holiday day (weekday unchanged if already valid). Weekend-only behavior is just the default working set with an empty holiday set.
- `addCalendarDays(dateISO, n)` — unchanged (pure calendar add).
- `suggestFollowUpDate({ level, today, config })` → `nextWorkingDay(addCalendarDays(today, config.cadenceDays[level]), config)`; returns `{ date, intervalDays }` where `intervalDays = config.cadenceDays[level]`.

**Safety:** both `addBusinessDays` and `nextWorkingDay` cap their advance loop (≤ 366 iterations) and throw a clear error if no working/non-holiday day is found within a year, rather than looping forever.

**Back-compat:** existing exported constants `GRACE_BUSINESS_DAYS` and `CADENCE_DAYS` remain (now consumed by `DEFAULT_ORG_CONFIG`). The old `rollToWeekday` is replaced by `nextWorkingDay` with the default config; call sites and tests updated.

## 7. Server plumbing

- **`app/lib/org-config.server.ts`** — `loadOrgConfig(client, orgId): Promise<OrgConfig>`: one read of `org_settings` (maybe-single) + `org_holidays`, resolved via the pure `resolveOrgConfig`.
- **`promise-create.server.ts`** — load config; `grace_until = addBusinessDays(promisedDate, config.promiseGraceDays, config)`.
- **Dashboard loader (`dashboard.tsx`)** — `loadOrgConfig(...)` once; thread `config` into `buildCaseItems(...)`.
- **`buildCaseItems`** — gains a `config: OrgConfig` parameter; computes `suggestedFollowUpAt` and `suggestedFollowUpIntervalDays` via `suggestFollowUpDate({ level: effectiveLevel, today, config })`.

## 8. Client

- **`CaseItem`** gains `suggestedFollowUpIntervalDays: number`.
- **`LogContactDrawer`** renders the caption from `selected.suggestedFollowUpIntervalDays` and `selected.effectiveLevel`; **removes the `import { CADENCE_DAYS }`**. No other drawer change (still pre-filled + editable).

## 9. Edge cases

- **Empty `working_days`** — blocked by CHECK; `resolveOrgConfig` also falls back to default; loops are bounded regardless.
- **Holiday landing on every near-term day** — bounded loop throws after ~366 iterations (operator misconfiguration surfaced as an error, not a hang).
- **`promise_grace_days = 0`** — allowed; the promise date itself is the deadline.
- **A holiday on a non-working day** — harmless; it's redundantly skipped.
- **Existing promises** — `grace_until` already stored; not recomputed.

## 10. Testing (TDD)

- **`org-config.test.ts`** (new) — `resolveOrgConfig`: null settings ⇒ defaults; partial overrides; holiday set built from rows; empty `working_days` fallback.
- **`business-days.test.ts`** (extend) — holiday skipping in `addBusinessDays`; Saturday-working set; `nextWorkingDay` rolls over a holiday-then-weekend; bounded-loop guard throws on impossible config.
- **`follow-up-cadence.test.ts`** (extend) — per-org cadence override changes the suggested date; holiday roll; `intervalDays` reflects the org value.
- **`cases.test.ts`** (extend) — `suggestedFollowUpAt` and `suggestedFollowUpIntervalDays` reflect the passed config (override + custom cadence).
- **promise-create / promise-evaluation** — `grace_until` honors per-org grace days and holidays.

## 11. Out of scope (deferred)

- Settings management UI → **Phase 9** (G1–G3).
- Recurring / region holiday rule imports (only explicit dated rows now).
- Retroactive recompute of stored `grace_until`.
- Half-day, per-channel, or per-rep scheduling.
