# Phase 6a — Case Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the customer account to the primary collections workspace — a durable `collection_cases` table that auto-opens/closes per customer, a case-centric work queue (one row per case, invoices inside), and a per-customer SMS thread.

**Architecture:** A new RLS-gated `collection_cases` table holds durable per-customer collections state. A pure `reconcileCases` computes open/resolve ops; a thin server applier runs it after every invoice-write path. The queue is rebuilt around `CaseItem` (pure `cases.ts`, reusing `worklist.ts` heat/priority). The dashboard loader, `WorkQueue`, and `DetailPanel` move from `?invoice=` / `WorkItem` to `?case=` / `CaseItem`. Contact logging becomes case-anchored (optional invoice); SMS send/consent default to the case's oldest invoice.

**Tech Stack:** React Router v7 (framework mode) on Cloudflare Workers; Supabase Postgres + RLS; Vitest against local Supabase; Tailwind v4.

## Global Constraints

- React Router v7 framework mode on Cloudflare Workers. No `node:*` in `app/**`.
- No client→`.server.ts` module-graph reference. Pure modules (`worklist.ts`, `cases.ts`) stay suffix-free. Type-only imports from route/pure modules are erased at build and safe.
- Tailwind v4 CSS-first; **static literal class strings only** (no `text-${tone}`); use static record maps. Thermal tokens cool/warm/hot; copper accent; ink/panel/surface/border/text/muted.
- Supabase RLS via `is_org_member(org_id)`. **User client** for reads + the contact-driven case write; **service client** only for connection status / member roster / sync-time reconciliation (org-scoped by `org_id` on every query). The browser never touches the DB.
- All redirects use `safeReturnTo(value, "/dashboard")`; `returnTo` must be an absolute `/dashboard?...` path.
- Vitest against local Supabase; per-test **fresh orgs + globally-unique data**; **never** global truncation. Run via `npx vitest run` (NOT `npm test`). Components verified by `npx tsc -b` + `npx react-router build`.
- Conventional Commits. Never commit secrets. Never `git add` untracked prototype dirs (`nudgepay-frontend/`, `nudgepay-backend/`) or local-only `scripts/`. Commit only named files.
- Migrations applied via `npx supabase migration up` against local Supabase.
- Co-author every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Case status & next-action vocabulary (verbatim from spec)

- `status ∈ {'new','working','promised','waiting','on_hold','resolved'}`
- `next_action_type ∈ {'contact','follow_up','promise','waiting','exception'}`
- 6a actively uses `new` / `working` / `resolved` and `next_action_type` `contact` / `follow_up`. `promised`/`waiting`/`on_hold` and their types are defined in the check constraint but transitioned into by 6b/6c.

## File structure

| Action | File | Responsibility |
| --- | --- | --- |
| Create | `supabase/migrations/0009_collection_cases.sql` | table + RLS + indexes + `case_id` columns + one-time reconcile/backfill |
| Create | `app/lib/cases.ts` | pure `reconcileCases`, `CaseItem`, `buildCaseItems`, `applyCaseView`, `sortCaseItems`, `computeCaseMetrics` |
| Create | `app/lib/case-lifecycle.server.ts` | `applyCaseReconciliation` Supabase applier |
| Modify | `app/lib/qbo-sync.server.ts` | invoke applier after invoice upserts (sync/webhook/CDC) |
| Modify | `app/lib/contact-log.ts` | `caseId` required, `invoiceId` optional |
| Modify | `app/routes/api.contact-logs.tsx` | resolve case, update next-action/status on save |
| Modify | `app/routes/dashboard.tsx` | loader builds cases; select by `case`; thread by `customer_id` |
| Modify | `app/components/WorkQueue.tsx` | case rows + columns |
| Modify | `app/components/DetailPanel.tsx` | customer/case workspace; invoices inside |
| Modify | `app/components/MetricsStrip.tsx` | case-count labels |
| Create | `tests/cases.test.ts` | pure unit tests |
| Create | `tests/cases-rls.test.ts` | DB-backed RLS + lifecycle |
| Modify | `tests/api-contact-logs.test.ts`, `tests/dashboard-worklist.test.ts` | case update + composition |

---

### Task 1: Migration `0009_collection_cases.sql`

**Files:**
- Create: `nudgepay-app/supabase/migrations/0009_collection_cases.sql`
- Test: `nudgepay-app/tests/cases-rls.test.ts` (the migration-shape assertions; lifecycle tests come in Task 4)

**Interfaces:**
- Produces: table `collection_cases (id, org_id, customer_id, status, next_action_type, next_action_at, opened_at, closed_at, created_at)`; partial unique index `collection_cases_one_open_per_customer`; `contact_logs.case_id`, `text_messages.case_id`.

- [ ] **Step 1: Write the migration**

Create `nudgepay-app/supabase/migrations/0009_collection_cases.sql`:

```sql
-- Phase 6a: per-customer collection cases (durable collections state).
create table collection_cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  status text not null default 'new'
    check (status in ('new','working','promised','waiting','on_hold','resolved')),
  next_action_type text
    check (next_action_type in ('contact','follow_up','promise','waiting','exception')),
  next_action_at date,
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz,
  created_at timestamptz not null default now()
);

-- At most ONE open case per customer (auto-open singularity + idempotent reconcile).
create unique index collection_cases_one_open_per_customer
  on collection_cases (customer_id) where closed_at is null;
create index collection_cases_org_status_idx     on collection_cases (org_id, status);
create index collection_cases_org_nextaction_idx on collection_cases (org_id, next_action_at);

-- RLS: gate by org membership (mirror 0002 contact_logs_all).
alter table collection_cases enable row level security;
create policy collection_cases_all on collection_cases
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Interactions link to a case (nullable; historical rows may stay null).
alter table contact_logs  add column case_id uuid references collection_cases(id) on delete set null;
alter table text_messages add column case_id uuid references collection_cases(id) on delete set null;
create index contact_logs_org_case_idx  on contact_logs  (org_id, case_id);
create index text_messages_org_case_idx on text_messages (org_id, case_id);

-- One-time backfill: open a case for every customer with overdue work and no open case.
insert into collection_cases (org_id, customer_id, status, next_action_type, next_action_at)
select distinct i.org_id, i.customer_id, 'new', 'contact', current_date
from invoices i
where i.customer_id is not null
  and i.balance > 0
  and i.due_date < current_date
  and not exists (
    select 1 from collection_cases c
    where c.customer_id = i.customer_id and c.closed_at is null
  );

-- Backfill case_id on existing interactions to the customer's open case.
update contact_logs cl
set case_id = c.id
from collection_cases c
where c.customer_id = cl.customer_id and c.closed_at is null and cl.case_id is null;

update text_messages tm
set case_id = c.id
from collection_cases c
where c.customer_id = tm.customer_id and c.closed_at is null and tm.case_id is null;
```

- [ ] **Step 2: Apply the migration**

Run: `cd nudgepay-app && npx supabase migration up`
Expected: applies `0009_collection_cases.sql` with no error; `collection_cases` listed in subsequent `npx supabase migration list` / table introspection.

