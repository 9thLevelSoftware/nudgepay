# NudgePay Phase 5b — Contact Logging + Promise Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the collections workspace write-capable — log a contact + record a promise to pay from the detail panel, show the real activity timeline, and surface Follow-ups-due / Broken-promises as metric tiles and saved views.

**Architecture:** A lean ALTER on the existing `contact_logs` table adds two promise columns; a new RLS-scoped resource-route action inserts logs; pure `worklist.ts` functions gain promise/follow-up signals and two derived views; the dashboard loader reads contact logs and threads the signals through; a URL-param-driven slide-over captures the log. Server computes everything; the browser only renders and submits forms.

**Tech Stack:** React Router v7 (framework mode) on Cloudflare Workers, Supabase Postgres + RLS, `@supabase/ssr` user client, Tailwind v4 (CSS-first), Vitest against local Supabase.

## Global Constraints

- No `node:*` imports in `app/**`; Web standards only (Workers runtime). `node:*` is allowed in `tests/**` and `vitest.config.ts`.
- Security boundary: browser → server routes only; **RLS user client (`requireUser`) for all reads AND the contact-log insert**; service client is NOT used for contact logs; never expose secrets/tokens in any loader/action payload.
- Multi-tenant: every read and the insert is org-scoped via the session; cross-org `invoice_id` references are blocked by an explicit readability check before insert.
- Pure logic modules (`app/lib/worklist.ts`, the new validator) must have NO I/O and NO `.server` suffix (RR7 bundler rejects client references to `.server` files).
- Tailwind v4 CSS-first: static literal class strings only — never `bg-${x}` / `text-${tone}`; use the existing static record-map pattern. Copper focus rings; reduced-motion honored.
- Field set is promise-only: migration adds exactly `promised_amount numeric(12,2)` and `promised_date date`. No `contact_person` column. "Who I spoke with" lives in `notes`.
- Promise fields are required+validated ONLY when `outcome === "promise-to-pay"`; ignored (stored null) otherwise.
- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`); `.env.test` / `.dev.vars` gitignored, never committed.
- Tests run with `npx vitest run` (there is no `npm test` script) from `nudgepay-app/`. There is no React render-test infra; components are verified by `npx tsc -b` + `npx react-router build`.

## File Structure

- **Create** `nudgepay-app/supabase/migrations/0007_contact_log_promises.sql` — ALTER `contact_logs`, add promise columns + `(org_id, invoice_id)` index.
- **Create** `nudgepay-app/app/lib/contact-log.ts` — pure `parseContactLogForm(form)` validator + shared `ContactLogFields` / enum constants. No I/O, no `.server` suffix.
- **Create** `nudgepay-app/app/routes/api.contact-logs.tsx` — `action`-only resource route; inserts via RLS user client.
- **Create** `nudgepay-app/app/components/LogContactDrawer.tsx` — URL-param-driven slide-over with the log form.
- **Modify** `nudgepay-app/app/lib/worklist.ts` — promise/follow-up types, signals, predicates, view + metric additions, hardened last-contact selection.
- **Modify** `nudgepay-app/app/routes/dashboard.tsx` — `buildDashboardData` signature + loader reads contact logs, derives signals + selected activity, parses `log`/`logError`, renders the drawer.
- **Modify** `nudgepay-app/app/components/DetailPanel.tsx` — wire Log button to the drawer; populate the Activity tab timeline.
- **Modify** `nudgepay-app/app/components/MetricsStrip.tsx` — 6 tiles.
- **Modify** `nudgepay-app/app/components/WorkQueue.tsx` — 6 saved-view tabs.
- **Modify** `nudgepay-app/tests/worklist.test.ts` — new pure tests.
- **Modify** `nudgepay-app/tests/dashboard-worklist.test.ts` — extend composition for signals.
- **Create** `nudgepay-app/tests/api-contact-logs.test.ts` — validator unit tests + DB-backed RLS insert.

---

### Task 1: Migration — promise columns on `contact_logs`

**Files:**
- Create: `nudgepay-app/supabase/migrations/0007_contact_log_promises.sql`
- Test: `nudgepay-app/tests/api-contact-logs.test.ts` (create with the column-existence test only; later tasks add to it)

**Interfaces:**
- Consumes: existing `contact_logs` table (`id, org_id, invoice_id, customer_id, user_id, method, outcome, notes, follow_up_at, created_at`) with `contact_logs_all` RLS policy and grants to `authenticated`/`service_role` (migrations 0001/0002).
- Produces: `contact_logs.promised_amount numeric(12,2)` (nullable), `contact_logs.promised_date date` (nullable), index on `contact_logs (org_id, invoice_id)`.

- [ ] **Step 1: Write the migration**

Create `nudgepay-app/supabase/migrations/0007_contact_log_promises.sql`:

```sql
-- Phase 5b: promise-to-pay tracking on contact logs.
-- contact_logs already exists (0001) with RLS (contact_logs_all) and grants;
-- this only adds two nullable columns and a lookup index. No RLS/grant change.
alter table contact_logs
  add column promised_amount numeric(12,2),
  add column promised_date   date;

-- The dashboard loader reads contact logs filtered by (org_id, invoice_id in (...)).
create index contact_logs_org_invoice_idx on contact_logs (org_id, invoice_id);
```

- [ ] **Step 2: Apply the migration to local Supabase**

Run from `nudgepay-app/`: `npx supabase migration up`
Expected: applies `0007_contact_log_promises.sql` with no error. (If the local stack reports it is not running, start it with `npx supabase start`; if migrations are out of sync, `npx supabase db reset` re-applies all — test data is created fresh per run so a reset is safe locally.)

- [ ] **Step 3: Write the failing column-existence test**

Create `nudgepay-app/tests/api-contact-logs.test.ts`:

```ts
import { expect, test, beforeAll } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

// ── Task 1: migration columns exist and accept promise data ──────────────────
test("contact_logs accepts promised_amount and promised_date", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Promise Cols Org" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "pc-c1", name: "Promise Co" }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "pc-i1", customer_id: cust!.id, amount: 1000, balance: 1000, due_date: "2026-03-01", status: "overdue" })
    .select("id").single();
  const user = await makeUserClient("promise-cols@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });

  const { data: row, error } = await svc.from("contact_logs").insert({
    org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, user_id: user.userId,
    method: "call", outcome: "promise-to-pay", notes: "spoke with AP",
    promised_amount: 500.5, promised_date: "2026-07-01",
  }).select("promised_amount, promised_date").single();

  expect(error).toBeNull();
  expect(Number(row!.promised_amount)).toBe(500.5);
  expect(row!.promised_date).toBe("2026-07-01");
});
```

- [ ] **Step 4: Run the test to verify it passes** (the columns now exist)

Run from `nudgepay-app/`: `npx vitest run tests/api-contact-logs.test.ts`
Expected: PASS (1 test). If it fails with "column promised_amount does not exist," the migration did not apply — re-run Step 2.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/supabase/migrations/0007_contact_log_promises.sql nudgepay-app/tests/api-contact-logs.test.ts
git commit -m "feat: add promise columns to contact_logs (migration 0007)"
```

---

### Task 2: Pure worklist logic — promise/follow-up signals, predicates, views, metrics

