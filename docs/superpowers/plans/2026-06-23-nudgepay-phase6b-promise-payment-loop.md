# Phase 6b — Promise + Payment Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture promises-to-pay as a first-class entity, sync QBO payments/credit-memos, and automatically classify promises as kept / partially kept / broken from invoice balance deltas — payment-validated and grace-aware — while fixing the periodic-sync staleness bug.

**Architecture:** Mirror the proven 6a lifecycle pattern — pure evaluators (`business-days.ts`, `promises.ts`) plus a server applier (`promise-evaluation.server.ts`) wired into the existing sync paths right after `applyCaseReconciliation`. Promise *state* lives in a new `promises` table; `contact_logs.promised_*` columns remain only as the log snapshot.

**Tech Stack:** TypeScript, React Router v7 on Cloudflare Workers, Supabase Postgres + RLS, Vitest against local Supabase. Spec: `docs/superpowers/specs/2026-06-23-nudgepay-phase6b-promise-payment-loop-design.md`.

## Global Constraints

- **RLS boundary:** user client (`@supabase/ssr`, RLS-scoped) for all reads/writes triggered by a user request; **service client** only for connection status, member roster, and sync-time reconciliation/evaluation. Browser never touches the DB.
- **No `.server` on pure modules** imported by client components or shared with route modules: `business-days.ts`, `promises.ts`, `cases.ts` must be pure (no `node:*`, no I/O). `.server.ts` only for server-only modules. RR7 bundler fails the build on a client→`.server` module-graph reference.
- **No `node:*` imports in `app/**`** (Workers runtime). Crypto via Web Crypto.
- **Tailwind v4:** only static literal class strings; no `text-${x}`. Use static record maps.
- **Vitest:** run `npx vitest run <file>` from `nudgepay-app/` (never `npm test`, never from repo root). Each test creates a **fresh org** with **globally-unique** data; **never** truncate globally. Helpers: `serviceClient()`, `makeUserClient(email)` → `{ client, userId, accessToken }`.
- **Component verification:** `npx tsc -b` then `npx react-router build`, both from `nudgepay-app/`.
- **Money** NaN-guarded (never write NaN to a numeric column). **Dates** are date-only `YYYY-MM-DD` strings compared lexically; format for display only via `formatDate` (`app/lib/dates.ts`).
- **Idempotency:** Postgres `23505` (unique_violation) swallowed on idempotent inserts/upserts.
- **Grace:** `GRACE_BUSINESS_DAYS = 2`, weekend-skip, no holiday calendar, no per-org config (deferred to C7).
- **Conventional Commits**; commit co-author trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never `git add` untracked dirs (`.idea/`, `node_modules/`, `scripts/`, `nudgepay-frontend/`, `nudgepay-backend/`); add only named files.
- **Promise classification:** `received = max(0, baseline_balance − current_linked_balance)`; `received ≥ promised_amount` → kept; past grace & `received>0` → partially_kept; past grace & `received≈0` → broken; before grace & not fully kept → pending. Terminal states never re-evaluated.

---

## File structure

**New files**
- `nudgepay-app/supabase/migrations/0010_promise_payment_loop.sql` — `promises`, `promise_invoices`, `payments` tables; RLS; indexes; backfill.
- `nudgepay-app/app/lib/business-days.ts` — pure `addBusinessDays` + `GRACE_BUSINESS_DAYS`.
- `nudgepay-app/app/lib/promises.ts` — pure promise types + `evaluatePromise`/`evaluatePromises`.
- `nudgepay-app/app/lib/promise-evaluation.server.ts` — `applyPromiseEvaluation` server applier.
- `nudgepay-app/app/routes/api.promises.cancel.tsx` — manual cancel action.

**Modified files**
- `app/lib/qbo-mappers.server.ts` — `PaymentUpsert` + `mapQboPayment`.
- `app/lib/qbo-webhook.server.ts` — dual-format (legacy + CloudEvents) parse.
- `app/lib/qbo-api.server.ts` — Payment/CreditMemo in CDC + query/read unions.
- `app/lib/qbo-sync.server.ts` — `upsertPayments`, `applyPaymentWebhook`, B3 re-pull, `applyPromiseEvaluation` wiring.
- `app/routes/webhooks.qbo.tsx` — Payment/CreditMemo dispatch.
- `app/routes/api.contact-logs.tsx` — promise creation + supersede.
- `app/lib/cases.ts` — `promise`/`brokenPromise`/`promiseStatus`/`amountReceived`; case-keyed last-contact.
- `app/routes/dashboard.tsx` — load promises; re-thread last-contact by `case_id`.
- `app/components/DetailPanel.tsx` — promise card + cancel button.
- `app/components/WorkQueue.tsx` — promise indicator.

**Test files** (new unless noted): `tests/business-days.test.ts`, `tests/promises.test.ts`, `tests/payments-mappers.test.ts`, `tests/qbo-webhook.test.ts` (extend if present), `tests/qbo-api.test.ts` (extend if present), `tests/promise-evaluation-rls.test.ts`, `tests/qbo-sync-payments.test.ts`, `tests/api-contact-logs.test.ts` (extend), `tests/api-promises-cancel.test.ts`, `tests/cases.test.ts` (extend), `tests/dashboard-worklist.test.ts` (extend).

---

### Task 1: Migration 0010 — promises, promise_invoices, payments

**Files:**
- Create: `nudgepay-app/supabase/migrations/0010_promise_payment_loop.sql`
- Test: `nudgepay-app/tests/promise-evaluation-rls.test.ts` (schema/RLS smoke; expanded in Task 7)

**Interfaces:**
- Produces: tables `promises`, `promise_invoices`, `payments` with RLS `is_org_member(org_id)`; partial unique index `promises_one_active_per_case`.

- [ ] **Step 1: Write the failing test** (`tests/promise-evaluation-rls.test.ts`)

```ts
import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

test("promises: RLS isolates by org and one-active-per-case index holds", async () => {
  const svc = serviceClient();
  const a = await makeUserClient("promises-rls-a@example.com");
  const b = await makeUserClient("promises-rls-b@example.com");

  const { data: orgA } = await svc.from("organizations").insert({ name: `PromOrgA ${a.userId}` }).select("id").single();
  const { data: orgB } = await svc.from("organizations").insert({ name: `PromOrgB ${b.userId}` }).select("id").single();
  await svc.from("memberships").insert([
    { org_id: orgA!.id, user_id: a.userId, role: "owner" },
    { org_id: orgB!.id, user_id: b.userId, role: "owner" },
  ]);
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgA!.id, qbo_id: `prc-${a.userId}`, name: "Acme" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgA!.id, customer_id: cust!.id, status: "promised" }).select("id").single();

  const { error: insErr } = await svc.from("promises").insert({
    org_id: orgA!.id, case_id: cse!.id, customer_id: cust!.id,
    status: "pending", promised_amount: 500, promised_date: "2026-07-01",
    grace_until: "2026-07-03", baseline_balance: 1200,
  });
  expect(insErr).toBeNull();

  // Member A reads its own promise; member B sees nothing.
  const { data: seenByA } = await a.client.from("promises").select("id").eq("org_id", orgA!.id);
  expect(seenByA!.length).toBe(1);
  const { data: seenByB } = await b.client.from("promises").select("id").eq("org_id", orgA!.id);
  expect(seenByB!.length).toBe(0);

  // Second pending promise on the same case violates the partial-unique index.
  const { error: dupErr } = await svc.from("promises").insert({
    org_id: orgA!.id, case_id: cse!.id, customer_id: cust!.id,
    status: "pending", promised_amount: 100, promised_date: "2026-07-05",
    grace_until: "2026-07-07", baseline_balance: 1200,
  });
  expect((dupErr as any)?.code).toBe("23505");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/promise-evaluation-rls.test.ts`
Expected: FAIL — `relation "promises" does not exist`.

- [ ] **Step 3: Write the migration** (`supabase/migrations/0010_promise_payment_loop.sql`)

```sql
-- Phase 6b: promise-to-pay state machine + payment/credit sync.

-- Promises: authoritative promise state (contact_logs.promised_* stays as log snapshot).
create table promises (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  case_id uuid not null references collection_cases(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','kept','partially_kept','broken','renegotiated','cancelled')),
  promised_amount numeric(12,2) not null check (promised_amount > 0),
  promised_date date not null,
  grace_until date not null,
  baseline_balance numeric(12,2) not null,
  amount_received numeric(12,2) not null default 0,
  replacement_promise_id uuid references promises(id) on delete set null,
  contact_log_id uuid references contact_logs(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index promises_one_active_per_case on promises (case_id) where status = 'pending';
create index promises_org_case_idx   on promises (org_id, case_id);
create index promises_org_status_idx on promises (org_id, status);

alter table promises enable row level security;
create policy promises_all on promises
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Multi-invoice linkage (B1). Baseline snapshot per invoice at creation.
create table promise_invoices (
  promise_id uuid not null references promises(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  baseline_balance numeric(12,2) not null,
  primary key (promise_id, invoice_id)
);
create index promise_invoices_org_invoice_idx on promise_invoices (org_id, invoice_id);

alter table promise_invoices enable row level security;
create policy promise_invoices_all on promise_invoices
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Payment / CreditMemo events (B3 re-pull driver + audit). Not consumed by the classifier.
create table payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  qbo_id text not null,
  type text not null check (type in ('payment','credit_memo')),
  amount numeric(12,2) not null,
  txn_date date,
  qbo_sync_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (org_id, qbo_id, type)
);
create index payments_org_customer_idx on payments (org_id, customer_id);

alter table payments enable row level security;
create policy payments_all on payments
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Backfill one promise per legacy contact_log that recorded a promise. Historical
-- baselines are unreconstructable, so baseline = the linked invoice's current
-- balance (best effort) and status is by date rule. grace_until = promised_date.
insert into promises (org_id, case_id, customer_id, status, promised_amount,
                      promised_date, grace_until, baseline_balance, contact_log_id, created_by, created_at)
select cl.org_id, cl.case_id, cl.customer_id,
       case when cl.promised_date < current_date then 'broken' else 'pending' end,
       cl.promised_amount, cl.promised_date, cl.promised_date,
       coalesce(i.balance, 0), cl.id, cl.user_id, cl.created_at
from contact_logs cl
left join invoices i on i.id = cl.invoice_id
where cl.promised_amount is not null
  and cl.case_id is not null
  and cl.customer_id is not null;

-- Link backfilled promises to their originating invoice when present.
insert into promise_invoices (promise_id, invoice_id, org_id, baseline_balance)
select p.id, cl.invoice_id, p.org_id, coalesce(i.balance, 0)
from promises p
join contact_logs cl on cl.id = p.contact_log_id
left join invoices i on i.id = cl.invoice_id
where cl.invoice_id is not null;
```