- [ ] **Step 3: Write a DB-backed shape test**

Add to a new file `nudgepay-app/tests/cases-rls.test.ts`:

```ts
import { expect, test, beforeAll } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

test("collection_cases enforces one open case per customer", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Cases Org A" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "cs-c1", name: "Riverside" }).select("id").single();

  const first = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "new", next_action_type: "contact" });
  expect(first.error).toBeNull();

  // Second OPEN case for the same customer must violate the partial unique index.
  const second = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "new" });
  expect(second.error).not.toBeNull();

  // But a resolved (closed) case may coexist with a new open one.
  await svc.from("collection_cases")
    .update({ status: "resolved", closed_at: new Date().toISOString() })
    .eq("org_id", orgId).eq("customer_id", cust!.id);
  const third = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "new" });
  expect(third.error).toBeNull();
});

test("RLS: a member reads only their own org's cases", async () => {
  const svc = serviceClient();
  const a = await makeUserClient("cases-rls-a@example.com");
  const { data: orgA } = await svc.from("organizations").insert({ name: "RLS Org A" }).select("id").single();
  await svc.from("memberships").insert({ org_id: orgA!.id, user_id: a.userId, role: "owner" });
  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgA!.id, qbo_id: "rls-c1", name: "A Cust" }).select("id").single();
  await svc.from("collection_cases").insert({ org_id: orgA!.id, customer_id: custA!.id, status: "new" });

  // A foreign org + case the member is NOT in.
  const { data: orgB } = await svc.from("organizations").insert({ name: "RLS Org B" }).select("id").single();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgB!.id, qbo_id: "rls-c2", name: "B Cust" }).select("id").single();
  await svc.from("collection_cases").insert({ org_id: orgB!.id, customer_id: custB!.id, status: "new" });

  const { data: visible, error } = await a.client.from("collection_cases").select("id, org_id");
  expect(error).toBeNull();
  expect(visible!.every((r) => r.org_id === orgA!.id)).toBe(true);
  expect(visible!.length).toBe(1);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/cases-rls.test.ts`
Expected: PASS (2 tests). If the migration was not applied (Step 2), the inserts fail — re-run Step 2.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/supabase/migrations/0009_collection_cases.sql nudgepay-app/tests/cases-rls.test.ts
git commit -m "feat: add collection_cases table, RLS, and case_id links (6a)"
```

---

### Task 2: `cases.ts` — types + `reconcileCases` (pure)

**Files:**
- Create: `nudgepay-app/app/lib/cases.ts`
- Test: `nudgepay-app/tests/cases.test.ts`

**Interfaces:**
- Consumes (from `app/lib/worklist.ts`): `Heat`, `Priority`, `LastContact`, `Metric`, `Metrics`, `ViewId`, `SortId`, `InvoiceInput`, `CustomerInput`, `LastContactInput`, `HIGH_VALUE_THRESHOLD`, `heatOf`, `priorityOf`, `ageInDays`.
- Produces: `CaseStatus`, `NextActionType`, `CaseRow`, `CaseInvoice`, `CaseItem`, `ReconcileOp`, `reconcileCases(overdueCustomerIds, openCases, today)`.

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/cases.test.ts`:

```ts
import { expect, test } from "vitest";
import { reconcileCases } from "../app/lib/cases";

const TODAY = "2026-06-22";

test("reconcileCases opens a case for an overdue customer with no open case", () => {
  const ops = reconcileCases(new Set(["c1", "c2"]), [{ id: "case-1", customerId: "c1" }], TODAY);
  expect(ops).toEqual([{ kind: "open", customerId: "c2" }]);
});

test("reconcileCases resolves an open case whose customer is no longer overdue", () => {
  const ops = reconcileCases(new Set(["c1"]), [
    { id: "case-1", customerId: "c1" },
    { id: "case-2", customerId: "c2" },
  ], TODAY);
  expect(ops).toEqual([{ kind: "resolve", caseId: "case-2" }]);
});

test("reconcileCases is a no-op when cases already match the overdue set", () => {
  const ops = reconcileCases(new Set(["c1"]), [{ id: "case-1", customerId: "c1" }], TODAY);
  expect(ops).toEqual([]);
});

test("reconcileCases both opens and resolves in one pass", () => {
  const ops = reconcileCases(new Set(["c2"]), [{ id: "case-1", customerId: "c1" }], TODAY);
  expect(ops).toContainEqual({ kind: "open", customerId: "c2" });
  expect(ops).toContainEqual({ kind: "resolve", caseId: "case-1" });
  expect(ops.length).toBe(2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: FAIL — `Failed to resolve import "../app/lib/cases"`.

- [ ] **Step 3: Write the minimal implementation**

Create `nudgepay-app/app/lib/cases.ts`:

```ts
// Pure derived-intelligence for the case-centric collections workspace. No I/O,
// no node:*, no .server suffix (imported by route + tests + client components via
// type-only imports). Reuses the invoice-level heat/priority helpers from worklist.ts.

import {
  heatOf, priorityOf, ageInDays, HIGH_VALUE_THRESHOLD,
  type Heat, type Priority, type LastContact, type Metric, type Metrics,
  type ViewId, type SortId, type InvoiceInput, type CustomerInput, type LastContactInput,
} from "./worklist";

export type CaseStatus = "new" | "working" | "promised" | "waiting" | "on_hold" | "resolved";
export type NextActionType = "contact" | "follow_up" | "promise" | "waiting" | "exception";

export type CaseRow = {
  id: string;
  customerId: string;
  status: CaseStatus;
  nextActionType: NextActionType | null;
  nextActionAt: string | null;
};

export type CaseInvoice = {
  invoiceId: string;
  docNumber: string | null;
  balance: number;
  dueDate: string | null;
  ageDays: number;
  heat: Heat;
};

export type CaseItem = {
  caseId: string;
  customerId: string;
  customerName: string;
  owner: string;
  ownerId: string | null;
  status: CaseStatus;
  nextActionType: NextActionType | null;
  nextActionAt: string | null;
  totalOverdue: number;
  invoiceCount: number;
  oldestAgeDays: number;
  heat: Heat;
  priority: Priority;
  lastContact: LastContact;
  phone: string | null;
  email: string | null;
  promise: { amount: number; date: string } | null;
  brokenPromise: boolean;
  followUpDue: boolean;
  searchText: string;
  invoices: CaseInvoice[];
};

export type ReconcileOp =
  | { kind: "open"; customerId: string }
  | { kind: "resolve"; caseId: string };