**Files:**
- Modify: `nudgepay-app/app/lib/worklist.ts`
- Modify: `nudgepay-app/app/routes/dashboard.tsx` (thread the new signature through `buildDashboardData` so the build stays green; loader passes `[]` for signals until Task 5)
- Test: `nudgepay-app/tests/worklist.test.ts`, `nudgepay-app/tests/dashboard-worklist.test.ts`

**Interfaces:**
- Consumes: existing exports in `worklist.ts` (`WorkItem`, `Metric`, `Metrics`, `ViewId`, `SortId`, `LastContactInput`, `buildWorkItems`, `applyView`, `computeMetrics`, `ageInDays`, `heatOf`, `priorityOf`, `nextActionOf`); existing `buildDashboardData(invoices, customers, lastContacts, params, today)` in `dashboard.tsx`.
- Produces (exact final signatures):
  - `type PromiseSignalInput = { invoiceId: string; promisedAmount: number | null; promisedDate: string | null; followUpAt: string | null }`
  - `WorkItem` gains `promise: { amount: number; date: string } | null` and `followUpAt: string | null`
  - `type ViewId = "all-open" | "30-plus" | "high-value" | "never-contacted" | "follow-ups-due" | "broken-promises"`
  - `type Metrics = { thirtyPlus: Metric; highValue: Metric; neverContacted: Metric; allOpen: Metric; followUpsDue: Metric; brokenPromises: Metric }`
  - `buildWorkItems(invoices, customers, lastContacts, promiseSignals, today): WorkItem[]`
  - `isBrokenPromise(item: WorkItem, today: string): boolean`
  - `isFollowUpDue(item: WorkItem, today: string): boolean`
  - `applyView(items: WorkItem[], view: ViewId, today: string): WorkItem[]`
  - `computeMetrics(items: WorkItem[], today: string): Metrics`
  - `buildDashboardData(invoices, customers, lastContacts, promiseSignals, params, today): DashboardData`

- [ ] **Step 1: Write the failing pure tests**

Add to `nudgepay-app/tests/worklist.test.ts` (append; keep existing imports — add the new names to the existing import from `../app/lib/worklist`):

```ts
import {
  buildWorkItems, applyView, computeMetrics, isBrokenPromise, isFollowUpDue,
  type PromiseSignalInput,
} from "../app/lib/worklist";

const T = "2026-06-22";
const inv = (id: string, due: string, bal = 1000) =>
  ({ id, qbo_doc_number: id, customer_id: "c1", balance: bal, due_date: due });
const cust = [{ id: "c1", name: "Acme", phone: null, email: null }];

test("buildWorkItems picks the most-recent contact regardless of input order", () => {
  const items = buildWorkItems(
    [inv("i1", "2026-03-01")], cust,
    [
      { invoiceId: "i1", date: "2026-06-10T00:00:00Z", channel: "Text" },
      { invoiceId: "i1", date: "2026-06-20T00:00:00Z", channel: "Call" },
    ],
    [], T,
  );
  expect(items[0].lastContact).toEqual({ date: "2026-06-20T00:00:00Z", channel: "Call" });
});

test("buildWorkItems maps promise + followUpAt from signals", () => {
  const signals: PromiseSignalInput[] = [
    { invoiceId: "i1", promisedAmount: 250, promisedDate: "2026-06-30", followUpAt: "2026-06-25" },
  ];
  const items = buildWorkItems([inv("i1", "2026-03-01")], cust, [], signals, T);
  expect(items[0].promise).toEqual({ amount: 250, date: "2026-06-30" });
  expect(items[0].followUpAt).toBe("2026-06-25");
});

test("buildWorkItems leaves promise null when amount or date missing", () => {
  const signals: PromiseSignalInput[] = [
    { invoiceId: "i1", promisedAmount: 250, promisedDate: null, followUpAt: null },
  ];
  const items = buildWorkItems([inv("i1", "2026-03-01")], cust, [], signals, T);
  expect(items[0].promise).toBeNull();
});

test("isBrokenPromise: past promise broken, today/future not", () => {
  const mk = (date: string | null) =>
    buildWorkItems([inv("i1", "2026-03-01")], cust, [],
      date ? [{ invoiceId: "i1", promisedAmount: 100, promisedDate: date, followUpAt: null }] : [], T)[0];
  expect(isBrokenPromise(mk("2026-06-21"), T)).toBe(true);  // < today
  expect(isBrokenPromise(mk("2026-06-22"), T)).toBe(false); // == today
  expect(isBrokenPromise(mk("2026-06-23"), T)).toBe(false); // > today
  expect(isBrokenPromise(mk(null), T)).toBe(false);         // no promise
});

test("isFollowUpDue: on/before today due, after not", () => {
  const mk = (fu: string | null) =>
    buildWorkItems([inv("i1", "2026-03-01")], cust, [],
      [{ invoiceId: "i1", promisedAmount: null, promisedDate: null, followUpAt: fu }], T)[0];
  expect(isFollowUpDue(mk("2026-06-21"), T)).toBe(true);  // < today
  expect(isFollowUpDue(mk("2026-06-22"), T)).toBe(true);  // == today
  expect(isFollowUpDue(mk("2026-06-23"), T)).toBe(false); // > today
  expect(isFollowUpDue(mk(null), T)).toBe(false);         // none
});

test("applyView filters follow-ups-due and broken-promises", () => {
  const items = buildWorkItems(
    [inv("i1", "2026-03-01"), inv("i2", "2026-03-01"), inv("i3", "2026-03-01")], cust, [],
    [
      { invoiceId: "i1", promisedAmount: 100, promisedDate: "2026-06-01", followUpAt: null }, // broken
      { invoiceId: "i2", promisedAmount: null, promisedDate: null, followUpAt: "2026-06-20" }, // follow-up due
      { invoiceId: "i3", promisedAmount: 100, promisedDate: "2026-12-01", followUpAt: "2026-12-01" }, // neither
    ], T,
  );
  expect(applyView(items, "broken-promises", T).map((i) => i.invoiceId)).toEqual(["i1"]);
  expect(applyView(items, "follow-ups-due", T).map((i) => i.invoiceId)).toEqual(["i2"]);
});

test("computeMetrics totals follow-ups-due and broken-promises", () => {
  const items = buildWorkItems(
    [inv("i1", "2026-03-01", 400), inv("i2", "2026-03-01", 600)], cust, [],
    [
      { invoiceId: "i1", promisedAmount: 100, promisedDate: "2026-06-01", followUpAt: "2026-06-20" }, // broken + due
      { invoiceId: "i2", promisedAmount: null, promisedDate: null, followUpAt: null },
    ], T,
  );
  const m = computeMetrics(items, T);
  expect(m.brokenPromises).toEqual({ count: 1, amount: 400 });
  expect(m.followUpsDue).toEqual({ count: 1, amount: 400 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `nudgepay-app/`: `npx vitest run tests/worklist.test.ts`
Expected: FAIL — `isBrokenPromise`/`isFollowUpDue` not exported; `buildWorkItems`/`applyView`/`computeMetrics` arity mismatch.

- [ ] **Step 3: Update `worklist.ts`**

In `nudgepay-app/app/lib/worklist.ts`:

(a) Extend types near the top:

```ts
export type ViewId = "all-open" | "30-plus" | "high-value" | "never-contacted" | "follow-ups-due" | "broken-promises";
```

```ts
export type Metrics = {
  thirtyPlus: Metric; highValue: Metric; neverContacted: Metric; allOpen: Metric;
  followUpsDue: Metric; brokenPromises: Metric;
};
```

Add the new input type next to the other `*Input` types:

```ts
export type PromiseSignalInput = {
  invoiceId: string;
  promisedAmount: number | null;
  promisedDate: string | null;
  followUpAt: string | null;
};
```

Add two fields to `WorkItem` (after `lastContact`):

```ts
  promise: { amount: number; date: string } | null;
  followUpAt: string | null;