Note: the backfill can in theory produce two `pending` rows for one case if a legacy case had two open promise logs; the partial-unique index would reject the second insert and abort the migration. Guard by keeping only the most recent pending per case — add before the first insert:

```sql
-- Among multiple promise logs per case, only the most recent may become pending;
-- older ones are treated as renegotiated so the one-active index holds.
-- (Implemented by marking all-but-latest as 'renegotiated' in the status expression.)
```

Replace the status expression in the first insert with a window-aware form:

```sql
insert into promises (org_id, case_id, customer_id, status, promised_amount,
                      promised_date, grace_until, baseline_balance, contact_log_id, created_by, created_at)
select org_id, case_id, customer_id,
       case
         when rn > 1 then 'renegotiated'
         when promised_date < current_date then 'broken'
         else 'pending'
       end,
       promised_amount, promised_date, promised_date, baseline_balance, log_id, user_id, created_at
from (
  select cl.org_id, cl.case_id, cl.customer_id, cl.promised_amount, cl.promised_date,
         coalesce(i.balance, 0) as baseline_balance, cl.id as log_id, cl.user_id, cl.created_at,
         row_number() over (partition by cl.case_id order by cl.created_at desc) as rn
  from contact_logs cl
  left join invoices i on i.id = cl.invoice_id
  where cl.promised_amount is not null and cl.case_id is not null and cl.customer_id is not null
) ranked;
```

Use this windowed insert in place of the simple one above (delete the simple version).

- [ ] **Step 4: Apply the migration and run the test**

Run: `cd nudgepay-app && npx supabase db reset` (replays all migrations on local Supabase), then `npx vitest run tests/promise-evaluation-rls.test.ts`
Expected: PASS (2 assertions: RLS isolation, 23505 on duplicate pending).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/supabase/migrations/0010_promise_payment_loop.sql nudgepay-app/tests/promise-evaluation-rls.test.ts
git commit -m "feat: add promises, promise_invoices, payments schema (0010)"
```

---

### Task 2: Pure business-day grace calendar

**Files:**
- Create: `nudgepay-app/app/lib/business-days.ts`
- Test: `nudgepay-app/tests/business-days.test.ts`

**Interfaces:**
- Produces: `GRACE_BUSINESS_DAYS = 2`; `addBusinessDays(dateISO: string, n: number): string` (date-only in/out, skips Sat/Sun).

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { addBusinessDays, GRACE_BUSINESS_DAYS } from "../app/lib/business-days";

test("GRACE_BUSINESS_DAYS is 2", () => {
  expect(GRACE_BUSINESS_DAYS).toBe(2);
});

test("addBusinessDays skips weekends", () => {
  // 2026-07-01 is a Wednesday. +2 business days = Friday 2026-07-03.
  expect(addBusinessDays("2026-07-01", 2)).toBe("2026-07-03");
  // 2026-07-02 is a Thursday. +2 = Monday 2026-07-06 (skips Sat/Sun).
  expect(addBusinessDays("2026-07-02", 2)).toBe("2026-07-06");
  // 2026-07-03 is a Friday. +2 = Tuesday 2026-07-07.
  expect(addBusinessDays("2026-07-03", 2)).toBe("2026-07-07");
});

test("addBusinessDays with 0 returns the same date", () => {
  expect(addBusinessDays("2026-07-01", 0)).toBe("2026-07-01");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/business-days.test.ts`
Expected: FAIL — cannot find module `../app/lib/business-days`.

- [ ] **Step 3: Write the implementation**

```ts
// Pure business-day arithmetic for promise grace deadlines. No I/O, no .server.
// Date-only strings (YYYY-MM-DD) in and out; UTC-component math so there is no
// timezone drift (consistent with app/lib/dates.ts). Weekends (Sat/Sun) are
// skipped. Holidays are out of scope for 6b (deferred to C7).

export const GRACE_BUSINESS_DAYS = 2;

export function addBusinessDays(dateISO: string, n: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  let added = 0;
  while (added < n) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    const day = dt.getUTCDay(); // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) added += 1;
  }
  return dt.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run the test**

Run: `cd nudgepay-app && npx vitest run tests/business-days.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/business-days.ts nudgepay-app/tests/business-days.test.ts
git commit -m "feat: add pure business-day grace calendar"
```

---

### Task 3: Pure promise evaluator

**Files:**
- Create: `nudgepay-app/app/lib/promises.ts`
- Test: `nudgepay-app/tests/promises.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `type PromiseStatus = "pending"|"kept"|"partially_kept"|"broken"|"renegotiated"|"cancelled"`
  - `type PromiseEvalRow = { id: string; status: PromiseStatus; promisedAmount: number; baselineBalance: number; graceUntil: string }`
  - `type PromiseEvalOp = { promiseId: string; status: PromiseStatus; amountReceived: number; resolvedAt: string }`
  - `evaluatePromise(row: PromiseEvalRow, currentLinkedBalance: number, today: string): PromiseEvalOp | null`
  - `evaluatePromises(rows: PromiseEvalRow[], balanceByPromiseId: Map<string, number>, today: string): PromiseEvalOp[]`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { evaluatePromise, evaluatePromises, type PromiseEvalRow } from "../app/lib/promises";

const row = (over: Partial<PromiseEvalRow> = {}): PromiseEvalRow => ({
  id: "p1", status: "pending", promisedAmount: 500, baselineBalance: 1200, graceUntil: "2026-07-03", ...over,
});

test("kept when received >= promised (even before grace)", () => {
  // current 700 => received 500 >= 500
  expect(evaluatePromise(row(), 700, "2026-07-01")).toEqual({
    promiseId: "p1", status: "kept", amountReceived: 500, resolvedAt: "2026-07-01",
  });
});

test("stays pending before grace when not fully received", () => {
  // current 1000 => received 200 < 500, today <= graceUntil
  expect(evaluatePromise(row(), 1000, "2026-07-02")).toBeNull();
});

test("partially_kept past grace with some receipt", () => {
  expect(evaluatePromise(row(), 1000, "2026-07-06")).toEqual({
    promiseId: "p1", status: "partially_kept", amountReceived: 200, resolvedAt: "2026-07-06",
  });
});

test("broken past grace with no receipt", () => {
  expect(evaluatePromise(row(), 1200, "2026-07-06")).toEqual({
    promiseId: "p1", status: "broken", amountReceived: 0, resolvedAt: "2026-07-06",
  });
});

test("received clamps at 0 when balance grew", () => {
  expect(evaluatePromise(row(), 1500, "2026-07-06")).toEqual({
    promiseId: "p1", status: "broken", amountReceived: 0, resolvedAt: "2026-07-06",
  });
});

test("terminal statuses are never re-evaluated", () => {
  for (const status of ["kept", "broken", "renegotiated", "cancelled", "partially_kept"] as const) {
    expect(evaluatePromise(row({ status }), 0, "2026-07-06")).toBeNull();
  }
});

