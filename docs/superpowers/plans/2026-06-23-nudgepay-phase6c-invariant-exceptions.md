# Phase 6c — Hard Next-Action Invariant + Minimal Exceptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "every active case carries an explicit next action" an enforced invariant via a required `nextStep` at log time, and add `waiting`/`on_hold` (exception) deferred states with review dates.

**Architecture:** A required `nextStep` (follow_up / promise / waiting / exception) is captured in the log-contact drawer and applied as a single case-state write in the contact-log action. `next_action_at` doubles as the review date for deferred states, so the existing `follow-ups-due` predicate gives suppression + auto-resurfacing for free. The promise trigger moves from `outcome==='promise-to-pay'` to `nextStep==='promise'`.

**Tech Stack:** TypeScript, React Router v7 on Cloudflare Workers, Supabase Postgres + RLS, Vitest against local Supabase. Spec: `docs/superpowers/specs/2026-06-23-nudgepay-phase6c-invariant-exceptions-design.md`.

## Global Constraints

- **RLS boundary:** user client (RLS-scoped) for all user-triggered reads/writes (contact-log action, dashboard loader); service client only for sync-time reconciliation. Browser never touches the DB.
- **No `.server` on pure modules** imported by client components: `contact-log.ts`, `cases.ts`, `worklist.ts` must stay pure (no `node:*`, no I/O). RR7 bundler fails on a client→`.server` graph reference.
- **Tailwind v4:** only static literal class strings; no `text-${x}`. Use static record maps.
- **Vitest:** run `npx vitest run <file>` from `nudgepay-app/` (never `npm test`, never repo root). Fresh org + globally-unique data per test; never global truncation. Helpers: `serviceClient()`, `makeUserClient(email)` → `{ client, userId, accessToken }`. `fd` form helper: `tests/fd.ts`.
- **Component verification:** `npx tsc -b` then `npx react-router build`, both from `nudgepay-app/`. Apply a new migration to local Supabase with `npx supabase db reset` from `nudgepay-app/`.
- **Dates** are date-only `YYYY-MM-DD` strings compared lexically; display via `formatDate` (`app/lib/dates.ts`). Date validity via the existing `validDate` in `contact-log.ts`.
- **Exact enums:** `nextStep ∈ {follow_up, promise, waiting, exception}`; `exception_reason ∈ {disputed, payment_plan, do_not_contact, other}`. `status` already has `waiting`/`on_hold`; `next_action_type` already has `waiting`/`exception` (migration 0009) — no enum migration.
- **State mapping (verbatim):** follow_up→`working`/`follow_up`/followUpAt (clear exception cols); promise→`createPromiseForLog` (`promised`/`promise`/grace_until, clears exception cols); waiting→`waiting`/`waiting`/reviewAt (clear exception cols, cancel pending promise); exception→`on_hold`/`exception`/reviewAt (set reason+note, cancel pending promise). A review date is **required** for waiting + exception.
- **Conventional Commits**; commit co-author `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never `git add` untracked dirs; add only named files.

---

## File structure

**New:** `nudgepay-app/supabase/migrations/0011_case_exceptions.sql`; `nudgepay-app/tests/case-exceptions.test.ts`.

**Modified:** `app/lib/contact-log.ts` (nextStep parse), `app/routes/api.contact-logs.tsx` (nextStep state write + promise-cancel-on-defer), `app/lib/promise-create.server.ts` (clear exception cols), `app/lib/cases.ts` (waiting view + exception fields), `app/lib/worklist.ts` (`ViewId += 'waiting'`), `app/routes/dashboard.tsx` (load exception cols + waiting viewCount), `app/components/LogContactDrawer.tsx` (next-step UX), `app/components/DetailPanel.tsx` (exception display), `app/components/WorkQueue.tsx` (Waiting tab).

**Tests:** `tests/case-exceptions.test.ts` (new), `tests/contact-log.test.ts`, `tests/api-contact-logs.test.ts`, `tests/cases.test.ts`, `tests/dashboard-worklist.test.ts`.

---

### Task 1: Migration 0011 — exception columns

**Files:**
- Create: `nudgepay-app/supabase/migrations/0011_case_exceptions.sql`
- Test: `nudgepay-app/tests/case-exceptions.test.ts`

**Interfaces:**
- Produces: `collection_cases.exception_reason` (text, check in disputed/payment_plan/do_not_contact/other, nullable) + `collection_cases.exception_note` (text, nullable).

- [ ] **Step 1: Write the failing test** (`tests/case-exceptions.test.ts`)

```ts
import { expect, test } from "vitest";
import { serviceClient } from "./helpers";

