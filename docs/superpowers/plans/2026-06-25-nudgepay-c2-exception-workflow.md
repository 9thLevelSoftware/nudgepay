# NudgePay C2 — Exception / Dispute Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote case exceptions from a 4-value string into a 9-value taxonomy with per-state suppression behavior and a hard outbound-messaging block for `do_not_contact` / `legal_agency`.

**Architecture:** One new pure module (`app/lib/exceptions.ts`) owns the taxonomy, per-state policy, and the suppression predicate; the contact-log parser, case derivation, messaging guards, label map, and UI all consume it. A migration widens the `exception_reason` CHECK. Terminal states leave `next_action_at` null (never auto-resurface); review-dated states keep resurfacing on their date. Parked cases drop out of the active queue/metrics and live in the Exceptions view.

**Tech Stack:** React Router 7.9.6 (SSR), TypeScript 5.9, Supabase (Postgres + RLS), Tailwind v4, Vitest 4 (node env, no jsdom), Cloudflare Workers.

**Spec:** `docs/superpowers/specs/2026-06-25-nudgepay-c2-exception-workflow-design.md`

## Global Constraints

- **RLS:** every user/RLS-client read/write binds `.eq("org_id", org.org_id)` and captures+throws errors. `is_org_member` permits every org the caller belongs to. The service client (messaging paths only) bypasses RLS — keep it scoped exactly where it is today.
- **Tailwind v4:** literal class strings only, no interpolation.
- **Pure modules** (`exceptions.ts`, `cases.ts`, `contact-log.ts`, `bulk.ts`, `worklist.ts`, `format.ts`): no I/O, no `node:*`, no `.server` suffix.
- **Taxonomy/constants** live only in `exceptions.ts`; every other module imports from it.
- **Tests:** run with `npx vitest run` (there is **no** `npm test` script). Node env, no jsdom, `fileParallelism: false`. Integration tests need local Supabase — apply migrations with `npx supabase db reset` before running them.
- **Terminal states** = `legal_agency`, `do_not_contact` (indefinite hold, no auto-resurface, block outbound SMS). All others are review-dated.
- **`other`** is retained as a 9th catch-all (kept out of the primary picker; behaves review-dated).
- **Conventional Commits**; commit-body trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**Create**
- `app/lib/exceptions.ts` — taxonomy, `EXCEPTION_POLICY`, helpers, `isCaseSuppressed`.
- `supabase/migrations/0015_case_exception_taxonomy.sql` — widen the CHECK.
- `tests/exceptions.test.ts` — pure policy + suppression tests.
- `tests/next-step.test.ts` — integration: `applyNextStep` writes terminal vs review-dated rows.

**Modify**
- `app/lib/format.ts` — derive `EXCEPTION_REASON_LABEL` from `EXCEPTION_POLICY`.
- `app/lib/contact-log.ts` — source enum from `exceptions.ts`; conditional review-date.
- `app/lib/next-step.server.ts` — terminal → null `next_action_at`; widen type.
- `app/lib/cases.ts` — `suppressed` field; view filtering; `onHold` metric.
- `app/lib/worklist.ts` — add `onHold` to the `Metrics` type + zero it in `computeMetrics`.
- `app/lib/twilio-messaging.server.ts` — `activeCaseForSend` + contact-block in `sendInvoiceText`.
- `app/lib/bulk.ts` — `do-not-contact` skip reason + `contactBlocked` flag.
- `app/lib/bulk-send.server.ts` — select `exception_reason`, set `contactBlocked`.
- `app/routes/api.text.send.tsx` — `blocked` flash reason.
- `app/routes/dashboard.tsx` — `onHold` in the not-connected metrics literal.
- `app/components/MetricsStrip.tsx` — 7th "On hold" tile.
- `app/components/LogContactDrawer.tsx` — expanded picker, conditional review-date, terminal note.
- `app/components/DetailPanel.tsx` — parked banner + messaging-blocked composer.
- `app/components/WorkQueue.tsx` — exception badge.
- `tests/case-exceptions.test.ts`, `tests/contact-log.test.ts`, `tests/cases.test.ts`, `tests/bulk.test.ts`, `tests/twilio-send.test.ts` — extend.

---

## Task 1: Pure exceptions module + label re-derivation

**Files:**
- Create: `nudgepay-app/app/lib/exceptions.ts`
- Modify: `nudgepay-app/app/lib/format.ts:13-18`
- Test: `nudgepay-app/tests/exceptions.test.ts`

**Interfaces:**
- Produces:
  - `EXCEPTION_STATES: readonly ExceptionState[]` (9 values, tuple order below).
  - `type ExceptionState` — union of the 9 string literals.
  - `PRIMARY_EXCEPTION_STATES: ExceptionState[]` — the 8 minus `other`.
  - `EXCEPTION_POLICY: Readonly<Record<ExceptionState, { terminal: boolean; requiresReview: boolean; blocksContact: boolean; label: string }>>`.
  - `isTerminal(state: ExceptionState): boolean`
  - `requiresReviewDate(state: ExceptionState): boolean`
  - `isContactBlocked(state: ExceptionState | null): boolean`
  - `exceptionLabel(state: ExceptionState | null): string`
  - `isCaseSuppressed(args: { status: string; exceptionReason: ExceptionState | null; nextActionAt: string | null; today: string }): boolean`

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/exceptions.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  EXCEPTION_STATES, PRIMARY_EXCEPTION_STATES, EXCEPTION_POLICY,
  isTerminal, requiresReviewDate, isContactBlocked, exceptionLabel, isCaseSuppressed,
  type ExceptionState,
} from "../app/lib/exceptions";

const TERMINAL: ExceptionState[] = ["legal_agency", "do_not_contact"];

test("EXCEPTION_STATES has the 8 primary values plus retained 'other'", () => {
  expect(EXCEPTION_STATES).toEqual([
    "disputed", "incorrect_amount", "work_incomplete", "documentation_requested",
    "wrong_contact", "payment_plan", "legal_agency", "do_not_contact", "other",
  ]);
  expect(PRIMARY_EXCEPTION_STATES).not.toContain("other");
  expect(PRIMARY_EXCEPTION_STATES).toHaveLength(8);
});

test("terminal set is exactly legal_agency + do_not_contact", () => {
  for (const s of EXCEPTION_STATES) {
    expect(isTerminal(s)).toBe(TERMINAL.includes(s));
  }
});