// Pure: given the set of customer ids that currently have overdue work and the
// existing OPEN cases, return the open/resolve ops needed. Idempotent.
export function reconcileCases(
  overdueCustomerIds: Set<string>,
  openCases: { id: string; customerId: string }[],
  _today: string,
): ReconcileOp[] {
  const ops: ReconcileOp[] = [];
  const openByCustomer = new Set(openCases.map((c) => c.customerId));

  for (const customerId of overdueCustomerIds) {
    if (!openByCustomer.has(customerId)) ops.push({ kind: "open", customerId });
  }
  for (const c of openCases) {
    if (!overdueCustomerIds.has(c.customerId)) ops.push({ kind: "resolve", caseId: c.id });
  }
  return ops;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/cases.ts nudgepay-app/tests/cases.test.ts
git commit -m "feat: add cases.ts with reconcileCases (6a)"
```

---

### Task 3: `cases.ts` — `buildCaseItems`, `applyCaseView`, `sortCaseItems`, `computeCaseMetrics` (pure)

**Files:**
- Modify: `nudgepay-app/app/lib/cases.ts`
- Test: `nudgepay-app/tests/cases.test.ts`

**Interfaces:**
- Produces: `buildCaseItems(cases, invoices, customers, lastContacts, today, ownerLabels)`, `applyCaseView(items, view, today, currentUserId)`, `sortCaseItems(items, sort)`, `computeCaseMetrics(items, today)`.
- Reuses `Metrics` shape from `worklist.ts`: `{ thirtyPlus, highValue, neverContacted, allOpen, followUpsDue, brokenPromises }` (each `Metric = { count, amount }`).

- [ ] **Step 1: Write the failing tests**

Append to `nudgepay-app/tests/cases.test.ts`:

```ts
import {
  buildCaseItems, applyCaseView, sortCaseItems, computeCaseMetrics,
  type CaseRow,
} from "../app/lib/cases";

const CASES: CaseRow[] = [
  { id: "case-1", customerId: "c1", status: "working", nextActionType: "follow_up", nextActionAt: "2026-06-20" },
  { id: "case-2", customerId: "c2", status: "new", nextActionType: "contact", nextActionAt: "2026-06-25" },
];
const CUSTOMERS = [
  { id: "c1", name: "Acme", phone: "+13105550101", email: "ap@acme.test", owner: "u1" },
  { id: "c2", name: "Globex", phone: null, email: null, owner: null },
];
const INVOICES = [
  { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 6000, due_date: "2026-03-01" }, // 113d
  { id: "i2", qbo_doc_number: "1002", customer_id: "c1", balance: 300,  due_date: "2026-06-18" }, // 4d
  { id: "i3", qbo_doc_number: "2001", customer_id: "c2", balance: 800,  due_date: "2026-05-01" }, // 52d
];
const LABELS = new Map([["u1", "diskin"]]);

test("buildCaseItems aggregates totalOverdue, invoiceCount, oldest age, and heat from the oldest", () => {
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, [], TODAY, LABELS);
  const acme = items.find((c) => c.customerId === "c1")!;
  expect(acme.totalOverdue).toBe(6300);
  expect(acme.invoiceCount).toBe(2);
  expect(acme.oldestAgeDays).toBe(113);
  expect(acme.heat.band).toBe("hot");
  expect(acme.owner).toBe("diskin");
  expect(acme.invoices.map((i) => i.invoiceId)).toEqual(["i1", "i2"]); // oldest first
  expect(acme.searchText).toContain("diskin");
  expect(acme.searchText).toContain("1001");
});

test("buildCaseItems resolves owner Unassigned when null", () => {
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, [], TODAY, LABELS);
  expect(items.find((c) => c.customerId === "c2")!.owner).toBe("Unassigned");
});

test("buildCaseItems excludes invoices with a null customer_id", () => {
  const orphanInvoices = [...INVOICES, { id: "i9", qbo_doc_number: "9999", customer_id: null, balance: 100, due_date: "2026-01-01" }];
  const items = buildCaseItems(CASES, orphanInvoices, CUSTOMERS, [], TODAY, LABELS);
  expect(items.flatMap((c) => c.invoices).some((i) => i.invoiceId === "i9")).toBe(false);
});

test("applyCaseView filters by case-level predicates", () => {
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, [], TODAY, LABELS);
  expect(applyCaseView(items, "30-plus", TODAY, null).map((c) => c.customerId)).toEqual(["c1", "c2"]);
  expect(applyCaseView(items, "high-value", TODAY, null).map((c) => c.customerId)).toEqual(["c1"]);
  expect(applyCaseView(items, "follow-ups-due", TODAY, null).map((c) => c.customerId)).toEqual(["c1"]); // nextActionAt 06-20 <= today
  expect(applyCaseView(items, "my-work", TODAY, "u1").map((c) => c.customerId)).toEqual(["c1"]);
  expect(applyCaseView(items, "never-contacted", TODAY, null).map((c) => c.customerId).sort()).toEqual(["c1", "c2"]);
});

test("computeCaseMetrics counts cases and sums overdue", () => {
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, [], TODAY, LABELS);
  const m = computeCaseMetrics(items, TODAY);
  expect(m.allOpen.count).toBe(2);
  expect(m.allOpen.amount).toBe(7100);
  expect(m.highValue.count).toBe(1);
  expect(m.followUpsDue.count).toBe(1);
});