```

(b) Replace `buildWorkItems` with the version below (adds `promiseSignals`, hardens last-contact selection to max-by-date, maps promise/followUpAt):

```ts
export function buildWorkItems(
  invoices: InvoiceInput[], customers: CustomerInput[],
  lastContacts: LastContactInput[], promiseSignals: PromiseSignalInput[], today: string,
): WorkItem[] {
  const customerById = new Map(customers.map((c) => [c.id, c]));

  // Most-recent contact per invoice (explicit max-by-date; do not rely on order).
  const lastByInvoice = new Map<string, LastContactInput>();
  for (const lc of lastContacts) {
    const prev = lastByInvoice.get(lc.invoiceId);
    if (!prev || lc.date > prev.date) lastByInvoice.set(lc.invoiceId, lc);
  }

  const signalByInvoice = new Map(promiseSignals.map((s) => [s.invoiceId, s]));

  const customerBalance = new Map<string, number>();
  const customerInvoiceCount = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.customer_id) continue;
    customerBalance.set(inv.customer_id, (customerBalance.get(inv.customer_id) ?? 0) + Number(inv.balance || 0));
    customerInvoiceCount.set(inv.customer_id, (customerInvoiceCount.get(inv.customer_id) ?? 0) + 1);
  }

  return invoices.map((inv) => {
    const cust = inv.customer_id ? customerById.get(inv.customer_id) ?? null : null;
    const ageDays = inv.due_date ? ageInDays(inv.due_date, today) : 0;
    const lc = lastByInvoice.get(inv.id) ?? null;
    const neverContacted = !lc;
    const balance = Number(inv.balance || 0);
    const name = cust?.name ?? "(unknown customer)";
    const sig = signalByInvoice.get(inv.id) ?? null;
    const promise =
      sig && sig.promisedAmount != null && sig.promisedDate != null
        ? { amount: sig.promisedAmount, date: sig.promisedDate }
        : null;
    return {
      invoiceId: inv.id,
      docNumber: inv.qbo_doc_number,
      customerId: inv.customer_id,
      customerName: name,
      phone: cust?.phone ?? null,
      email: cust?.email ?? null,
      owner: "Unassigned",
      balance,
      customerBalance: inv.customer_id ? customerBalance.get(inv.customer_id) ?? balance : balance,
      dueDate: inv.due_date,
      ageDays,
      heat: heatOf(ageDays),
      priority: priorityOf(ageDays, neverContacted),
      nextAction: nextActionOf(ageDays, neverContacted),
      lastContact: lc ? { date: lc.date, channel: lc.channel } : null,
      promise,
      followUpAt: sig?.followUpAt ?? null,
      invoiceCount: inv.customer_id ? customerInvoiceCount.get(inv.customer_id) ?? 1 : 1,
      searchText: [name, inv.qbo_doc_number ?? "", cust?.phone ?? "", cust?.email ?? ""].join(" ").toLowerCase(),
    };
  });
}
```

(c) Add the two predicates (after `buildWorkItems`):

```ts
export function isBrokenPromise(item: WorkItem, today: string): boolean {
  return item.promise != null && item.promise.date < today;
}

export function isFollowUpDue(item: WorkItem, today: string): boolean {
  return item.followUpAt != null && item.followUpAt <= today;
}
```

(d) Replace `applyView` (adds `today` + the two new views):

```ts
export function applyView(items: WorkItem[], view: ViewId, today: string): WorkItem[] {
  if (view === "30-plus") return items.filter((i) => i.ageDays >= 30);
  if (view === "high-value") return items.filter((i) => i.balance >= HIGH_VALUE_THRESHOLD);
  if (view === "never-contacted") return items.filter((i) => i.lastContact === null);
  if (view === "follow-ups-due") return items.filter((i) => isFollowUpDue(i, today));
  if (view === "broken-promises") return items.filter((i) => isBrokenPromise(i, today));
  return items;
}
```

(e) Replace `computeMetrics` (adds `today` + the two buckets):

```ts
export function computeMetrics(items: WorkItem[], today: string): Metrics {
  const bucket = (pred: (i: WorkItem) => boolean): Metric => {
    const matched = items.filter(pred);
    return { count: matched.length, amount: matched.reduce((s, i) => s + i.balance, 0) };
  };
  return {
    thirtyPlus: bucket((i) => i.ageDays >= 30),
    highValue: bucket((i) => i.balance >= HIGH_VALUE_THRESHOLD),
    neverContacted: bucket((i) => i.lastContact === null),
    allOpen: bucket(() => true),
    followUpsDue: bucket((i) => isFollowUpDue(i, today)),
    brokenPromises: bucket((i) => isBrokenPromise(i, today)),
  };
}
```

- [ ] **Step 4: Thread the new signature through `buildDashboardData` (keep the build green)**

In `nudgepay-app/app/routes/dashboard.tsx`:

(a) Add `PromiseSignalInput` to the import from `../lib/worklist` and update the `DashboardParams.tab` union is unchanged. Update `buildDashboardData` signature + body:

```ts
export function buildDashboardData(
  invoices: InvoiceInput[],
  customers: CustomerInput[],
  lastContacts: LastContactInput[],
  promiseSignals: PromiseSignalInput[],
  params: DashboardParams,
  today: string,
): DashboardData {
  const { view, sort, q, invoice } = params;

  const allItems = buildWorkItems(invoices, customers, lastContacts, promiseSignals, today);

  const searchedItems =
    q.trim() === ""
      ? allItems
      : allItems.filter((i) => i.searchText.includes(q.toLowerCase()));

  const metrics = computeMetrics(searchedItems, today);

  const ALL_VIEWS: ViewId[] = ["all-open", "30-plus", "high-value", "never-contacted", "follow-ups-due", "broken-promises"];
  const viewCounts = Object.fromEntries(
    ALL_VIEWS.map((v) => [v, applyView(searchedItems, v, today).length]),
  ) as Record<ViewId, number>;

  const viewFiltered = applyView(searchedItems, view, today);
  const items = sortItems(viewFiltered, sort);

  const selected =
    invoice != null
      ? (searchedItems.find((i) => i.invoiceId === invoice) ?? null)
      : null;

  return { items, metrics, viewCounts, selected };
}
```

(b) Update the loader's empty-state `dashboardData` default to include the two new metric buckets and view counts:

```ts
  let dashboardData: DashboardData = {
    items: [],
    metrics: {
      thirtyPlus: { count: 0, amount: 0 },
      highValue: { count: 0, amount: 0 },
      neverContacted: { count: 0, amount: 0 },
      allOpen: { count: 0, amount: 0 },
      followUpsDue: { count: 0, amount: 0 },
      brokenPromises: { count: 0, amount: 0 },
    },
    viewCounts: {
      "all-open": 0, "30-plus": 0, "high-value": 0,
      "never-contacted": 0, "follow-ups-due": 0, "broken-promises": 0,
    },
    selected: null,
  };
```

(c) Update the `VALID_VIEWS` array in the loader to include the two new ids:

```ts
  const VALID_VIEWS: ViewId[] = ["all-open", "30-plus", "high-value", "never-contacted", "follow-ups-due", "broken-promises"];