test("blocksContact set equals the terminal set", () => {
  for (const s of EXCEPTION_STATES) {
    expect(EXCEPTION_POLICY[s].blocksContact).toBe(TERMINAL.includes(s));
  }
  expect(isContactBlocked("do_not_contact")).toBe(true);
  expect(isContactBlocked("disputed")).toBe(false);
  expect(isContactBlocked(null)).toBe(false);
});

test("every non-terminal state requires a review date; terminal states do not", () => {
  for (const s of EXCEPTION_STATES) {
    expect(requiresReviewDate(s)).toBe(!TERMINAL.includes(s));
  }
});

test("every state has a non-empty label; exceptionLabel(null) is empty", () => {
  for (const s of EXCEPTION_STATES) expect(EXCEPTION_POLICY[s].label.length).toBeGreaterThan(0);
  expect(exceptionLabel("do_not_contact")).toBe("Do not contact");
  expect(exceptionLabel(null)).toBe("");
});

test("isCaseSuppressed: terminal on_hold is always suppressed", () => {
  expect(isCaseSuppressed({ status: "on_hold", exceptionReason: "do_not_contact", nextActionAt: null, today: "2026-06-25" })).toBe(true);
  // even with a past review date, terminal stays suppressed
  expect(isCaseSuppressed({ status: "on_hold", exceptionReason: "legal_agency", nextActionAt: "2026-01-01", today: "2026-06-25" })).toBe(true);
});

test("isCaseSuppressed: review-dated future is suppressed, resurfaced is not", () => {
  expect(isCaseSuppressed({ status: "on_hold", exceptionReason: "disputed", nextActionAt: "2026-07-01", today: "2026-06-25" })).toBe(true);
  expect(isCaseSuppressed({ status: "on_hold", exceptionReason: "disputed", nextActionAt: "2026-06-25", today: "2026-06-25" })).toBe(false);
  expect(isCaseSuppressed({ status: "on_hold", exceptionReason: "disputed", nextActionAt: "2026-06-20", today: "2026-06-25" })).toBe(false);
});

test("isCaseSuppressed: review-dated with no date is suppressed", () => {
  expect(isCaseSuppressed({ status: "on_hold", exceptionReason: "disputed", nextActionAt: null, today: "2026-06-25" })).toBe(true);
});