test("collection_cases stores exception_reason + note and rejects a bad reason", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `ExcOrg ${Math.random()}` }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `exc-${Math.random()}`, name: "Acme" }).select("id").single();

  const { data: ok, error: okErr } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "on_hold",
    next_action_type: "exception", next_action_at: "2026-08-01",
    exception_reason: "disputed", exception_note: "customer disputes line 3",
  }).select("exception_reason, exception_note").single();
  expect(okErr).toBeNull();
  expect(ok!.exception_reason).toBe("disputed");
  expect(ok!.exception_note).toBe("customer disputes line 3");

  const { error: badErr } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "on_hold", exception_reason: "nope",
  });
  expect(badErr).not.toBeNull(); // check constraint rejects an unknown reason
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/case-exceptions.test.ts`
Expected: FAIL — `column "exception_reason" of relation "collection_cases" does not exist`.

- [ ] **Step 3: Write the migration** (`supabase/migrations/0011_case_exceptions.sql`)

```sql
-- Phase 6c: minimal exception placeholder on collection cases.
-- next_action_at doubles as the review date for waiting/on_hold; no review_at column.
alter table collection_cases
  add column exception_reason text
    check (exception_reason in ('disputed','payment_plan','do_not_contact','other')),
  add column exception_note text;
```

- [ ] **Step 4: Apply the migration and run the test**

Run: `cd nudgepay-app && npx supabase db reset` then `npx vitest run tests/case-exceptions.test.ts`
Expected: PASS (2 assertions: stored values; bad reason rejected).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/supabase/migrations/0011_case_exceptions.sql nudgepay-app/tests/case-exceptions.test.ts
git commit -m "feat: add exception_reason + exception_note to collection_cases (0011)"
```

---

### Task 2: contact-log parser — required nextStep

**Files:**
- Modify: `nudgepay-app/app/lib/contact-log.ts`
- Test: `nudgepay-app/tests/contact-log.test.ts` (extend + migrate existing calls)

**Interfaces:**
- Produces:
  - `NEXT_STEPS = ["follow_up","promise","waiting","exception"] as const`; `type NextStep = typeof NEXT_STEPS[number]`.
  - `EXCEPTION_REASONS = ["disputed","payment_plan","do_not_contact","other"] as const`; `type ExceptionReason = typeof EXCEPTION_REASONS[number]`.
  - `ContactLogFields` gains `nextStep: NextStep`, `reviewAt: string | null`, `exceptionReason: ExceptionReason | null`, `exceptionNote: string | null`.
  - New error codes: `bad-next-step`, `next-step-date`, `bad-exception` (existing `promise-required`/`bad-amount`/`bad-date`/`missing-case`/`bad-method`/`bad-outcome` retained).

- [ ] **Step 1: Write the failing test** (extend `tests/contact-log.test.ts`)

```ts
test("parse: requires a valid nextStep", () => {
  expect(parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "no-answer" })))
    .toEqual({ ok: false, error: "bad-next-step" });
});

test("parse: follow_up requires a date", () => {
  expect(parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "no-answer", nextStep: "follow_up" })))
    .toEqual({ ok: false, error: "next-step-date" });
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "no-answer", nextStep: "follow_up", followUpAt: "2026-07-01" }));
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.fields.followUpAt).toBe("2026-07-01");
});

test("parse: promise via nextStep needs amount + date", () => {
  expect(parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "promise-to-pay", nextStep: "promise" })))
    .toEqual({ ok: false, error: "promise-required" });
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "promise-to-pay", nextStep: "promise", promisedAmount: "500", promisedDate: "2026-07-01" }));
  expect(r.ok).toBe(true);
  if (r.ok) { expect(r.fields.promisedAmount).toBe(500); expect(r.fields.nextStep).toBe("promise"); }
});

test("parse: waiting needs a review date", () => {
  expect(parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "no-commitment", nextStep: "waiting" })))
    .toEqual({ ok: false, error: "next-step-date" });
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "no-commitment", nextStep: "waiting", reviewAt: "2026-07-08" }));
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.fields.reviewAt).toBe("2026-07-08");
});

test("parse: exception needs a valid reason + review date", () => {
  expect(parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "dispute", nextStep: "exception", reviewAt: "2026-07-08" })))
    .toEqual({ ok: false, error: "bad-exception" });
  expect(parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "dispute", nextStep: "exception", exceptionReason: "disputed" })))
    .toEqual({ ok: false, error: "next-step-date" });
  const r = parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "dispute", nextStep: "exception", exceptionReason: "disputed", exceptionNote: "line 3 wrong", reviewAt: "2026-07-08" }));
  expect(r.ok).toBe(true);
  if (r.ok) { expect(r.fields.exceptionReason).toBe("disputed"); expect(r.fields.exceptionNote).toBe("line 3 wrong"); expect(r.fields.reviewAt).toBe("2026-07-08"); }
});
```

