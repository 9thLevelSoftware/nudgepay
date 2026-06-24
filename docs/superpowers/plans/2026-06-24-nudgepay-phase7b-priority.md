# NudgePay Phase 7b — Multi-factor, Override-able Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the age-only, invisible priority with a multi-factor weighted score (age + balance + broken-promise + silence + follow-up-due) that derives the existing 4 levels, add a transparent manual level-override on each case, and surface both in the queue and DetailPanel.

**Architecture:** A new pure module `app/lib/priority.ts` owns the scorer, weights, thresholds, factor breakdown, and override→level resolution (mirrors how 7a isolated `timeline.ts`). `cases.ts` calls it from `buildCaseItems` and orders by effective level. One migration adds override columns to `collection_cases`; a dedicated `api.priority-override.tsx` resource route writes them (the codebase routes every case mutation through its own `api.*` route). The queue row gains an effective-level badge; the DetailPanel gains a "Why this priority" breakdown + override control.

**Tech Stack:** React Router 7, TypeScript 5.9, Supabase (Postgres + RLS), Tailwind v4, Vitest 4. Cloudflare Workers runtime.

## Global Constraints

- **Pure modules** (`app/lib/*.ts` without `.server`): no I/O, no `node:*`, no secrets — they ship in the client bundle and are imported by tests. `priority.ts` must obey this. (`new Date()` is allowed only in `.server`/route code, never in `priority.ts`.)
- **Tailwind v4:** class names must be **static literal strings** — no `text-${x}` interpolation. New color/badge classes go in literal `Record<string,string>` maps.
- **RLS boundary:** dashboard reads and the override write use the **user client** (`requireUser`), never the service client. Service client is only for connection status + member roster.
- **No `.server` import from client code:** `priority.ts`, `cases.ts`, and components stay pure-client-safe.
- **Backward compatibility:** keep the existing `Priority` shape (`level`/`tone`/`reason`/`rank`); leave `worklist.ts` and `tests/worklist.test.ts` untouched (legacy invoice path). New `CaseRow`/`buildCaseItems` additions must be optional/defaulted so existing `cases.test.ts` and `dashboard-worklist.test.ts` call sites still compile.
- **Override enum stored lowercase** (`'critical'|'high'|'medium'|'low'`), matching `status`/`exception_reason` conventions; mapped to/from PascalCase `PriorityLevel` in `priority.ts`.
- **Commands:** tests `npx vitest run`; types `npx tsc -b`; build `npx react-router build`; DB (local) `npx supabase db reset` applies all migrations. Run all from `nudgepay-app/`.

---

### Task 1: Pure priority scorer (`app/lib/priority.ts`)

**Files:**
- Create: `nudgepay-app/app/lib/priority.ts`
- Test: `nudgepay-app/tests/priority.test.ts`

**Interfaces:**
- Consumes: `HIGH_VALUE_THRESHOLD`, `type HeatBand`, `type Priority` from `./worklist`.
- Produces:
  - `type PriorityLevel = "Critical" | "High" | "Medium" | "Low"`
  - `type PriorityOverrideLevel = "critical" | "high" | "medium" | "low"`
  - `type PriorityFactor = { key: string; label: string; points: number }`
  - `type PriorityFactorInput = { ageDays: number; balance: number; brokenPromise: boolean; daysSinceContact: number | null; followUpDue: boolean }`
  - `type ScoredPriority = { score: number; level: PriorityLevel; tone: HeatBand; rank: number; reason: string; factors: PriorityFactor[] }`
  - `function scorePriority(input: PriorityFactorInput): ScoredPriority`
  - `function levelToRank(level: PriorityLevel): number`
  - `function overrideToLevel(o: PriorityOverrideLevel | null): PriorityLevel | null`

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/priority.test.ts`:

```ts
import { expect, test } from "vitest";
import { scorePriority, levelToRank, overrideToLevel } from "../app/lib/priority";

// --- factor bucket boundaries ---
test("age buckets: 0 contributes nothing, 1-29 -> 8, then 30/60/90", () => {
  const base = { balance: 0, brokenPromise: false, daysSinceContact: 0, followUpDue: false };
  const age = (d: number) => scorePriority({ ...base, ageDays: d }).factors.find((f) => f.key === "age")?.points;
  expect(age(0)).toBeUndefined();
  expect(age(1)).toBe(8);
  expect(age(29)).toBe(8);
  expect(age(30)).toBe(20);
  expect(age(60)).toBe(32);
  expect(age(90)).toBe(45);
});

test("balance buckets step at 1k/5k/10k/25k; zero balance contributes nothing", () => {
  const base = { ageDays: 0, brokenPromise: false, daysSinceContact: 0, followUpDue: false };
  const bal = (b: number) => scorePriority({ ...base, balance: b }).factors.find((f) => f.key === "balance")?.points;
  expect(bal(0)).toBeUndefined();
  expect(bal(999)).toBe(2);
  expect(bal(1000)).toBe(6);
  expect(bal(5000)).toBe(12);
  expect(bal(10000)).toBe(18);
  expect(bal(25000)).toBe(25);
});