test("isCaseSuppressed: not suppressed unless on_hold with an exception", () => {
  expect(isCaseSuppressed({ status: "working", exceptionReason: "disputed", nextActionAt: "2026-07-01", today: "2026-06-25" })).toBe(false);
  expect(isCaseSuppressed({ status: "on_hold", exceptionReason: null, nextActionAt: "2026-07-01", today: "2026-06-25" })).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/exceptions.test.ts`
Expected: FAIL — cannot resolve `../app/lib/exceptions`.

- [ ] **Step 3: Create the module**

Create `nudgepay-app/app/lib/exceptions.ts`:

```ts
// Pure taxonomy + policy for collection-case exception states. No I/O, no
// node:*, no .server suffix — the single source of truth imported by the
// contact-log parser, the case derivation, the messaging guards, the format
// labels, and the UI.

export const EXCEPTION_STATES = [
  "disputed",
  "incorrect_amount",
  "work_incomplete",
  "documentation_requested",
  "wrong_contact",
  "payment_plan",
  "legal_agency",
  "do_not_contact",
  "other",
] as const;

export type ExceptionState = (typeof EXCEPTION_STATES)[number];

type Policy = { terminal: boolean; requiresReview: boolean; blocksContact: boolean; label: string };

// Terminal (legal_agency, do_not_contact): indefinite hold, no auto-resurface,
// blocks outbound SMS. All others are review-dated and resurface on their date.
export const EXCEPTION_POLICY: Readonly<Record<ExceptionState, Policy>> = Object.freeze({
  disputed:                { terminal: false, requiresReview: true,  blocksContact: false, label: "Disputed" },
  incorrect_amount:        { terminal: false, requiresReview: true,  blocksContact: false, label: "Incorrect amount" },
  work_incomplete:         { terminal: false, requiresReview: true,  blocksContact: false, label: "Work incomplete" },
  documentation_requested: { terminal: false, requiresReview: true,  blocksContact: false, label: "Documentation requested" },
  wrong_contact:           { terminal: false, requiresReview: true,  blocksContact: false, label: "Wrong contact" },
  payment_plan:            { terminal: false, requiresReview: true,  blocksContact: false, label: "Payment plan" },
  legal_agency:            { terminal: true,  requiresReview: false, blocksContact: true,  label: "Legal / agency" },
  do_not_contact:          { terminal: true,  requiresReview: false, blocksContact: true,  label: "Do not contact" },
  other:                   { terminal: false, requiresReview: true,  blocksContact: false, label: "Other" },
});

// The 8 states offered in the primary picker (excludes the retained `other`).
export const PRIMARY_EXCEPTION_STATES: ExceptionState[] =
  EXCEPTION_STATES.filter((s) => s !== "other");

export function isTerminal(state: ExceptionState): boolean {
  return EXCEPTION_POLICY[state].terminal;
}

export function requiresReviewDate(state: ExceptionState): boolean {
  return EXCEPTION_POLICY[state].requiresReview;
}

export function isContactBlocked(state: ExceptionState | null): boolean {
  return state != null && EXCEPTION_POLICY[state].blocksContact;
}

export function exceptionLabel(state: ExceptionState | null): string {
  return state ? EXCEPTION_POLICY[state].label : "";
}

// A case is "parked" (suppressed from active surfacing) when it is on_hold with
// an exception that holds indefinitely (terminal), carries no review date, or
// whose review date is still in the future. Date strings are YYYY-MM-DD and
// compare lexicographically.
export function isCaseSuppressed(args: {
  status: string;
  exceptionReason: ExceptionState | null;
  nextActionAt: string | null;
  today: string;
}): boolean {
  if (args.status !== "on_hold" || args.exceptionReason == null) return false;
  if (isTerminal(args.exceptionReason)) return true;
  if (args.nextActionAt == null) return true;
  return args.nextActionAt > args.today;
}
```

- [ ] **Step 4: Re-derive the label map in `format.ts`**

In `nudgepay-app/app/lib/format.ts`, replace the hardcoded `EXCEPTION_REASON_LABEL` (lines 13-18) so it covers the full taxonomy from one source. Add the import at the top of the file (after line 2) and replace the block:

```ts
import { EXCEPTION_STATES, EXCEPTION_POLICY } from "./exceptions";
```

```ts
// Derived from the single source of truth so the label set never drifts.
export const EXCEPTION_REASON_LABEL: Record<string, string> = Object.fromEntries(
  EXCEPTION_STATES.map((s) => [s, EXCEPTION_POLICY[s].label]),
);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/exceptions.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Typecheck**

Run: `cd nudgepay-app && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/exceptions.ts nudgepay-app/app/lib/format.ts nudgepay-app/tests/exceptions.test.ts
git commit -m "feat(exceptions): taxonomy + per-state policy module (C2)"
```

---

## Task 2: Migration — widen the exception_reason CHECK

**Files:**
- Create: `nudgepay-app/supabase/migrations/0015_case_exception_taxonomy.sql`
- Test: `nudgepay-app/tests/case-exceptions.test.ts:1-24` (extend)

**Interfaces:**
- Consumes: existing `collection_cases.exception_reason` column + its CHECK `collection_cases_exception_reason_check` (from `0011`).
- Produces: the column now accepts the 9 taxonomy values; existing `other` rows survive.

- [ ] **Step 1: Write the migration**

Create `nudgepay-app/supabase/migrations/0015_case_exception_taxonomy.sql`:

```sql
-- Phase 8c (C2): widen the case exception taxonomy from the 6c minimal slice
-- (disputed/payment_plan/do_not_contact/other) to the full 9-value set. `other`
-- is retained as a catch-all so existing rows survive the constraint swap.
-- No new columns: next_action_at keeps doubling as the review date; terminal
-- states (legal_agency, do_not_contact) leave it null.
alter table collection_cases
  drop constraint collection_cases_exception_reason_check,
  add constraint collection_cases_exception_reason_check
    check (exception_reason in (
      'disputed', 'incorrect_amount', 'work_incomplete', 'documentation_requested',
      'wrong_contact', 'payment_plan', 'legal_agency', 'do_not_contact', 'other'
    ));
```

- [ ] **Step 2: Apply the migration locally**

Run: `cd nudgepay-app && npx supabase db reset`
Expected: all migrations apply cleanly through `0015`.

- [ ] **Step 3: Extend the schema test**

Append to `nudgepay-app/tests/case-exceptions.test.ts` (after the existing test, before EOF):

```ts
test("collection_cases accepts the new C2 taxonomy values and a terminal hold with null review", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `ExcOrg2 ${Math.random()}` }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `exc2-${Math.random()}`, name: "Beta" }).select("id").single();

  // A review-dated new value.
  const { error: e1 } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "on_hold",
    next_action_type: "exception", next_action_at: "2026-09-01", exception_reason: "incorrect_amount",
  });
  expect(e1).toBeNull();

  // A terminal value with NO review date (next_action_at null).
  const { data: c2, error: e2 } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "on_hold",
    next_action_type: "exception", next_action_at: null, exception_reason: "do_not_contact",
  }).select("exception_reason, next_action_at").single();
  expect(e2).toBeNull();
  expect(c2!.exception_reason).toBe("do_not_contact");
  expect(c2!.next_action_at).toBeNull();

  // An out-of-taxonomy value is still rejected.
  const { error: e3 } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "on_hold", exception_reason: "totally_bogus",
  });
  expect(e3).not.toBeNull();
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/case-exceptions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/supabase/migrations/0015_case_exception_taxonomy.sql nudgepay-app/tests/case-exceptions.test.ts
git commit -m "feat(exceptions): migration 0015 widens exception_reason taxonomy (C2)"
```

---

## Task 3: Contact-log parser — source enum + conditional review date

**Files:**
- Modify: `nudgepay-app/app/lib/contact-log.ts:14-17, 97-105`
- Test: `nudgepay-app/tests/contact-log.test.ts` (extend)

**Interfaces:**
- Consumes: `EXCEPTION_STATES`, `requiresReviewDate`, `ExceptionState` from `exceptions.ts` (Task 1).
- Produces: `EXCEPTION_REASONS` (= `EXCEPTION_STATES`) and `type ExceptionReason` (= `ExceptionState`) remain exported from `contact-log.ts` (back-compat aliases). The exception branch requires `reviewAt` **only** when `requiresReviewDate(state)`.

- [ ] **Step 1: Write the failing tests**

Append to `nudgepay-app/tests/contact-log.test.ts`:

```ts
test("exception with a review-dated reason requires reviewAt", () => {
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "dispute", nextStep: "exception", exceptionReason: "disputed" }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toBe("next-step-date");
});

test("exception with a review-dated reason accepts a valid reviewAt", () => {
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "dispute", nextStep: "exception", exceptionReason: "incorrect_amount", reviewAt: "2026-08-01" }));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.fields.exceptionReason).toBe("incorrect_amount");
    expect(r.fields.reviewAt).toBe("2026-08-01");
  }
});

test("exception with a terminal reason does NOT require reviewAt", () => {
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "no-commitment", nextStep: "exception", exceptionReason: "do_not_contact" }));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.fields.exceptionReason).toBe("do_not_contact");
    expect(r.fields.reviewAt).toBeNull();
  }
});

test("exception rejects an unknown reason", () => {
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "dispute", nextStep: "exception", exceptionReason: "bogus", reviewAt: "2026-08-01" }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toBe("bad-exception");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd nudgepay-app && npx vitest run tests/contact-log.test.ts`
Expected: FAIL — the terminal-reason test fails (current code always requires `reviewAt`).

- [ ] **Step 3: Update the enum source**

In `nudgepay-app/app/lib/contact-log.ts`, replace the local enum declaration (lines 14-17):

```ts
export const NEXT_STEPS = ["follow_up", "promise", "waiting", "exception"] as const;
export type NextStep = (typeof NEXT_STEPS)[number];
export const EXCEPTION_REASONS = EXCEPTION_STATES;
export type ExceptionReason = ExceptionState;
```

Add the import at the top of the file (after the file's opening comment block, before the existing `export const CONTACT_METHODS`):

```ts
import { EXCEPTION_STATES, requiresReviewDate, type ExceptionState } from "./exceptions";
```

- [ ] **Step 4: Make the review date conditional**

In `parseContactLogForm`, replace the `else if (nextStep === "exception")` branch (lines 97-105):

```ts
  } else if (nextStep === "exception") {
    const r = str(form, "exceptionReason");
    if (!r || !EXCEPTION_REASONS.includes(r as ExceptionReason)) return { ok: false, error: "bad-exception" };
    const state = r as ExceptionReason;
    const d = str(form, "reviewAt");
    if (requiresReviewDate(state)) {
      if (!d || !validDate(d)) return { ok: false, error: "next-step-date" };
      reviewAt = d;
    } else if (d != null) {
      // Terminal states do not require a review date, but if one is supplied it must be valid.
      if (!validDate(d)) return { ok: false, error: "next-step-date" };
      reviewAt = d;
    }
    exceptionReason = state;
    exceptionNote = str(form, "exceptionNote");
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/contact-log.test.ts`
Expected: PASS (all existing + 4 new).

- [ ] **Step 6: Typecheck**

Run: `cd nudgepay-app && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/contact-log.ts nudgepay-app/tests/contact-log.test.ts
git commit -m "feat(exceptions): conditional review date by exception state (C2)"
```

---

## Task 4: Apply layer — terminal states leave next_action_at null

**Files:**
- Modify: `nudgepay-app/app/lib/next-step.server.ts:5-12, 29-41`
- Test: `nudgepay-app/tests/next-step.test.ts` (create)

**Interfaces:**
- Consumes: `requiresReviewDate`, `ExceptionState` from `exceptions.ts`; `ExceptionReason` from `contact-log.ts`.
- Produces: `applyNextStep(client, caseId, f)` unchanged signature; for the exception branch it writes `next_action_at = requiresReviewDate(state) ? f.reviewAt : null`.

- [ ] **Step 1: Write the failing integration test**

Create `nudgepay-app/tests/next-step.test.ts`:

```ts
import { beforeAll, expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { applyNextStep } from "../app/lib/next-step.server";

let client: any;
let userId: string;
let orgId: string;

beforeAll(async () => {
  ({ client, userId } = await makeUserClient("next-step@example.com"));
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `NS Org ${Math.random()}` }).select("id").single();
  orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: userId, role: "member" });
});

async function seedCase(): Promise<string> {
  const svc = serviceClient();
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `ns-${Math.random()}`, name: "Acme" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();
  return cse!.id as string;
}

test("applyNextStep with a review-dated exception stores the review date", async () => {
  const caseId = await seedCase();
  const res = await applyNextStep(client, caseId, {
    nextStep: "exception", followUpAt: null, promisedAmount: null, promisedDate: null,
    reviewAt: "2026-09-01", exceptionReason: "disputed", exceptionNote: "line 3",
  });
  expect(res.ok).toBe(true);
  const { data } = await serviceClient().from("collection_cases")
    .select("status, exception_reason, next_action_at").eq("id", caseId).single();
  expect(data!.status).toBe("on_hold");
  expect(data!.exception_reason).toBe("disputed");
  expect(data!.next_action_at).toBe("2026-09-01");
});

test("applyNextStep with a terminal exception nulls next_action_at even if a review date is supplied", async () => {
  const caseId = await seedCase();
  // Pass a non-null reviewAt: the OLD code would persist it; the NEW code must
  // force null for terminal states. This makes the test fail before the fix.
  const res = await applyNextStep(client, caseId, {
    nextStep: "exception", followUpAt: null, promisedAmount: null, promisedDate: null,
    reviewAt: "2026-09-01", exceptionReason: "do_not_contact", exceptionNote: null,
  });
  expect(res.ok).toBe(true);
  const { data } = await serviceClient().from("collection_cases")
    .select("status, exception_reason, next_action_at").eq("id", caseId).single();
  expect(data!.status).toBe("on_hold");
  expect(data!.exception_reason).toBe("do_not_contact");
  expect(data!.next_action_at).toBeNull();
});
```

> Note: `makeUserClient`/`memberships` follow the existing helper pattern; if the helper already inserts a membership/org for the user, adapt the seed to reuse it. Check `tests/helpers.ts` and mirror what `api-contact-logs.test.ts` does for an org the user belongs to.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/next-step.test.ts`
Expected: FAIL — before the fix, `applyNextStep` writes `f.reviewAt` (`"2026-09-01"`) for the terminal case, so `next_action_at` is `"2026-09-01"` not `null`. The terminal test fails on that assertion.

- [ ] **Step 3: Widen the input type**

In `nudgepay-app/app/lib/next-step.server.ts`, replace the `NextStepInput` type (lines 4-12) and add the import:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { requiresReviewDate } from "./exceptions";
import type { ExceptionReason } from "./contact-log";

// The forward-action fields parsed from a contact log (subset of ContactLogFields).
export type NextStepInput = {
  nextStep: "follow_up" | "promise" | "waiting" | "exception";
  followUpAt: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
  reviewAt: string | null;
  exceptionReason: ExceptionReason | null;
  exceptionNote: string | null;
};
```

- [ ] **Step 4: Force null next_action_at for terminal states**

Replace the `else { // exception }` branch (lines 34-37):

```ts
  } else {
    // exception: terminal states (legal_agency, do_not_contact) leave
    // next_action_at null so nothing auto-resurfaces them; review-dated
    // states keep their review date.
    const state = f.exceptionReason;
    const keepReview = state != null && requiresReviewDate(state);
    update = {
      status: "on_hold",
      next_action_type: "exception",
      next_action_at: keepReview ? f.reviewAt : null,
      exception_reason: state,
      exception_note: f.exceptionNote,
    };
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/next-step.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck**

Run: `cd nudgepay-app && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/next-step.server.ts nudgepay-app/tests/next-step.test.ts
git commit -m "feat(exceptions): terminal states leave next_action_at null (C2)"
```

---

## Task 5: Queue suppression + onHold metric

**Files:**
- Modify: `nudgepay-app/app/lib/cases.ts:15, 29-41, 109-225, 240-253`
- Modify: `nudgepay-app/app/lib/worklist.ts:35, 172-185`
- Modify: `nudgepay-app/app/routes/dashboard.tsx:259-266`
- Test: `nudgepay-app/tests/cases.test.ts` (extend)

**Interfaces:**
- Consumes: `isCaseSuppressed`, `ExceptionState` from `exceptions.ts`.
- Produces: `CaseItem` gains `suppressed: boolean`. `applyCaseView` default + `never-contacted` exclude suppressed. `computeCaseMetrics` returns the existing buckets (active-only) plus `onHold: Metric`. The `Metrics` type (in `worklist.ts`) gains `onHold: Metric`.

- [ ] **Step 1: Write the failing tests**

Append to `nudgepay-app/tests/cases.test.ts` (reuse the existing imports; add a small case builder inline):

```ts
test("suppressed parked cases drop out of the default view and active metrics; onHold counts them", () => {
  const today = "2026-06-25";
  const cases: CaseRow[] = [
    { id: "active", customerId: "c-active", status: "working", nextActionType: "follow_up", nextActionAt: "2026-06-20", exceptionReason: null, exceptionNote: null },
    { id: "parked-future", customerId: "c-fut", status: "on_hold", nextActionType: "exception", nextActionAt: "2026-07-10", exceptionReason: "disputed", exceptionNote: null },
    { id: "parked-terminal", customerId: "c-term", status: "on_hold", nextActionType: "exception", nextActionAt: null, exceptionReason: "do_not_contact", exceptionNote: null },
    { id: "resurfaced", customerId: "c-res", status: "on_hold", nextActionType: "exception", nextActionAt: "2026-06-24", exceptionReason: "disputed", exceptionNote: null },
  ];
  const invoices = cases.map((c) => ({ id: `i-${c.customerId}`, qbo_doc_number: "1", customer_id: c.customerId, balance: 100, due_date: "2026-01-01" }));
  const customers = cases.map((c) => ({ id: c.customerId, name: c.customerId, phone: null, email: null, owner: null, smsConsent: false }));
  const items = buildCaseItems(cases, invoices, customers, [], [], today, new Map());

  const byId = new Map(items.map((i) => [i.caseId, i]));
  expect(byId.get("parked-future")!.suppressed).toBe(true);
  expect(byId.get("parked-terminal")!.suppressed).toBe(true);
  expect(byId.get("resurfaced")!.suppressed).toBe(false);
  expect(byId.get("active")!.suppressed).toBe(false);

  // Default view excludes suppressed; resurfaced + active remain.
  const def = applyCaseView(items, "all-open", today, null).map((i) => i.caseId).sort();
  expect(def).toEqual(["active", "resurfaced"]);

  // Exceptions/On-hold view ("waiting") includes ALL parked, including terminal.
  const onHoldView = applyCaseView(items, "waiting", today, null).map((i) => i.caseId).sort();
  expect(onHoldView).toEqual(["parked-future", "parked-terminal", "resurfaced"]);

  // Metrics: allOpen excludes the two still-parked; onHold counts them.
  const m = computeCaseMetrics(items, today);
  expect(m.allOpen.count).toBe(2);     // active + resurfaced
  expect(m.onHold.count).toBe(2);      // parked-future + parked-terminal
});
```

> `applyCaseView` view id "all-open" maps to the default branch (`return items`), and "waiting" is the Exceptions/On-hold view. Confirm the `ViewId` strings against `worklist.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: FAIL — `suppressed` undefined / `m.onHold` undefined.

- [ ] **Step 3: Add `onHold` to the Metrics type and zero it in the legacy producer**

In `nudgepay-app/app/lib/worklist.ts`, line 35, extend the `Metrics` type:

```ts
export type Metrics = { thirtyPlus: Metric; highValue: Metric; neverContacted: Metric; allOpen: Metric; followUpsDue: Metric; brokenPromises: Metric; onHold: Metric };
```

In `computeMetrics` (the invoice-level producer, around lines 172-185), add `onHold` to the returned object (invoice-level has no on_hold concept):

```ts
    onHold: { count: 0, amount: 0 },
```

- [ ] **Step 4: Add the `suppressed` field in cases.ts**

In `nudgepay-app/app/lib/cases.ts`:

1. Add the import (after the existing `import type { ExceptionReason } from "./contact-log";`, line 15):

```ts
import { isCaseSuppressed } from "./exceptions";
```

2. Add `suppressed: boolean;` to the `CaseItem` type (after `exceptionNote: string | null;`, ~line 80):

```ts
  suppressed: boolean;
```

3. In `buildCaseItems`, inside the `cases.map((cse) => { ... })` return object (after `exceptionNote: cse.exceptionNote,`, ~line 205), add:

```ts
      suppressed: isCaseSuppressed({ status: cse.status, exceptionReason: cse.exceptionReason, nextActionAt: cse.nextActionAt, today }),
```

- [ ] **Step 5: Exclude suppressed from active views**

In `applyCaseView` (lines 214-225), change the default and never-contacted branches:

```ts
export function applyCaseView(
  items: CaseItem[], view: ViewId, today: string, currentUserId: string | null,
): CaseItem[] {
  if (view === "30-plus") return items.filter((i) => i.oldestAgeDays >= 30 && !i.suppressed);
  if (view === "high-value") return items.filter((i) => i.totalOverdue >= HIGH_VALUE_THRESHOLD && !i.suppressed);
  if (view === "never-contacted") return items.filter((i) => i.lastContact === null && !i.suppressed);
  if (view === "follow-ups-due") return items.filter((i) => i.nextActionAt != null && i.nextActionAt <= today);
  if (view === "broken-promises") return items.filter((i) => i.brokenPromise);
  if (view === "waiting") return items.filter((i) => i.status === "waiting" || i.status === "on_hold");
  if (view === "my-work") return items.filter((i) => i.ownerId != null && i.ownerId === currentUserId);
  return items.filter((i) => !i.suppressed);
}
```

> `follow-ups-due` is intentionally unchanged: its `nextActionAt <= today` predicate already drops future-review parked cases, and terminal cases carry a null `nextActionAt` (Task 4). A resurfaced review-dated case (`nextActionAt <= today`, not suppressed) correctly appears. The `waiting` view is the Exceptions/On-hold view and deliberately shows all parked cases including terminal.

- [ ] **Step 6: Add the onHold bucket in computeCaseMetrics**

Replace `computeCaseMetrics` (lines 240-253):

```ts
export function computeCaseMetrics(items: CaseItem[], today: string): Metrics {
  const active = items.filter((i) => !i.suppressed);
  const bucket = (source: CaseItem[], pred: (i: CaseItem) => boolean): Metric => {
    const matched = source.filter(pred);
    return { count: matched.length, amount: matched.reduce((s, i) => s + i.totalOverdue, 0) };
  };
  return {
    thirtyPlus: bucket(active, (i) => i.oldestAgeDays >= 30),
    highValue: bucket(active, (i) => i.totalOverdue >= HIGH_VALUE_THRESHOLD),
    neverContacted: bucket(active, (i) => i.lastContact === null),
    allOpen: bucket(active, () => true),
    followUpsDue: bucket(active, (i) => i.nextActionAt != null && i.nextActionAt <= today),
    brokenPromises: bucket(active, (i) => i.brokenPromise),
    onHold: bucket(items, (i) => i.suppressed),
  };
}
```

- [ ] **Step 7: Add onHold to the not-connected metrics literal**

In `nudgepay-app/app/routes/dashboard.tsx`, the not-connected `dashboardData.metrics` literal (lines 259-266), add after `brokenPromises: { count: 0, amount: 0 },`:

```ts
      onHold: { count: 0, amount: 0 },
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts tests/worklist.test.ts`
Expected: PASS (existing + new; worklist per-bucket asserts unaffected).

- [ ] **Step 9: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build`
Expected: exit 0; client + SSR build clean.

- [ ] **Step 10: Commit**

```bash
git add nudgepay-app/app/lib/cases.ts nudgepay-app/app/lib/worklist.ts nudgepay-app/app/routes/dashboard.tsx nudgepay-app/tests/cases.test.ts
git commit -m "feat(exceptions): suppress parked cases from active views + onHold metric (C2)"
```

---

## Task 6: Messaging hard-block (individual send)

**Files:**
- Modify: `nudgepay-app/app/lib/twilio-messaging.server.ts:30-39, 41-57`
- Modify: `nudgepay-app/app/routes/api.text.send.tsx:42-45`
- Test: `nudgepay-app/tests/twilio-send.test.ts` (extend)

**Interfaces:**
- Consumes: `isContactBlocked`, `ExceptionState` from `exceptions.ts`.
- Produces: `activeCaseForSend(service, orgId, customerId): Promise<{ id: string | null; exceptionReason: ExceptionState | null }>`. `sendInvoiceText` throws `Error("Contact blocked: <state>")` before the Twilio call when the open case's exception blocks contact. `activeCaseId` (inbound path) is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `nudgepay-app/tests/twilio-send.test.ts`:

```ts
test("sendInvoiceText refuses a do_not_contact case (no Twilio call, no row)", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550133");
  await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: customerId, status: "on_hold",
    next_action_type: "exception", exception_reason: "do_not_contact",
  });
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "x" }))
    .rejects.toThrow(/blocked/i);
  expect(fetchFn).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("text_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("sendInvoiceText still sends for a non-blocking exception (disputed)", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550134");
  await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: customerId, status: "on_hold",
    next_action_type: "exception", next_action_at: "2026-09-01", exception_reason: "disputed",
  });
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-DISP", status: "queued" }));
  const res = await sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "Past due" });
  expect(res.sid).toBe("SM-DISP");
  expect(fetchFn).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/twilio-send.test.ts`
Expected: FAIL — the do_not_contact case currently sends (no block).

- [ ] **Step 3: Add `activeCaseForSend` and the block**

In `nudgepay-app/app/lib/twilio-messaging.server.ts`, add the import at the top (after line 2):

```ts
import { isContactBlocked, type ExceptionState } from "./exceptions";
```

Add a new lookup after `activeCaseId` (after line 39):

```ts
// Like activeCaseId but also returns the open case's exception state, for the
// outbound contact-block guard. Errors are surfaced, not swallowed.
export async function activeCaseForSend(
  service: SupabaseClient, orgId: string, customerId: string,
): Promise<{ id: string | null; exceptionReason: ExceptionState | null }> {
  const { data, error } = await service.from("collection_cases")
    .select("id, exception_reason").eq("org_id", orgId).eq("customer_id", customerId).is("closed_at", null).maybeSingle();
  if (error) throw error;
  return {
    id: (data?.id as string) ?? null,
    exceptionReason: (data?.exception_reason as ExceptionState | null) ?? null,
  };
}
```

In `sendInvoiceText`, replace the consent check + case lookup region (lines 53-57). Currently:

```ts
  if (!cust.sms_consent) throw new Error("Customer has not consented to SMS");

  const sender = await resolveSender(deps.service, args.orgId, deps.defaultSender);
  const caseId = await activeCaseId(deps.service, args.orgId, cust.id as string);