```

(d) Update the single existing `buildDashboardData(...)` call inside the loader to pass `[]` for `promiseSignals` for now (Task 5 replaces this):

```ts
    dashboardData = buildDashboardData(
      invoicesInput,
      customersInput,
      lastContactsInput,
      [], // promiseSignals — wired in Task 5
      { view, sort, q, invoice, tab },
      today,
    );
```

- [ ] **Step 5: Update the existing dashboard-worklist tests for the new signature**

In `nudgepay-app/tests/dashboard-worklist.test.ts`, both `buildDashboardData(...)` calls gain a `[]` promiseSignals argument before the params object. Update the first call (line ~14) and the second (line ~33):

```ts
  const data = buildDashboardData(invoices, customers, lastContacts, [],
    { view: "30-plus", sort: "recommended", q: "", invoice: "i1" }, TODAY);
```

```ts
  const data = buildDashboardData(invoices, customers, [], [],
    { view: "all-open", sort: "recommended", q: "globex", invoice: null }, TODAY);
```

Then add one signal-flow test:

```ts
test("buildDashboardData threads promise + follow-up signals into items and metrics", () => {
  const invoices = [{ id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 700, due_date: "2026-03-01" }];
  const customers = [{ id: "c1", name: "Acme", phone: null, email: null }];
  const signals = [{ invoiceId: "i1", promisedAmount: 200, promisedDate: "2026-06-01", followUpAt: "2026-06-20" }];
  const data = buildDashboardData(invoices, customers, [], signals,
    { view: "broken-promises", sort: "recommended", q: "", invoice: "i1" }, TODAY);
  expect(data.items.map((i) => i.invoiceId)).toEqual(["i1"]);
  expect(data.metrics.brokenPromises.count).toBe(1);
  expect(data.metrics.followUpsDue.count).toBe(1);
  expect(data.selected?.promise).toEqual({ amount: 200, date: "2026-06-01" });
});

test("a logged contact clears never-contacted in the metrics", () => {
  const invoices = [{ id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 700, due_date: "2026-03-01" }];
  const customers = [{ id: "c1", name: "Acme", phone: null, email: null }];
  const withContact = buildDashboardData(invoices, customers,
    [{ invoiceId: "i1", date: "2026-06-19T00:00:00Z", channel: "Call" }], [],
    { view: "all-open", sort: "recommended", q: "", invoice: null }, TODAY);
  expect(withContact.metrics.neverContacted.count).toBe(0);
});
```

- [ ] **Step 6: Run the full suite**

Run from `nudgepay-app/`: `npx vitest run`
Expected: PASS — all prior tests plus the new worklist + dashboard tests. Then `npx tsc -b` Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/worklist.ts nudgepay-app/app/routes/dashboard.tsx nudgepay-app/tests/worklist.test.ts nudgepay-app/tests/dashboard-worklist.test.ts
git commit -m "feat: worklist promise + follow-up signals, views, and metrics"
```

---

### Task 3: Pure validator — `parseContactLogForm`

**Files:**
- Create: `nudgepay-app/app/lib/contact-log.ts`
- Test: `nudgepay-app/tests/api-contact-logs.test.ts` (append)

**Interfaces:**
- Consumes: nothing (pure; uses Web `FormData`).
- Produces:
  - `const CONTACT_METHODS = ["call", "email", "text", "note"] as const`
  - `const CONTACT_OUTCOMES = ["promise-to-pay", "dispute", "no-commitment", "left-voicemail", "no-answer", "other"] as const`
  - `type ContactMethod = (typeof CONTACT_METHODS)[number]`
  - `type ContactOutcome = (typeof CONTACT_OUTCOMES)[number]`
  - `type ContactLogFields = { invoiceId: string; customerId: string | null; method: ContactMethod; outcome: ContactOutcome; notes: string | null; followUpAt: string | null; promisedAmount: number | null; promisedDate: string | null }`
  - `type ParseResult = { ok: true; fields: ContactLogFields } | { ok: false; error: string }`
  - `function parseContactLogForm(form: FormData): ParseResult`

- [ ] **Step 1: Write the failing validator tests**

Append to `nudgepay-app/tests/api-contact-logs.test.ts`:

```ts
import { parseContactLogForm } from "../app/lib/contact-log";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

test("parse: valid call with no promise", () => {
  const r = parseContactLogForm(fd({ invoiceId: "i1", method: "call", outcome: "no-answer" }));
  expect(r).toEqual({ ok: true, fields: {
    invoiceId: "i1", customerId: null, method: "call", outcome: "no-answer",
    notes: null, followUpAt: null, promisedAmount: null, promisedDate: null,
  }});
});

test("parse: promise-to-pay requires amount and date", () => {
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "call", outcome: "promise-to-pay" })))
    .toEqual({ ok: false, error: "promise-required" });
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "call", outcome: "promise-to-pay", promisedAmount: "500" })))
    .toEqual({ ok: false, error: "promise-required" });
});

test("parse: promise-to-pay valid", () => {
  const r = parseContactLogForm(fd({
    invoiceId: "i1", customerId: "c1", method: "call", outcome: "promise-to-pay",
    promisedAmount: "500.50", promisedDate: "2026-07-01", notes: "  AP will pay  ", followUpAt: "2026-07-02",
  }));
  expect(r).toEqual({ ok: true, fields: {
    invoiceId: "i1", customerId: "c1", method: "call", outcome: "promise-to-pay",
    notes: "AP will pay", followUpAt: "2026-07-02", promisedAmount: 500.5, promisedDate: "2026-07-01",
  }});
});

test("parse: rejects bad amount, bad date, bad method, bad outcome, missing invoice", () => {
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "call", outcome: "promise-to-pay", promisedAmount: "-5", promisedDate: "2026-07-01" })).ok).toBe(false);
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "call", outcome: "promise-to-pay", promisedAmount: "abc", promisedDate: "2026-07-01" }))).toEqual({ ok: false, error: "bad-amount" });
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "call", outcome: "promise-to-pay", promisedAmount: "500", promisedDate: "nope" }))).toEqual({ ok: false, error: "bad-date" });
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "smoke", outcome: "no-answer" }))).toEqual({ ok: false, error: "bad-method" });
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "call", outcome: "vibes" }))).toEqual({ ok: false, error: "bad-outcome" });
  expect(parseContactLogForm(fd({ method: "call", outcome: "no-answer" }))).toEqual({ ok: false, error: "missing-invoice" });
});

test("parse: rejects malformed follow-up date", () => {
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "note", outcome: "other", followUpAt: "2026-13-99" })))
    .toEqual({ ok: false, error: "bad-date" });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `nudgepay-app/`: `npx vitest run tests/api-contact-logs.test.ts`
Expected: FAIL — `Cannot find module '../app/lib/contact-log'`.

- [ ] **Step 3: Write `contact-log.ts`**

Create `nudgepay-app/app/lib/contact-log.ts`:

```ts
// Pure validation for the contact-log form. No I/O, no node:*, no .server suffix
// (it is imported by both the action route and tests). The action layer performs
// auth/org/RLS; this only shapes and validates the submitted fields.

export const CONTACT_METHODS = ["call", "email", "text", "note"] as const;
export const CONTACT_OUTCOMES = [
  "promise-to-pay", "dispute", "no-commitment", "left-voicemail", "no-answer", "other",
] as const;