test("sortCaseItems recommended orders by priority rank then oldest age", () => {
  const items = buildCaseItems(CASES, INVOICES, CUSTOMERS, [], TODAY, LABELS);
  expect(sortCaseItems(items, "recommended").map((c) => c.customerId)).toEqual(["c1", "c2"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: FAIL — `buildCaseItems is not a function` (not yet exported).

- [ ] **Step 3: Write the implementation**

Append to `nudgepay-app/app/lib/cases.ts`:

```ts
export function buildCaseItems(
  cases: CaseRow[],
  invoices: InvoiceInput[],
  customers: CustomerInput[],
  lastContacts: LastContactInput[],
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

  // Most-recent contact per customer (max-by-date; do not rely on order).
  const lastByCustomer = new Map<string, LastContactInput & { customerId: string }>();
  const invoiceToCustomer = new Map<string, string>();
  for (const [cid, list] of invoicesByCustomer) for (const ci of list) invoiceToCustomer.set(ci.invoiceId, cid);
  for (const lc of lastContacts) {
    const cid = invoiceToCustomer.get(lc.invoiceId);
    if (!cid) continue;
    const prev = lastByCustomer.get(cid);
    if (!prev || lc.date > prev.date) lastByCustomer.set(cid, { ...lc, customerId: cid });
  }

  return cases.map((cse) => {
    const cust = customerById.get(cse.customerId) ?? null;
    const invList = (invoicesByCustomer.get(cse.customerId) ?? [])
      .slice()
      .sort((a, b) => b.ageDays - a.ageDays); // oldest first
    const totalOverdue = invList.reduce((s, i) => s + i.balance, 0);
    const oldestAgeDays = invList.length ? invList[0].ageDays : 0;
    const lc = lastByCustomer.get(cse.customerId) ?? null;
    const neverContacted = !lc;
    const ownerId = cust?.owner ?? null;
    const owner = ownerId ? (ownerLabels.get(ownerId) ?? "Unknown") : "Unassigned";
    const name = cust?.name ?? "(unknown customer)";
    const followUpDue = cse.nextActionAt != null && cse.nextActionAt <= today;

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
      promise: null,        // populated in 6b
      brokenPromise: false, // populated in 6b
      followUpDue,
      searchText: [name, ...invList.map((i) => i.docNumber ?? ""), cust?.phone ?? "", cust?.email ?? "", owner]
        .join(" ").toLowerCase(),
      invoices: invList,
    };
  });
}

export function applyCaseView(
  items: CaseItem[], view: ViewId, today: string, currentUserId: string | null,
): CaseItem[] {
  if (view === "30-plus") return items.filter((i) => i.oldestAgeDays >= 30);
  if (view === "high-value") return items.filter((i) => i.totalOverdue >= HIGH_VALUE_THRESHOLD);
  if (view === "never-contacted") return items.filter((i) => i.lastContact === null);
  if (view === "follow-ups-due") return items.filter((i) => i.nextActionAt != null && i.nextActionAt <= today);
  if (view === "broken-promises") return items.filter((i) => i.brokenPromise);
  if (view === "my-work") return items.filter((i) => i.ownerId != null && i.ownerId === currentUserId);
  return items;
}

export function sortCaseItems(items: CaseItem[], sort: SortId): CaseItem[] {
  const copy = [...items];
  if (sort === "most-overdue") return copy.sort((a, b) => b.oldestAgeDays - a.oldestAgeDays);
  if (sort === "highest-balance") return copy.sort((a, b) => b.totalOverdue - a.totalOverdue);
  if (sort === "customer") return copy.sort((a, b) => a.customerName.localeCompare(b.customerName));
  return copy.sort((a, b) => a.priority.rank - b.priority.rank || b.oldestAgeDays - a.oldestAgeDays || b.totalOverdue - a.totalOverdue);
}

export function computeCaseMetrics(items: CaseItem[], today: string): Metrics {
  const bucket = (pred: (i: CaseItem) => boolean): Metric => {
    const matched = items.filter(pred);
    return { count: matched.length, amount: matched.reduce((s, i) => s + i.totalOverdue, 0) };
  };
  return {
    thirtyPlus: bucket((i) => i.oldestAgeDays >= 30),
    highValue: bucket((i) => i.totalOverdue >= HIGH_VALUE_THRESHOLD),
    neverContacted: bucket((i) => i.lastContact === null),
    allOpen: bucket(() => true),
    followUpsDue: bucket((i) => i.nextActionAt != null && i.nextActionAt <= today),
    brokenPromises: bucket((i) => i.brokenPromise),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/cases.ts nudgepay-app/tests/cases.test.ts
git commit -m "feat: add case item building, views, sort, and metrics (6a)"
```

---

### Task 4: `case-lifecycle.server.ts` applier + wire into sync

**Files:**
- Create: `nudgepay-app/app/lib/case-lifecycle.server.ts`
- Modify: `nudgepay-app/app/lib/qbo-sync.server.ts` (call applier after `upsertInvoices` in `syncOverdueInvoices`, `applyInvoiceWebhook`, `runCdcCatchup`)
- Test: `nudgepay-app/tests/cases-rls.test.ts`

**Interfaces:**
- Consumes: `reconcileCases` from `cases.ts`; a `SupabaseClient`.
- Produces: `applyCaseReconciliation(client, orgId, today): Promise<{ opened: number; resolved: number }>`.

- [ ] **Step 1: Write the failing test**

Append to `nudgepay-app/tests/cases-rls.test.ts`:

```ts
import { applyCaseReconciliation } from "../app/lib/case-lifecycle.server";

test("applyCaseReconciliation opens, then resolves, a case as balances change", async () => {
  const svc = serviceClient();
  const today = "2026-06-22";
  const { data: org } = await svc.from("organizations").insert({ name: "Lifecycle Org" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "lc-c1", name: "Lifecycle Co" }).select("id").single();
  const { data: inv } = await svc.from("invoices").insert({
    org_id: orgId, qbo_id: "lc-i1", qbo_doc_number: "7001", customer_id: cust!.id,
    amount: 900, balance: 900, due_date: "2026-03-01", status: "overdue",
  }).select("id").single();

  const opened = await applyCaseReconciliation(svc, orgId, today);
  expect(opened.opened).toBe(1);
  const { data: openCases } = await svc.from("collection_cases")
    .select("id, status").eq("org_id", orgId).is("closed_at", null);
  expect(openCases!.length).toBe(1);
  expect(openCases![0].status).toBe("new");

  // Re-run with no change → idempotent (no duplicate open case).
  const noop = await applyCaseReconciliation(svc, orgId, today);
  expect(noop.opened).toBe(0);

  // Pay the invoice → case resolves.
  await svc.from("invoices").update({ balance: 0, status: "paid" }).eq("id", inv!.id);
  const resolved = await applyCaseReconciliation(svc, orgId, today);
  expect(resolved.resolved).toBe(1);
  const { data: stillOpen } = await svc.from("collection_cases")
    .select("id").eq("org_id", orgId).is("closed_at", null);
  expect(stillOpen!.length).toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/cases-rls.test.ts`
Expected: FAIL — `Failed to resolve import "../app/lib/case-lifecycle.server"`.

- [ ] **Step 3: Write the applier**

Create `nudgepay-app/app/lib/case-lifecycle.server.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileCases } from "./cases";

// Reconcile collection_cases for one org against the current overdue set.
// Org-scoped on every query. Idempotent: the partial unique index makes a
// concurrent duplicate "open" a no-op (conflict is swallowed).
export async function applyCaseReconciliation(
  client: SupabaseClient, orgId: string, today: string,
): Promise<{ opened: number; resolved: number }> {
  const { data: overdue, error: oErr } = await client
    .from("invoices")
    .select("customer_id")
    .eq("org_id", orgId)
    .gt("balance", 0)
    .lt("due_date", today)
    .not("customer_id", "is", null);
  if (oErr) throw oErr;
  const overdueCustomerIds = new Set(
    (overdue ?? []).map((r) => r.customer_id as string).filter(Boolean),
  );

  const { data: open, error: cErr } = await client
    .from("collection_cases")
    .select("id, customer_id")
    .eq("org_id", orgId)
    .is("closed_at", null);
  if (cErr) throw cErr;
  const openCases = (open ?? []).map((r) => ({ id: r.id as string, customerId: r.customer_id as string }));

  const ops = reconcileCases(overdueCustomerIds, openCases, today);

  let opened = 0;
  let resolved = 0;
  for (const op of ops) {
    if (op.kind === "open") {
      const { error } = await client.from("collection_cases").insert({
        org_id: orgId, customer_id: op.customerId,
        status: "new", next_action_type: "contact", next_action_at: today,
      });
      // 23505 = unique_violation (a concurrent reconcile already opened it): no-op.
      if (error && (error as any).code !== "23505") throw error;
      if (!error) opened += 1;
    } else {
      const { error } = await client.from("collection_cases")
        .update({ status: "resolved", closed_at: new Date().toISOString(), next_action_at: null })
        .eq("id", op.caseId);
      if (error) throw error;
      resolved += 1;
    }
  }
  return { opened, resolved };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/cases-rls.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Wire the applier into the sync paths**

In `nudgepay-app/app/lib/qbo-sync.server.ts`, add the import near the top (after the existing imports):

```ts
import { applyCaseReconciliation } from "./case-lifecycle.server";
```

In `syncOverdueInvoices`, after `await upsertInvoices(deps.service, invoiceRows);` (line ~81) and before the `qbo_connections` update, add:

```ts
  const reconcileToday = new Date().toISOString().slice(0, 10);
  try {
    await applyCaseReconciliation(deps.service, orgId, reconcileToday);
  } catch (e) {
    console.error("[6a] case reconciliation failed (sync); cron will re-converge", e);
  }
```

In `applyInvoiceWebhook`, after `await upsertInvoices(deps.service, [mapQboInvoice(inv, orgId, customerId, new Date())]);` add the same `try/catch` block (with its own `reconcileToday`).

In `runCdcCatchup`, after `await upsertInvoices(deps.service, invoiceRows);` add the same `try/catch` block.

Rationale: reconciliation must never abort the sync write; the cron path is the safety net.

- [ ] **Step 6: Verify the build + full suite**

Run: `cd nudgepay-app && npx tsc -b && npx vitest run tests/cases-rls.test.ts tests/cases.test.ts`
Expected: tsc clean; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/case-lifecycle.server.ts nudgepay-app/app/lib/qbo-sync.server.ts nudgepay-app/tests/cases-rls.test.ts
git commit -m "feat: reconcile collection cases on every invoice sync path (6a)"
```

---

### Task 5: Case-anchored contact logging

**Files:**
- Modify: `nudgepay-app/app/lib/contact-log.ts` (`caseId` required, `invoiceId` optional)
- Modify: `nudgepay-app/app/routes/api.contact-logs.tsx` (resolve case, write `case_id`, update case next-action/status)
- Test: `nudgepay-app/tests/contact-log.test.ts` (parse), `nudgepay-app/tests/api-contact-logs.test.ts` (route)

**Interfaces:**
- Consumes: `parseContactLogForm(form)` now returns `fields` with `caseId: string`, `invoiceId: string | null`.
- Produces: a contact log with `case_id`; the case row updated to `status='working'`, `next_action_type` and `next_action_at` set from `followUpAt` when present.

- [ ] **Step 1: Write the failing parse test**

Add to `nudgepay-app/tests/contact-log.test.ts` (create the file if absent; mirror the existing parse-test style):

```ts
import { expect, test } from "vitest";
import { parseContactLogForm } from "../app/lib/contact-log";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

test("parseContactLogForm requires caseId", () => {
  const r = parseContactLogForm(fd({ method: "call", outcome: "no-answer" }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toBe("missing-case");
});

test("parseContactLogForm accepts a case-level log with no invoice", () => {
  const r = parseContactLogForm(fd({ caseId: "case-1", method: "note", outcome: "other" }));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.fields.caseId).toBe("case-1");
    expect(r.fields.invoiceId).toBeNull();
  }
});

test("parseContactLogForm keeps an optional invoiceId when present", () => {
  const r = parseContactLogForm(fd({ caseId: "case-1", invoiceId: "i1", method: "call", outcome: "no-answer" }));
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.fields.invoiceId).toBe("i1");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/contact-log.test.ts`
Expected: FAIL — current parser requires `invoiceId` and has no `caseId`/`missing-case`.

- [ ] **Step 3: Update `contact-log.ts`**

In `nudgepay-app/app/lib/contact-log.ts`, change the `ContactLogFields` type and the head of `parseContactLogForm`:

Replace the `invoiceId` field in `ContactLogFields`:

```ts
export type ContactLogFields = {
  caseId: string;
  invoiceId: string | null;
  customerId: string | null;
  method: ContactMethod;
  outcome: ContactOutcome;
  notes: string | null;
  followUpAt: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
};
```

Replace the opening of `parseContactLogForm` (the `invoiceId` guard) with:

```ts
export function parseContactLogForm(form: FormData): ParseResult {
  const caseId = str(form, "caseId");
  if (!caseId) return { ok: false, error: "missing-case" };

  const invoiceId = str(form, "invoiceId"); // optional now
  const customerId = str(form, "customerId");
```

And in the returned `fields` object, replace `invoiceId,` with `caseId, invoiceId,`.

- [ ] **Step 4: Write the failing route test**

Add to `nudgepay-app/tests/api-contact-logs.test.ts` (DB-backed; mirror existing helper usage). This validates the data layer the route relies on — inserting a case-anchored log and updating the case:

```ts
test("a case-anchored contact log updates the case to working with the follow-up date", async () => {
  const svc = serviceClient();
  const user = await makeUserClient("contact-case@example.com");
  const { data: org } = await svc.from("organizations").insert({ name: "Contact Case Org" }).select("id").single();
  const orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "cc-c1", name: "Case Co" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "new", next_action_type: "contact" })
    .select("id").single();

  // Insert via the USER client (RLS path the route uses) + update the case.
  const { error: insErr } = await user.client.from("contact_logs").insert({
    org_id: orgId, case_id: cse!.id, customer_id: cust!.id, user_id: user.userId,
    method: "call", outcome: "no-answer", follow_up_at: "2026-07-01",
  });
  expect(insErr).toBeNull();

  const { error: updErr } = await user.client.from("collection_cases")
    .update({ status: "working", next_action_type: "follow_up", next_action_at: "2026-07-01" })
    .eq("id", cse!.id);
  expect(updErr).toBeNull();

  const { data: row } = await user.client.from("collection_cases").select("status, next_action_at").eq("id", cse!.id).single();
  expect(row!.status).toBe("working");
  expect(row!.next_action_at).toBe("2026-07-01");
});
```

- [ ] **Step 5: Run to verify it fails, then update the route**

Run: `cd nudgepay-app && npx vitest run tests/api-contact-logs.test.ts`
Expected: the new test may already pass at the data layer (it exercises RLS directly), but the route must be updated to match. Update `nudgepay-app/app/routes/api.contact-logs.tsx`:

Replace the cross-org guard + insert block (current lines ~25–46) with:

```ts
  // Cross-org guard: the case must belong to the caller's org. RLS lets the user
  // client read only own-org cases, so a foreign caseId returns no row.
  const { data: cse } = await supabase
    .from("collection_cases").select("id").eq("id", f.caseId).maybeSingle();
  if (!cse) return redirect(withError(returnTo, "missing-case"), { headers });

  // If an invoice was sub-selected, validate it too (own-org only).
  if (f.invoiceId) {
    const { data: inv } = await supabase
      .from("invoices").select("id").eq("id", f.invoiceId).maybeSingle();
    if (!inv) return redirect(withError(returnTo, "missing-invoice"), { headers });
  }

  const { error } = await supabase.from("contact_logs").insert({
    org_id: org.org_id,
    case_id: f.caseId,
    invoice_id: f.invoiceId,
    customer_id: f.customerId,
    user_id: user.id,
    method: f.method,
    outcome: f.outcome,
    notes: f.notes,
    follow_up_at: f.followUpAt,
    promised_amount: f.promisedAmount,
    promised_date: f.promisedDate,
  });
  if (error) return redirect(withError(returnTo, "save-failed"), { headers });

  // Keep next-action durable: a logged contact moves the case to "working" and,
  // when a follow-up date was given, sets it as the next action.
  if (f.followUpAt) {
    await supabase.from("collection_cases")
      .update({ status: "working", next_action_type: "follow_up", next_action_at: f.followUpAt })
      .eq("id", f.caseId);
  } else {
    await supabase.from("collection_cases")
      .update({ status: "working" })
      .eq("id", f.caseId);
  }

  return redirect(returnTo, { headers });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/contact-log.test.ts tests/api-contact-logs.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/contact-log.ts nudgepay-app/app/routes/api.contact-logs.tsx nudgepay-app/tests/contact-log.test.ts nudgepay-app/tests/api-contact-logs.test.ts
git commit -m "feat: case-anchor contact logging and update case next-action (6a)"
```

---

### Task 6: Dashboard loader → case-centric

**Files:**
- Modify: `nudgepay-app/app/routes/dashboard.tsx`
- Test: `nudgepay-app/tests/dashboard-worklist.test.ts`

**Interfaces:**
- Consumes: `buildCaseItems`, `applyCaseView`, `sortCaseItems`, `computeCaseMetrics`, `CaseItem`, `CaseRow` from `cases.ts`.
- Produces: `buildCaseData(...)` (renamed from `buildDashboardData`), returning `{ items: CaseItem[]; metrics; viewCounts; selected: CaseItem | null }`. Loader returns `case` (selected case id) instead of `invoice` (plus optional `invoice` sub-selection).

- [ ] **Step 1: Update the composition test**

Replace the `buildDashboardData` import and the `my-work`/composition tests in `nudgepay-app/tests/dashboard-worklist.test.ts` with `buildCaseData`. Add:

```ts
import { buildCaseData } from "../app/routes/dashboard";
import type { CaseRow } from "../app/lib/cases";

test("buildCaseData composes case items, metrics, viewCounts, and selection", () => {
  const cases: CaseRow[] = [
    { id: "case-1", customerId: "c1", status: "working", nextActionType: "follow_up", nextActionAt: "2026-06-20" },
  ];
  const invoices = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 6000, due_date: "2026-03-01" },
    { id: "i2", qbo_doc_number: "1002", customer_id: "c1", balance: 300, due_date: "2026-06-18" },
  ];
  const customers = [{ id: "c1", name: "Acme", phone: null, email: null, owner: "u1" }];
  const data = buildCaseData(cases, invoices, customers, [],
    { view: "all-open", sort: "recommended", q: "", caseId: "case-1" }, "2026-06-22",
    new Map([["u1", "diskin"]]), "u1");

  expect(data.metrics.allOpen.count).toBe(1);
  expect(data.viewCounts["my-work"]).toBe(1);
  expect(data.items.map((i) => i.caseId)).toEqual(["case-1"]);
  expect(data.selected?.caseId).toBe("case-1");
  expect(data.selected?.totalOverdue).toBe(6300);
});
```

Remove or update the prior `buildDashboardData` tests in this file that reference `invoice`/`invoiceId` selection so they call `buildCaseData` with `caseId`. (The DB-backed RLS read tests at the bottom that query Supabase directly stay as-is.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/dashboard-worklist.test.ts`
Expected: FAIL — `buildCaseData` not exported.

- [ ] **Step 3: Replace `buildDashboardData` with `buildCaseData`**

In `nudgepay-app/app/routes/dashboard.tsx`:

Replace the `worklist` import block with both modules:

```ts
import {
  type InvoiceInput, type CustomerInput, type LastContactInput,
  type Metrics, type ViewId, type SortId,
} from "../lib/worklist";
import {
  buildCaseItems, applyCaseView, sortCaseItems, computeCaseMetrics,
  type CaseItem, type CaseRow,
} from "../lib/cases";
```

Replace `DashboardParams`, `DashboardData`, and `buildDashboardData` with:

```ts
type DashboardParams = {
  view: ViewId;
  sort: SortId;
  q: string;
  caseId: string | null;
  invoice?: string | null;
  tab?: "overview" | "activity" | "messages";
};

type DashboardData = {
  items: CaseItem[];
  metrics: Metrics;
  viewCounts: Record<ViewId, number>;
  selected: CaseItem | null;
};

const ALL_VIEWS: ViewId[] = ["all-open", "30-plus", "high-value", "never-contacted", "follow-ups-due", "broken-promises", "my-work"];

export function buildCaseData(
  cases: CaseRow[],
  invoices: InvoiceInput[],
  customers: CustomerInput[],
  lastContacts: LastContactInput[],
  params: DashboardParams,
  today: string,
  ownerLabels: Map<string, string>,
  currentUserId: string | null,
): DashboardData {
  const { view, sort, q, caseId } = params;
  const allItems = buildCaseItems(cases, invoices, customers, lastContacts, today, ownerLabels);
  const searched = q.trim() === "" ? allItems : allItems.filter((i) => i.searchText.includes(q.toLowerCase()));
  const metrics = computeCaseMetrics(searched, today);
  const viewCounts = Object.fromEntries(
    ALL_VIEWS.map((v) => [v, applyCaseView(searched, v, today, currentUserId).length]),
  ) as Record<ViewId, number>;
  const items = sortCaseItems(applyCaseView(searched, view, today, currentUserId), sort);
  const selected = caseId != null ? (searched.find((i) => i.caseId === caseId) ?? null) : null;
  return { items, metrics, viewCounts, selected };
}
```

- [ ] **Step 4: Update the loader**

In `loader`, make these changes:

1. URL params — replace `const invoice = sp.get("invoice") ?? null;` with:

```ts
  const caseId = sp.get("case") ?? null;
  const invoice = sp.get("invoice") ?? null; // optional sub-selection for invoice-specific actions
```

2. After building `invoicesInput`/`customersInput`/`lastContactsInput` (the existing RLS reads stay — they feed the case items), **load open cases** (USER client) before calling the builder:

```ts
    const { data: caseRows } = await supabase
      .from("collection_cases")
      .select("id, customer_id, status, next_action_type, next_action_at")
      .eq("org_id", org.org_id)
      .is("closed_at", null);
    const cases: CaseRow[] = ((caseRows as any[]) ?? []).map((r) => ({
      id: r.id, customerId: r.customer_id, status: r.status,
      nextActionType: r.next_action_type, nextActionAt: r.next_action_at,
    }));
```

3. Replace the `buildDashboardData(...)` call with:

```ts
    dashboardData = buildCaseData(
      cases, invoicesInput, customersInput, lastContactsInput,
      { view, sort, q, caseId, invoice, tab }, today, ownerLabels, user.id,
    );
```

4. Replace the selected-detail block guarded by `if (invoice)` with one guarded by `if (dashboardData.selected)`, keyed on the **customer** for the thread/consent and the **case** for activity. Use the selected case's customer + its oldest invoice as the representative invoice:

```ts
    const sel = dashboardData.selected;
    if (sel) {
      const customerId = sel.customerId;
      const repInvoiceId = invoice ?? (sel.invoices[0]?.invoiceId ?? null);

      // Activity: contact logs for the case.
      const { data: actRows } = await supabase
        .from("contact_logs")
        .select("id, method, outcome, notes, created_at, follow_up_at, promised_amount, promised_date")
        .eq("org_id", org.org_id)
        .eq("case_id", sel.caseId)
        .order("created_at", { ascending: false });
      selectedActivity = ((actRows as unknown as ContactLogRow[]) ?? []).map((r) => ({
        id: r.id, method: r.method, outcome: r.outcome, notes: r.notes,
        createdAt: r.created_at, followUpAt: r.follow_up_at,
        promisedAmount: r.promised_amount == null ? null : Number(r.promised_amount),
        promisedDate: r.promised_date,
      }));

      // Messages: thread by CUSTOMER (one conversation per customer).
      const { data: msgRows } = await supabase
        .from("text_messages")
        .select("id, direction, body, status, error_code, created_at")
        .eq("org_id", org.org_id)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: true });
      selectedMessages = ((msgRows as unknown as SelectedMessageRow[]) ?? []).map((r) => ({
        id: r.id, direction: r.direction, body: r.body, status: r.status,
        errorCode: r.error_code, createdAt: r.created_at,
      }));

      // Consent + phone from the customer.
      const { data: custRow } = await supabase
        .from("customers").select("phone, sms_consent").eq("id", customerId).maybeSingle();
      selectedConsent = (custRow as any)?.sms_consent ?? false;
      selectedPhone = (custRow as any)?.phone ?? null;
      selectedRepInvoiceId = repInvoiceId;
    }
```

Add `let selectedRepInvoiceId: string | null = null;` next to the other `selected*` declarations, and the `ContactLogRow` type's `invoice_id`/`customer_id` fields remain (the activity select no longer needs them but the type is shared — leave as-is or trim; trimming the select is fine since we don't read them here).

5. In the returned `data({...})`, replace `invoice,` with `case: caseId, invoice, repInvoiceId: selectedRepInvoiceId,` and keep the rest.

- [ ] **Step 5: Update the page component props**

In the `Dashboard()` component:
- Destructure `selected` (now a `CaseItem`), `repInvoiceId`, and keep `tab`, `view`, `sort`, `q`, `roster`, etc.
- `WorkQueue` prop `selectedInvoiceId={selected?.invoiceId ?? null}` → `selectedCaseId={selected?.caseId ?? null}`.
- `DetailPanel` gets `selected` (CaseItem), `repInvoiceId`, and the same activity/messages/consent/roster props.
- The `LogContactDrawer` `returnTo` and the `log && selected` guard now use `case`: build `returnTo` as `/dashboard?${new URLSearchParams({ case: selected.caseId, tab, view, sort, ...(q ? { q } : {}) }).toString()}`.

(Exact `WorkQueue`/`DetailPanel`/`LogContactDrawer` prop wiring is finalized in Tasks 7–8; this step makes the loader compile against their new signatures.)

- [ ] **Step 6: Run the test + typecheck**

Run: `cd nudgepay-app && npx vitest run tests/dashboard-worklist.test.ts && npx tsc -b`
Expected: composition test PASS. `tsc` will still report errors in `WorkQueue`/`DetailPanel`/`LogContactDrawer` until Tasks 7–8 — that is expected; the dashboard module itself should be type-correct against the new component prop names you introduce in Steps 5 and Tasks 7–8. If you prefer a green build at each task boundary, do Tasks 7–8 before re-running `tsc -b`.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/routes/dashboard.tsx nudgepay-app/tests/dashboard-worklist.test.ts
git commit -m "feat: case-centric dashboard loader and selection (6a)"
```

---

### Task 7: `WorkQueue` — case rows

**Files:**
- Modify: `nudgepay-app/app/components/WorkQueue.tsx`
- Test: build + typecheck (component is presentation; logic covered by `cases.ts` tests)

**Interfaces:**
- Consumes: `CaseItem`, `ViewId`, `SortId` from `cases.ts`/`worklist.ts`.
- Produces: `WorkQueueProps { items: CaseItem[]; view; sort; search; selectedCaseId: string | null; totalCount; viewCounts }`.

- [ ] **Step 1: Update imports + props**

In `nudgepay-app/app/components/WorkQueue.tsx`:

Replace the type import line:

```ts
import type { ViewId, SortId } from "../lib/worklist";
import type { CaseItem } from "../lib/cases";
```

Remove the `NextAction`-based `nextActionToneClass` map (cases carry a `status` + `nextActionAt`, not a `NextAction` object). Add a status label map:

```ts
const STATUS_LABEL: Record<string, string> = {
  new: "New", working: "Working", promised: "Promised",
  waiting: "Waiting", on_hold: "On hold", resolved: "Resolved",
};
```

Replace `WorkQueueProps`:

```ts
interface WorkQueueProps {
  items: CaseItem[];
  view: ViewId;
  sort: SortId;
  search: string;
  selectedCaseId: string | null;
  totalCount: number;
  viewCounts: Record<ViewId, number>;
}
```

- [ ] **Step 2: Update `QueueRow` and `MobileCard`**

Change the `item` param type to `CaseItem` in both. Replace the row `href` param `invoice: item.invoiceId` with `case: item.caseId`. Replace the per-invoice columns:
- Customer cell: `item.customerName`; sub-line shows `${item.invoiceCount} invoice(s)` instead of a single `docNumber`.
- Balance cell: `usd.format(item.totalOverdue)`.
- Age cell: `item.oldestAgeDays > 0 ? \`${item.oldestAgeDays}d\` : "Due"`.
- Replace the "Next action" cell content with the **status** + next action date:

```tsx
      <span data-label="Next action" className="hidden lg:block text-xs font-sans font-medium whitespace-nowrap text-text">
        {STATUS_LABEL[item.status] ?? item.status}
        {item.nextActionAt ? <span className="text-muted"> · {fmtDate(item.nextActionAt)}</span> : null}
      </span>
```

Keep the Owner chip (`item.owner`), Heat (`item.heat`), and Last contact cells unchanged (those fields exist on `CaseItem`). Update `aria-label` to `Open ${item.customerName}` (drop the invoice reference).

- [ ] **Step 3: Update the `WorkQueue` body**

- Destructure `selectedCaseId` instead of `selectedInvoiceId`.
- Column header "Customer / invoice" → "Customer"; "Balance" → "Total overdue"; "Age" → "Oldest age"; "Next action" → "Status".
- Row keys + `selected` check: `key={item.caseId}`, `selected={selectedCaseId === item.caseId}`.

- [ ] **Step 4: Verify build**

Run: `cd nudgepay-app && npx react-router build`
Expected: build succeeds (no Tailwind dynamic-class errors; `WorkQueue` type-checks against `CaseItem`). If `DetailPanel` still references old types, finish Task 8 then build.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/components/WorkQueue.tsx
git commit -m "feat: case-row work queue (6a)"
```

---

### Task 8: `DetailPanel` workspace + `MetricsStrip` labels

**Files:**
- Modify: `nudgepay-app/app/components/DetailPanel.tsx`
- Modify: `nudgepay-app/app/components/MetricsStrip.tsx`
- Test: build + typecheck + live Chrome

**Interfaces:**
- Consumes: `CaseItem` from `cases.ts`; `ActivityEntry`, `MessageEntry`, `RosterMember` from `~/routes/dashboard`; `repInvoiceId: string | null`.
- Produces: a customer/case workspace. SMS send + consent forms post a hidden `invoiceId = repInvoiceId`; contact-log + assign forms post `caseId`/`customerId`.

- [ ] **Step 1: Update imports + the `selected` type**

In `nudgepay-app/app/components/DetailPanel.tsx`:

```ts
import { type CaseItem } from "~/lib/cases";
```
Remove the `WorkItem` import. Change the main export's `selected: WorkItem | null` → `selected: CaseItem | null`, and `MessagesTab`'s `selected: WorkItem` → `selected: CaseItem`. Add a `repInvoiceId: string | null` prop to both `DetailPanel` and `MessagesTab`.

- [ ] **Step 2: Header → customer-centric**

Replace the invoice-centric header (doc label · due · age + dual balance) with customer-centric content:
- Kicker "Selected account" (unchanged).
- `selected.customerName` (unchanged).
- Sub-line: `${selected.invoiceCount} open invoice(s) · oldest ${selected.oldestAgeDays}d overdue`.
- Single balance card "Total overdue" = `formatUSD(selected.totalOverdue)` (drop the invoice-balance card; keep one card or a 2-up of Total overdue + Status).
- Status chip: `STATUS_LABEL[selected.status]` with next-action date when present. Add the same `STATUS_LABEL` map used in `WorkQueue` (local copy — static literal strings).

The action row `tel:`/`mailto:` use `selected.phone`/`selected.email` (unchanged). The "Text" Link and tab links change `invoice: selected.invoiceId` → `case: selected.caseId`. The "Log" link `logHref` changes to `case: selected.caseId`.

- [ ] **Step 3: Overview tab → invoices inside the case**

Replace the `InfoRow`-based priority/next-action grid with:
- "Status" (value `STATUS_LABEL[selected.status]`, tone from `selected.heat.band`).
- "Next action" — `selected.nextActionType ?? "—"` + date.
- Owner assign form: keep, but `customerId` = `selected.customerId`, and `returnTo` uses `case: selected.caseId`.
- Phone / Email InfoRows (unchanged).
- **A list of the case's invoices** below the grid:

```tsx
<div className="mt-4">
  <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Invoices</span>
  <ul className="mt-2 flex flex-col gap-1">
    {selected.invoices.map((inv) => (
      <li key={inv.invoiceId} className="flex items-center justify-between gap-2 rounded-md bg-panel px-3 py-2">
        <span className="font-mono text-xs text-text">{inv.docNumber ?? inv.invoiceId}</span>
        <span className="font-mono text-xs text-muted tabular-nums">
          {formatUSD(inv.balance)} · {inv.ageDays > 0 ? `${inv.ageDays}d` : "Due"}
        </span>
      </li>
    ))}
  </ul>
</div>
```

- [ ] **Step 4: Messages + consent → customer thread, representative invoice for actions**

In `MessagesTab`:
- `returnTo` uses `case: selected.caseId` (+ `tab: "messages"`).
- `vars` (template) uses the representative invoice label: `invoice: selected.invoices.find(i => i.invoiceId === repInvoiceId)?.docNumber ?? selected.customerName`, `balance: formatUSD(selected.totalOverdue)`, `dueDate` from the rep invoice (or "—").
- Consent form hidden `invoiceId` = `repInvoiceId ?? ""`; send form hidden `invoiceId` = `repInvoiceId ?? ""`. (Keeps the Phase-4 invoice-keyed send/consent routes unchanged; the message still threads to the customer via `customer_id` set by the send path.)
- If `repInvoiceId` is null (a case with no invoices — shouldn't happen for an open case, but guard), disable Send with a note "No invoice to reference."

- [ ] **Step 5: Activity tab**

No structural change — it already renders `ActivityEntry[]`. It now receives case-level logs from the loader. Leave as-is.

- [ ] **Step 6: `MetricsStrip` labels**

In `nudgepay-app/app/components/MetricsStrip.tsx`, update any tile sublabels that say "invoices" to "accounts" / "cases" to match case-counts (the `Metrics` shape is unchanged, so only copy changes). Confirm no logic change.

- [ ] **Step 7: Verify build + full suite**

Run: `cd nudgepay-app && npx tsc -b && npx react-router build && npx vitest run`
Expected: tsc clean; build succeeds; **all tests green** (135 prior + the new case tests; any prior tests referencing `invoice`/`WorkItem` selection were migrated in Task 6).

- [ ] **Step 8: Commit**

```bash
git add nudgepay-app/app/components/DetailPanel.tsx nudgepay-app/app/components/MetricsStrip.tsx
git commit -m "feat: customer/case workspace detail panel (6a)"
```

---

### Task 9: Live verification + ledger

**Files:** none (verification only)

- [ ] **Step 1: Seed + run dev**

Run the local demo seed (untracked `scripts/demo-seed.mjs`) and `npm run dev`. Log in as the demo owner.

- [ ] **Step 2: Live Chrome pass**

Verify: (1) the queue shows **one row per customer/case** with Status, Total overdue, Oldest age, Owner, # invoices; (2) opening a row shows the **customer workspace** with invoices listed inside Overview; (3) the Messages tab shows the **per-customer** thread; (4) logging a contact with a follow-up date moves the case to **Working** and sets the next-action date (re-query reflects it); (5) the saved views (30+, high-value, follow-ups-due, my-work) filter by case and the badges match; (6) assigning an owner persists and "My work" filters correctly.

- [ ] **Step 3: Confirm auto-resolve**

Via a service-client query (or the demo seed helper), set a customer's invoices to `balance=0`, trigger a sync/reconcile (or call `applyCaseReconciliation`), and confirm the case disappears from the queue (auto-resolved).

- [ ] **Step 4: Update the ledger**

Append the 6a completion line to `.superpowers/sdd/progress.md` and check the relevant boxes in `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` (A1-impl, the 6a portions).

---

## Self-review notes

- **Spec coverage:** §5.1 → Task 1; §5.2 → Tasks 2–3; §5.3–5.4 → Task 4; §5.5 → Task 5; §5.6 → Task 6; §5.7 → Tasks 7–8; §7 edges covered by `reconcileCases`/applier tests (Task 4) + orphan test (Task 3) + idempotency (Task 4); §8 testing distributed across tasks.
- **Representative-invoice bridge:** SMS send + consent keep the Phase-4 invoice-keyed routes by defaulting to the case's oldest open invoice (`repInvoiceId`), avoiding send-path rewrites in 6a (consistent with spec §5.7's optional `&invoice` sub-selection). Full customer-level send/consent re-keying is deferred (not required for the loop; consent data is already per-customer).
- **Type consistency:** `CaseItem`/`CaseRow`/`buildCaseData` names are used identically across Tasks 2/3/6/7/8. Selection param is `case` everywhere; `repInvoiceId` flows loader → DetailPanel.
- **Known transient state:** after Task 6, `tsc -b` reports errors in `WorkQueue`/`DetailPanel` until Tasks 7–8 land (called out in Task 6 Step 6). The branch is green again at the end of Task 8.