```

becomes:

```ts
  if (!cust.sms_consent) throw new Error("Customer has not consented to SMS");

  // Contact-block guard: a do_not_contact / legal_agency case blocks outbound
  // messaging on any channel. Check before resolving the sender or calling Twilio.
  const activeCase = await activeCaseForSend(deps.service, args.orgId, cust.id as string);
  if (isContactBlocked(activeCase.exceptionReason)) {
    throw new Error(`Contact blocked: ${activeCase.exceptionReason}`);
  }

  const sender = await resolveSender(deps.service, args.orgId, deps.defaultSender);
  const caseId = activeCase.id;
```

> This replaces the `activeCaseId` call inside `sendInvoiceText` with `activeCaseForSend` (one read, both fields). `activeCaseId` stays exported for `recordInboundMessage`.

- [ ] **Step 4: Map the blocked error in the route**

In `nudgepay-app/app/routes/api.text.send.tsx`, replace the catch (lines 42-45):

```ts
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    const reason = /blocked/i.test(msg) ? "blocked" : /consent/i.test(msg) ? "noconsent" : "error";
    return redirect(withSms(returnTo, reason), { headers });
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/twilio-send.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Typecheck**

Run: `cd nudgepay-app && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/twilio-messaging.server.ts nudgepay-app/app/routes/api.text.send.tsx nudgepay-app/tests/twilio-send.test.ts
git commit -m "feat(exceptions): hard-block individual SMS for do_not_contact/legal_agency (C2)"
```