test("evaluatePromises returns only changed rows", () => {
  const rows = [row({ id: "a" }), row({ id: "b" })];
  const balances = new Map([["a", 700], ["b", 1000]]); // a kept, b pending pre-grace
  const ops = evaluatePromises(rows, balances, "2026-07-01");
  expect(ops.map((o) => o.promiseId)).toEqual(["a"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/promises.test.ts`
Expected: FAIL — cannot find module `../app/lib/promises`.

- [ ] **Step 3: Write the implementation**

```ts
// Pure promise classification. No I/O, no .server. Balance-delta model:
// received = max(0, baseline - current linked balance). Only `pending` promises
// are evaluated; all other statuses are terminal and return null (no change).

export type PromiseStatus =
  | "pending" | "kept" | "partially_kept" | "broken" | "renegotiated" | "cancelled";

export type PromiseEvalRow = {
  id: string;
  status: PromiseStatus;
  promisedAmount: number;
  baselineBalance: number;
  graceUntil: string; // YYYY-MM-DD
};

export type PromiseEvalOp = {
  promiseId: string;
  status: PromiseStatus;   // kept | partially_kept | broken
  amountReceived: number;
  resolvedAt: string;      // `today` — all returned statuses are terminal
};

export function evaluatePromise(
  row: PromiseEvalRow, currentLinkedBalance: number, today: string,
): PromiseEvalOp | null {
  if (row.status !== "pending") return null;
  const received = Math.max(0, row.baselineBalance - currentLinkedBalance);

  if (received >= row.promisedAmount) {
    return { promiseId: row.id, status: "kept", amountReceived: received, resolvedAt: today };
  }
  if (today > row.graceUntil) {
    const status = received > 0 ? "partially_kept" : "broken";
    return { promiseId: row.id, status, amountReceived: received, resolvedAt: today };
  }
  return null; // before grace, not fully received — stay pending
}

export function evaluatePromises(
  rows: PromiseEvalRow[], balanceByPromiseId: Map<string, number>, today: string,
): PromiseEvalOp[] {
  const ops: PromiseEvalOp[] = [];
  for (const row of rows) {
    const balance = balanceByPromiseId.get(row.id) ?? row.baselineBalance;
    const op = evaluatePromise(row, balance, today);
    if (op) ops.push(op);
  }
  return ops;
}
```

- [ ] **Step 4: Run the test**

Run: `cd nudgepay-app && npx vitest run tests/promises.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/promises.ts nudgepay-app/tests/promises.test.ts
git commit -m "feat: add pure promise balance-delta evaluator"
```

---

### Task 4: Payment/CreditMemo mapper

**Files:**
- Modify: `nudgepay-app/app/lib/qbo-mappers.server.ts`
- Test: `nudgepay-app/tests/payments-mappers.test.ts`

**Interfaces:**
- Consumes: existing `money()` helper pattern (NaN-guard).
- Produces:
  - `type PaymentUpsert = { org_id: string; qbo_id: string; type: "payment"|"credit_memo"; customer_id: string|null; amount: number; txn_date: string|null; qbo_sync_at: string }`
  - `mapQboPayment(raw: any, type: "payment"|"credit_memo", orgId: string, customerId: string|null, now?: Date): PaymentUpsert`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { mapQboPayment } from "../app/lib/qbo-mappers.server";

const NOW = new Date("2026-06-23T12:00:00Z");

test("maps a QBO Payment with amount and txn date", () => {
  const raw = { Id: "501", TotalAmt: 250.5, TxnDate: "2026-06-20", CustomerRef: { value: "9" } };
  expect(mapQboPayment(raw, "payment", "org-1", "cust-uuid", NOW)).toEqual({
    org_id: "org-1", qbo_id: "501", type: "payment", customer_id: "cust-uuid",
    amount: 250.5, txn_date: "2026-06-20", qbo_sync_at: NOW.toISOString(),
  });
});

test("maps a CreditMemo and NaN-guards a missing amount", () => {
  const raw = { Id: "777", CustomerRef: { value: "9" } };
  const row = mapQboPayment(raw, "credit_memo", "org-1", null, NOW);
  expect(row.type).toBe("credit_memo");
  expect(row.amount).toBe(0);       // NaN-guarded
  expect(row.txn_date).toBeNull();
  expect(row.customer_id).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/payments-mappers.test.ts`
Expected: FAIL — `mapQboPayment is not a function`.

- [ ] **Step 3: Add to `qbo-mappers.server.ts`** (append after `mapQboInvoice`; reuse the existing `money()`)

```ts
export type PaymentUpsert = {
  org_id: string;
  qbo_id: string;
  type: "payment" | "credit_memo";
  customer_id: string | null;
  amount: number;
  txn_date: string | null;
  qbo_sync_at: string;
};

export function mapQboPayment(
  raw: any, type: "payment" | "credit_memo", orgId: string,
  customerId: string | null, now: Date = new Date(),
): PaymentUpsert {
  return {
    org_id: orgId,
    qbo_id: String(raw.Id),
    type,
    customer_id: customerId,
    amount: money(raw.TotalAmt),
    txn_date: raw.TxnDate ?? null,
    qbo_sync_at: now.toISOString(),
  };
}
```

- [ ] **Step 4: Run the test**

Run: `cd nudgepay-app && npx vitest run tests/payments-mappers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/qbo-mappers.server.ts nudgepay-app/tests/payments-mappers.test.ts
git commit -m "feat: add mapQboPayment for Payment/CreditMemo rows"
```

---

### Task 5: Webhook dual-format (legacy + CloudEvents) parse

**Files:**
- Modify: `nudgepay-app/app/lib/qbo-webhook.server.ts`
- Test: `nudgepay-app/tests/qbo-webhook.test.ts` (create if absent)

**Interfaces:**
- Consumes/Produces: `parseQboWebhook(rawBody: string): QboWebhookEntity[]` (unchanged signature). `QboWebhookEntity` = `{ realmId; entityName; id; operation }`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { parseQboWebhook } from "../app/lib/qbo-webhook.server";

test("parses legacy eventNotifications payload", () => {
  const body = JSON.stringify({
    eventNotifications: [{
      realmId: "RID1",
      dataChangeEvent: { entities: [{ name: "Payment", id: "501", operation: "Create" }] },
    }],
  });
  expect(parseQboWebhook(body)).toEqual([
    { realmId: "RID1", entityName: "Payment", id: "501", operation: "Create" },
  ]);
});

test("parses CloudEvents payload (array of qbo.<entity>.<event>.v1)", () => {
  const body = JSON.stringify([
    { type: "qbo.creditmemo.create.v1", intuitentityid: "777", intuitaccountid: "RID2" },
    { type: "qbo.invoice.update.v1", intuitentityid: "42", intuitaccountid: "RID2" },
  ]);
  expect(parseQboWebhook(body)).toEqual([
    { realmId: "RID2", entityName: "CreditMemo", id: "777", operation: "create" },
    { realmId: "RID2", entityName: "Invoice", id: "42", operation: "update" },
  ]);
});

test("returns [] on malformed JSON", () => {
  expect(parseQboWebhook("{not json")).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/qbo-webhook.test.ts`
Expected: FAIL — CloudEvents case returns `[]` (legacy-only parser).

- [ ] **Step 3: Replace `parseQboWebhook`** in `qbo-webhook.server.ts` (keep everything above it unchanged)

```ts
export type QboWebhookEntity = {
  realmId: string;
  entityName: string;
  id: string;
  operation: string;
};

// Canonical entity casing keyed by the lowercase token Intuit uses in CloudEvents
// `type` strings (qbo.<entity>.<event>.v1).
const ENTITY_CASING: Record<string, string> = {
  invoice: "Invoice",
  customer: "Customer",
  payment: "Payment",
  creditmemo: "CreditMemo",
};

function parseLegacy(payload: any): QboWebhookEntity[] {
  const out: QboWebhookEntity[] = [];
  for (const n of payload?.eventNotifications ?? []) {
    const realmId = String(n.realmId);
    for (const e of n?.dataChangeEvent?.entities ?? []) {
      out.push({ realmId, entityName: String(e.name), id: String(e.id), operation: String(e.operation) });
    }
  }
  return out;
}

function parseCloudEvents(payload: any): QboWebhookEntity[] {
  const events = Array.isArray(payload) ? payload : [payload];
  const out: QboWebhookEntity[] = [];
  for (const ev of events) {
    const type = typeof ev?.type === "string" ? ev.type : "";
    const m = /^qbo\.([a-z]+)\.([a-z]+)\.v\d+$/.exec(type);
    if (!m) continue;
    const entityName = ENTITY_CASING[m[1]] ?? "";
    if (!entityName) continue;
    out.push({
      realmId: String(ev.intuitaccountid ?? ""),
      entityName,
      id: String(ev.intuitentityid ?? ""),
      operation: m[2],
    });
  }
  return out;
}

// Supports both the legacy eventNotifications shape and the newer CloudEvents
// shape during Intuit's transition. Detection: presence of `eventNotifications`.
// NOTE: confirm exact CloudEvents field casing/nesting against a real Intuit
// payload before production cutover; both parsers are kept regardless.
export function parseQboWebhook(rawBody: string): QboWebhookEntity[] {
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return [];
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.eventNotifications) {
    return parseLegacy(payload);
  }
  return parseCloudEvents(payload);
}
```

- [ ] **Step 4: Run the test**

Run: `cd nudgepay-app && npx vitest run tests/qbo-webhook.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/qbo-webhook.server.ts nudgepay-app/tests/qbo-webhook.test.ts
git commit -m "feat: parse both legacy and CloudEvents QBO webhook payloads"
```

---

### Task 6: QBO API — Payment/CreditMemo in CDC and query/read

**Files:**
- Modify: `nudgepay-app/app/lib/qbo-api.server.ts`
- Test: `nudgepay-app/tests/qbo-api.test.ts` (create if absent)

**Interfaces:**
- Consumes: existing `qboQuery`, `qboReadEntity`, `qboCdc`.
- Produces:
  - `QboCdcResult` gains `payments: any[]; creditMemos: any[]`.
  - `qboQuery`/`qboReadEntity` entity-name unions widen to `"Invoice"|"Customer"|"Payment"|"CreditMemo"`.
  - `qboCdc` requests `Invoice,Customer,Payment,CreditMemo`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { qboCdc } from "../app/lib/qbo-api.server";

test("qboCdc requests payments + credit memos and flattens all four entities", async () => {
  let requestedUrl = "";
  const fetchFn = (async (url: string) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({
        CDCResponse: [{
          QueryResponse: [
            { Invoice: [{ Id: "1" }] },
            { Customer: [{ Id: "9" }] },
            { Payment: [{ Id: "501" }] },
            { CreditMemo: [{ Id: "777" }] },
          ],
        }],
      }),
    } as any;
  }) as unknown as typeof fetch;

  const res = await qboCdc(fetchFn, { baseUrl: "https://x" }, "tok", "RID", "2026-06-01T00:00:00Z");
  expect(decodeURIComponent(requestedUrl)).toContain("entities=Invoice,Customer,Payment,CreditMemo");
  expect(res.invoices.map((i) => i.Id)).toEqual(["1"]);
  expect(res.customers.map((c) => c.Id)).toEqual(["9"]);
  expect(res.payments.map((p) => p.Id)).toEqual(["501"]);
  expect(res.creditMemos.map((c) => c.Id)).toEqual(["777"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/qbo-api.test.ts`
Expected: FAIL — `res.payments` is undefined and the URL lacks `Payment,CreditMemo`.

- [ ] **Step 3: Edit `qbo-api.server.ts`**

Widen the result type and the entity unions, and request the new entities in CDC:

```ts
export type QboCdcResult = { invoices: any[]; customers: any[]; payments: any[]; creditMemos: any[] };
```

```ts
export async function qboQuery(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, query: string, entityName: "Invoice" | "Customer" | "Payment" | "CreditMemo",
): Promise<any[]> {
  const url = `${api.baseUrl}/v3/company/${realmId}/query`
    + `?query=${encodeURIComponent(query)}&minorversion=${MINOR_VERSION}`;
  const data = await getJson(fetchFn, url, accessToken);
  return (data?.QueryResponse?.[entityName] ?? []) as any[];
}

export async function qboReadEntity(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, entityName: "Invoice" | "Customer" | "Payment" | "CreditMemo", id: string,
): Promise<any | null> {
  const url = `${api.baseUrl}/v3/company/${realmId}/${entityName.toLowerCase()}/${id}`
    + `?minorversion=${MINOR_VERSION}`;
  const data = await getJson(fetchFn, url, accessToken);
  return data?.[entityName] ?? null;
}

export async function qboCdc(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, changedSinceIso: string,
): Promise<QboCdcResult> {
  const url = `${api.baseUrl}/v3/company/${realmId}/cdc`
    + `?entities=Invoice,Customer,Payment,CreditMemo&changedSince=${encodeURIComponent(changedSinceIso)}`
    + `&minorversion=${MINOR_VERSION}`;
  const data = await getJson(fetchFn, url, accessToken);
  const groups = (data?.CDCResponse?.[0]?.QueryResponse ?? []) as any[];
  return {
    invoices: groups.flatMap((g) => g.Invoice ?? []),
    customers: groups.flatMap((g) => g.Customer ?? []),
    payments: groups.flatMap((g) => g.Payment ?? []),
    creditMemos: groups.flatMap((g) => g.CreditMemo ?? []),
  };
}
```

Note: `qboReadEntity` lowercases the entity name; QBO's read path for credit memos is `/creditmemo/{id}` — `"CreditMemo".toLowerCase()` = `"creditmemo"`, which is correct.

- [ ] **Step 4: Run the test**

Run: `cd nudgepay-app && npx vitest run tests/qbo-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/qbo-api.server.ts nudgepay-app/tests/qbo-api.test.ts
git commit -m "feat: include Payment/CreditMemo in QBO CDC and query API"
```

---

### Task 7: Promise evaluation applier (server)

**Files:**
- Create: `nudgepay-app/app/lib/promise-evaluation.server.ts`
- Test: `nudgepay-app/tests/promise-evaluation-rls.test.ts` (extend)

**Interfaces:**
- Consumes: `evaluatePromises` (Task 3); tables from Task 1.
- Produces: `applyPromiseEvaluation(client: SupabaseClient, orgId: string, today: string): Promise<{ kept: number; partiallyKept: number; broken: number }>`.

- [ ] **Step 1: Write the failing test** (append to `tests/promise-evaluation-rls.test.ts`)

```ts
import { applyPromiseEvaluation } from "../app/lib/promise-evaluation.server";

test("applyPromiseEvaluation: kept on payment, broken at deadline, case reflection", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `EvalOrg ${Math.random()}` }).select("id").single();
  const orgId = org!.id;

  async function makeCaseWithPromise(qboSuffix: string, balance: number, graceUntil: string) {
    const { data: cust } = await svc.from("customers")
      .insert({ org_id: orgId, qbo_id: `ev-${qboSuffix}`, name: `C-${qboSuffix}` }).select("id").single();
    const { data: inv } = await svc.from("invoices").insert({
      org_id: orgId, qbo_id: `evi-${qboSuffix}`, qbo_doc_number: qboSuffix, customer_id: cust!.id,
      amount: 1200, balance, due_date: "2026-03-01", status: "overdue",
    }).select("id").single();
    const { data: cse } = await svc.from("collection_cases")
      .insert({ org_id: orgId, customer_id: cust!.id, status: "promised", next_action_type: "promise", next_action_at: graceUntil })
      .select("id").single();
    const { data: prom } = await svc.from("promises").insert({
      org_id: orgId, case_id: cse!.id, customer_id: cust!.id, status: "pending",
      promised_amount: 500, promised_date: "2026-07-01", grace_until: graceUntil, baseline_balance: 1200,
    }).select("id").single();
    await svc.from("promise_invoices").insert({ promise_id: prom!.id, invoice_id: inv!.id, org_id: orgId, baseline_balance: 1200 });
    return { caseId: cse!.id, promiseId: prom!.id };
  }

  // KEPT: balance dropped 1200 -> 700 (received 500 >= 500).
  const kept = await makeCaseWithPromise("kept", 700, "2026-07-03");
  // BROKEN: balance still 1200, today past grace.
  const broken = await makeCaseWithPromise("broken", 1200, "2026-07-03");

  const res = await applyPromiseEvaluation(svc, orgId, "2026-07-06");
  expect(res.kept).toBe(1);
  expect(res.broken).toBe(1);

  const { data: keptRow } = await svc.from("promises").select("status, amount_received").eq("id", kept.promiseId).single();
  expect(keptRow!.status).toBe("kept");
  expect(Number(keptRow!.amount_received)).toBe(500);

  const { data: brokenCase } = await svc.from("collection_cases").select("status, next_action_type").eq("id", broken.caseId).single();
  expect(brokenCase!.status).toBe("working");
  expect(brokenCase!.next_action_type).toBe("follow_up");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/promise-evaluation-rls.test.ts`
Expected: FAIL — cannot find module `promise-evaluation.server`.

- [ ] **Step 3: Write `promise-evaluation.server.ts`**

```ts
import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import { evaluatePromises, type PromiseEvalRow, type PromiseStatus } from "./promises";

// Recompute pending promises for one org against current linked-invoice balances.
// Org-scoped on every query (service client at the sync layer). Idempotent: only
// `pending` promises transition; terminal states are skipped by the pure evaluator.
export async function applyPromiseEvaluation(
  client: SupabaseClient, orgId: string, today: string,
): Promise<{ kept: number; partiallyKept: number; broken: number }> {
  const { data: pend, error: pErr } = await client
    .from("promises")
    .select("id, status, promised_amount, baseline_balance, grace_until")
    .eq("org_id", orgId)
    .eq("status", "pending");
  if (pErr) throw pErr;
  const promises = pend ?? [];
  if (promises.length === 0) return { kept: 0, partiallyKept: 0, broken: 0 };

  const ids = promises.map((p) => p.id as string);
  const { data: links, error: lErr } = await client
    .from("promise_invoices")
    .select("promise_id, invoice_id")
    .eq("org_id", orgId)
    .in("promise_id", ids);
  if (lErr) throw lErr;

  const invoiceIds = [...new Set((links ?? []).map((l) => l.invoice_id as string))];
  const balanceByInvoice = new Map<string, number>();
  if (invoiceIds.length > 0) {
    const { data: invs, error: iErr } = await client
      .from("invoices").select("id, balance").eq("org_id", orgId).in("id", invoiceIds);
    if (iErr) throw iErr;
    for (const inv of invs ?? []) balanceByInvoice.set(inv.id as string, Number(inv.balance) || 0);
  }

  const balanceByPromiseId = new Map<string, number>();
  for (const l of links ?? []) {
    const prev = balanceByPromiseId.get(l.promise_id as string) ?? 0;
    balanceByPromiseId.set(l.promise_id as string, prev + (balanceByInvoice.get(l.invoice_id as string) ?? 0));
  }

  // Also map case_id for case-state reflection on broken promises.
  const { data: caseRows } = await client
    .from("promises").select("id, case_id").eq("org_id", orgId).in("id", ids);
  const caseByPromise = new Map((caseRows ?? []).map((r) => [r.id as string, r.case_id as string]));

  const rows: PromiseEvalRow[] = promises.map((p) => ({
    id: p.id as string,
    status: p.status as PromiseStatus,
    promisedAmount: Number(p.promised_amount) || 0,
    baselineBalance: Number(p.baseline_balance) || 0,
    graceUntil: p.grace_until as string,
  }));

  const ops = evaluatePromises(rows, balanceByPromiseId, today);

  let kept = 0, partiallyKept = 0, broken = 0;
  for (const op of ops) {
    const { data: updated, error } = await client.from("promises")
      .update({ status: op.status, amount_received: op.amountReceived, resolved_at: new Date().toISOString() })
      .eq("id", op.promiseId).eq("status", "pending") // guard against a concurrent transition
      .select("id");
    if (error) throw error as PostgrestError;
    if (!updated || updated.length === 0) continue;

    if (op.status === "kept") kept += 1;
    else if (op.status === "partially_kept") partiallyKept += 1;
    else if (op.status === "broken") {
      broken += 1;
      const caseId = caseByPromise.get(op.promiseId);
      if (caseId) {
        const { error: cErr } = await client.from("collection_cases")
          .update({ status: "working", next_action_type: "follow_up", next_action_at: today })
          .eq("id", caseId);
        if (cErr) throw cErr;
      }
    }
  }
  return { kept, partiallyKept, broken };
}
```

- [ ] **Step 4: Run the test**

Run: `cd nudgepay-app && npx vitest run tests/promise-evaluation-rls.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/promise-evaluation.server.ts nudgepay-app/tests/promise-evaluation-rls.test.ts
git commit -m "feat: add applyPromiseEvaluation server applier"
```

---

### Task 8: Payment upsert, webhook apply, and B3-bug re-pull

**Files:**
- Modify: `nudgepay-app/app/lib/qbo-sync.server.ts`, `nudgepay-app/app/routes/webhooks.qbo.tsx`
- Test: `nudgepay-app/tests/qbo-sync-payments.test.ts`

**Interfaces:**
- Consumes: `mapQboPayment`/`PaymentUpsert` (Task 4), `qboQuery`/`qboReadEntity` (Task 6), `customerIdMap` (existing).
- Produces:
  - `upsertPayments(service: SupabaseClient, rows: PaymentUpsert[]): Promise<void>`
  - `repullCustomerInvoices(deps: SyncDeps, orgId: string, accessToken: string, realmId: string, qboCustomerIds: string[]): Promise<void>` (re-pull ALL invoices for those customers, ignoring `Balance>0`)
  - `applyPaymentWebhook(deps: SyncDeps, orgId: string, qboId: string, type: "payment"|"credit_memo"): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { serviceClient } from "./helpers";
import { upsertPayments } from "../app/lib/qbo-sync.server";

test("upsertPayments is idempotent on (org_id, qbo_id, type)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `PaySync ${Math.random()}` }).select("id").single();
  const orgId = org!.id;
  const row = {
    org_id: orgId, qbo_id: "501", type: "payment" as const, customer_id: null,
    amount: 100, txn_date: "2026-06-20", qbo_sync_at: new Date().toISOString(),
  };
  await upsertPayments(svc, [row]);
  await upsertPayments(svc, [{ ...row, amount: 150 }]); // same key — updates, no dup
  const { data } = await svc.from("payments").select("amount").eq("org_id", orgId).eq("qbo_id", "501");
  expect(data!.length).toBe(1);
  expect(Number(data![0].amount)).toBe(150);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/qbo-sync-payments.test.ts`
Expected: FAIL — `upsertPayments is not a function`.

- [ ] **Step 3: Edit `qbo-sync.server.ts`**

Add the import and three functions:

```ts
import {
  mapQboCustomer, mapQboInvoice, mapQboPayment,
  type CustomerUpsert, type InvoiceUpsert, type PaymentUpsert,
} from "./qbo-mappers.server";
```

```ts
export async function upsertPayments(service: SupabaseClient, rows: PaymentUpsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await service.from("payments").upsert(rows, { onConflict: "org_id,qbo_id,type" });
  if (error && (error as any).code !== "23505") throw error;
}

// B3-bug fix: re-pull ALL invoices for the given QBO customers (no Balance>0
// filter) so an invoice paid outside the periodic-overdue window updates to its
// real balance and its case can auto-resolve.
export async function repullCustomerInvoices(
  deps: SyncDeps, orgId: string, accessToken: string, realmId: string, qboCustomerIds: string[],
): Promise<void> {
  const ids = [...new Set(qboCustomerIds.filter(Boolean))];
  if (ids.length === 0) return;
  const idList = ids.map((id) => `'${id}'`).join(",");
  const invoices = await qboQuery(
    deps.fetchFn, deps.api, accessToken, realmId,
    `select * from Invoice where CustomerRef in (${idList}) startposition 1 maxresults ${QUERY_LIMIT}`,
    "Invoice",
  );
  if (invoices.length === 0) return;
  const idMap = await customerIdMap(deps.service, orgId, ids);
  const now = new Date();
  const rows = invoices.map((inv) =>
    mapQboInvoice(inv, orgId, idMap.get(String(inv?.CustomerRef?.value)) ?? null, now));
  await upsertInvoices(deps.service, rows);
}

export async function applyPaymentWebhook(
  deps: SyncDeps, orgId: string, qboId: string, type: "payment" | "credit_memo",
): Promise<void> {
  const { accessToken, realmId } = await getValidAccessToken(
    deps.fetchFn, deps.service, deps.cfg, deps.key, orgId,
  );
  const entity = type === "payment" ? "Payment" : "CreditMemo";
  const raw = await qboReadEntity(deps.fetchFn, deps.api, accessToken, realmId, entity, qboId);
  if (!raw) return;

  const qboCustomerId = raw?.CustomerRef?.value ? String(raw.CustomerRef.value) : null;
  let customerId: string | null = null;
  if (qboCustomerId) {
    const idMap = await customerIdMap(deps.service, orgId, [qboCustomerId]);
    customerId = idMap.get(qboCustomerId) ?? null;
  }
  await upsertPayments(deps.service, [mapQboPayment(raw, type, orgId, customerId, new Date())]);

  // B3 re-pull + reconcile + evaluate so a payment resolves cases/promises promptly.
  const today = new Date().toISOString().slice(0, 10);
  if (qboCustomerId) {
    try { await repullCustomerInvoices(deps, orgId, accessToken, realmId, [qboCustomerId]); }
    catch (e) { console.error("[6b] payment re-pull failed", e); }
  }
  try { await applyCaseReconciliation(deps.service, orgId, today); }
  catch (e) { console.error("[6b] reconciliation failed (payment webhook)", e); }
  try { await applyPromiseEvaluation(deps.service, orgId, today); }
  catch (e) { console.error("[6b] promise evaluation failed (payment webhook)", e); }
}
```

Add the import for the evaluator at the top:

```ts
import { applyPromiseEvaluation } from "./promise-evaluation.server";
```

Then dispatch Payment/CreditMemo in `webhooks.qbo.tsx`:

```ts
import {
  applyInvoiceWebhook, applyCustomerWebhook, applyPaymentWebhook, type SyncDeps,
} from "../lib/qbo-sync.server";
```

```ts
      if (ev.entityName === "Invoice") await applyInvoiceWebhook(deps, orgId, ev.id);
      else if (ev.entityName === "Customer") await applyCustomerWebhook(deps, orgId, ev.id);
      else if (ev.entityName === "Payment") await applyPaymentWebhook(deps, orgId, ev.id, "payment");
      else if (ev.entityName === "CreditMemo") await applyPaymentWebhook(deps, orgId, ev.id, "credit_memo");
      // other entity types are ignored
```

- [ ] **Step 4: Run the test**

Run: `cd nudgepay-app && npx vitest run tests/qbo-sync-payments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/qbo-sync.server.ts nudgepay-app/app/routes/webhooks.qbo.tsx nudgepay-app/tests/qbo-sync-payments.test.ts
git commit -m "feat: payment upsert, webhook apply, and B3-bug invoice re-pull"
```

---

### Task 9: Wire payment sync + promise evaluation into all sync paths

**Files:**
- Modify: `nudgepay-app/app/lib/qbo-sync.server.ts`
- Test: `nudgepay-app/tests/qbo-sync-payments.test.ts` (extend)

**Interfaces:**
- Consumes: `qboCdc` (now returns `payments`/`creditMemos`), `upsertPayments`, `repullCustomerInvoices`, `applyPromiseEvaluation`, `applyCaseReconciliation`.
- Produces: a new exported seam `applyPaymentsAndEvaluate(deps, orgId, accessToken, realmId, paymentRaws, today, now): Promise<void>` that upserts payments, re-pulls affected customers' invoices, reconciles cases, then evaluates promises. `syncOverdueInvoices`, `runCdcCatchup`, `applyInvoiceWebhook` all call it (or its evaluation tail) so every path — including the cron via `runCdcCatchup` — upserts payments and evaluates promises. No cron file change needed.

Rationale for the seam: a full `runCdcCatchup` test would require seeding a connection with a decryptable OAuth token (token refresh + CDC fetch + re-pull fetch all mocked). Extracting `applyPaymentsAndEvaluate` lets us test the genuinely-new behavior (payments upserted, balances re-pulled, promises evaluated) deterministically with a real service client and a small `fetchFn` mock for the re-pull, with no token crypto.

- [ ] **Step 1: Write the failing test** (extend `tests/qbo-sync-payments.test.ts`)

```ts
import { applyPaymentsAndEvaluate, type SyncDeps } from "../app/lib/qbo-sync.server";
import { qboApiBaseUrl } from "../app/lib/qbo-api.server";

test("applyPaymentsAndEvaluate upserts payments, re-pulls invoices, and marks the promise kept", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `PayEval ${Math.random()}` }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "9", name: "Acme" }).select("id").single();
  const { data: inv } = await svc.from("invoices").insert({
    org_id: orgId, qbo_id: "inv-9", qbo_doc_number: "1001", customer_id: cust!.id,
    amount: 1200, balance: 1200, due_date: "2026-03-01", status: "overdue",
  }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "promised", next_action_type: "promise", next_action_at: "2026-07-03" })
    .select("id").single();
  const { data: prom } = await svc.from("promises").insert({
    org_id: orgId, case_id: cse!.id, customer_id: cust!.id, status: "pending",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03", baseline_balance: 1200,
  }).select("id").single();
  await svc.from("promise_invoices").insert({ promise_id: prom!.id, invoice_id: inv!.id, org_id: orgId, baseline_balance: 1200 });

  // fetchFn mock: the re-pull query returns the invoice now paid down to 700.
  const fetchFn = (async () => ({
    ok: true,
    json: async () => ({ QueryResponse: { Invoice: [{ Id: "inv-9", DocNumber: "1001", CustomerRef: { value: "9" }, TotalAmt: 1200, Balance: 700, DueDate: "2026-03-01" }] } }),
  } as any)) as unknown as typeof fetch;

  const deps: SyncDeps = {
    fetchFn, service: svc,
    cfg: { clientId: "x", clientSecret: "x", redirectUri: "x" },
    api: { baseUrl: "https://x" }, key: "x",
  };
  const paymentRaws = [{ raw: { Id: "501", TotalAmt: 500, TxnDate: "2026-07-02", CustomerRef: { value: "9" } }, type: "payment" as const }];

  await applyPaymentsAndEvaluate(deps, orgId, "tok", "RID", paymentRaws, "2026-07-06", new Date("2026-07-06T00:00:00Z"));

  const { data: pay } = await svc.from("payments").select("amount").eq("org_id", orgId).eq("qbo_id", "501");
  expect(pay!.length).toBe(1);
  const { data: invRow } = await svc.from("invoices").select("balance").eq("id", inv!.id).single();
  expect(Number(invRow!.balance)).toBe(700);
  const { data: pr } = await svc.from("promises").select("status").eq("id", prom!.id).single();
  expect(pr!.status).toBe("kept");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/qbo-sync-payments.test.ts`
Expected: FAIL — `applyPaymentsAndEvaluate is not a function`.

- [ ] **Step 3: Edit `qbo-sync.server.ts`** — add the seam and call it from each path.

Add the seam (it owns payment upsert → re-pull → reconcile → evaluate, each new step try/caught except the upsert which is awaited directly):

```ts
export async function applyPaymentsAndEvaluate(
  deps: SyncDeps, orgId: string, accessToken: string, realmId: string,
  paymentRaws: { raw: any; type: "payment" | "credit_memo" }[],
  today: string, now: Date,
): Promise<void> {
  const payCustQboIds = paymentRaws.map((e) => e?.raw?.CustomerRef?.value).filter(Boolean).map(String);
  const payIdMap = await customerIdMap(deps.service, orgId, payCustQboIds);
  const paymentRows = paymentRaws.map((e) =>
    mapQboPayment(e.raw, e.type, orgId, payIdMap.get(String(e?.raw?.CustomerRef?.value)) ?? null, now));
  await upsertPayments(deps.service, paymentRows);

  if (payCustQboIds.length > 0) {
    try { await repullCustomerInvoices(deps, orgId, accessToken, realmId, payCustQboIds); }
    catch (e) { console.error("[6b] payment re-pull failed", e); }
  }
  try { await applyCaseReconciliation(deps.service, orgId, today); }
  catch (e) { console.error("[6b] reconciliation failed (payments)", e); }
  try { await applyPromiseEvaluation(deps.service, orgId, today); }
  catch (e) { console.error("[6b] promise evaluation failed (payments)", e); }
}
```

In `runCdcCatchup`, destructure the new CDC fields and call the seam after `upsertInvoices`, replacing the standalone `applyCaseReconciliation` block (the seam now performs it):

```ts
  const { invoices, customers, payments, creditMemos } = await qboCdc(deps.fetchFn, deps.api, accessToken, realmId, changedSince);
```

```ts
  // (after upsertCustomers + upsertInvoices)
  const reconcileToday = new Date().toISOString().slice(0, 10);
  const paymentRaws = [
    ...payments.map((p) => ({ raw: p, type: "payment" as const })),
    ...creditMemos.map((c) => ({ raw: c, type: "credit_memo" as const })),
  ];
  try {
    await applyPaymentsAndEvaluate(deps, orgId, accessToken, realmId, paymentRaws, reconcileToday, now);
  } catch (e) {
    console.error("[6b] payments/eval failed (cdc); cron will re-converge", e);
  }
```

In `syncOverdueInvoices` and `applyInvoiceWebhook`, the overdue/invoice queries do not fetch payments, so pass an empty `paymentRaws` — the seam still reconciles and evaluates (covering the time-based Pending→Broken transition). Replace each path's standalone `applyCaseReconciliation` try/catch with:

```ts
  try {
    await applyPaymentsAndEvaluate(deps, orgId, accessToken, realmId, [], reconcileToday, now);
  } catch (e) {
    console.error("[6b] payments/eval failed; cron will re-converge", e);
  }
```

(`syncOverdueInvoices` already has `now`; `applyInvoiceWebhook` constructs `new Date()` — reuse it as `now`.)

**DRY: refactor `applyPaymentWebhook` (from Task 8) to delegate to the seam.** Task 8 inlined re-pull + reconcile + evaluate inside `applyPaymentWebhook`; replace that tail so it reads the single entity, then calls the seam with a one-element `paymentRaws`:

```ts
  // (inside applyPaymentWebhook, replacing the inlined upsert + re-pull + reconcile + evaluate)
  const today = new Date().toISOString().slice(0, 10);
  await applyPaymentsAndEvaluate(deps, orgId, accessToken, realmId, [{ raw, type }], today, new Date());
```

The earlier `upsertPayments([mapQboPayment(...)])` line in `applyPaymentWebhook` is removed — the seam now performs the upsert. The existing `tests/qbo-sync-payments.test.ts` idempotency test still covers `upsertPayments` directly.

- [ ] **Step 4: Run the test**

Run: `cd nudgepay-app && npx vitest run tests/qbo-sync-payments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/qbo-sync.server.ts nudgepay-app/tests/qbo-sync-payments.test.ts
git commit -m "feat: sync payments + evaluate promises across all sync paths"
```

---

### Task 10: Promise creation + supersede in the contact-log action

**Files:**
- Modify: `nudgepay-app/app/routes/api.contact-logs.tsx`
- Test: `nudgepay-app/tests/api-contact-logs.test.ts` (extend)

**Interfaces:**
- Consumes: `addBusinessDays`, `GRACE_BUSINESS_DAYS` (Task 2); `parseContactLogForm` (existing; already returns `promisedAmount`/`promisedDate`).
- Produces: when `outcome==='promise-to-pay'`, a `promises` row (+ `promise_invoices`) is created, the prior pending promise is superseded (→`renegotiated`, `replacement_promise_id`), and the case is set `status='promised'`, `next_action_type='promise'`, `next_action_at=grace_until`.

- [ ] **Step 1: Write the failing test** (DB-level; exercises the helper extracted below)

The action route is awkward to invoke directly, so extract the promise-creation logic into a pure-ish DB helper that the test calls with a user client. Add to `tests/api-contact-logs.test.ts`:

```ts
import { createPromiseForLog } from "../app/lib/promise-create.server";

test("createPromiseForLog supersedes a prior pending promise and links case invoices", async () => {
  const svc = serviceClient();
  const user = await makeUserClient("promise-create@example.com");
  const { data: org } = await svc.from("organizations").insert({ name: `PCreate ${user.userId}` }).select("id").single();
  const orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });
  const { data: cust } = await svc.from("customers").insert({ org_id: orgId, qbo_id: `pc-${user.userId}`, name: "Acme" }).select("id").single();
  const { data: inv } = await svc.from("invoices").insert({
    org_id: orgId, qbo_id: `pci-${user.userId}`, qbo_doc_number: "1", customer_id: cust!.id,
    amount: 1200, balance: 1200, due_date: "2026-03-01", status: "overdue",
  }).select("id").single();
  const { data: cse } = await svc.from("collection_cases").insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();

  const first = await createPromiseForLog(user.client, {
    orgId, caseId: cse!.id, customerId: cust!.id, userId: user.userId,
    contactLogId: null, promisedAmount: 500, promisedDate: "2026-07-01",
  });
  expect(first.ok).toBe(true);

  const second = await createPromiseForLog(user.client, {
    orgId, caseId: cse!.id, customerId: cust!.id, userId: user.userId,
    contactLogId: null, promisedAmount: 800, promisedDate: "2026-07-10",
  });
  expect(second.ok).toBe(true);

  const { data: rows } = await svc.from("promises").select("id, status, replacement_promise_id, grace_until, baseline_balance").eq("org_id", orgId).order("created_at");
  expect(rows!.length).toBe(2);
  expect(rows![0].status).toBe("renegotiated");
  expect(rows![0].replacement_promise_id).toBe(rows![1].id);
  expect(rows![1].status).toBe("pending");
  expect(Number(rows![1].baseline_balance)).toBe(1200);
  expect(rows![1].grace_until).toBe("2026-07-14"); // 2026-07-10 is Fri -> +2 business days = Tue 14th

  const { data: caseRow } = await svc.from("collection_cases").select("status, next_action_type, next_action_at").eq("id", cse!.id).single();
  expect(caseRow!.status).toBe("promised");
  expect(caseRow!.next_action_type).toBe("promise");
  expect(caseRow!.next_action_at).toBe("2026-07-14");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/api-contact-logs.test.ts`
Expected: FAIL — cannot find module `promise-create.server`.

- [ ] **Step 3: Create `app/lib/promise-create.server.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { addBusinessDays, GRACE_BUSINESS_DAYS } from "./business-days";

export type CreatePromiseInput = {
  orgId: string;
  caseId: string;
  customerId: string | null;
  userId: string;
  contactLogId: string | null;
  promisedAmount: number;
  promisedDate: string;
};

// Creates a pending promise for a case, superseding any prior pending promise.
// All writes go through the supplied (user/RLS) client. Returns ok/error so the
// action can surface a single banner. Links all of the case's currently-overdue
// invoices and snapshots their summed balance as the baseline.
export async function createPromiseForLog(
  client: SupabaseClient, input: CreatePromiseInput,
): Promise<{ ok: true; promiseId: string } | { ok: false }> {
  // Currently-overdue invoices for this customer (case-scoped via customer).
  const { data: invs, error: iErr } = await client
    .from("invoices")
    .select("id, balance")
    .eq("org_id", input.orgId)
    .eq("customer_id", input.customerId)
    .gt("balance", 0);
  if (iErr) return { ok: false };
  const linked = (invs ?? []).map((r) => ({ id: r.id as string, balance: Number(r.balance) || 0 }));
  const baseline = linked.reduce((s, r) => s + r.balance, 0);
  const graceUntil = addBusinessDays(input.promisedDate, GRACE_BUSINESS_DAYS);

  // Supersede any existing pending promise to free the partial-unique slot.
  const { data: priors, error: sErr } = await client
    .from("promises")
    .update({ status: "renegotiated", resolved_at: new Date().toISOString() })
    .eq("org_id", input.orgId).eq("case_id", input.caseId).eq("status", "pending")
    .select("id");
  if (sErr) return { ok: false };

  const { data: created, error: cErr } = await client.from("promises").insert({
    org_id: input.orgId, case_id: input.caseId, customer_id: input.customerId,
    status: "pending", promised_amount: input.promisedAmount, promised_date: input.promisedDate,
    grace_until: graceUntil, baseline_balance: baseline, contact_log_id: input.contactLogId,
    created_by: input.userId,
  }).select("id").single();
  if (cErr || !created) return { ok: false };
  const promiseId = created.id as string;

  if (linked.length > 0) {
    const { error: liErr } = await client.from("promise_invoices").insert(
      linked.map((r) => ({ promise_id: promiseId, invoice_id: r.id, org_id: input.orgId, baseline_balance: r.balance })),
    );
    if (liErr) return { ok: false };
  }

  // Point the (single) superseded promise at the replacement.
  if (priors && priors.length > 0) {
    const { error: rErr } = await client.from("promises")
      .update({ replacement_promise_id: promiseId }).eq("id", priors[0].id as string);
    if (rErr) return { ok: false };
  }

  // Reflect into the case state machine.
  const { error: caseErr } = await client.from("collection_cases")
    .update({ status: "promised", next_action_type: "promise", next_action_at: graceUntil })
    .eq("id", input.caseId);
  if (caseErr) return { ok: false };

  return { ok: true, promiseId };
}
```

- [ ] **Step 4: Wire it into `api.contact-logs.tsx`** — after the existing case-update block, before the final `redirect(returnTo)`:

```ts
import { createPromiseForLog } from "../lib/promise-create.server";
```

Replace the tail of the action (the case-update block) so a promise-to-pay also creates the promise. After the `caseUpdate` write succeeds, add:

```ts
  if (f.outcome === "promise-to-pay" && f.promisedAmount != null && f.promisedDate != null) {
    const res = await createPromiseForLog(supabase, {
      orgId: org.org_id, caseId: f.caseId, customerId: f.customerId, userId: user.id,
      contactLogId: null, promisedAmount: f.promisedAmount, promisedDate: f.promisedDate,
    });
    if (!res.ok) return redirect(withError(returnTo, "save-failed"), { headers });
  }
```

Note: `createPromiseForLog` sets the case to `promised`/`promise`/`grace_until`, which intentionally overrides the generic `working`/`follow_up` case update above for the promise case. Leave the earlier `caseUpdate` write in place (it handles non-promise outcomes); the promise path runs after it and wins.

- [ ] **Step 5: Run the test, then commit**

Run: `cd nudgepay-app && npx vitest run tests/api-contact-logs.test.ts`
Expected: PASS.

```bash
git add nudgepay-app/app/lib/promise-create.server.ts nudgepay-app/app/routes/api.contact-logs.tsx nudgepay-app/tests/api-contact-logs.test.ts
git commit -m "feat: create + supersede promises when logging promise-to-pay"
```

---

### Task 11: Manual cancel-promise route

**Files:**
- Create: `nudgepay-app/app/routes/api.promises.cancel.tsx`
- Test: `nudgepay-app/tests/api-promises-cancel.test.ts`

**Interfaces:**
- Consumes: `safeReturnTo` (existing); `requireUser`/`resolveOrg` (existing).
- Produces: POST action that cancels a `pending` promise (→`cancelled`) and resets its case to `working`/`follow_up`/today. The cancel logic is extracted to `app/lib/promise-cancel.server.ts` for direct testing.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { cancelPromise } from "../app/lib/promise-cancel.server";

test("cancelPromise marks pending -> cancelled and resets the case", async () => {
  const svc = serviceClient();
  const user = await makeUserClient("promise-cancel@example.com");
  const { data: org } = await svc.from("organizations").insert({ name: `PCancel ${user.userId}` }).select("id").single();
  const orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });
  const { data: cust } = await svc.from("customers").insert({ org_id: orgId, qbo_id: `pcx-${user.userId}`, name: "Acme" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases").insert({ org_id: orgId, customer_id: cust!.id, status: "promised", next_action_type: "promise", next_action_at: "2026-07-03" }).select("id").single();
  const { data: prom } = await svc.from("promises").insert({
    org_id: orgId, case_id: cse!.id, customer_id: cust!.id, status: "pending",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03", baseline_balance: 1200,
  }).select("id").single();

  const res = await cancelPromise(user.client, prom!.id, "2026-06-23");
  expect(res.ok).toBe(true);

  const { data: p } = await svc.from("promises").select("status").eq("id", prom!.id).single();
  expect(p!.status).toBe("cancelled");
  const { data: c } = await svc.from("collection_cases").select("status, next_action_type, next_action_at").eq("id", cse!.id).single();
  expect(c!.status).toBe("working");
  expect(c!.next_action_type).toBe("follow_up");
  expect(c!.next_action_at).toBe("2026-06-23");
});

test("cancelPromise rejects a non-pending promise", async () => {
  const svc = serviceClient();
  const user = await makeUserClient("promise-cancel2@example.com");
  const { data: org } = await svc.from("organizations").insert({ name: `PCancel2 ${user.userId}` }).select("id").single();
  const orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });
  const { data: cust } = await svc.from("customers").insert({ org_id: orgId, qbo_id: `pcx2-${user.userId}`, name: "Acme" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases").insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();
  const { data: prom } = await svc.from("promises").insert({
    org_id: orgId, case_id: cse!.id, customer_id: cust!.id, status: "kept",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03", baseline_balance: 1200,
  }).select("id").single();

  const res = await cancelPromise(user.client, prom!.id, "2026-06-23");
  expect(res.ok).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/api-promises-cancel.test.ts`
Expected: FAIL — cannot find module `promise-cancel.server`.

- [ ] **Step 3: Create `app/lib/promise-cancel.server.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

// Cancels a pending promise (RLS-scoped client) and resets the case to a
// follow-up next action. Rejects if the promise is not pending or not visible.
export async function cancelPromise(
  client: SupabaseClient, promiseId: string, today: string,
): Promise<{ ok: boolean }> {
  const { data: updated, error } = await client.from("promises")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("id", promiseId).eq("status", "pending")
    .select("id, case_id");
  if (error) return { ok: false };
  if (!updated || updated.length === 0) return { ok: false };

  const caseId = updated[0].case_id as string;
  const { error: cErr } = await client.from("collection_cases")
    .update({ status: "working", next_action_type: "follow_up", next_action_at: today })
    .eq("id", caseId);
  if (cErr) return { ok: false };
  return { ok: true };
}
```

- [ ] **Step 4: Create the route `app/routes/api.promises.cancel.tsx`**

```tsx
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";
import { cancelPromise } from "../lib/promise-cancel.server";

function withError(returnTo: string, code: string): string {
  const sep = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${sep}promise=1&promiseError=${encodeURIComponent(code)}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const promiseId = form.get("promiseId");
  if (typeof promiseId !== "string" || promiseId === "") {
    return redirect(withError(returnTo, "missing-promise"), { headers });
  }

  const today = new Date().toISOString().slice(0, 10);
  const res = await cancelPromise(supabase, promiseId, today);
  if (!res.ok) return redirect(withError(returnTo, "cancel-failed"), { headers });
  return redirect(returnTo, { headers });
}
```

- [ ] **Step 5: Run the test, then commit**

Run: `cd nudgepay-app && npx vitest run tests/api-promises-cancel.test.ts`
Expected: PASS (2 tests).

```bash
git add nudgepay-app/app/lib/promise-cancel.server.ts nudgepay-app/app/routes/api.promises.cancel.tsx nudgepay-app/tests/api-promises-cancel.test.ts
git commit -m "feat: add manual cancel-promise route"
```

---

### Task 12: cases.ts — populate promise fields + case-keyed last-contact

**Files:**
- Modify: `nudgepay-app/app/lib/cases.ts`
- Test: `nudgepay-app/tests/cases.test.ts` (extend)

**Interfaces:**
- Produces:
  - `CaseItem` gains `promiseStatus: PromiseStatus | null` and `amountReceived: number | null` (keep existing `promise` and `brokenPromise`).
  - New input types: `type CasePromiseInput = { caseId: string; status: PromiseStatus; promisedAmount: number; promisedDate: string; amountReceived: number }` and `type CaseLastContactInput = { caseId: string; date: string; channel: string }`.
  - `buildCaseItems(cases, invoices, customers, lastContacts: CaseLastContactInput[], promises: CasePromiseInput[], today, ownerLabels): CaseItem[]` (signature gains `promises`; `lastContacts` re-typed to case-keyed).

- [ ] **Step 1: Write the failing test** (extend `tests/cases.test.ts`)

```ts
import type { CasePromiseInput, CaseLastContactInput } from "../app/lib/cases";

test("buildCaseItems populates promise, brokenPromise, promiseStatus and case-keyed last contact", () => {
  const cases = [{ id: "case-1", customerId: "c1", status: "promised" as const, nextActionType: "promise" as const, nextActionAt: "2026-07-03" }];
  const invoices = [{ id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 1200, due_date: "2026-03-01" }];
  const customers = [{ id: "c1", name: "Acme", phone: null, email: null, owner: null }];
  const lastContacts: CaseLastContactInput[] = [{ caseId: "case-1", date: "2026-06-20T10:00:00Z", channel: "Text" }];
  const promises: CasePromiseInput[] = [
    { caseId: "case-1", status: "broken", promisedAmount: 500, promisedDate: "2026-07-01", amountReceived: 0 },
  ];
  const items = buildCaseItems(cases, invoices, customers, lastContacts, promises, "2026-07-10", new Map());
  expect(items[0].promise).toEqual({ amount: 500, date: "2026-07-01" });
  expect(items[0].brokenPromise).toBe(true);
  expect(items[0].promiseStatus).toBe("broken");
  expect(items[0].lastContact).toEqual({ date: "2026-06-20T10:00:00Z", channel: "Text" });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: FAIL — `buildCaseItems` arity/shape mismatch; `CasePromiseInput` not exported.

- [ ] **Step 3: Edit `cases.ts`**

Add the import and types near the top (after the existing imports):

```ts
import type { PromiseStatus } from "./promises";
```

```ts
export type CasePromiseInput = {
  caseId: string;
  status: PromiseStatus;
  promisedAmount: number;
  promisedDate: string;
  amountReceived: number;
};
export type CaseLastContactInput = { caseId: string; date: string; channel: string };
```

Add the two fields to `CaseItem` (after `brokenPromise`):

```ts
  promiseStatus: PromiseStatus | null;
  amountReceived: number | null;
```

Replace the `buildCaseItems` signature and the last-contact + promise wiring:

```ts
export function buildCaseItems(
  cases: CaseRow[],
  invoices: InvoiceInput[],
  customers: CustomerInput[],
  lastContacts: CaseLastContactInput[],
  promises: CasePromiseInput[],
  today: string,
  ownerLabels: Map<string, string>,
): CaseItem[] {
  const customerById = new Map(customers.map((c) => [c.id, c]));

  // Group overdue invoices by customer (skip orphans with null customer_id).
  const invoicesByCustomer = new Map<string, CaseInvoice[]>();
  for (const inv of invoices) {
    if (!inv.customer_id) continue;
    const ageDays = inv.due_date ? ageInDays(inv.due_date, today) : 0;
    const ci: CaseInvoice = {
      invoiceId: inv.id,
      docNumber: inv.qbo_doc_number,
      balance: Number(inv.balance || 0),
      dueDate: inv.due_date,
      ageDays,
      heat: heatOf(ageDays),
    };
    const list = invoicesByCustomer.get(inv.customer_id) ?? [];
    list.push(ci);
    invoicesByCustomer.set(inv.customer_id, list);
  }

  // Most-recent contact per CASE (max-by-date; do not rely on order).
  const lastByCase = new Map<string, CaseLastContactInput>();
  for (const lc of lastContacts) {
    const prev = lastByCase.get(lc.caseId);
    if (!prev || lc.date > prev.date) lastByCase.set(lc.caseId, lc);
  }

  // Active promise per case (the input carries at most one relevant promise per case).
  const promiseByCase = new Map<string, CasePromiseInput>();
  for (const p of promises) promiseByCase.set(p.caseId, p);

  return cases.map((cse) => {
    const cust = customerById.get(cse.customerId) ?? null;
    const invList = (invoicesByCustomer.get(cse.customerId) ?? [])
      .slice()
      .sort((a, b) => b.ageDays - a.ageDays); // oldest first
    const totalOverdue = invList.reduce((s, i) => s + i.balance, 0);
    const oldestAgeDays = invList.length ? invList[0].ageDays : 0;
    const lc = lastByCase.get(cse.id) ?? null;
    const neverContacted = !lc;
    const ownerId = cust?.owner ?? null;
    const owner = ownerId ? (ownerLabels.get(ownerId) ?? "Unknown") : "Unassigned";
    const name = cust?.name ?? "(unknown customer)";
    const followUpDue = cse.nextActionAt != null && cse.nextActionAt <= today;
    const prom = promiseByCase.get(cse.id) ?? null;

    return {
      caseId: cse.id,
      customerId: cse.customerId,
      customerName: name,
      owner,
      ownerId,
      status: cse.status,
      nextActionType: cse.nextActionType,
      nextActionAt: cse.nextActionAt,
      totalOverdue,
      invoiceCount: invList.length,
      oldestAgeDays,
      heat: heatOf(oldestAgeDays),
      priority: priorityOf(oldestAgeDays, neverContacted),
      lastContact: lc ? { date: lc.date, channel: lc.channel } : null,
      phone: cust?.phone ?? null,
      email: cust?.email ?? null,
      promise: prom ? { amount: prom.promisedAmount, date: prom.promisedDate } : null,
      brokenPromise: prom?.status === "broken",
      promiseStatus: prom ? prom.status : null,
      amountReceived: prom ? prom.amountReceived : null,
      followUpDue,
      searchText: [name, ...invList.map((i) => i.docNumber ?? ""), cust?.phone ?? "", cust?.email ?? "", owner]
        .filter(Boolean).join(" ").toLowerCase(),
      invoices: invList,
    };
  });
}
```

Note: the `invoiceToCustomer`/`lastByCustomer` mapping that keyed last-contact off invoices is removed entirely — last contact is now keyed directly off `case_id`.

- [ ] **Step 4: Run the test**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: PASS (existing + new).

**Required existing-test updates (the signature change breaks 6a tests — fix them in this task):**
- Every existing `buildCaseItems(...)` call in `cases.test.ts` gains the `promises` argument in its new position (4th = `lastContacts`, 5th = `promises`). Pass `[]` for `promises` where the test doesn't exercise promises.
- The 6a last-contact test asserted invoice→customer keying via `LastContactInput { invoiceId, date, channel }`. Last contact is now keyed by `case_id`; re-point that test to `CaseLastContactInput { caseId, date, channel }` and assert the most-recent-per-case selection. Do not delete the test — convert it.
- Any test asserting the full `CaseItem` shape must include the new `promiseStatus` and `amountReceived` fields.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/cases.ts nudgepay-app/tests/cases.test.ts
git commit -m "feat: populate promise fields and case-keyed last-contact in cases"
```

---

### Task 13: Dashboard loader — load promises + re-thread last-contact by case_id

**Files:**
- Modify: `nudgepay-app/app/routes/dashboard.tsx`
- Test: `nudgepay-app/tests/dashboard-worklist.test.ts` (extend)

**Interfaces:**
- Consumes: `buildCaseItems` new signature; `CasePromiseInput`, `CaseLastContactInput` (Task 12).
- Produces: `buildCaseData(cases, invoices, customers, lastContacts: CaseLastContactInput[], promises: CasePromiseInput[], params, today, ownerLabels, currentUserId)` — signature gains `promises`; `lastContacts` re-typed. Loader fetches open cases' active promises and a per-case last-contact merged from `contact_logs` + `text_messages`.

- [ ] **Step 1: Write the failing test** (extend `tests/dashboard-worklist.test.ts`)

```ts
import type { CasePromiseInput, CaseLastContactInput } from "../app/lib/cases";

test("buildCaseData threads promises into items and metrics", () => {
  const cases = [{ id: "case-1", customerId: "c1", status: "promised" as const, nextActionType: "promise" as const, nextActionAt: "2026-07-03" }];
  const invoices = [{ id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 1200, due_date: "2026-03-01" }];
  const customers = [{ id: "c1", name: "Acme", phone: null, email: null, owner: "u1" }];
  const lastContacts: CaseLastContactInput[] = [];
  const promises: CasePromiseInput[] = [{ caseId: "case-1", status: "broken", promisedAmount: 500, promisedDate: "2026-07-01", amountReceived: 0 }];
  const data = buildCaseData(cases, invoices, customers, lastContacts, promises,
    { view: "broken-promises", sort: "recommended", q: "", caseId: "case-1" }, "2026-07-10",
    new Map([["u1", "diskin"]]), "u1");
  expect(data.items.map((i) => i.caseId)).toEqual(["case-1"]);
  expect(data.metrics.brokenPromises.count).toBe(1);
  expect(data.selected?.promiseStatus).toBe("broken");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/dashboard-worklist.test.ts`
Expected: FAIL — `buildCaseData` arity mismatch.

**Required existing-test updates (fix in this task):** the two existing `buildCaseData(...)` calls in `dashboard-worklist.test.ts` (the "composes case items…" and "search filter…" tests) use the old 8-arg signature. Insert `[]` for the new `promises` argument in its new 5th position (after `lastContacts`, before `params`). The DB-backed RLS tests in that file don't call `buildCaseData` and need no change.

- [ ] **Step 3: Edit `dashboard.tsx`**

Update `buildCaseData` to accept and forward `promises`, and re-type `lastContacts`:

```ts
export function buildCaseData(
  cases: CaseRow[],
  invoices: InvoiceInput[],
  customers: CustomerInput[],
  lastContacts: CaseLastContactInput[],
  promises: CasePromiseInput[],
  params: { view: ViewId; sort: SortId; q: string; caseId: string | null },
  today: string,
  ownerLabels: Map<string, string>,
  currentUserId: string | null,
) {
  const allItems = buildCaseItems(cases, invoices, customers, lastContacts, promises, today, ownerLabels);
  // ... existing view/sort/metrics/selection logic unchanged ...
}
```

Import the new types:

```ts
import { buildCaseItems, applyCaseView, sortCaseItems, computeCaseMetrics,
  type CaseRow, type CaseItem, type CasePromiseInput, type CaseLastContactInput } from "../lib/cases";
```

In the loader, replace the invoice-keyed `lastContactsInput` build with a **case-keyed** merge of contact logs and text messages, and load active promises. After `rawInvoices`/`cases` are loaded:

```ts
  // Per-case last contact, merged from contact_logs + text_messages (both carry case_id since 0009).
  const caseIds = cases.map((c) => c.id);
  const lastContactsInput: CaseLastContactInput[] = [];
  if (caseIds.length > 0) {
    const { data: logRows } = await supabase
      .from("contact_logs")
      .select("case_id, method, created_at")
      .eq("org_id", org.org_id).in("case_id", caseIds)
      .order("created_at", { ascending: false });
    const methodLabel: Record<string, string> = { call: "Call", email: "Email", text: "Text", note: "Note" };
    for (const r of (logRows as any[]) ?? []) {
      if (r.case_id) lastContactsInput.push({ caseId: r.case_id, date: r.created_at, channel: methodLabel[r.method] ?? "Note" });
    }
    const { data: msgRows } = await supabase
      .from("text_messages")
      .select("case_id, created_at")
      .eq("org_id", org.org_id).in("case_id", caseIds).eq("direction", "outbound")
      .order("created_at", { ascending: false });
    for (const r of (msgRows as any[]) ?? []) {
      if (r.case_id) lastContactsInput.push({ caseId: r.case_id, date: r.created_at, channel: "Text" });
    }
  }

  // Active promise per open case (pending preferred, else most-recent non-cancelled).
  const promisesInput: CasePromiseInput[] = [];
  if (caseIds.length > 0) {
    const { data: promRows } = await supabase
      .from("promises")
      .select("case_id, status, promised_amount, promised_date, amount_received, created_at")
      .eq("org_id", org.org_id).in("case_id", caseIds)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false });
    const seen = new Set<string>();
    const pendingFirst = [...((promRows as any[]) ?? [])].sort((a, b) =>
      (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0));
    for (const r of pendingFirst) {
      if (seen.has(r.case_id)) continue;
      seen.add(r.case_id);
      promisesInput.push({
        caseId: r.case_id, status: r.status, promisedAmount: Number(r.promised_amount) || 0,
        promisedDate: r.promised_date, amountReceived: Number(r.amount_received) || 0,
      });
    }
  }
```

Update the `buildCaseData(...)` call in the loader to pass `lastContactsInput` and `promisesInput` in the new positions.

- [ ] **Step 4: Run the test, then full typecheck**

Run: `cd nudgepay-app && npx vitest run tests/dashboard-worklist.test.ts`
Expected: PASS. Then `npx tsc -b` — expect transient errors only at DetailPanel/WorkQueue call sites (fixed in Task 14); the loader/`buildCaseData` itself must be clean.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/routes/dashboard.tsx nudgepay-app/tests/dashboard-worklist.test.ts
git commit -m "feat: load promises and re-thread last-contact by case_id"
```

---

### Task 14: UI — promise card + cancel button + queue indicator

**Files:**
- Modify: `nudgepay-app/app/components/DetailPanel.tsx`, `nudgepay-app/app/components/WorkQueue.tsx`
- Verify: `npx tsc -b` + `npx react-router build`

**Interfaces:**
- Consumes: `CaseItem` fields `promise`, `promiseStatus`, `amountReceived` (Task 12). The active promise's id is needed for the cancel form — add it to the selected-case detail (see note).

- [ ] **Step 1: Add a static status map + Promise card to `DetailPanel.tsx`**

Near the other static maps:

```tsx
const PROMISE_STATUS: Record<string, { label: string; tone: string }> = {
  pending:        { label: "Promise pending",  tone: "text-cool" },
  kept:           { label: "Promise kept",     tone: "text-cool" },
  partially_kept: { label: "Partially kept",   tone: "text-warm" },
  broken:         { label: "Promise broken",   tone: "text-hot" },
  renegotiated:   { label: "Renegotiated",     tone: "text-muted" },
  cancelled:      { label: "Cancelled",        tone: "text-muted" },
};
```

In the Overview tab, render a Promise card when `selected.promiseStatus` is set:

```tsx
{selected.promiseStatus ? (
  <div className="rounded-lg border border-border bg-panel px-4 py-3">
    <div className="flex items-center justify-between">
      <span className={`text-sm font-sans font-semibold ${PROMISE_STATUS[selected.promiseStatus]?.tone ?? "text-text"}`}>
        {PROMISE_STATUS[selected.promiseStatus]?.label ?? selected.promiseStatus}
      </span>
      {selected.promise ? (
        <span className="font-mono text-sm text-text">{formatUSD(selected.promise.amount)}</span>
      ) : null}
    </div>
    {selected.promise ? (
      <p className="mt-1 text-xs text-muted">
        Promised by {formatDate(selected.promise.date)}
        {selected.amountReceived != null ? ` · received ${formatUSD(selected.amountReceived)}` : ""}
      </p>
    ) : null}
    {selected.promiseStatus === "pending" && selectedPromiseId ? (
      <form method="post" action="/api/promises/cancel" className="mt-2">
        <input type="hidden" name="promiseId" value={selectedPromiseId} />
        <input type="hidden" name="returnTo" value={overviewReturnTo} />
        <button type="submit" className="text-xs font-sans font-medium text-copper hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded">
          Cancel promise
        </button>
      </form>
    ) : null}
  </div>
) : null}
```

Note on `selectedPromiseId` and `overviewReturnTo`: the active promise's `id` is not currently on `CaseItem`. The simplest path is to surface the selected case's active promise id from the loader as a separate prop (`selectedPromiseId: string | null`) alongside the existing selected-case detail props, and build `overviewReturnTo` the same way the Messages tab builds its `returnTo`. Add `selectedPromiseId` to the loader's selected-case detail (read the case's pending promise id) and thread it through `dashboard.tsx` → `DetailPanel`. If the active promise is not `pending`, pass `null` (no cancel button).

- [ ] **Step 2: Add a queue indicator to `WorkQueue.tsx`**

In `QueueRow` and `MobileCard`, after the status label, surface a broken/promised hint from `item.promiseStatus`:

```tsx
{item.promiseStatus === "broken" ? (
  <span className="text-hot"> · Promise broken</span>
) : item.promiseStatus === "pending" ? (
  <span className="text-cool"> · Promised</span>
) : null}
```

- [ ] **Step 3: Thread `selectedPromiseId` through the loader + dashboard route**

In `dashboard.tsx` loader selected-case block, read the active pending promise id:

```ts
  let selectedPromiseId: string | null = null;
  if (selectedCase) {
    const { data: ap } = await supabase
      .from("promises").select("id").eq("org_id", org.org_id).eq("case_id", selectedCase.id).eq("status", "pending").maybeSingle();
    selectedPromiseId = ap?.id ?? null;
  }
```

Return `selectedPromiseId` from the loader and pass it to `<DetailPanel selectedPromiseId={...} ... />`. Add the prop to `DetailPanel`'s props type.

- [ ] **Step 4: Verify build**

Run: `cd nudgepay-app && npx tsc -b && npx react-router build`
Expected: tsc clean; build succeeds (no client→`.server` import — `DetailPanel` imports only `cases.ts`/`dates.ts` types + the route action via URL, never a `.server` module).

- [ ] **Step 5: Run the full suite, then commit**

Run: `cd nudgepay-app && npx vitest run`
Expected: all tests pass.

```bash
git add nudgepay-app/app/components/DetailPanel.tsx nudgepay-app/app/components/WorkQueue.tsx nudgepay-app/app/routes/dashboard.tsx
git commit -m "feat: promise card with cancel and broken-promise queue indicator"
```

---

## Final verification (after Task 14)

- [ ] `cd nudgepay-app && npx vitest run` — full suite green.
- [ ] `cd nudgepay-app && npx tsc -b && npx react-router build` — typecheck + build clean.
- [ ] Spot-check the demo: update `scripts/demo-seed.mjs` (LOCAL-ONLY, never commit) to create a pending promise (kept + broken examples) and confirm the broken-promises view, the promise card, and the cancel action render.

## Notes for the implementer

- **Service vs user client:** payment sync, reconciliation, and promise evaluation run with the **service** client (sync layer, org-scoped). Promise creation/cancel run with the **user** client (RLS). Never cross these.
- **`closed_at` semantics:** a case is open while `closed_at is null`. Promise-driven status changes (`promised`/`working`) never touch `closed_at`; only full-payment reconciliation closes a case.
- **CloudEvents:** the exact field casing in `parseCloudEvents` is a documented assumption — confirm against a real Intuit payload before production cutover. Both parsers stay regardless.
- **Backfill abort risk:** the windowed insert in the migration guarantees at most one `pending` promise per case so the partial-unique index cannot abort the migration.