export type ContactMethod = (typeof CONTACT_METHODS)[number];
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

export type ContactLogFields = {
  invoiceId: string;
  customerId: string | null;
  method: ContactMethod;
  outcome: ContactOutcome;
  notes: string | null;
  followUpAt: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
};

export type ParseResult =
  | { ok: true; fields: ContactLogFields }
  | { ok: false; error: string };

// Strict YYYY-MM-DD with a real calendar check (rejects 2026-13-99).
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function str(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function parseContactLogForm(form: FormData): ParseResult {
  const invoiceId = str(form, "invoiceId");
  if (!invoiceId) return { ok: false, error: "missing-invoice" };

  const customerId = str(form, "customerId");

  const method = str(form, "method");
  if (!method || !CONTACT_METHODS.includes(method as ContactMethod)) return { ok: false, error: "bad-method" };

  const outcome = str(form, "outcome");
  if (!outcome || !CONTACT_OUTCOMES.includes(outcome as ContactOutcome)) return { ok: false, error: "bad-outcome" };

  const notes = str(form, "notes");

  const followUpRaw = str(form, "followUpAt");
  if (followUpRaw && !validDate(followUpRaw)) return { ok: false, error: "bad-date" };
  const followUpAt = followUpRaw;

  let promisedAmount: number | null = null;
  let promisedDate: string | null = null;

  if (outcome === "promise-to-pay") {
    const amountRaw = str(form, "promisedAmount");
    const dateRaw = str(form, "promisedDate");
    if (!amountRaw || !dateRaw) return { ok: false, error: "promise-required" };
    const n = Number(amountRaw);
    if (!Number.isFinite(n)) return { ok: false, error: "bad-amount" };
    if (n <= 0) return { ok: false, error: "bad-amount" };
    if (!validDate(dateRaw)) return { ok: false, error: "bad-date" };
    promisedAmount = n;
    promisedDate = dateRaw;
  }

  return {
    ok: true,
    fields: {
      invoiceId, customerId,
      method: method as ContactMethod,
      outcome: outcome as ContactOutcome,
      notes, followUpAt, promisedAmount, promisedDate,
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `nudgepay-app/`: `npx vitest run tests/api-contact-logs.test.ts`
Expected: PASS (all validator tests + the Task 1 column test).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/contact-log.ts nudgepay-app/tests/api-contact-logs.test.ts
git commit -m "feat: add parseContactLogForm validator for contact logs"
```

---

### Task 4: Write path — `/api/contact-logs` action route

**Files:**
- Create: `nudgepay-app/app/routes/api.contact-logs.tsx`
- Modify: `nudgepay-app/app/routes.ts` (register the route if routes are declared explicitly — check first; if the project uses filesystem flat-routes, no edit is needed)
- Test: `nudgepay-app/tests/api-contact-logs.test.ts` (append the DB-backed RLS insert test)

**Interfaces:**
- Consumes: `parseContactLogForm` (Task 3); `requireUser`, `resolveOrg` (`app/lib/session.server.ts`); `getEnv` (`app/lib/env.server.ts`); `contact_logs.promised_amount`/`promised_date` (Task 1).
- Produces: `POST /api/contact-logs` that inserts a contact log (RLS user client) and redirects to a safe same-origin `returnTo` (defaults to `/dashboard`), or back to `returnTo` with `&logError=<code>` on failure.

- [ ] **Step 1: Check route registration**

Run from `nudgepay-app/`: `cat app/routes.ts`
If it uses `@react-router/fs-routes` `flatRoutes()`, the file `app/routes/api.contact-logs.tsx` auto-registers — no edit. If routes are listed explicitly (e.g. `route("api/qbo/disconnect", ...)`), add `route("api/contact-logs", "routes/api.contact-logs.tsx")` next to the other `api/*` entries. Match whatever pattern `api.qbo.disconnect.tsx` uses (it is the reference).

- [ ] **Step 2: Write the failing DB-backed insert test**

Append to `nudgepay-app/tests/api-contact-logs.test.ts`:

```ts
import { action as contactLogAction } from "../app/routes/api.contact-logs";

// Build a minimal env/context the action expects (getEnv reads from context).
// The action uses requireUser (cookie-based). For a direct-call test we instead
// assert the RLS insert path via a user client, mirroring the action's writes.
test("RLS user client inserts a contact log readable back within the org", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Log Insert Org" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "li-c1", name: "Logged Co" }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "li-i1", customer_id: cust!.id, amount: 900, balance: 900, due_date: "2026-02-01", status: "overdue" })
    .select("id").single();
  const user = await makeUserClient("log-insert@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "member" });

  const { error: insErr } = await user.client.from("contact_logs").insert({
    org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, user_id: user.userId,
    method: "call", outcome: "promise-to-pay", notes: "will pay",
    promised_amount: 300, promised_date: "2026-07-15", follow_up_at: null,
  });
  expect(insErr).toBeNull();

  const { data: rows } = await user.client.from("contact_logs")
    .select("user_id, method, promised_amount, promised_date").eq("invoice_id", inv!.id);
  expect(rows!.length).toBe(1);
  expect(rows![0].user_id).toBe(user.userId);
  expect(Number(rows![0].promised_amount)).toBe(300);
});
```

(Note: this test exercises the exact insert shape the action performs through the RLS user client. The `import { action }` line proves the route module loads without throwing at import time.)

- [ ] **Step 3: Run the test to verify it fails**

Run from `nudgepay-app/`: `npx vitest run tests/api-contact-logs.test.ts`
Expected: FAIL — `Cannot find module '../app/routes/api.contact-logs'`.

- [ ] **Step 4: Write the action route**

Create `nudgepay-app/app/routes/api.contact-logs.tsx`:

```ts
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { parseContactLogForm } from "../lib/contact-log";

// Resolve a safe same-origin redirect target. We only accept an app-relative
// path (must start with a single "/", not "//") to avoid open-redirects.
function safeReturnTo(raw: FormData, requestUrl: string): string {
  const v = raw.get("returnTo");
  if (typeof v === "string" && v.startsWith("/") && !v.startsWith("//")) return v;
  return "/dashboard";
}

function withError(returnTo: string, code: string): string {
  const sep = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${sep}logError=${encodeURIComponent(code)}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form, request.url);

  const parsed = parseContactLogForm(form);
  if (!parsed.ok) return redirect(withError(returnTo, parsed.error), { headers });
  const f = parsed.fields;

  // Cross-org guard: the RLS user client can only read invoices in the caller's
  // org, so a foreign invoice_id returns no row even though contact_logs RLS
  // would otherwise accept the insert (it only checks org_id).
  const { data: inv } = await supabase
    .from("invoices").select("id").eq("id", f.invoiceId).maybeSingle();
  if (!inv) return redirect(withError(returnTo, "missing-invoice"), { headers });

  const { error } = await supabase.from("contact_logs").insert({
    org_id: org.org_id,
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

  return redirect(returnTo, { headers });
}
```

- [ ] **Step 5: Run the test + typecheck**

Run from `nudgepay-app/`: `npx vitest run tests/api-contact-logs.test.ts` Expected: PASS.
Run: `npx tsc -b` Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/routes/api.contact-logs.tsx nudgepay-app/tests/api-contact-logs.test.ts
git commit -m "feat: add /api/contact-logs action route with RLS-scoped insert"
```
(Also `git add nudgepay-app/app/routes.ts` if Step 1 required an edit.)

---

### Task 5: Loader wiring — read contact logs, derive signals + selected activity

**Files:**
- Modify: `nudgepay-app/app/routes/dashboard.tsx` (loader only; default-export render is unchanged here)
- Test: manual via `npx tsc -b` + the existing suite (loader DB read has no new unit test; the pure composition is already covered by Task 2)

**Interfaces:**
- Consumes: `buildDashboardData(..., promiseSignals, params, today)` (Task 2); `PromiseSignalInput`, `LastContactInput` (Task 2); `contact_logs` promise columns (Task 1).
- Produces (added to the loader's returned `data` object, all serializable):
  - `promiseSignals` is internal (not returned).
  - `log: boolean` (from `?log=1`)
  - `logError: string | null` (from `?logError=`)
  - `selectedActivity: ActivityEntry[]` where `type ActivityEntry = { id: string; method: string; outcome: string | null; notes: string | null; createdAt: string; followUpAt: string | null; promisedAmount: number | null; promisedDate: string | null }`

- [ ] **Step 1: Add the `ActivityEntry` type and contact-log row type**

In `nudgepay-app/app/routes/dashboard.tsx`, near the other row types (after `TextMessageRow`):

```ts
type ContactLogRow = {
  id: string;
  invoice_id: string | null;
  customer_id: string | null;
  method: string;
  outcome: string | null;
  notes: string | null;
  created_at: string;
  follow_up_at: string | null;
  promised_amount: number | string | null;
  promised_date: string | null;
};

export type ActivityEntry = {
  id: string;
  method: string;
  outcome: string | null;
  notes: string | null;
  createdAt: string;
  followUpAt: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
};
```

- [ ] **Step 2: Read contact logs and derive merged last-contact + promise signals**

In the loader, inside `if (connected) { ... }`, AFTER the `lastContactsInput` block that reads `text_messages` (it currently ends by pushing `{ invoiceId, date, channel: "Text" }`), add a contact-logs read and fold it into `lastContactsInput`, plus build `promiseSignals`:

```ts
    // Per-invoice contact logs (USER client / RLS). Folds into last-contact and
    // supplies promise + follow-up signals.
    const promiseSignals: PromiseSignalInput[] = [];
    if (rawInvoices.length > 0) {
      const invoiceIds = rawInvoices.map((r) => r.id);
      const { data: logRows } = await supabase
        .from("contact_logs")
        .select("id, invoice_id, customer_id, method, outcome, notes, created_at, follow_up_at, promised_amount, promised_date")
        .eq("org_id", org.org_id)
        .in("invoice_id", invoiceIds)
        .order("created_at", { ascending: false });

      const logs = (logRows as unknown as ContactLogRow[]) ?? [];

      // Channel label for the merged last-contact (logs are most-recent-first).
      const methodLabel: Record<string, string> = {
        call: "Call", email: "Email", text: "Text", note: "Note",
      };
      for (const row of logs) {
        if (!row.invoice_id) continue;
        lastContactsInput.push({
          invoiceId: row.invoice_id,
          date: row.created_at,
          channel: methodLabel[row.method] ?? "Logged",
        });
      }

      // Derive one signal per invoice: latest promise (first row with both promise
      // fields, since ordered desc) and latest pending follow-up (first non-null).
      const promiseByInvoice = new Map<string, { amount: number; date: string }>();
      const followUpByInvoice = new Map<string, string>();
      for (const row of logs) {
        if (!row.invoice_id) continue;
        if (!promiseByInvoice.has(row.invoice_id) && row.promised_amount != null && row.promised_date != null) {
          promiseByInvoice.set(row.invoice_id, { amount: Number(row.promised_amount), date: row.promised_date });
        }
        if (!followUpByInvoice.has(row.invoice_id) && row.follow_up_at != null) {
          followUpByInvoice.set(row.invoice_id, row.follow_up_at);
        }
      }
      const signalInvoiceIds = new Set([...promiseByInvoice.keys(), ...followUpByInvoice.keys()]);
      for (const id of signalInvoiceIds) {
        const p = promiseByInvoice.get(id) ?? null;
        promiseSignals.push({
          invoiceId: id,
          promisedAmount: p?.amount ?? null,
          promisedDate: p?.date ?? null,
          followUpAt: followUpByInvoice.get(id) ?? null,
        });
      }
    }
```

- [ ] **Step 3: Pass `promiseSignals` into `buildDashboardData`**

Replace the `buildDashboardData(...)` call from Task 2 Step 4(d) to pass the real signals:

```ts
    dashboardData = buildDashboardData(
      invoicesInput,
      customersInput,
      lastContactsInput,
      promiseSignals,
      { view, sort, q, invoice, tab },
      today,
    );
```

- [ ] **Step 4: Read the selected invoice's activity timeline**

Still inside `if (connected)`, AFTER `dashboardData = ...`, add a scoped read for the selected invoice:

```ts
    if (invoice) {
      const { data: actRows } = await supabase
        .from("contact_logs")
        .select("id, invoice_id, customer_id, method, outcome, notes, created_at, follow_up_at, promised_amount, promised_date")
        .eq("org_id", org.org_id)
        .eq("invoice_id", invoice)
        .order("created_at", { ascending: false });
      selectedActivity = ((actRows as unknown as ContactLogRow[]) ?? []).map((r) => ({
        id: r.id,
        method: r.method,
        outcome: r.outcome,
        notes: r.notes,
        createdAt: r.created_at,
        followUpAt: r.follow_up_at,
        promisedAmount: r.promised_amount == null ? null : Number(r.promised_amount),
        promisedDate: r.promised_date,
      }));
    }
```

Declare `selectedActivity` with the other mutable loader state (near `let dashboardData`):

```ts
  let selectedActivity: ActivityEntry[] = [];
```

- [ ] **Step 5: Parse `log` / `logError` and add to the returned data**

In the param-parsing block, add:

```ts
  const log = sp.get("log") === "1";
  const logError = sp.get("logError");
```

Add `PromiseSignalInput` to the `worklist` import. Then extend the returned `data({...})` object (alongside `view, sort, q, invoice, tab`):

```ts
      log,
      logError,
      selectedActivity,
```

- [ ] **Step 6: Typecheck + full suite**

Run from `nudgepay-app/`: `npx tsc -b` Expected: clean. Then `npx vitest run` Expected: all PASS (no behavior change to existing tests).

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/routes/dashboard.tsx
git commit -m "feat: loader reads contact logs for signals and activity timeline"
```

---

### Task 6: UI — LogContactDrawer + DetailPanel Log button + Activity timeline

**Files:**
- Create: `nudgepay-app/app/components/LogContactDrawer.tsx`
- Modify: `nudgepay-app/app/components/DetailPanel.tsx`
- Modify: `nudgepay-app/app/routes/dashboard.tsx` (render the drawer; pass `selectedActivity` + `log` + `logError` to the components)

**Interfaces:**
- Consumes: loader fields `log`, `logError`, `selectedActivity` (Task 5); `/api/contact-logs` (Task 4); `CONTACT_METHODS`, `CONTACT_OUTCOMES` (Task 3); `ActivityEntry` (Task 5); `WorkItem` (Task 2); `Icon` (`components/Icons.tsx`, available names include `phone`, `mail`, `message`, `note`, `calendar`, `check`, `circle`, `chevronRight`, `plus`).
- Produces: `LogContactDrawer({ selected, returnTo, logError })`; updated `DetailPanel({ selected, activeTab, activity, view, sort, q })`.

- [ ] **Step 1: Write `LogContactDrawer.tsx`**

Create `nudgepay-app/app/components/LogContactDrawer.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Form, Link } from "react-router";
import type { WorkItem } from "../lib/worklist";
import { CONTACT_METHODS, CONTACT_OUTCOMES } from "../lib/contact-log";
import { Icon } from "./Icons";

const METHOD_LABEL: Record<string, string> = {
  call: "Call", email: "Email", text: "Text", note: "Note",
};
const OUTCOME_LABEL: Record<string, string> = {
  "promise-to-pay": "Promise to pay",
  dispute: "Dispute",
  "no-commitment": "No commitment",
  "left-voicemail": "Left voicemail",
  "no-answer": "No answer",
  other: "Other",
};
const ERROR_MESSAGE: Record<string, string> = {
  "promise-required": "Add a promised amount and date, or change the outcome.",
  "bad-amount": "Enter a valid promised amount greater than zero.",
  "bad-date": "Enter a valid date.",
  "missing-invoice": "That invoice could not be found.",
  "save-failed": "Could not save the contact. Try again.",
};

export function LogContactDrawer({
  selected, returnTo, logError,
}: {
  selected: WorkItem;
  returnTo: string;
  logError: string | null;
}) {
  const [outcome, setOutcome] = useState<string>("no-answer");
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const showPromise = outcome === "promise-to-pay";

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Log a contact">
      {/* Scrim — clicking it (a Link) closes the drawer */}
      <Link to={returnTo} aria-label="Close" className="absolute inset-0 bg-ink/40 motion-safe:transition-opacity" />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-surface border-l border-border h-full overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display text-lg font-semibold text-text">Log a contact</h2>
          <Link
            to={returnTo}
            aria-label="Close"
            className="text-muted hover:text-text rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-copper p-1"
          >
            <Icon name="chevronRight" size={18} aria-hidden />
          </Link>
        </div>

        <p className="px-5 pt-3 text-sm text-muted font-sans">
          {selected.customerName}
          <span className="mx-1.5 text-border">·</span>
          {selected.docNumber ?? selected.invoiceId}
        </p>

        {logError && ERROR_MESSAGE[logError] && (
          <p role="alert" className="mx-5 mt-3 rounded-md bg-hot/10 border border-hot/30 px-3 py-2 text-sm text-hot font-sans">
            {ERROR_MESSAGE[logError]}
          </p>
        )}

        <Form method="post" action="/api/contact-logs" className="flex flex-col gap-4 px-5 py-4">
          <input type="hidden" name="invoiceId" value={selected.invoiceId} />
          <input type="hidden" name="customerId" value={selected.customerId ?? ""} />
          <input type="hidden" name="returnTo" value={returnTo} />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Method</span>
            <select
              ref={firstFieldRef}
              name="method"
              defaultValue="call"
              className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              {CONTACT_METHODS.map((m) => (
                <option key={m} value={m}>{METHOD_LABEL[m]}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Outcome</span>
            <select
              name="outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              {CONTACT_OUTCOMES.map((o) => (
                <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
              ))}
            </select>
          </label>

          {showPromise && (
            <div className="grid grid-cols-2 gap-3 rounded-md bg-panel/60 border border-border p-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Promised amount</span>
                <input
                  name="promisedAmount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-mono text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Promised by</span>
                <input
                  name="promisedDate"
                  type="date"
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                />
              </label>
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Notes</span>
            <textarea
              name="notes"
              rows={3}
              placeholder="Who you spoke with, what they said…"
              className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper resize-y"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Follow up (optional)</span>
            <input
              name="followUpAt"
              type="date"
              className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Link
              to={returnTo}
              className="rounded-md border border-border bg-panel px-4 py-2 text-sm font-sans text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="rounded-md bg-copper px-4 py-2 text-sm font-sans font-semibold text-ink hover:bg-copper/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-offset-2"
            >
              Save contact
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `DetailPanel.tsx` — Log button + Activity timeline**

In `nudgepay-app/app/components/DetailPanel.tsx`:

(a) Add imports + an `ActivityEntry` import and `props`:

```tsx
import type { ActivityEntry } from "~/routes/dashboard";
```

Change the component signature and the Log button + Activity tab. Replace the `DetailPanel` props with:

```tsx
export function DetailPanel({
  selected,
  activeTab,
  activity,
  view,
  sort,
  q,
}: {
  selected: WorkItem | null;
  activeTab: "overview" | "activity" | "messages";
  activity: ActivityEntry[];
  view: string;
  sort: string;
  q: string;
}) {
```

(b) Build a params helper for links that preserve queue context. After the `const docLabel = ...` line:

```tsx
  const ctx = new URLSearchParams({ invoice: selected.invoiceId, view, sort, ...(q ? { q } : {}) });
  const logHref = `?${new URLSearchParams({ invoice: selected.invoiceId, tab: "activity", view, sort, ...(q ? { q } : {}), log: "1" }).toString()}`;
```

(c) Replace the disabled Log `<button>` with a `<Link>`:

```tsx
          <Link
            to={logHref}
            className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-copper border border-copper/40 rounded-md px-3 py-1.5 hover:bg-copper/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
          >
            <Icon name="note" size={14} aria-hidden />
            Log
          </Link>
```

(d) Replace the Activity `PlaceholderTab` block with a real timeline. Add these helpers above the component (next to `formatUSD`):

```tsx
const METHOD_ICON: Record<string, "phone" | "mail" | "message" | "note"> = {
  call: "phone", email: "mail", text: "message", note: "note",
};
const OUTCOME_TEXT: Record<string, string> = {
  "promise-to-pay": "Promise to pay",
  dispute: "Dispute",
  "no-commitment": "No commitment",
  "left-voicemail": "Left voicemail",
  "no-answer": "No answer",
  other: "Logged",
};
function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return "—"; }
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
```

Replace the `activeTab === "activity"` block with:

```tsx
      {activeTab === "activity" ? (
        <section id="activity-panel" role="tabpanel" aria-labelledby="activity-tab" className="flex-1 px-5 py-4">
          {activity.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Icon name="note" size={24} className="text-border" aria-hidden />
              <p className="text-sm font-sans font-semibold text-text">No contact logged yet.</p>
              <p className="text-xs text-muted max-w-xs">Use Log to record a call or note.</p>
            </div>
          ) : (
            <ol className="flex flex-col gap-3">
              {activity.map((a) => {
                const broken = a.promisedDate != null && a.promisedDate < todayISO();
                return (
                  <li key={a.id} className="flex gap-3 border-b border-border pb-3 last:border-0">
                    <span className="mt-0.5 text-muted shrink-0">
                      <Icon name={METHOD_ICON[a.method] ?? "note"} size={15} aria-hidden />
                    </span>
                    <div className="min-w-0 flex flex-col gap-0.5">
                      <span className="text-sm font-sans font-semibold text-text">
                        {OUTCOME_TEXT[a.outcome ?? "other"] ?? "Logged"}
                      </span>
                      <span className="font-mono text-xs text-muted">{formatDateTime(a.createdAt)}</span>
                      {a.promisedAmount != null && a.promisedDate != null && (
                        <span className={`text-xs font-sans font-medium ${broken ? "text-hot" : "text-text"}`}>
                          Promised {formatUSD(a.promisedAmount)} by {formatDateTime(a.promisedDate)}
                          {broken ? " · broken" : ""}
                        </span>
                      )}
                      {a.followUpAt && (
                        <span className="text-xs font-sans text-muted">Follow up {formatDateTime(a.followUpAt)}</span>
                      )}
                      {a.notes && <span className="text-xs text-muted whitespace-pre-wrap">{a.notes}</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ) : null}
```

- [ ] **Step 3: Render the drawer + pass props in `dashboard.tsx`**

In `nudgepay-app/app/routes/dashboard.tsx` default export:

(a) Add to the destructured `useLoaderData`: `log`, `logError`, `selectedActivity`, and ensure `invoice` is available (it is in the returned data). Import the drawer:

```tsx
import { LogContactDrawer } from "../components/LogContactDrawer";
```

(b) Update the `<DetailPanel>` usage to pass the new props:

```tsx
              <DetailPanel
                selected={selected ?? null}
                activeTab={tab}
                activity={selectedActivity}
                view={view}
                sort={sort}
                q={q}
              />
```

(c) After the two-pane `<div>` (inside the `connected` branch, as a sibling), render the drawer when `log` is true and an account is selected. Build `returnTo` as the current dashboard URL without `log`:

```tsx
          {log && selected ? (
            <LogContactDrawer
              selected={selected}
              returnTo={`?${new URLSearchParams({ invoice: selected.invoiceId, tab, view, sort, ...(q ? { q } : {}) }).toString()}`}
              logError={logError}
            />
          ) : null}
```

- [ ] **Step 4: Typecheck + build**

Run from `nudgepay-app/`: `npx tsc -b` Expected: clean. Then `npx react-router build` Expected: build succeeds (no `.server`-in-client errors; `contact-log.ts` and `worklist.ts` are pure).

- [ ] **Step 5: Visual check (dev server + Chrome)**

Run the dev server (`npm run dev`), open `/dashboard` with the seeded demo org, select an account, click **Log**, confirm: drawer opens with focus on Method; choosing "Promise to pay" reveals amount/date; saving returns to the queue with the Activity timeline showing the new entry; a past promised date renders `hot` with "· broken". Do a frontend-design self-critique pass (spacing, focus rings, reduced-motion, mobile full-width sheet).

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/components/LogContactDrawer.tsx nudgepay-app/app/components/DetailPanel.tsx nudgepay-app/app/routes/dashboard.tsx
git commit -m "feat: log-contact slide-over and activity timeline in detail panel"
```

---

### Task 7: UI — 6 metric tiles + 6 saved-view tabs

**Files:**
- Modify: `nudgepay-app/app/components/MetricsStrip.tsx`
- Modify: `nudgepay-app/app/components/WorkQueue.tsx`

**Interfaces:**
- Consumes: `Metrics` with `followUpsDue`/`brokenPromises` (Task 2); `ViewId` with `follow-ups-due`/`broken-promises` (Task 2); `viewCounts` keyed by all six views (Task 2 `buildDashboardData`).
- Produces: 6-tile MetricsStrip; 6-tab WorkQueue saved views.

- [ ] **Step 1: Update `MetricsStrip.tsx` to 6 tiles**

In `nudgepay-app/app/components/MetricsStrip.tsx`, change the grid to fit six and add the two tiles. Replace the wrapper `className` and add the tiles before `</div>`:

```tsx
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
      aria-label="Collections summary metrics"
    >
```

Add after the "All open" `<MetricTile>`:

```tsx
      <MetricTile
        label="Follow-ups due"
        count={metrics.followUpsDue.count}
        amount={metrics.followUpsDue.amount}
        accent="warm"
      />
      <MetricTile
        label="Broken promises"
        count={metrics.brokenPromises.count}
        amount={metrics.brokenPromises.amount}
        accent="hot"
      />
```

- [ ] **Step 2: Update `WorkQueue.tsx` saved views to 6**

In `nudgepay-app/app/components/WorkQueue.tsx`, extend `SAVED_VIEWS`:

```ts
const SAVED_VIEWS: { id: ViewId; label: string }[] = [
  { id: "all-open",         label: "All open" },
  { id: "30-plus",          label: "30+ days" },
  { id: "high-value",       label: "High value" },
  { id: "never-contacted",  label: "Never contacted" },
  { id: "follow-ups-due",   label: "Follow-ups due" },
  { id: "broken-promises",  label: "Broken promises" },
];
```

(The tab-render loop already reads `viewCounts[sv.id] ?? 0`, so counts work with no further change.)

- [ ] **Step 3: Typecheck + build**

Run from `nudgepay-app/`: `npx tsc -b` Expected: clean (the `Metrics`/`ViewId` types now include the new members; if `tsc` complains about a missing metric key anywhere, that's a real gap to fix). Then `npx react-router build` Expected: success.

- [ ] **Step 4: Visual check**

Dev server + Chrome: confirm six tiles render (Follow-ups due = warm, Broken promises = hot) and six view tabs with correct counts; clicking "Broken promises" filters the queue. Self-critique the strip wrapping at sm/xl breakpoints.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/components/MetricsStrip.tsx nudgepay-app/app/components/WorkQueue.tsx
git commit -m "feat: surface follow-ups-due and broken-promises as tiles and views"
```

---

## Self-Review

**Spec coverage:**
- §3 logging UX (slide-over, URL-param) → Task 6 (`LogContactDrawer`, `?log=1`). ✅
- §3 two signals as tiles + views → Task 2 (logic) + Task 7 (UI). ✅
- §3 field set = promise-only, conditional reveal → Task 1 (columns), Task 3 (validator), Task 6 (conditional reveal). ✅
- §4 migration → Task 1. ✅
- §5 write path, pure validator, cross-org guard, returnTo/logError → Task 3 + Task 4. ✅
- §6 pure logic (types, predicates, hardened last-contact, view/metric additions, correctness fix) → Task 2. ✅
- §7 loader reads + selected activity + log/logError → Task 5. ✅
- §8 components (drawer, DetailPanel timeline, MetricsStrip, WorkQueue) → Task 6 + Task 7. ✅
- §9 error copy / empty state → Task 6 (`ERROR_MESSAGE`, empty state). ✅
- §10 testing (worklist, api-contact-logs, dashboard) → Tasks 2/3/4 tests. ✅
- §11 constraints → Global Constraints + reaffirmed per task. ✅

**Placeholder scan:** No TBD/TODO; every code step carries full code. The only "manual" step is the visual check (Tasks 6/7), which is the project's established no-render-test convention, not a placeholder.

**Type consistency:** `ViewId`, `Metrics`, `PromiseSignalInput`, `WorkItem.promise`/`followUpAt`, `ActivityEntry`, `ContactLogFields`, and the `buildWorkItems`/`applyView`/`computeMetrics`/`buildDashboardData` signatures are defined once in Task 2/3/5 and consumed with the same names/arity in Tasks 4–7. The action's insert keys (`promised_amount`, `promised_date`, `follow_up_at`) match the migration columns (Task 1) and the loader's `ContactLogRow` select (Task 5).

**One known coupling to verify at execution:** `DetailPanel` imports `ActivityEntry` from `~/routes/dashboard`. Importing a type from a route module into a client component is safe (type-only import, erased at build) — but if the bundler ever complains, move `ActivityEntry` into `app/lib/worklist.ts` (pure) and import from there. Flag to the implementer of Task 6.