---

## Task 7: Messaging hard-block (bulk send)

**Files:**
- Modify: `nudgepay-app/app/lib/bulk.ts:9-16, 33-42`
- Modify: `nudgepay-app/app/lib/bulk-send.server.ts:7-9, 22-25, 45-62`
- Test: `nudgepay-app/tests/bulk.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new in `bulk.ts` (works off a boolean flag); `isContactBlocked` from `exceptions.ts` in `bulk-send.server.ts`.
- Produces: `SkipReason` gains `"do-not-contact"`. `TextableCase` gains `contactBlocked?: boolean`. `partitionEligibility` skips blocked cases first (ahead of phone, then consent).

- [ ] **Step 1: Write the failing test**

Append to `nudgepay-app/tests/bulk.test.ts`:

```ts
test("partitionEligibility skips a contact-blocked case ahead of phone/consent", () => {
  const { eligible, skipped } = partitionEligibility([
    { caseId: "c1", customerName: "OK", phone: "+12295550100", smsConsent: true },
    { caseId: "c2", customerName: "Blocked", phone: "+12295550101", smsConsent: true, contactBlocked: true },
    { caseId: "c3", customerName: "BlockedNoPhone", phone: null, smsConsent: false, contactBlocked: true },
  ]);
  expect(eligible.map((c) => c.caseId)).toEqual(["c1"]);
  expect(skipped).toEqual([
    { caseId: "c2", name: "Blocked", reason: "do-not-contact" },
    { caseId: "c3", name: "BlockedNoPhone", reason: "do-not-contact" },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/bulk.test.ts`
Expected: FAIL — `contactBlocked` not honored; type error on the field.

- [ ] **Step 3: Extend bulk.ts**

In `nudgepay-app/app/lib/bulk.ts`, update the skip reason + textable type (lines 9-16):

```ts
export type SkipReason = "no-phone" | "no-consent" | "do-not-contact";

export type TextableCase = {
  caseId: string;
  customerName: string;
  phone: string | null;
  smsConsent: boolean;
  contactBlocked?: boolean;
};
```

Update `partitionEligibility` (lines 33-42):

```ts
export function partitionEligibility<T extends TextableCase>(cases: T[]): EligibilitySplit<T> {
  const eligible: T[] = [];
  const skipped: { caseId: string; name: string; reason: SkipReason }[] = [];
  for (const c of cases) {
    if (c.contactBlocked) skipped.push({ caseId: c.caseId, name: c.customerName, reason: "do-not-contact" });
    else if (!c.phone) skipped.push({ caseId: c.caseId, name: c.customerName, reason: "no-phone" });
    else if (!c.smsConsent) skipped.push({ caseId: c.caseId, name: c.customerName, reason: "no-consent" });
    else eligible.push(c);
  }
  return { eligible, skipped };
}
```

- [ ] **Step 4: Wire the flag in bulk-send.server.ts**

In `nudgepay-app/app/lib/bulk-send.server.ts`:

Add the import (after line 2):

```ts
import { isContactBlocked, type ExceptionState } from "./exceptions";
```

Update the case query (lines 22-25) to select `exception_reason`:

```ts
  const { data: caseRows, error: caseErr } = await svc.from("collection_cases")
    .select("id, customer_id, exception_reason").eq("org_id", args.orgId).in("id", ids).is("closed_at", null);
  if (caseErr) throw caseErr;
  const cases = ((caseRows as { id: string; customer_id: string; exception_reason: ExceptionState | null }[]) ?? []);
```

In the build loop (lines 45-62), set `contactBlocked` on each built case (add to the `built.push({ ... })` object):

```ts
      contactBlocked: isContactBlocked(c.exception_reason),
```

> `c` in the loop is a `cases` row, so `c.exception_reason` is available. `CaseForSend extends TextableCase`, which now carries the optional `contactBlocked` flag.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/bulk.test.ts tests/bulk-send.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 6: Typecheck**

Run: `cd nudgepay-app && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/bulk.ts nudgepay-app/app/lib/bulk-send.server.ts nudgepay-app/tests/bulk.test.ts
git commit -m "feat(exceptions): exclude contact-blocked cases from bulk SMS (C2)"
```

---

## Task 8: LogContactDrawer — expanded picker + conditional review date

**Files:**
- Modify: `nudgepay-app/app/components/LogContactDrawer.tsx:5-6, 230-252`

**Interfaces:**
- Consumes: `PRIMARY_EXCEPTION_STATES`, `requiresReviewDate`, `isTerminal`, `exceptionLabel`, `isContactBlocked`, `type ExceptionState` from `exceptions.ts`.

This task has no unit test (no jsdom); verify via tsc + build, consistent with the C1 component convention.

- [ ] **Step 1: Update imports**

In `nudgepay-app/app/components/LogContactDrawer.tsx`, add (near line 5-6, with the other lib imports):

```ts
import { PRIMARY_EXCEPTION_STATES, requiresReviewDate, isContactBlocked, type ExceptionState } from "../lib/exceptions";
```

Add local state for the selected exception reason near the other `useState` calls (after `const [nextStep, setNextStep] = useState<string>("");`):

```ts
  const [exceptionReason, setExceptionReason] = useState<ExceptionState>("disputed");
```

- [ ] **Step 2: Replace the exception sub-form**

Replace the `{nextStep === "exception" && ( ... )}` block (lines 230-252):

```tsx
          {nextStep === "exception" && (
            <div className="grid gap-3 rounded-md bg-panel/60 border border-border p-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Reason</span>
                <select name="exceptionReason" value={exceptionReason}
                  onChange={(e) => setExceptionReason(e.target.value as ExceptionState)}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper">
                  {PRIMARY_EXCEPTION_STATES.map((r) => (
                    <option key={r} value={r}>{EXCEPTION_REASON_LABEL[r]}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Note (optional)</span>
                <input name="exceptionNote" type="text"
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper" />
              </label>
              {requiresReviewDate(exceptionReason) ? (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Revisit on</span>
                  <input name="reviewAt" type="date" required
                    className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper" />
                </label>
              ) : (
                <p className="text-xs font-sans text-amber-200">
                  Parks this case indefinitely{isContactBlocked(exceptionReason) ? " and blocks outbound messages" : ""}.
                </p>
              )}
            </div>
          )}
```

> `EXCEPTION_REASON_LABEL` is already imported from `format.ts` (now covers all 9). The review-date input is only rendered (and only `required`) for review-dated reasons, matching the Task 3 parser rule.

- [ ] **Step 2 (continued): keep the unused-import check clean**

If `requiresReviewDate`/`isContactBlocked`/`PRIMARY_EXCEPTION_STATES` are now the only `exceptions.ts` symbols used, ensure the import line matches exactly what is referenced (drop `isTerminal` if unused).

- [ ] **Step 3: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build`
Expected: exit 0; build clean.

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/components/LogContactDrawer.tsx
git commit -m "feat(exceptions): expanded reason picker + conditional review date in drawer (C2)"
```

---

## Task 9: DetailPanel — parked banner + messaging-blocked composer

**Files:**
- Modify: `nudgepay-app/app/components/DetailPanel.tsx:8, 61-99, 200-221, 631-639`

**Interfaces:**
- Consumes: `isContactBlocked`, `isTerminal`, `exceptionLabel` from `exceptions.ts`; `selected: CaseItem` (already carries `exceptionReason`, `nextActionAt`, `status`).

No unit test (no jsdom); verify via tsc + build.

- [ ] **Step 1: Update imports**

In `nudgepay-app/app/components/DetailPanel.tsx`, add to the lib imports (near line 8):

```ts
import { isContactBlocked, isTerminal } from "~/lib/exceptions";
```

Add a `blocked` SMS banner entry to `SMS_BANNER` (after the `error` entry, ~line 52):

```ts
  blocked: { text: "Not sent — this case is marked do-not-contact / legal.", tone: "text-hot" },
```

- [ ] **Step 2: Disable the composer for a blocked case**

In `MessagesTab`, compute the blocked flag near `noInvoice` (after line 94):

```ts
  const contactBlocked = isContactBlocked(selected.exceptionReason);
```

Update the composer's submit button disabled condition (line 215):

```tsx
              disabled={!consent || noInvoice || contactBlocked}
```

Update the helper text region (lines 208-212) so a blocked case explains itself:

```tsx
            {contactBlocked ? (
              <span className="text-xs text-hot">Messaging blocked — {exceptionLabel(selected.exceptionReason)}.</span>
            ) : noInvoice ? (
              <span className="text-xs text-muted">No invoice to reference.</span>
            ) : !consent ? (
              <span className="text-xs text-muted">Mark consent to enable sending.</span>
            ) : <span />}
```

> Add `exceptionLabel` to the import line in Step 1 (it is from `~/lib/exceptions`): `import { isContactBlocked, isTerminal, exceptionLabel } from "~/lib/exceptions";`.

- [ ] **Step 3: Enrich the exception banner with parked-until / indefinite**

Replace the existing exception banner block (lines 631-639) — currently:

```tsx
          {selected.status === "on_hold" && selected.exceptionReason ? (
```

with a version that states the hold horizon:

```tsx
          {selected.status === "on_hold" && selected.exceptionReason ? (
            <div className="rounded-md border border-border bg-panel/60 px-3 py-2">
              <p className="text-xs font-sans font-semibold text-text">
                Exception · {EXCEPTION_REASON_LABEL[selected.exceptionReason] ?? selected.exceptionReason}
                <span className="ml-1 font-normal text-muted">
                  {isTerminal(selected.exceptionReason)
                    ? "· parked indefinitely"
                    : selected.nextActionAt
                      ? `· parked until ${formatDate(selected.nextActionAt)}`
                      : ""}
                </span>
              </p>
              {selected.exceptionNote ? (
                <p className="mt-1 text-xs text-muted">{selected.exceptionNote}</p>
              ) : null}
            </div>
          ) : null}
```

> Match the surrounding markup of the original block (preserve whatever wrapper/classes existed at lines 631-639 if they differ; the key additions are the `isTerminal` / `parked until` line). `formatDate` is already imported in this file.

- [ ] **Step 4: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build`
Expected: exit 0; build clean.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/components/DetailPanel.tsx
git commit -m "feat(exceptions): parked banner + messaging-blocked composer in DetailPanel (C2)"
```

---

## Task 10: WorkQueue badge + MetricsStrip On-hold tile

**Files:**
- Modify: `nudgepay-app/app/components/WorkQueue.tsx:7, 185-195, 238-246`
- Modify: `nudgepay-app/app/components/MetricsStrip.tsx:80-90`

**Interfaces:**
- Consumes: `exceptionLabel` from `exceptions.ts`; `metrics.onHold` (Task 5) in `MetricsStrip`.

No unit test (no jsdom); verify via tsc + build.

- [ ] **Step 1: Add the exception badge in WorkQueue**

In `nudgepay-app/app/components/WorkQueue.tsx`, add the import (near line 7):

```ts
import { exceptionLabel } from "../lib/exceptions";
```

In the desktop row and mobile card, next to the status label (lines ~189 and ~242 render `STATUS_LABEL[item.status]`), add an exception badge when on hold. Insert immediately after the status label element in BOTH render sites:

```tsx
            {item.status === "on_hold" && item.exceptionReason ? (
              <span className="ml-1.5 inline-flex items-center rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-200">
                {exceptionLabel(item.exceptionReason)}
              </span>
            ) : null}
```

> `item` is a `CaseItem` with `status` and `exceptionReason`. Use literal Tailwind classes (no interpolation). Place the badge consistently in both the desktop status cell and the mobile status line.

- [ ] **Step 2: Add the On-hold tile in MetricsStrip**

In `nudgepay-app/app/components/MetricsStrip.tsx`, append the tile to the `tiles` array (after the `Broken promises` entry, line 86):

```tsx
    { label: "On hold", viewId: "waiting", accent: "ink", m: metrics.onHold },
```

Update the grid to fit a 7th tile (line 90):

```tsx
      className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-3 xl:grid-cols-7"
```

> `viewId: "waiting"` routes the tile to the Exceptions/On-hold view. Confirm `"ink"` is a valid `TileProps["accent"]`; if not, reuse an existing accent value already present in the file.

- [ ] **Step 3: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build`
Expected: exit 0; build clean.

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/components/WorkQueue.tsx nudgepay-app/app/components/MetricsStrip.tsx
git commit -m "feat(exceptions): queue exception badge + On-hold metric tile (C2)"
```

---

## Task 11: Docs — mark C2 complete + full-suite gate

**Files:**
- Modify: `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md:44`

- [ ] **Step 1: Run the full gate**

Run: `cd nudgepay-app && npx supabase db reset && npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc exit 0; full vitest suite green; client + SSR build clean.

- [ ] **Step 2: Update the checklist**

In `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md`, change the C2 line (line 44) from `[ ]` to `[x]` and append a completion note in the established style, e.g.:

```markdown
- [x] **C2 — Exception / dispute workflow.** ✅ **8c.** `collection_cases.exception_reason` widened to the 9-value taxonomy (migration `0015`); pure `exceptions.ts` owns the per-state policy (terminal = `legal_agency`/`do_not_contact`; the rest review-dated). Parked cases (`isCaseSuppressed`) drop out of active views + active metrics into an `onHold` bucket / Exceptions view, and resurface on their review date. Conditional review-date at log time; `do_not_contact`/`legal_agency` hard-block individual + bulk SMS (`sendInvoiceText` throws, `partitionEligibility` skips). Surfaced via the drawer picker, DetailPanel parked banner + blocked composer, and a queue badge.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md
git commit -m "docs: mark C2 complete (Phase 8c) in gap checklist"
```

---

## Final verification (whole branch)

After all tasks, confirm:
- `cd nudgepay-app && npx supabase db reset && npx tsc --noEmit && npx vitest run && npm run build` — all green.
- Cross-org isolation: every new read binds `org_id`; the service client is used only in the messaging paths where it already was.
- Suppression: terminal parked + future-review parked excluded from default/metrics; resurfaced review-dated cases reappear; Exceptions view shows all parked.
- Hard-block: `do_not_contact`/`legal_agency` cases cannot be sent individually or in bulk.