test("silence buckets step at 7/14/30; never-contacted (null) is max silence", () => {
  const base = { ageDays: 0, balance: 0, brokenPromise: false, followUpDue: false };
  const sil = (d: number | null) => scorePriority({ ...base, daysSinceContact: d }).factors.find((f) => f.key === "silence")?.points;
  expect(sil(6)).toBeUndefined();
  expect(sil(7)).toBe(5);
  expect(sil(14)).toBe(10);
  expect(sil(30)).toBe(15);
  expect(sil(null)).toBe(15);
});

test("broken promise (+25) and follow-up-due (+12) are additive", () => {
  const base = { ageDays: 0, balance: 0, daysSinceContact: 0 };
  expect(scorePriority({ ...base, brokenPromise: true, followUpDue: false }).score).toBe(25);
  expect(scorePriority({ ...base, brokenPromise: false, followUpDue: true }).score).toBe(12);
  expect(scorePriority({ ...base, brokenPromise: true, followUpDue: true }).score).toBe(37);
});

// --- score → level thresholds ---
test("level thresholds at 25/50/80", () => {
  // craft scores precisely via factors: age gives 8/20/32/45, balance 2..25, etc.
  const low = scorePriority({ ageDays: 1, balance: 0, brokenPromise: false, daysSinceContact: 0, followUpDue: false }); // 8
  expect(low.level).toBe("Low");
  const medium = scorePriority({ ageDays: 30, balance: 1000, brokenPromise: false, daysSinceContact: 0, followUpDue: false }); // 20+6=26
  expect(medium.level).toBe("Medium");
  const high = scorePriority({ ageDays: 90, balance: 0, brokenPromise: false, daysSinceContact: 7, followUpDue: false }); // 45+5=50
  expect(high.level).toBe("High");
  const critical = scorePriority({ ageDays: 90, balance: 10000, brokenPromise: true, daysSinceContact: 0, followUpDue: false }); // 45+18+25=88
  expect(critical.level).toBe("Critical");
});

test("factors are non-zero contributors sorted by points descending; reason joins the top two", () => {
  const s = scorePriority({ ageDays: 92, balance: 12000, brokenPromise: true, daysSinceContact: 30, followUpDue: true });
  expect(s.factors.map((f) => f.points)).toEqual([...s.factors.map((f) => f.points)].sort((a, b) => b - a));
  expect(s.factors.every((f) => f.points > 0)).toBe(true);
  expect(s.factors.find((f) => f.key === "silence")?.label).toBe("30 days since contact");
  expect(s.factors.find((f) => f.key === "age")?.label).toBe("92 days overdue");
  expect(s.reason).toContain(s.factors[0].label);
});

test("empty factor set yields Low score 0 with 'Not yet due' reason", () => {
  const s = scorePriority({ ageDays: 0, balance: 0, brokenPromise: false, daysSinceContact: 0, followUpDue: false });
  expect(s.score).toBe(0);
  expect(s.level).toBe("Low");
  expect(s.factors).toEqual([]);
  expect(s.reason).toBe("Not yet due");
});

// --- override mapping ---
test("levelToRank orders Critical<High<Medium<Low", () => {
  expect(levelToRank("Critical")).toBe(0);
  expect(levelToRank("High")).toBe(1);
  expect(levelToRank("Medium")).toBe(2);
  expect(levelToRank("Low")).toBe(3);
});