Then **migrate the existing `tests/contact-log.test.ts` cases** that expect `ok:true`: add `nextStep` + its required field. Specifically:
- "parse: valid call with no promise" (`fd({ caseId:"case-1", invoiceId:"i1", method:"call", outcome:"no-answer" })`) → add `nextStep: "follow_up", followUpAt: "2026-07-01"`; the assertion on `followUpAt` (if any) stays valid.
- Any other `ok:true` parse in the file → add `nextStep: "follow_up", followUpAt: "2026-07-01"`.
- Tests asserting `missing-case` / `bad-method` / `bad-outcome` are unaffected (those checks run before `nextStep`).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/contact-log.test.ts`
Expected: FAIL — the new tests fail (`nextStep` not parsed) and migrated `ok:true` tests may fail on the new required field.

- [ ] **Step 3: Replace `parseContactLogForm`** in `contact-log.ts` (keep `CONTACT_METHODS`, `CONTACT_OUTCOMES`, `validDate`, `str`, `ParseResult`)

Add near the top (after the existing `CONTACT_OUTCOMES`):

```ts
export const NEXT_STEPS = ["follow_up", "promise", "waiting", "exception"] as const;
export type NextStep = (typeof NEXT_STEPS)[number];
export const EXCEPTION_REASONS = ["disputed", "payment_plan", "do_not_contact", "other"] as const;
export type ExceptionReason = (typeof EXCEPTION_REASONS)[number];
```

Extend `ContactLogFields`:

```ts
export type ContactLogFields = {
  caseId: string;
  invoiceId: string | null;
  customerId: string | null;
  method: ContactMethod;
  outcome: ContactOutcome;
  notes: string | null;
  nextStep: NextStep;
  followUpAt: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
  reviewAt: string | null;
  exceptionReason: ExceptionReason | null;
  exceptionNote: string | null;
};
```

Replace the body of `parseContactLogForm` from the `notes` line onward (drop the old `followUpRaw` block and the old `outcome === "promise-to-pay"` block):

```ts
export function parseContactLogForm(form: FormData): ParseResult {
  const caseId = str(form, "caseId");
  if (!caseId) return { ok: false, error: "missing-case" };

  const invoiceId = str(form, "invoiceId"); // optional
  const customerId = str(form, "customerId");

  const method = str(form, "method");
  if (!method || !CONTACT_METHODS.includes(method as ContactMethod)) return { ok: false, error: "bad-method" };

  const outcome = str(form, "outcome");
  if (!outcome || !CONTACT_OUTCOMES.includes(outcome as ContactOutcome)) return { ok: false, error: "bad-outcome" };

  const notes = str(form, "notes");

  const nextStep = str(form, "nextStep");
  if (!nextStep || !NEXT_STEPS.includes(nextStep as NextStep)) return { ok: false, error: "bad-next-step" };

  let followUpAt: string | null = null;
  let promisedAmount: number | null = null;
  let promisedDate: string | null = null;
  let reviewAt: string | null = null;
  let exceptionReason: ExceptionReason | null = null;
  let exceptionNote: string | null = null;

  if (nextStep === "follow_up") {
    const d = str(form, "followUpAt");
    if (!d || !validDate(d)) return { ok: false, error: "next-step-date" };
    followUpAt = d;
  } else if (nextStep === "promise") {
    const amountRaw = str(form, "promisedAmount");
    const dateRaw = str(form, "promisedDate");
    if (!amountRaw || !dateRaw) return { ok: false, error: "promise-required" };
    const n = Number(amountRaw);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "bad-amount" };
    if (!validDate(dateRaw)) return { ok: false, error: "bad-date" };
    promisedAmount = n;
    promisedDate = dateRaw;
  } else if (nextStep === "waiting") {
    const d = str(form, "reviewAt");
    if (!d || !validDate(d)) return { ok: false, error: "next-step-date" };
    reviewAt = d;
  } else if (nextStep === "exception") {
    const r = str(form, "exceptionReason");
    if (!r || !EXCEPTION_REASONS.includes(r as ExceptionReason)) return { ok: false, error: "bad-exception" };
    const d = str(form, "reviewAt");
    if (!d || !validDate(d)) return { ok: false, error: "next-step-date" };
    exceptionReason = r as ExceptionReason;
    reviewAt = d;
    exceptionNote = str(form, "exceptionNote");
  }

  return {
    ok: true,
    fields: {
      caseId, invoiceId, customerId,
      method: method as ContactMethod,
      outcome: outcome as ContactOutcome,
      notes,
      nextStep: nextStep as NextStep,
      followUpAt, promisedAmount, promisedDate,
      reviewAt, exceptionReason, exceptionNote,
    },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `cd nudgepay-app && npx vitest run tests/contact-log.test.ts`
Expected: PASS (new + migrated).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/contact-log.ts nudgepay-app/tests/contact-log.test.ts
git commit -m "feat: require nextStep in contact-log parser (follow_up/promise/waiting/exception)"
```

---

### Task 3: contact-log action — apply nextStep state + cancel-on-defer

**Files:**
- Modify: `nudgepay-app/app/routes/api.contact-logs.tsx`, `nudgepay-app/app/lib/promise-create.server.ts`
- Test: `nudgepay-app/tests/api-contact-logs.test.ts` (extend + migrate parse calls)

**Interfaces:**
- Consumes: `parseContactLogForm` (Task 2; `fields.nextStep`, `reviewAt`, `exceptionReason`, `exceptionNote`), `createPromiseForLog`.
- Produces: the action writes the §state-mapping case update; `nextStep ∈ {waiting, exception}` cancels any pending promise; `createPromiseForLog` clears exception cols.

- [ ] **Step 1: Write the failing test** (extend `tests/api-contact-logs.test.ts`)

The action is awkward to call directly, so test a new exported helper `applyNextStep` that performs the case write + cancel-on-defer. Add to `tests/api-contact-logs.test.ts`:

```ts
import { applyNextStep } from "../app/lib/next-step.server";

async function seedCase(svc: ReturnType<typeof serviceClient>, suffix: string, status = "working") {
  const { data: org } = await svc.from("organizations").insert({ name: `NS ${suffix} ${Math.random()}` }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers").insert({ org_id: orgId, qbo_id: `ns-${suffix}-${Math.random()}`, name: "Acme" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases").insert({ org_id: orgId, customer_id: cust!.id, status }).select("id").single();
  return { orgId, customerId: cust!.id, caseId: cse!.id };
}

test("applyNextStep waiting sets waiting state + review date and clears exception cols", async () => {
  const svc = serviceClient();
  const { orgId, caseId } = await seedCase(svc, "wait", "on_hold");
  await svc.from("collection_cases").update({ exception_reason: "disputed", exception_note: "x" }).eq("id", caseId);
  const res = await applyNextStep(svc, caseId, { nextStep: "waiting", followUpAt: null, promisedAmount: null, promisedDate: null, reviewAt: "2026-07-08", exceptionReason: null, exceptionNote: null });
  expect(res.ok).toBe(true);
  const { data: c } = await svc.from("collection_cases").select("status, next_action_type, next_action_at, exception_reason, exception_note").eq("id", caseId).single();
  expect(c!.status).toBe("waiting");
  expect(c!.next_action_type).toBe("waiting");
  expect(c!.next_action_at).toBe("2026-07-08");
  expect(c!.exception_reason).toBeNull();
  expect(c!.exception_note).toBeNull();
});

test("applyNextStep exception sets on_hold + reason/note", async () => {
  const svc = serviceClient();
  const { caseId } = await seedCase(svc, "exc");
  const res = await applyNextStep(svc, caseId, { nextStep: "exception", followUpAt: null, promisedAmount: null, promisedDate: null, reviewAt: "2026-07-08", exceptionReason: "payment_plan", exceptionNote: "3 installments" });
  expect(res.ok).toBe(true);
  const { data: c } = await svc.from("collection_cases").select("status, next_action_type, next_action_at, exception_reason, exception_note").eq("id", caseId).single();
  expect(c!.status).toBe("on_hold");
  expect(c!.next_action_type).toBe("exception");
  expect(c!.exception_reason).toBe("payment_plan");
  expect(c!.exception_note).toBe("3 installments");
});

test("applyNextStep waiting cancels a pending promise without resetting the case", async () => {
  const svc = serviceClient();
  const { orgId, customerId, caseId } = await seedCase(svc, "cancel", "promised");
  const { data: prom } = await svc.from("promises").insert({
    org_id: orgId, case_id: caseId, customer_id: customerId, status: "pending",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03", baseline_balance: 1200,
  }).select("id").single();
  const res = await applyNextStep(svc, caseId, { nextStep: "waiting", followUpAt: null, promisedAmount: null, promisedDate: null, reviewAt: "2026-07-08", exceptionReason: null, exceptionNote: null });
  expect(res.ok).toBe(true);
  const { data: p } = await svc.from("promises").select("status").eq("id", prom!.id).single();
  expect(p!.status).toBe("cancelled");
  const { data: c } = await svc.from("collection_cases").select("status").eq("id", caseId).single();
  expect(c!.status).toBe("waiting"); // NOT reset to working
});

test("applyNextStep follow_up sets working + follow-up date, leaves a pending promise intact", async () => {
  const svc = serviceClient();
  const { orgId, customerId, caseId } = await seedCase(svc, "fu", "promised");
  const { data: prom } = await svc.from("promises").insert({
    org_id: orgId, case_id: caseId, customer_id: customerId, status: "pending",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03", baseline_balance: 1200,
  }).select("id").single();
  const res = await applyNextStep(svc, caseId, { nextStep: "follow_up", followUpAt: "2026-07-05", promisedAmount: null, promisedDate: null, reviewAt: null, exceptionReason: null, exceptionNote: null });
  expect(res.ok).toBe(true);
  const { data: c } = await svc.from("collection_cases").select("status, next_action_type, next_action_at").eq("id", caseId).single();
  expect(c!.status).toBe("working");
  expect(c!.next_action_at).toBe("2026-07-05");
  const { data: p } = await svc.from("promises").select("status").eq("id", prom!.id).single();
  expect(p!.status).toBe("pending"); // untouched
});
```

Also **migrate existing parse-test `fd(...)` calls** in this file that expect `ok:true` to include `nextStep` + its field (same as Task 2's migration), and the existing `createPromiseForLog` test stays valid.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/api-contact-logs.test.ts`
Expected: FAIL — cannot find module `next-step.server`.

- [ ] **Step 3: Create `app/lib/next-step.server.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

// The forward-action fields parsed from a contact log (subset of ContactLogFields).
export type NextStepInput = {
  nextStep: "follow_up" | "promise" | "waiting" | "exception";
  followUpAt: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
  reviewAt: string | null;
  exceptionReason: "disputed" | "payment_plan" | "do_not_contact" | "other" | null;
  exceptionNote: string | null;
};

// Applies a non-promise nextStep to a case (the promise branch is handled by the
// caller via createPromiseForLog). All writes go through the supplied user/RLS
// client. waiting/exception first cancel any pending promise so the evaluator
// cannot later flip the deferred case back to working.
export async function applyNextStep(
  client: SupabaseClient, caseId: string, f: NextStepInput,
): Promise<{ ok: boolean }> {
  if (f.nextStep === "waiting" || f.nextStep === "exception") {
    const { error: cancelErr } = await client
      .from("promises")
      .update({ status: "cancelled", resolved_at: new Date().toISOString() })
      .eq("case_id", caseId).eq("status", "pending");
    if (cancelErr) return { ok: false };
  }

  let update: Record<string, unknown>;
  if (f.nextStep === "follow_up") {
    update = { status: "working", next_action_type: "follow_up", next_action_at: f.followUpAt, exception_reason: null, exception_note: null };
  } else if (f.nextStep === "waiting") {
    update = { status: "waiting", next_action_type: "waiting", next_action_at: f.reviewAt, exception_reason: null, exception_note: null };
  } else {
    // exception
    update = { status: "on_hold", next_action_type: "exception", next_action_at: f.reviewAt, exception_reason: f.exceptionReason, exception_note: f.exceptionNote };
  }

  const { error } = await client.from("collection_cases").update(update).eq("id", caseId);
  if (error) return { ok: false };
  return { ok: true };
}
```

- [ ] **Step 4: Rewrite the tail of `api.contact-logs.tsx`** (replace the `caseUpdate` block + the `outcome === "promise-to-pay"` block)

Add imports:

```ts
import { applyNextStep } from "../lib/next-step.server";
```

Replace from after the `contact_logs` insert (`const contactLogId = logRow.id;`) through the end:

```ts
  if (f.nextStep === "promise" && f.promisedAmount != null && f.promisedDate != null) {
    const res = await createPromiseForLog(supabase, {
      orgId: org.org_id, caseId: f.caseId, customerId: f.customerId, userId: user.id,
      contactLogId, promisedAmount: f.promisedAmount, promisedDate: f.promisedDate,
    });
    if (!res.ok) return redirect(withError(returnTo, "save-failed"), { headers });
  } else {
    const res = await applyNextStep(supabase, f.caseId, f);
    if (!res.ok) return redirect(withError(returnTo, "save-failed"), { headers });
  }

  return redirect(returnTo, { headers });
```

Also update the `contact_logs` insert so `follow_up_at`/`promised_*` only carry their branch's data:

```ts
    follow_up_at: f.nextStep === "follow_up" ? f.followUpAt : null,
    promised_amount: f.nextStep === "promise" ? f.promisedAmount : null,
    promised_date: f.nextStep === "promise" ? f.promisedDate : null,
```

- [ ] **Step 5: Clear exception cols in `createPromiseForLog`** (`promise-create.server.ts`) — extend its final case update:

```ts
  const { error: caseErr } = await client.from("collection_cases")
    .update({ status: "promised", next_action_type: "promise", next_action_at: graceUntil, exception_reason: null, exception_note: null })
    .eq("id", input.caseId);
```

- [ ] **Step 6: Run the test, then commit**

Run: `cd nudgepay-app && npx vitest run tests/api-contact-logs.test.ts`
Expected: PASS.

```bash
git add nudgepay-app/app/lib/next-step.server.ts nudgepay-app/app/routes/api.contact-logs.tsx nudgepay-app/app/lib/promise-create.server.ts nudgepay-app/tests/api-contact-logs.test.ts
git commit -m "feat: apply nextStep case state + cancel-on-defer in contact-log action"
```

---

### Task 4: cases.ts — waiting view + exception fields

**Files:**
- Modify: `nudgepay-app/app/lib/cases.ts`, `nudgepay-app/app/lib/worklist.ts`
- Test: `nudgepay-app/tests/cases.test.ts` (extend)

**Interfaces:**
- Produces:
  - `worklist.ts`: `ViewId` gains `"waiting"`.
  - `cases.ts`: `CaseRow` gains `exceptionReason: ExceptionReason | null`, `exceptionNote: string | null`; `CaseItem` gains the same two fields; `buildCaseItems` passes them through; `applyCaseView` handles `"waiting"` (`status in waiting/on_hold`). Imports `ExceptionReason` type from `./contact-log`.

- [ ] **Step 1: Write the failing test** (extend `tests/cases.test.ts`)

```ts
test("waiting view selects waiting + on_hold cases; exception fields flow through", () => {
  const cases: CaseRow[] = [
    { id: "c-w", customerId: "x1", status: "waiting", nextActionType: "waiting", nextActionAt: "2026-07-20", exceptionReason: null, exceptionNote: null },
    { id: "c-h", customerId: "x2", status: "on_hold", nextActionType: "exception", nextActionAt: "2026-07-20", exceptionReason: "disputed", exceptionNote: "line 3" },
    { id: "c-o", customerId: "x3", status: "working", nextActionType: "follow_up", nextActionAt: "2026-07-01", exceptionReason: null, exceptionNote: null },
  ];
  const invoices = [
    { id: "i1", qbo_doc_number: "1", customer_id: "x1", balance: 100, due_date: "2026-03-01" },
    { id: "i2", qbo_doc_number: "2", customer_id: "x2", balance: 100, due_date: "2026-03-01" },
    { id: "i3", qbo_doc_number: "3", customer_id: "x3", balance: 100, due_date: "2026-03-01" },
  ];
  const customers = [
    { id: "x1", name: "W", phone: null, email: null, owner: null },
    { id: "x2", name: "H", phone: null, email: null, owner: null },
    { id: "x3", name: "O", phone: null, email: null, owner: null },
  ];
  const items = buildCaseItems(cases, invoices, customers, [], [], "2026-07-10", new Map());
  const hold = items.find((i) => i.caseId === "c-h")!;
  expect(hold.exceptionReason).toBe("disputed");
  expect(hold.exceptionNote).toBe("line 3");

  const waiting = applyCaseView(items, "waiting", "2026-07-10", null).map((i) => i.caseId).sort();
  expect(waiting).toEqual(["c-h", "c-w"]);

  // The two deferred cases have a future review date -> excluded from follow-ups-due.
  const due = applyCaseView(items, "follow-ups-due", "2026-07-10", null).map((i) => i.caseId);
  expect(due).toEqual(["c-o"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: FAIL — `CaseRow`/`CaseItem` lack exception fields; `applyCaseView` has no `"waiting"`.

- [ ] **Step 3: Edit `worklist.ts`** — add `"waiting"` to `ViewId`:

```ts
export type ViewId = "all-open" | "30-plus" | "high-value" | "never-contacted" | "follow-ups-due" | "broken-promises" | "waiting" | "my-work";
```

- [ ] **Step 4: Edit `cases.ts`**

Add the import:

```ts
import type { ExceptionReason } from "./contact-log";
```

Extend `CaseRow` (add the two fields after `nextActionAt`):

```ts
  exceptionReason: ExceptionReason | null;
  exceptionNote: string | null;
```

Extend `CaseItem` (add after `amountReceived`):

```ts
  exceptionReason: ExceptionReason | null;
  exceptionNote: string | null;
```

In `buildCaseItems`'s returned object, add (near `nextActionAt`):

```ts
      exceptionReason: cse.exceptionReason,
      exceptionNote: cse.exceptionNote,
```

Add the `waiting` predicate to `applyCaseView` (before the `my-work` line):

```ts
  if (view === "waiting") return items.filter((i) => i.status === "waiting" || i.status === "on_hold");
```

- [ ] **Step 5: Run the test**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: PASS. Then `npx tsc -b` — expect transient errors ONLY in `dashboard.tsx` (the `CaseRow` map at ~line 287 lacks exception fields; `ALL_VIEWS`/empty-state `viewCounts` lack `"waiting"`); Task 5 resolves them. `cases.ts`/`worklist.ts`/`tests/cases.test.ts` must be type-clean.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/lib/cases.ts nudgepay-app/app/lib/worklist.ts nudgepay-app/tests/cases.test.ts
git commit -m "feat: add waiting view and exception fields to cases"
```

---

### Task 5: dashboard loader — load exception cols + waiting viewCount

**Files:**
- Modify: `nudgepay-app/app/routes/dashboard.tsx`
- Test: `nudgepay-app/tests/dashboard-worklist.test.ts` (extend)

**Interfaces:**
- Consumes: `CaseRow` (now with exception fields), `ViewId` (now with `"waiting"`).
- Produces: loader selects `exception_reason, exception_note` and maps them into `CaseRow`; `ALL_VIEWS` + the empty-state `viewCounts` include `"waiting"`.

- [ ] **Step 1: Write the failing test** (extend `tests/dashboard-worklist.test.ts`)

```ts
test("buildCaseData counts the waiting view", () => {
  const cases: CaseRow[] = [
    { id: "w1", customerId: "c1", status: "waiting", nextActionType: "waiting", nextActionAt: "2026-07-20", exceptionReason: null, exceptionNote: null },
    { id: "o1", customerId: "c2", status: "working", nextActionType: "follow_up", nextActionAt: "2026-07-01", exceptionReason: null, exceptionNote: null },
  ];
  const invoices = [
    { id: "i1", qbo_doc_number: "1", customer_id: "c1", balance: 100, due_date: "2026-03-01" },
    { id: "i2", qbo_doc_number: "2", customer_id: "c2", balance: 100, due_date: "2026-03-01" },
  ];
  const customers = [
    { id: "c1", name: "W", phone: null, email: null, owner: null },
    { id: "c2", name: "O", phone: null, email: null, owner: null },
  ];
  const data = buildCaseData(cases, invoices, customers, [], [],
    { view: "waiting", sort: "recommended", q: "", caseId: null }, "2026-07-10", new Map(), null);
  expect(data.viewCounts.waiting).toBe(1);
  expect(data.items.map((i) => i.caseId)).toEqual(["w1"]);
});
```

Also **migrate** any existing `CaseRow` literals in `tests/dashboard-worklist.test.ts` (the "composes case items…" and "search filter…" tests) to include `exceptionReason: null, exceptionNote: null`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/dashboard-worklist.test.ts`
Expected: FAIL — `viewCounts.waiting` undefined / `CaseRow` literals missing exception fields.

- [ ] **Step 3: Edit `dashboard.tsx`**

Add `"waiting"` to `ALL_VIEWS`:

```ts
const ALL_VIEWS: ViewId[] = ["all-open", "30-plus", "high-value", "never-contacted", "follow-ups-due", "broken-promises", "waiting", "my-work"];
```

Add `"waiting": 0` to the empty-state `viewCounts` object:

```ts
    viewCounts: {
      "all-open": 0, "30-plus": 0, "high-value": 0,
      "never-contacted": 0, "follow-ups-due": 0, "broken-promises": 0, "waiting": 0, "my-work": 0,
    },
```

Extend `CaseRowRaw` + the cases SELECT + the `CaseRow` map:

```ts
type CaseRowRaw = {
  id: string;
  customer_id: string;
  status: string;
  next_action_type: string | null;
  next_action_at: string | null;
  exception_reason: string | null;
  exception_note: string | null;
};
```

```ts
    const { data: caseRows } = await supabase
      .from("collection_cases")
      .select("id, customer_id, status, next_action_type, next_action_at, exception_reason, exception_note")
      .eq("org_id", org.org_id)
      .is("closed_at", null);
    const cases: CaseRow[] = ((caseRows as CaseRowRaw[]) ?? []).map((r) => ({
      id: r.id, customerId: r.customer_id, status: r.status as CaseStatus,
      nextActionType: r.next_action_type as NextActionType | null, nextActionAt: r.next_action_at,
      exceptionReason: r.exception_reason as ExceptionReason | null, exceptionNote: r.exception_note,
    }));
```

Add the `ExceptionReason` import to the `cases` import group:

```ts
import { buildCaseItems, applyCaseView, sortCaseItems, computeCaseMetrics,
  type CaseRow, type CaseItem, type CasePromiseInput, type CaseLastContactInput } from "../lib/cases";
import type { ExceptionReason } from "../lib/contact-log";
```

(If `dashboard.tsx` already imports types from `../lib/contact-log`, add `ExceptionReason` to that import instead.)

- [ ] **Step 4: Run the test, then typecheck**

Run: `cd nudgepay-app && npx vitest run tests/dashboard-worklist.test.ts`
Expected: PASS. Then `npx tsc -b` — the loader is now type-clean; only `LogContactDrawer`/`DetailPanel`/`WorkQueue` (Task 6) may still error (they don't reference the new fields yet, so likely already clean — report what remains).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/routes/dashboard.tsx nudgepay-app/tests/dashboard-worklist.test.ts
git commit -m "feat: load exception cols and count the waiting view in the loader"
```

---

### Task 6: UI — next-step drawer + exception display + Waiting tab

**Files:**
- Modify: `nudgepay-app/app/components/LogContactDrawer.tsx`, `nudgepay-app/app/components/DetailPanel.tsx`, `nudgepay-app/app/components/WorkQueue.tsx`
- Verify: `npx tsc -b` + `npx react-router build` + full suite

**Interfaces:**
- Consumes: `CaseItem.exceptionReason`/`exceptionNote` (Task 4); the action's `nextStep` form fields (Task 3).

- [ ] **Step 1: Rework `LogContactDrawer.tsx`** — add a required Next-step selector and conditional fields.

Add the next-step labels + extend `ERROR_MESSAGE` (near the existing maps):

```tsx
const NEXT_STEP_LABEL: Record<string, string> = {
  follow_up: "Follow up", promise: "Promise to pay", waiting: "Waiting on customer", exception: "Exception (hold)",
};
const EXCEPTION_REASON_LABEL: Record<string, string> = {
  disputed: "Disputed", payment_plan: "Payment plan", do_not_contact: "Do not contact", other: "Other",
};
```

Add to `ERROR_MESSAGE`:

```tsx
  "bad-next-step": "Choose a next step.",
  "next-step-date": "Enter a valid date for the next step.",
  "bad-exception": "Choose an exception reason.",
```

Replace the `outcome`-driven promise toggle with a `nextStep` state and add the control + conditional blocks. After the existing `const [outcome, setOutcome] = useState<string>("no-answer");` add:

```tsx
  const [nextStep, setNextStep] = useState<string>("follow_up");
```

Replace `const showPromise = outcome === "promise-to-pay";` with:

```tsx
  const showPromise = nextStep === "promise";
```

In the `<Form>`, after the Notes field, REPLACE the old "Follow up (optional)" block with the required Next-step selector + conditional fields:

```tsx
          <label className="flex flex-col gap-1">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Next step</span>
            <select
              name="nextStep"
              value={nextStep}
              onChange={(e) => setNextStep(e.target.value)}
              className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              {["follow_up", "promise", "waiting", "exception"].map((s) => (
                <option key={s} value={s}>{NEXT_STEP_LABEL[s]}</option>
              ))}
            </select>
          </label>

          {nextStep === "follow_up" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Follow up on</span>
              <input name="followUpAt" type="date" required
                className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper" />
            </label>
          )}

          {nextStep === "waiting" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Revisit on</span>
              <input name="reviewAt" type="date" required
                className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper" />
            </label>
          )}

          {nextStep === "exception" && (
            <div className="grid gap-3 rounded-md bg-panel/60 border border-border p-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Reason</span>
                <select name="exceptionReason" defaultValue="disputed"
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper">
                  {["disputed", "payment_plan", "do_not_contact", "other"].map((r) => (
                    <option key={r} value={r}>{EXCEPTION_REASON_LABEL[r]}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Note (optional)</span>
                <input name="exceptionNote" type="text"
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Revisit on</span>
                <input name="reviewAt" type="date" required
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper" />
              </label>
            </div>
          )}
```

The existing `showPromise` promise block (amount + `promisedDate`) stays where it is — it now renders when `nextStep === "promise"`.

- [ ] **Step 2: Add exception display to `DetailPanel.tsx`** — a static reason map + a panel shown when `selected.status === "on_hold"`.

Near the other static maps:

```tsx
const EXCEPTION_REASON_LABEL: Record<string, string> = {
  disputed: "Disputed", payment_plan: "Payment plan", do_not_contact: "Do not contact", other: "Other",
};
```

In the Overview tab, after the status/next-action lines, render:

```tsx
{selected.status === "on_hold" && selected.exceptionReason ? (
  <div className="rounded-lg border border-border bg-panel px-4 py-3">
    <span className="text-sm font-sans font-semibold text-warm">
      Exception · {EXCEPTION_REASON_LABEL[selected.exceptionReason] ?? selected.exceptionReason}
    </span>
    {selected.exceptionNote ? (
      <p className="mt-1 text-xs text-muted">{selected.exceptionNote}</p>
    ) : null}
  </div>
) : null}
```

- [ ] **Step 3: Add the Waiting tab to `WorkQueue.tsx`** `SAVED_VIEWS`:

```tsx
const SAVED_VIEWS: { id: ViewId; label: string }[] = [
  { id: "all-open",         label: "All open" },
  { id: "30-plus",          label: "30+ days" },
  { id: "high-value",       label: "High value" },
  { id: "never-contacted",  label: "Never contacted" },
  { id: "follow-ups-due",   label: "Follow-ups due" },
  { id: "broken-promises",  label: "Broken promises" },
  { id: "waiting",          label: "Waiting" },
  { id: "my-work",          label: "My work" },
];
```

- [ ] **Step 4: Verify build**

Run: `cd nudgepay-app && npx tsc -b && npx react-router build`
Expected: tsc clean; build succeeds (no client→`.server` import — `LogContactDrawer`/`DetailPanel`/`WorkQueue` import only `cases.ts`/`contact-log.ts` types + route actions by URL).

- [ ] **Step 5: Run the full suite, then commit**

Run: `cd nudgepay-app && npx vitest run`
Expected: all tests pass.

```bash
git add nudgepay-app/app/components/LogContactDrawer.tsx nudgepay-app/app/components/DetailPanel.tsx nudgepay-app/app/components/WorkQueue.tsx
git commit -m "feat: required next-step drawer, exception display, and Waiting tab"
```

---

## Final verification (after Task 6)

- [ ] `cd nudgepay-app && npx vitest run` — full suite green.
- [ ] `cd nudgepay-app && npx tsc -b && npx react-router build` — typecheck + build clean.
- [ ] Spot-check the demo: log a contact with each next-step (follow_up / waiting / exception / promise) and confirm the case status, the Waiting view, the exception panel, and follow-ups-due suppression behave per the spec.

## Notes for the implementer

- **Service vs user client:** the contact-log action and `applyNextStep`/`createPromiseForLog` run with the **user** client (RLS). Never use the service client there.
- **Transient build-red is expected** between Task 4 (adds `"waiting"` to `ViewId` + exception fields to `CaseRow`) and Task 5 (updates the loader). Confirm via `tsc -b` that errors are confined to `dashboard.tsx`, nothing in `cases.ts`.
- **`next_action_at` is the review date** for `waiting`/`on_hold`; do not add a `review_at` column.
- **`outcome` is descriptive only now** — it no longer triggers the promise; `nextStep === "promise"` does.