test("overrideToLevel maps lowercase enum to PascalCase, null passes through", () => {
  expect(overrideToLevel("critical")).toBe("Critical");
  expect(overrideToLevel("low")).toBe("Low");
  expect(overrideToLevel(null)).toBe(null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/priority.test.ts`
Expected: FAIL — `Cannot find module '../app/lib/priority'` (file not created yet).

- [ ] **Step 3: Write the implementation**

Create `nudgepay-app/app/lib/priority.ts`:

```ts
// Pure multi-factor priority scoring. No I/O, no node:*, no .server suffix —
// imported by cases.ts and by tests. Weights are named constants here; full
// configurability (per-org tuning) is deferred to C7.

import { HIGH_VALUE_THRESHOLD, type HeatBand, type Priority } from "./worklist";

export type PriorityLevel = Priority["level"]; // "Critical" | "High" | "Medium" | "Low"
export type PriorityOverrideLevel = "critical" | "high" | "medium" | "low";
export type PriorityFactor = { key: string; label: string; points: number };

export type PriorityFactorInput = {
  ageDays: number;
  balance: number;
  brokenPromise: boolean;
  daysSinceContact: number | null; // null = never contacted (treated as max silence)
  followUpDue: boolean;
};

export type ScoredPriority = {
  score: number;
  level: PriorityLevel;
  tone: HeatBand;
  rank: number;
  reason: string;
  factors: PriorityFactor[]; // non-zero contributors, descending by points
};

// --- weights (named constants) ---
function agePoints(ageDays: number): number {
  if (ageDays >= 90) return 45;
  if (ageDays >= 60) return 32;
  if (ageDays >= 30) return 20;
  if (ageDays >= 1) return 8;
  return 0;
}
function balancePoints(balance: number): number {
  if (balance >= 25_000) return 25;
  if (balance >= 10_000) return 18;
  if (balance >= HIGH_VALUE_THRESHOLD) return 12; // 5000
  if (balance >= 1_000) return 6;
  if (balance > 0) return 2;
  return 0;
}
const BROKEN_PROMISE_POINTS = 25;
function silencePoints(daysSinceContact: number | null): number {
  if (daysSinceContact === null) return 15; // never contacted = max silence
  if (daysSinceContact >= 30) return 15;
  if (daysSinceContact >= 14) return 10;
  if (daysSinceContact >= 7) return 5;
  return 0;
}
const FOLLOW_UP_DUE_POINTS = 12;

// --- level thresholds ---
function levelOf(score: number): { level: PriorityLevel; tone: HeatBand; rank: number } {
  if (score >= 80) return { level: "Critical", tone: "hot", rank: 0 };
  if (score >= 50) return { level: "High", tone: "warm", rank: 1 };
  if (score >= 25) return { level: "Medium", tone: "warm", rank: 2 };
  return { level: "Low", tone: "cool", rank: 3 };
}

export function levelToRank(level: PriorityLevel): number {
  return level === "Critical" ? 0 : level === "High" ? 1 : level === "Medium" ? 2 : 3;
}

const OVERRIDE_TO_LEVEL: Record<PriorityOverrideLevel, PriorityLevel> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low",
};
export function overrideToLevel(o: PriorityOverrideLevel | null): PriorityLevel | null {
  return o ? OVERRIDE_TO_LEVEL[o] : null;
}

export function scorePriority(input: PriorityFactorInput): ScoredPriority {
  const factors: PriorityFactor[] = [];

  const ageP = agePoints(input.ageDays);
  if (ageP > 0) factors.push({ key: "age", label: `${input.ageDays} days overdue`, points: ageP });

  const balP = balancePoints(input.balance);
  if (balP > 0) factors.push({ key: "balance", label: "Balance", points: balP });

  if (input.brokenPromise) factors.push({ key: "broken", label: "Broken promise", points: BROKEN_PROMISE_POINTS });

  const silP = silencePoints(input.daysSinceContact);
  if (silP > 0) factors.push({
    key: "silence",
    label: input.daysSinceContact === null ? "Never contacted" : `${input.daysSinceContact} days since contact`,
    points: silP,
  });

  if (input.followUpDue) factors.push({ key: "followup", label: "Follow-up due", points: FOLLOW_UP_DUE_POINTS });

  factors.sort((a, b) => b.points - a.points);
  const score = factors.reduce((s, f) => s + f.points, 0);
  const { level, tone, rank } = levelOf(score);
  const reason = factors.length ? factors.slice(0, 2).map((f) => f.label).join(", ") : "Not yet due";
  return { score, level, tone, rank, reason, factors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/priority.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/priority.ts nudgepay-app/tests/priority.test.ts
git commit -m "feat(priority): pure multi-factor scorer + override resolution (7b)"
```

---

### Task 2: Wire the scorer into `cases.ts`

**Files:**
- Modify: `nudgepay-app/app/lib/cases.ts`
- Test: `nudgepay-app/tests/cases.test.ts` (extend)

**Interfaces:**
- Consumes: `scorePriority`, `levelToRank`, `overrideToLevel`, `type PriorityLevel`, `type PriorityOverrideLevel`, `type PriorityFactor` from `./priority`; existing `ageInDays`, `heatOf`, `HIGH_VALUE_THRESHOLD` from `./worklist`.
- Produces (new `CaseItem` fields, additive): `score: number`, `factors: PriorityFactor[]`, `effectiveLevel: PriorityLevel`, `priorAttempts: number`, `override: { level: PriorityLevel; reason: string | null; by: string | null; at: string | null } | null`. New **optional** `CaseRow` fields: `priorityOverride?`, `priorityOverrideReason?`, `priorityOverrideBy?`, `priorityOverrideAt?`.

> **Note (refines the spec):** `priorAttempts` is derived from the `lastContacts` list length per case (the loader already pushes one entry per contact_log + per outbound SMS — exactly "logs + outbound SMS"). No new `buildCaseItems` parameter and no `buildCaseData`/`dashboard-worklist.test.ts` change is needed.

- [ ] **Step 1: Write the failing test**

Append to `nudgepay-app/tests/cases.test.ts`:

```ts
import { scorePriority } from "../app/lib/priority";

test("buildCaseItems scores via scorePriority and exposes score/factors/effectiveLevel", () => {
  // Acme: oldest 113d, total 6300, never contacted -> age45 + balance12 + silence15 = 72 -> High
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, [], [], TODAY, LABELS);
  const acme = items.find((c) => c.customerId === "c1")!;
  expect(acme.score).toBe(72);
  expect(acme.priority.level).toBe("High");
  expect(acme.effectiveLevel).toBe("High"); // no override
  expect(acme.factors.map((f) => f.key)).toContain("age");
  expect(acme.override).toBe(null);
});

test("buildCaseItems derives priorAttempts from the per-case contact count", () => {
  const lastContacts: CaseLastContactInput[] = [
    { caseId: "case-1", date: "2026-06-10T00:00:00Z", channel: "Text" },
    { caseId: "case-1", date: "2026-06-17T00:00:00Z", channel: "Email" },
    { caseId: "case-1", date: "2026-06-19T00:00:00Z", channel: "Text" },
  ];
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, lastContacts, [], TODAY, LABELS);
  expect(items.find((c) => c.caseId === "case-1")!.priorAttempts).toBe(3);
  expect(items.find((c) => c.caseId === "case-2")!.priorAttempts).toBe(0);
});

test("an override pins the effective level while leaving the computed score intact", () => {
  const cases: CaseRow[] = [
    { id: "case-1", customerId: "c1", status: "working", nextActionType: "follow_up", nextActionAt: "2026-06-20",
      exceptionReason: null, exceptionNote: null,
      priorityOverride: "critical", priorityOverrideReason: "CEO escalation",
      priorityOverrideBy: "u1", priorityOverrideAt: "2026-06-24T00:00:00Z" },
  ];
  const items = buildCaseItems(cases, INVOICES, CUSTOMERS, [], [], TODAY, LABELS);
  const c = items[0];
  expect(c.priority.level).toBe("High");     // computed unchanged
  expect(c.effectiveLevel).toBe("Critical"); // pinned up
  expect(c.override).toEqual({ level: "Critical", reason: "CEO escalation", by: "u1", at: "2026-06-24T00:00:00Z" });
});

test("sortCaseItems recommended orders by effective level, then score, then priorAttempts", () => {
  // c2 pinned to critical should lead despite a lower computed score than c1.
  const cases: CaseRow[] = [
    { id: "case-1", customerId: "c1", status: "working", nextActionType: "follow_up", nextActionAt: "2026-06-20", exceptionReason: null, exceptionNote: null },
    { id: "case-2", customerId: "c2", status: "new", nextActionType: "contact", nextActionAt: "2026-06-25", exceptionReason: null, exceptionNote: null,
      priorityOverride: "critical", priorityOverrideReason: null, priorityOverrideBy: null, priorityOverrideAt: null },
  ];
  const items = buildCaseItems(cases, INVOICES, CUSTOMERS, [], [], TODAY, LABELS);
  expect(sortCaseItems(items, "recommended").map((c) => c.customerId)).toEqual(["c2", "c1"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: FAIL — `score`/`effectiveLevel`/`priorAttempts`/`override` undefined; `priorityOverride` not assignable to `CaseRow`.

- [ ] **Step 3: Implement the changes**

In `nudgepay-app/app/lib/cases.ts`:

1. Replace the `priorityOf` import. Change the `./worklist` import block to drop `priorityOf` and add the priority imports below it:

```ts
import {
  heatOf, ageInDays, HIGH_VALUE_THRESHOLD,
  type Heat, type Priority, type LastContact, type Metric, type Metrics,
  type ViewId, type SortId, type InvoiceInput, type CustomerInput,
} from "./worklist";
import {
  scorePriority, levelToRank, overrideToLevel,
  type PriorityLevel, type PriorityOverrideLevel, type PriorityFactor,
} from "./priority";
```

2. Extend `CaseRow` with the optional override fields:

```ts
export type CaseRow = {
  id: string;
  customerId: string;
  status: CaseStatus;
  nextActionType: NextActionType | null;
  nextActionAt: string | null;
  exceptionReason: ExceptionReason | null;
  exceptionNote: string | null;
  priorityOverride?: PriorityOverrideLevel | null;
  priorityOverrideReason?: string | null;
  priorityOverrideBy?: string | null;
  priorityOverrideAt?: string | null;
};
```

3. Extend `CaseItem` with the new fields (add after `priority: Priority;`):

```ts
  priority: Priority;
  score: number;
  factors: PriorityFactor[];
  effectiveLevel: PriorityLevel;
  priorAttempts: number;
  override: { level: PriorityLevel; reason: string | null; by: string | null; at: string | null } | null;
```

4. In `buildCaseItems`, count attempts in the existing last-contact loop. Replace the `lastByCase` loop with:

```ts
  // Most-recent contact per CASE (max-by-date) and attempt count per case.
  const lastByCase = new Map<string, CaseLastContactInput>();
  const attemptsByCase = new Map<string, number>();
  for (const lc of lastContacts) {
    attemptsByCase.set(lc.caseId, (attemptsByCase.get(lc.caseId) ?? 0) + 1);
    const prev = lastByCase.get(lc.caseId);
    if (!prev || lc.date > prev.date) lastByCase.set(lc.caseId, lc);
  }
```

5. Inside the `cases.map((cse) => { ... })` body, after `const prom = promiseByCase.get(cse.id) ?? null;`, compute the score and override:

```ts
    const daysSinceContact = lc ? ageInDays(lc.date, today) : null;
    const scored = scorePriority({
      ageDays: oldestAgeDays,
      balance: totalOverdue,
      brokenPromise: prom?.status === "broken",
      daysSinceContact,
      followUpDue,
    });
    const overrideLevel = overrideToLevel(cse.priorityOverride ?? null);
    const priorAttempts = attemptsByCase.get(cse.id) ?? 0;
```

6. In the returned object, replace `priority: priorityOf(oldestAgeDays, neverContacted),` with:

```ts
      priority: { level: scored.level, tone: scored.tone, reason: scored.reason, rank: scored.rank },
      score: scored.score,
      factors: scored.factors,
      effectiveLevel: overrideLevel ?? scored.level,
      priorAttempts,
      override: overrideLevel
        ? { level: overrideLevel, reason: cse.priorityOverrideReason ?? null, by: cse.priorityOverrideBy ?? null, at: cse.priorityOverrideAt ?? null }
        : null,
```

7. Update the `recommended` branch of `sortCaseItems` (the final `return`):

```ts
  return copy.sort((a, b) =>
    levelToRank(a.effectiveLevel) - levelToRank(b.effectiveLevel)
    || b.score - a.score
    || b.priorAttempts - a.priorAttempts
    || b.oldestAgeDays - a.oldestAgeDays
    || b.totalOverdue - a.totalOverdue);
```

> `neverContacted` is no longer read (silence is derived from `daysSinceContact`). If TypeScript/lint flags `neverContacted` as unused after this edit, delete the `const neverContacted = !lc;` line.

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts && npx tsc -b`
Expected: PASS — new + existing `cases.test.ts` cases green (existing "orders by priority rank" still yields `["c1","c2"]`), no type errors.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/cases.ts nudgepay-app/tests/cases.test.ts
git commit -m "feat(priority): score cases multi-factor + effective-level sort (7b)"
```

---

### Task 3: Migration — override columns on `collection_cases`

**Files:**
- Create: `nudgepay-app/supabase/migrations/0012_priority_override.sql`

**Interfaces:**
- Produces: four columns on `collection_cases` consumed by the loader (Task 5) and route (Task 4): `priority_override`, `priority_override_reason`, `priority_override_by`, `priority_override_at`.

- [ ] **Step 1: Write the migration**

Create `nudgepay-app/supabase/migrations/0012_priority_override.sql`:

```sql
-- Phase 7b: manual priority override on collection cases.
-- The override pins the EFFECTIVE level (up or down); the computed multi-factor
-- score is unaffected and still shown. Override never touches financial data.
alter table collection_cases
  add column priority_override text
    check (priority_override in ('critical','high','medium','low')),
  add column priority_override_reason text,
  add column priority_override_by uuid,
  add column priority_override_at timestamptz;
```

- [ ] **Step 2: Apply the migration and verify it lands**

Run: `cd nudgepay-app && npx supabase db reset`
Expected: all migrations `0001`–`0012` apply with no error; output ends with the reset completing successfully.

- [ ] **Step 3: Confirm existing DB-backed tests still pass**

Run: `cd nudgepay-app && npx vitest run tests/cases-rls.test.ts`
Expected: PASS (the schema change is additive; RLS on `collection_cases` is unchanged).

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/supabase/migrations/0012_priority_override.sql
git commit -m "feat(priority): add priority override columns to collection_cases (7b)"
```

---

### Task 4: Override write route (`api.priority-override.tsx`)

**Files:**
- Create: `nudgepay-app/app/routes/api.priority-override.tsx`
- Test: `nudgepay-app/tests/api-priority-override.test.ts`

**Interfaces:**
- Consumes: `getEnv`, `requireUser`, `resolveOrg`, `safeReturnTo` (existing server libs); the `0012` columns (Task 3).
- Produces: a POST action accepting form fields `caseId`, `level` (`critical|high|medium|low`, or empty/invalid = clear), `reason` (optional), `returnTo`. Sets the four override columns on the user client; redirects to `returnTo`.

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/api-priority-override.test.ts`:

```ts
import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

// Mirrors the RLS + guard paths the /api/priority-override action relies on.
test("a member sets and clears a priority override on an own-org case via RLS", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Override Org A" }).select("id").single();
  const orgId = org!.id;
  const a = await makeUserClient("override-a@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: a.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "ov-c1", name: "Override Co" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();

  // set
  await a.client.from("collection_cases").update({
    priority_override: "critical", priority_override_reason: "CEO escalation",
    priority_override_by: a.userId, priority_override_at: new Date().toISOString(),
  }).eq("id", cse!.id);
  let { data: after } = await svc.from("collection_cases")
    .select("priority_override, priority_override_reason, priority_override_by").eq("id", cse!.id).single();
  expect(after!.priority_override).toBe("critical");
  expect(after!.priority_override_reason).toBe("CEO escalation");
  expect(after!.priority_override_by).toBe(a.userId);

  // clear
  await a.client.from("collection_cases").update({
    priority_override: null, priority_override_reason: null, priority_override_by: null, priority_override_at: null,
  }).eq("id", cse!.id);
  ({ data: after } = await svc.from("collection_cases")
    .select("priority_override, priority_override_reason, priority_override_by").eq("id", cse!.id).single());
  expect(after!.priority_override).toBe(null);
});

test("a member of another org cannot override the case (RLS blocks)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Override Org B" }).select("id").single();
  const orgId = org!.id;
  const owner = await makeUserClient("override-owner@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "ovb-c1", name: "Private Co" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();

  const outsider = await makeUserClient("override-outsider@example.com"); // no membership in Org B
  await outsider.client.from("collection_cases").update({ priority_override: "low" }).eq("id", cse!.id);
  const { data: after } = await svc.from("collection_cases").select("priority_override").eq("id", cse!.id).single();
  expect(after!.priority_override).toBe(null); // unchanged — RLS blocked it
});

test("the check constraint rejects an invalid level", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Override Org C" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "ovc-c1", name: "C Co" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();

  const { error } = await svc.from("collection_cases").update({ priority_override: "urgent" }).eq("id", cse!.id);
  expect(error).not.toBeNull(); // check constraint violation
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/api-priority-override.test.ts`
Expected: PASS for the RLS/constraint cases **only if Task 3 ran** — but the route file does not exist yet. (These tests exercise the DB contract the route relies on; they pass once `0012` is applied. If any fail, Task 3 was not applied — run `npx supabase db reset`.)

> The route action itself has no unit harness in this codebase (consistent with `api-assign.test.ts`, which tests the RLS/guard contract, not the handler). Proceed to create the route so the UI in Tasks 6–7 can post to it.

- [ ] **Step 3: Create the route**

Create `nudgepay-app/app/routes/api.priority-override.tsx`:

```tsx
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";

const LEVELS = ["critical", "high", "medium", "low"] as const;

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const caseId = typeof form.get("caseId") === "string" ? (form.get("caseId") as string) : "";
  if (!caseId) return redirect(returnTo, { headers });

  // Cross-org guard: the RLS user client only sees own-org cases.
  const { data: cse } = await supabase
    .from("collection_cases").select("id").eq("id", caseId).maybeSingle();
  if (!cse) return redirect(returnTo, { headers });

  const levelRaw = form.get("level");
  const level = typeof levelRaw === "string" && (LEVELS as readonly string[]).includes(levelRaw)
    ? levelRaw : null; // anything else (incl. empty) = clear
  const reasonRaw = form.get("reason");
  const reason = level && typeof reasonRaw === "string" && reasonRaw.trim().length > 0
    ? reasonRaw.trim().slice(0, 280) : null;

  await supabase.from("collection_cases").update({
    priority_override: level,
    priority_override_reason: reason,
    priority_override_by: level ? user.id : null,
    priority_override_at: level ? new Date().toISOString() : null,
  }).eq("id", caseId);

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/api-priority-override.test.ts && npx tsc -b`
Expected: PASS — all three DB-contract cases green; no type errors.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/routes/api.priority-override.tsx nudgepay-app/tests/api-priority-override.test.ts
git commit -m "feat(priority): add priority-override resource route + RLS contract tests (7b)"
```

---

### Task 5: Loader wiring (`dashboard.tsx`)

**Files:**
- Modify: `nudgepay-app/app/routes/dashboard.tsx`

**Interfaces:**
- Consumes: the `0012` columns (Task 3); the extended `CaseRow` (Task 2).
- Produces: `CaseRow[]` carrying the four override fields into `buildCaseData` → `buildCaseItems`. No new query (attempts derived in `cases.ts`); `buildCaseData` signature unchanged.

- [ ] **Step 1: Extend the raw case row type**

In `dashboard.tsx`, update `CaseRowRaw` (around line 108) to include the override columns:

```ts
type CaseRowRaw = {
  id: string;
  customer_id: string;
  status: string;
  next_action_type: string | null;
  next_action_at: string | null;
  exception_reason: string | null;
  exception_note: string | null;
  priority_override: string | null;
  priority_override_reason: string | null;
  priority_override_by: string | null;
  priority_override_at: string | null;
};
```

- [ ] **Step 2: Select and map the override columns**

In the open-cases query (around line 276), extend the `.select(...)` and the mapping. Add the import for the override level type at the top with the other `cases` imports:

```ts
import {
  buildCaseItems, applyCaseView, sortCaseItems, computeCaseMetrics,
  type CaseItem, type CaseRow, type CaseStatus, type NextActionType,
  type CasePromiseInput, type CaseLastContactInput,
} from "../lib/cases";
import type { PriorityOverrideLevel } from "../lib/priority";
```

Replace the query + mapping:

```ts
    const { data: caseRows } = await supabase
      .from("collection_cases")
      .select("id, customer_id, status, next_action_type, next_action_at, exception_reason, exception_note, priority_override, priority_override_reason, priority_override_by, priority_override_at")
      .eq("org_id", org.org_id)
      .is("closed_at", null);
    const cases: CaseRow[] = ((caseRows as CaseRowRaw[]) ?? []).map((r) => ({
      id: r.id, customerId: r.customer_id, status: r.status as CaseStatus,
      nextActionType: r.next_action_type as NextActionType | null, nextActionAt: r.next_action_at,
      exceptionReason: r.exception_reason as ExceptionReason | null, exceptionNote: r.exception_note,
      priorityOverride: (r.priority_override as PriorityOverrideLevel | null) ?? null,
      priorityOverrideReason: r.priority_override_reason,
      priorityOverrideBy: r.priority_override_by,
      priorityOverrideAt: r.priority_override_at,
    }));
```

- [ ] **Step 3: Verify build + full suite**

Run: `cd nudgepay-app && npx tsc -b && npx react-router build && npx vitest run`
Expected: type-clean, build clean, full suite green.

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/routes/dashboard.tsx
git commit -m "feat(priority): load case override columns into the queue (7b)"
```

---

### Task 6: Effective-level badge in the queue (`WorkQueue.tsx`)

**Files:**
- Modify: `nudgepay-app/app/components/WorkQueue.tsx`

**Interfaces:**
- Consumes: `CaseItem.effectiveLevel` and `CaseItem.override` (Task 2).

- [ ] **Step 1: Add a static level→badge class map**

After the `STATUS_LABEL` map (around line 20) add:

```tsx
// Static effective-level → badge classes (Tailwind v4 needs literal strings).
const LEVEL_BADGE: Record<string, string> = {
  Critical: "bg-hot/10 text-hot",
  High: "bg-warm/10 text-warm",
  Medium: "bg-warm/5 text-warm",
  Low: "bg-cool/10 text-cool",
};
```

- [ ] **Step 2: Render the badge in the desktop row**

In `QueueRow`, inside the Customer cell (replace the existing `{/* Customer */}` span block at lines 116–119):

```tsx
      {/* Customer */}
      <span data-label="Customer" className="min-w-0">
        <span className="block font-sans text-text truncate">{item.customerName}</span>
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-muted">{item.invoiceCount} invoice(s)</span>
          <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold ${LEVEL_BADGE[item.effectiveLevel] ?? "text-muted"}`}>
            {item.override ? <span aria-hidden>📌</span> : null}
            {item.effectiveLevel}
          </span>
        </span>
      </span>
```

- [ ] **Step 3: Render the badge in the mobile card**

In `MobileCard`, replace the customer name block (lines 210–213) with:

```tsx
          <div className="min-w-0">
            <p className="font-sans text-text font-medium truncate">{item.customerName}</p>
            <p className="flex items-center gap-1.5">
              <span className="font-mono text-xs text-muted">{item.invoiceCount} invoice(s)</span>
              <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold ${LEVEL_BADGE[item.effectiveLevel] ?? "text-muted"}`}>
                {item.override ? <span aria-hidden>📌</span> : null}
                {item.effectiveLevel}
              </span>
            </p>
          </div>
```

- [ ] **Step 4: Verify build**

Run: `cd nudgepay-app && npx tsc -b && npx react-router build`
Expected: type-clean, build clean.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/components/WorkQueue.tsx
git commit -m "feat(priority): effective-level badge + override marker in queue (7b)"
```

---

### Task 7: "Why this priority" + override control (`DetailPanel.tsx`)

**Files:**
- Modify: `nudgepay-app/app/components/DetailPanel.tsx`

**Interfaces:**
- Consumes: `CaseItem.factors`, `CaseItem.score`, `CaseItem.priority`, `CaseItem.effectiveLevel`, `CaseItem.override` (Task 2); existing `roster` prop (for resolving `override.by` → label); existing `overviewReturnTo` (line 294); existing `TONE_CLASS` map; POSTs to `/api/priority-override` (Task 4).

- [ ] **Step 1: Add the block to the overview panel**

In the `activeTab === "overview"` panel, immediately **after** the closing `</div>` of the InfoRow grid (the grid that ends at line 478, just before `{/* Invoice list */}`), insert:

```tsx
          {/* Why this priority */}
          <div className="mt-4 rounded-card bg-panel p-4 shadow-tile">
            <div className="flex items-center justify-between">
              <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">
                Why this priority
              </span>
              <span className={`text-sm font-sans font-semibold ${TONE_CLASS[selected.heat.band] ?? "text-text"}`}>
                {selected.effectiveLevel}
                {selected.override ? <span aria-hidden> 📌</span> : null}
              </span>
            </div>

            <ul className="mt-2 flex flex-col gap-1">
              {selected.factors.map((f) => (
                <li key={f.key} className="flex items-center justify-between text-xs">
                  <span className="text-text">{f.label}</span>
                  <span className="font-mono text-muted tabular-nums">+{f.points}</span>
                </li>
              ))}
              {selected.factors.length === 0 ? (
                <li className="text-xs text-muted">Not yet due</li>
              ) : null}
            </ul>

            <p className="mt-2 text-xs text-muted">
              Computed: {selected.priority.level} · score {selected.score}
              {selected.override ? (
                <> · pinned to {selected.override.level}
                  {selected.override.by
                    ? ` by ${roster.find((m) => m.userId === selected.override!.by)?.label ?? selected.override.by}`
                    : ""}
                </>
              ) : null}
            </p>
            {selected.override?.reason ? (
              <p className="mt-1 text-xs italic text-muted">“{selected.override.reason}”</p>
            ) : null}

            {/* Override control */}
            <form method="post" action="/api/priority-override" className="mt-3 flex items-center gap-2">
              <input type="hidden" name="caseId" value={selected.caseId} />
              <input type="hidden" name="returnTo" value={overviewReturnTo} />
              <select
                name="level"
                defaultValue={selected.override ? selected.override.level.toLowerCase() : ""}
                aria-label="Override priority level"
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
              >
                <option value="">No override</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <input
                name="reason"
                type="text"
                placeholder="Reason (optional)"
                defaultValue={selected.override?.reason ?? ""}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-sans text-text placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
              />
              <button
                type="submit"
                className="rounded-md border border-copper/40 px-3 py-1 text-xs font-sans font-medium text-copper hover:bg-copper/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
              >
                Save
              </button>
            </form>
          </div>
```

- [ ] **Step 2: Verify build + full suite + typecheck**

Run: `cd nudgepay-app && npx tsc -b && npx react-router build && npx vitest run`
Expected: type-clean, build clean, full suite green.

- [ ] **Step 3: Visual verification (controller)**

Start the app and confirm, for a selected case:
- The DetailPanel overview shows "Why this priority" with the non-zero factors and their points, the computed level + score line.
- Setting the override `<select>` to Critical (with a reason) and Save reloads with the badge showing `Critical 📌` in the queue row, the "pinned to Critical by <you>" line, and the reason in quotes.
- Setting it back to "No override" and Save clears the marker and the pinned line.

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/components/DetailPanel.tsx
git commit -m "feat(priority): 'Why this priority' breakdown + override control (7b)"
```

---

## Self-Review

**1. Spec coverage:**
- §4 score (factors, weights, thresholds, behavior change) → Task 1. ✅
- §4.4 factor breakdown → Task 1 (`factors`), surfaced Task 7. ✅
- §5.1 migration columns → Task 3. ✅
- §5.2 resolution + sort (effectiveRank → score → priorAttempts → age → balance) → Task 2. ✅
- §5.3 lifecycle/permissions (any member, persists, clear) → Task 4 (set/clear on user client). ✅
- §5.4 write path (dedicated `api.*` route) → Task 4. ✅
- §6 surfacing (queue badge + 📌; DetailPanel breakdown + control) → Tasks 6, 7. ✅
- §7 data flow (attempts = logs + outbound SMS) → Task 2 (derived from `lastContacts`; note documents the spec refinement). ✅
- §8 pure/total, no financial mutation, RLS, Tailwind literals, no `.server` import → Tasks 1/4/6/7 + Global Constraints. ✅
- §9 testing (priority.test.ts, cases.test.ts extend, api route test, build/regression gates, visual) → Tasks 1/2/4 + gates in 5/7. ✅
- §11 file manifest → all files covered across Tasks 1–7. ✅

**2. Placeholder scan:** No TBD/TODO; every code step contains complete code; commands have expected output. ✅

**3. Type consistency:** `scorePriority`/`levelToRank`/`overrideToLevel` signatures match between Task 1 (definition) and Task 2 (use). `PriorityOverrideLevel` used identically in Tasks 1/2/5. New `CaseItem` fields (`score`, `factors`, `effectiveLevel`, `priorAttempts`, `override`) defined in Task 2 and consumed unchanged in Tasks 6/7. `CaseRow` optional override fields consistent between Task 2 (type) and Task 5 (mapping). Route form fields (`caseId`/`level`/`reason`/`returnTo`) match between Task 4 (route) and Task 7 (form). ✅

**Deviation from spec (flagged):** `priorAttempts` is derived from the existing `lastContacts` count inside `buildCaseItems` rather than via a new loader aggregation — same definition (contact_logs + outbound SMS), fewer queries, no `buildCaseData` signature churn.
