# Promises Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a promise pipeline/ledger tab that surfaces the existing Phase 6b promise data cross-customer, with lifecycle status tabs, a KPI strip, and a `?promiseId=` quick-view panel that deep-links into Collections/Accounts.

**Architecture:** Mirrors the Phase 11 Accounts tab exactly — a pure, fully-tested deriver (`app/lib/promise-ledger.ts`), one RLS-scoped loader (`app/routes/promises.tsx`) reusing the dashboard/accounts prelude, and three presentational components reusing the Phase 10 warm design system. Read-only: no new write routes, no migration; all action deep-links to existing surfaces.

**Tech Stack:** React Router v7 (framework mode), TypeScript, Supabase (RLS via user client), Tailwind v4 (`@theme` tokens), Vitest, Cloudflare Workers build.

## Global Constraints

- Pure libs (`app/lib/*.ts` without `.server`) have **no I/O, no `node:*`, no `.server` imports** — safe in client + server bundles. Tailwind v4 needs **literal class strings** (status→class maps live in components, not the pure lib).
- Loader prelude is **copied verbatim** from `app/routes/accounts.tsx` (`requireUser` → `resolveOrg` → org name → initials → `getConnectionStatus` via service client → **redirect to `/settings` when not connected** → sync label → `isOwner`).
- All tenant data reads use the **user client** (`supabase`) with an explicit `.eq("org_id", org.org_id)`; the **service client** is used only for connection status + `listOrgMembers`.
- Numeric coercion at the loader boundary: `Number(x) || 0` for amounts.
- Date-only columns (`promised_date`, `grace_until`) are `YYYY-MM-DD` strings; compare them as strings (lexicographic = chronological) and render via `formatDate` from `app/lib/dates.ts`. `today = new Date().toISOString().slice(0, 10)`.
- "Due soon" window = **`DUE_SOON_BUSINESS_DAYS = 3`** business days, computed with `addBusinessDays` honoring the org working-day/holiday calendar from `loadOrgConfig`.
- Promise DB `status` is **never mutated** by this tab — buckets are read-time derivations.
- Conventional Commits. Run `npx vitest run`, `npx tsc -p tsconfig.json --noEmit`, and `npm run build` green before declaring a task done.

---

### Task 1: Pure deriver `app/lib/promise-ledger.ts` (TDD)

**Files:**
- Create: `app/lib/promise-ledger.ts`
- Test: `tests/promise-ledger.test.ts`

**Interfaces:**
- Consumes: `addBusinessDays`, `DEFAULT_WORKING_DAYS`, `NO_HOLIDAYS` from `app/lib/business-days.ts`.
- Produces (relied on by Tasks 2 & 3):
  - Types `PromiseDbStatus`, `PromiseTab`, `PromiseSort`, `PromiseLinkedInvoice`, `PromiseInput`, `PromiseRow`, `PromiseMetrics`.
  - Const `DUE_SOON_BUSINESS_DAYS`, `PROMISE_TABS: PromiseTab[]`, `PROMISE_SORTS: PromiseSort[]`.
  - Fns `buildPromiseRows(promises, today, ownerLabels)`, `isDueSoon(row, today, config?)`, `applyPromiseTab(rows, tab, today, config?)`, `sortPromiseRows(rows, sort)`, `computePromiseMetrics(rows, today, config?)`.

- [ ] **Step 1: Write the failing test**

Create `tests/promise-ledger.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  buildPromiseRows, isDueSoon, applyPromiseTab, sortPromiseRows, computePromiseMetrics,
  PROMISE_TABS, PROMISE_SORTS, type PromiseInput,
} from "../app/lib/promise-ledger";

const TODAY = "2026-06-22"; // Monday; addBusinessDays(+3) = Thu 2026-06-25

// p1 due-soon (06-24, within window), p2 active-not-due-soon (07-10),
// p3 due-soon + awaiting-evaluation (past grace), p4 broken, p5 kept,
// p6 partially_kept, p7 renegotiated, p8 cancelled.
const PROMISES: PromiseInput[] = [
  { promiseId: "p1", caseId: "k1", customerId: "c1", customerName: "Acme",   ownerId: "u1", status: "pending",        promisedAmount: 500,  amountReceived: 0,   baselineBalance: 500,  promisedDate: "2026-06-24", graceUntil: "2026-06-26", createdAt: "2026-06-20T00:00:00Z" },
  { promiseId: "p2", caseId: "k2", customerId: "c2", customerName: "Globex", ownerId: null, status: "pending",        promisedAmount: 1000, amountReceived: 0,   baselineBalance: 1000, promisedDate: "2026-07-10", graceUntil: "2026-07-12", createdAt: "2026-06-20T00:00:00Z" },
  { promiseId: "p3", caseId: "k3", customerId: "c3", customerName: "Initech",ownerId: "u1", status: "pending",        promisedAmount: 300,  amountReceived: 0,   baselineBalance: 300,  promisedDate: "2026-06-10", graceUntil: "2026-06-12", createdAt: "2026-06-05T00:00:00Z" },
  { promiseId: "p4", caseId: "k4", customerId: "c4", customerName: "Umbrella",ownerId: "u1",status: "broken",         promisedAmount: 800,  amountReceived: 200, baselineBalance: 800,  promisedDate: "2026-05-01", graceUntil: "2026-05-05", createdAt: "2026-04-28T00:00:00Z" },
  { promiseId: "p5", caseId: "k5", customerId: "c5", customerName: "Stark",  ownerId: "u1", status: "kept",           promisedAmount: 400,  amountReceived: 400, baselineBalance: 400,  promisedDate: "2026-05-10", graceUntil: "2026-05-14", createdAt: "2026-05-08T00:00:00Z" },
  { promiseId: "p6", caseId: "k6", customerId: "c6", customerName: "Wayne",  ownerId: "u1", status: "partially_kept", promisedAmount: 600,  amountReceived: 250, baselineBalance: 600,  promisedDate: "2026-05-12", graceUntil: "2026-05-16", createdAt: "2026-05-10T00:00:00Z" },
  { promiseId: "p7", caseId: "k7", customerId: "c7", customerName: "Cyberdyne",ownerId:"u1",status: "renegotiated",   promisedAmount: 700,  amountReceived: 0,   baselineBalance: 700,  promisedDate: "2026-06-01", graceUntil: "2026-06-03", createdAt: "2026-05-28T00:00:00Z" },
  { promiseId: "p8", caseId: "k8", customerId: "c8", customerName: "Soylent",ownerId: "u1", status: "cancelled",      promisedAmount: 900,  amountReceived: 0,   baselineBalance: 900,  promisedDate: "2026-06-02", graceUntil: "2026-06-04", createdAt: "2026-05-29T00:00:00Z" },
];
const LABELS = new Map([["u1", "diskin"]]);

test("frozen constants list every tab and sort", () => {
  expect(PROMISE_TABS).toEqual(["active", "due-soon", "broken", "kept", "all"]);
  expect(PROMISE_SORTS).toEqual(["due-date", "amount", "customer"]);
});

test("buildPromiseRows resolves owner label, outstanding, superseded, awaitingEvaluation", () => {
  const rows = buildPromiseRows(PROMISES, TODAY, LABELS);
  const byId = new Map(rows.map((r) => [r.promiseId, r]));
  expect(byId.get("p2")!.owner).toBe("Unassigned");     // null owner
  expect(byId.get("p1")!.owner).toBe("diskin");
  expect(byId.get("p4")!.outstanding).toBe(600);         // 800 - 200
  expect(byId.get("p5")!.outstanding).toBe(0);           // received >= promised
  expect(byId.get("p7")!.superseded).toBe(true);         // renegotiated
  expect(byId.get("p8")!.superseded).toBe(true);         // cancelled
  expect(byId.get("p1")!.superseded).toBe(false);
  expect(byId.get("p3")!.awaitingEvaluation).toBe(true); // pending, today > grace
  expect(byId.get("p1")!.awaitingEvaluation).toBe(false);// pending, today <= grace
  expect(byId.get("p4")!.awaitingEvaluation).toBe(false);// not pending
});

test("isDueSoon: pending within 3 business days or already past; never for resolved", () => {
  const rows = buildPromiseRows(PROMISES, TODAY, LABELS);
  const byId = new Map(rows.map((r) => [r.promiseId, r]));
  expect(isDueSoon(byId.get("p1")!, TODAY)).toBe(true);  // 06-24 <= 06-25 threshold
  expect(isDueSoon(byId.get("p3")!, TODAY)).toBe(true);  // past due, still pending
  expect(isDueSoon(byId.get("p2")!, TODAY)).toBe(false); // 07-10 far future
  expect(isDueSoon(byId.get("p4")!, TODAY)).toBe(false); // broken, not pending
});

test("applyPromiseTab partitions by lifecycle", () => {
  const rows = buildPromiseRows(PROMISES, TODAY, LABELS);
  const ids = (tab: any) => applyPromiseTab(rows, tab, TODAY).map((r) => r.promiseId).sort();
  expect(ids("active")).toEqual(["p1", "p2", "p3"]);
  expect(ids("due-soon")).toEqual(["p1", "p3"]);
  expect(ids("broken")).toEqual(["p4"]);
  expect(ids("kept")).toEqual(["p5", "p6"]);          // kept + partially_kept
  expect(applyPromiseTab(rows, "all", TODAY).length).toBe(8);
});

test("sortPromiseRows: due-date asc, amount desc, customer asc", () => {
  const rows = buildPromiseRows(PROMISES, TODAY, LABELS);
  expect(sortPromiseRows(rows, "due-date").map((r) => r.promiseId)[0]).toBe("p4"); // 2026-05-01 earliest
  expect(sortPromiseRows(rows, "amount").map((r) => r.promiseId)[0]).toBe("p2");   // 1000 highest
  expect(sortPromiseRows(rows, "customer").map((r) => r.customerName)[0]).toBe("Acme");
});

test("computePromiseMetrics: counts, dollars, and null-safe strict kept rate", () => {
  const rows = buildPromiseRows(PROMISES, TODAY, LABELS);
  const m = computePromiseMetrics(rows, TODAY);
  expect(m.activeCount).toBe(3);
  expect(m.activeAmount).toBe(1800);        // 500 + 1000 + 300
  expect(m.dueSoonCount).toBe(2);
  expect(m.dueSoonAmount).toBe(800);        // 500 + 300
  expect(m.brokenCount).toBe(1);
  expect(m.brokenOutstanding).toBe(600);
  expect(m.keptRate).toBeCloseTo(1 / 3);    // kept(1) / (kept1 + partial1 + broken1)
});

test("computePromiseMetrics: kept rate is null when nothing is resolved", () => {
  const onlyPending = buildPromiseRows(PROMISES.filter((p) => p.status === "pending"), TODAY, LABELS);
  expect(computePromiseMetrics(onlyPending, TODAY).keptRate).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/promise-ledger.test.ts`
Expected: FAIL — cannot resolve `../app/lib/promise-ledger` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `app/lib/promise-ledger.ts`:

```ts
// app/lib/promise-ledger.ts
// Pure derived-intelligence for the Promises tab (promise pipeline/ledger). No
// I/O, no node:*, no .server — imported by the route loader, the ledger/panel
// components (type-only), and tests. Mirrors app/lib/accounts.ts in shape.

import { addBusinessDays, DEFAULT_WORKING_DAYS, NO_HOLIDAYS } from "./business-days";

export type PromiseDbStatus =
  | "pending" | "kept" | "partially_kept" | "broken" | "renegotiated" | "cancelled";

// How many business days ahead still counts a pending promise as "due soon".
export const DUE_SOON_BUSINESS_DAYS = 3;

export type PromiseTab = "active" | "due-soon" | "broken" | "kept" | "all";
export const PROMISE_TABS: PromiseTab[] = ["active", "due-soon", "broken", "kept", "all"];

export type PromiseSort = "due-date" | "amount" | "customer";
export const PROMISE_SORTS: PromiseSort[] = ["due-date", "amount", "customer"];

export type PromiseLinkedInvoice = { invoiceId: string; docNumber: string | null; balance: number };

// One promise as the loader hands it to the deriver (org-scoped, numeric-coerced).
export type PromiseInput = {
  promiseId: string;
  caseId: string;
  customerId: string;
  customerName: string;
  ownerId: string | null;
  status: PromiseDbStatus;
  promisedAmount: number;
  amountReceived: number;
  baselineBalance: number;
  promisedDate: string; // YYYY-MM-DD
  graceUntil: string;   // YYYY-MM-DD
  createdAt: string;    // ISO timestamp
};

export type PromiseRow = PromiseInput & {
  owner: string;
  outstanding: number;         // max(0, promised - received)
  superseded: boolean;         // renegotiated | cancelled
  awaitingEvaluation: boolean; // pending but today > graceUntil (sync lag)
};

type DayConfig = { workingDays?: ReadonlySet<number>; holidays?: ReadonlySet<string> };

export function buildPromiseRows(
  promises: PromiseInput[],
  today: string,
  ownerLabels: Map<string, string>,
): PromiseRow[] {
  return promises.map((p) => ({
    ...p,
    owner: p.ownerId ? (ownerLabels.get(p.ownerId) ?? "Unknown") : "Unassigned",
    outstanding: Math.max(0, p.promisedAmount - p.amountReceived),
    superseded: p.status === "renegotiated" || p.status === "cancelled",
    awaitingEvaluation: p.status === "pending" && today > p.graceUntil,
  }));
}

// A pending promise is "due soon" when its promised date falls within
// DUE_SOON_BUSINESS_DAYS business days of today — which also captures any
// promised date already in the past (proactive + overdue watch list).
export function isDueSoon(row: PromiseRow, today: string, config: DayConfig = {}): boolean {
  if (row.status !== "pending") return false;
  const threshold = addBusinessDays(today, DUE_SOON_BUSINESS_DAYS, {
    workingDays: config.workingDays ?? DEFAULT_WORKING_DAYS,
    holidays: config.holidays ?? NO_HOLIDAYS,
  });
  return row.promisedDate <= threshold;
}

export function applyPromiseTab(
  rows: PromiseRow[], tab: PromiseTab, today: string, config: DayConfig = {},
): PromiseRow[] {
  if (tab === "active") return rows.filter((r) => r.status === "pending");
  if (tab === "due-soon") return rows.filter((r) => isDueSoon(r, today, config));
  if (tab === "broken") return rows.filter((r) => r.status === "broken");
  if (tab === "kept") return rows.filter((r) => r.status === "kept" || r.status === "partially_kept");
  return rows; // "all"
}

export function sortPromiseRows(rows: PromiseRow[], sort: PromiseSort): PromiseRow[] {
  const copy = [...rows];
  if (sort === "amount") {
    return copy.sort((a, b) => b.promisedAmount - a.promisedAmount || a.customerName.localeCompare(b.customerName));
  }
  if (sort === "customer") {
    return copy.sort((a, b) => a.customerName.localeCompare(b.customerName));
  }
  // due-date: soonest promised date first; ties broken by customer name.
  return copy.sort((a, b) =>
    a.promisedDate === b.promisedDate
      ? a.customerName.localeCompare(b.customerName)
      : a.promisedDate.localeCompare(b.promisedDate),
  );
}

export type PromiseMetrics = {
  activeCount: number; activeAmount: number;
  dueSoonCount: number; dueSoonAmount: number;
  brokenCount: number; brokenOutstanding: number;
  keptRate: number | null; // strict: kept / (kept + partially_kept + broken); null when none resolved
};

export function computePromiseMetrics(
  rows: PromiseRow[], today: string, config: DayConfig = {},
): PromiseMetrics {
  const active = rows.filter((r) => r.status === "pending");
  const dueSoon = rows.filter((r) => isDueSoon(r, today, config));
  const broken = rows.filter((r) => r.status === "broken");
  const keptCount = rows.filter((r) => r.status === "kept").length;
  const partialCount = rows.filter((r) => r.status === "partially_kept").length;
  const resolvedDenom = keptCount + partialCount + broken.length;
  return {
    activeCount: active.length,
    activeAmount: active.reduce((s, r) => s + r.promisedAmount, 0),
    dueSoonCount: dueSoon.length,
    dueSoonAmount: dueSoon.reduce((s, r) => s + r.promisedAmount, 0),
    brokenCount: broken.length,
    brokenOutstanding: broken.reduce((s, r) => s + r.outstanding, 0),
    keptRate: resolvedDenom === 0 ? null : keptCount / resolvedDenom,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/promise-ledger.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/promise-ledger.ts tests/promise-ledger.test.ts
git commit -m "feat(promises): pure promise-ledger deriver + tests"
```

---

### Task 2: Presentational components

**Files:**
- Create: `app/components/PromisesLedger.tsx` (also exports the status label/chip maps)
- Create: `app/components/PromisesMetrics.tsx`
- Create: `app/components/PromiseQuickPanel.tsx`

**Interfaces:**
- Consumes: `PromiseRow`, `PromiseTab`, `PromiseSort`, `PromiseMetrics`, `PromiseLinkedInvoice`, `PromiseDbStatus` (Task 1); `formatUSD` (`app/lib/format.ts`), `formatDate` (`app/lib/dates.ts`), `Icon` (`app/components/Icons.tsx`).
- Produces (relied on by Task 3): `PromisesMetrics`, `PromisesLedger`, `PromiseQuickPanel` React components; `PROMISE_STATUS_LABEL`, `PROMISE_STATUS_CHIP` exported from `PromisesLedger.tsx`.

> No unit tests — these are presentational and follow the Accounts components, which shipped without component tests. Verified via `tsc` + `build` in Step 4.

- [ ] **Step 1: Create `app/components/PromisesLedger.tsx`**

```tsx
// app/components/PromisesLedger.tsx
import { Form, Link } from "react-router";
import type { PromiseRow, PromiseTab, PromiseSort, PromiseDbStatus } from "../lib/promise-ledger";
import { formatUSD } from "../lib/format";
import { formatDate } from "../lib/dates";

export const PROMISE_STATUS_LABEL: Record<PromiseDbStatus, string> = {
  pending: "Pending", kept: "Kept", partially_kept: "Partial",
  broken: "Broken", renegotiated: "Renegotiated", cancelled: "Cancelled",
};
// Literal class strings for the Tailwind v4 scanner.
export const PROMISE_STATUS_CHIP: Record<PromiseDbStatus, string> = {
  pending: "bg-copper/10 text-copper",
  kept: "bg-cool/10 text-cool",
  partially_kept: "bg-copper/10 text-copper",
  broken: "bg-warm/10 text-warm",
  renegotiated: "bg-muted/10 text-muted",
  cancelled: "bg-muted/10 text-muted",
};

const TABS: { id: PromiseTab; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "due-soon", label: "Due soon" },
  { id: "broken", label: "Broken" },
  { id: "kept", label: "Kept" },
  { id: "all", label: "All" },
];
const SORTS: { id: PromiseSort; label: string }[] = [
  { id: "due-date", label: "Due date" },
  { id: "amount", label: "Amount" },
  { id: "customer", label: "Customer (A–Z)" },
];

interface Props {
  rows: PromiseRow[];
  tab: PromiseTab;
  sort: PromiseSort;
  counts: Record<PromiseTab, number>;
  selectedId: string | null;
}

export function PromisesLedger({ rows, tab, sort, counts, selectedId }: Props) {
  const link = (promiseId: string) => `?${new URLSearchParams({ tab, sort, promiseId }).toString()}`;
  const tabHref = (id: PromiseTab) => `?${new URLSearchParams({ tab: id, sort }).toString()}`;

  return (
    <section className="flex flex-col bg-surface border border-border rounded-card overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 bg-paper border-b border-border">
        <h2 className="font-display text-sm font-semibold text-text">Promises</h2>
        <span className="text-xs text-muted">{rows.length} matching</span>
        <Form method="get" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="tab" value={tab} />
          <label className="sr-only" htmlFor="promise-sort">Sort</label>
          <select
            id="promise-sort" name="sort" defaultValue={sort}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-8 px-2 rounded border border-border bg-surface text-sm"
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Form>
      </header>

      <nav className="flex flex-wrap gap-2 px-4 py-2 border-b border-border" aria-label="Promise lifecycle filters">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <Link
              key={t.id} to={tabHref(t.id)} aria-current={active ? "page" : undefined}
              className={[
                "inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium border",
                active ? "bg-ink text-surface border-ink" : "bg-paper text-muted border-border hover:border-copper/50",
              ].join(" ")}
            >
              {t.label}
              <span className={active ? "text-surface/70" : "text-muted/70"}>{counts[t.id]}</span>
            </Link>
          );
        })}
      </nav>

      <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1.2fr_1fr] gap-3 px-4 py-2 bg-paper border-b border-border font-mono text-[10px] uppercase tracking-wide text-muted">
        <span>Customer</span><span className="text-right">Promised</span><span>Due</span><span>Received</span><span>Status</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">No promises in this view.</p>
      ) : (
        <ul role="list" className="divide-y divide-border">
          {rows.map((r) => {
            const selected = r.promiseId === selectedId;
            return (
              <li key={r.promiseId} className={selected ? "bg-copper/5" : ""}>
                <Link
                  to={link(r.promiseId)}
                  className={[
                    "relative grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1.2fr_1fr] gap-1 md:gap-3 px-4 py-3 items-center",
                    "hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset",
                    r.superseded ? "opacity-60" : "",
                  ].join(" ")}
                  aria-current={selected ? "true" : undefined}
                >
                  {selected ? <span className="absolute left-0 inset-y-0 w-0.5 bg-copper" aria-hidden="true" /> : null}
                  <span className="font-medium text-text truncate">{r.customerName}</span>
                  <span className="text-sm text-text text-right tabular-nums">{formatUSD(r.promisedAmount)}</span>
                  <span className="text-sm text-muted">
                    {formatDate(r.promisedDate)}
                    {r.awaitingEvaluation ? <span className="ml-1 text-warm" title="Past grace — awaiting next sync">⏳</span> : null}
                  </span>
                  <span className="text-sm text-muted tabular-nums">{formatUSD(r.amountReceived)} / {formatUSD(r.promisedAmount)}</span>
                  <span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PROMISE_STATUS_CHIP[r.status]}`}>
                      {PROMISE_STATUS_LABEL[r.status]}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Create `app/components/PromisesMetrics.tsx`**

```tsx
// app/components/PromisesMetrics.tsx
import { Link } from "react-router";
import type { PromiseMetrics } from "../lib/promise-ledger";
import { formatUSD } from "../lib/format";

type Accent = "ink" | "copper" | "warm" | "cool";
const ACCENT_TEXT: Record<Accent, string> = {
  ink: "text-text", copper: "text-copper", warm: "text-warm", cool: "text-cool",
};
const ACCENT_DOT: Record<Accent, string> = {
  ink: "bg-ink", copper: "bg-copper", warm: "bg-warm", cool: "bg-cool",
};

function Tile({ to, label, value, sub, accent }: { to: string; label: string; value: string; sub: string; accent: Accent }) {
  return (
    <Link
      to={to}
      className="relative flex flex-col p-4 rounded-tile overflow-hidden min-w-0 bg-paper border border-border hover:border-copper/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
    >
      <span aria-hidden="true" className={`absolute top-0 inset-x-0 h-0.5 ${ACCENT_DOT[accent]}`} />
      <span className="flex items-center gap-1.5 mb-2">
        <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${ACCENT_DOT[accent]}`} />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted truncate">{label}</span>
      </span>
      <span className="font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-text">{value}</span>
      <span className={`mt-1.5 text-xs ${ACCENT_TEXT[accent]}`}>{sub}</span>
    </Link>
  );
}

export function PromisesMetrics({ metrics }: { metrics: PromiseMetrics }) {
  const keptRateLabel = metrics.keptRate == null ? "—" : `${Math.round(metrics.keptRate * 100)}%`;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-4" aria-label="Promises summary metrics">
      <Tile to="?tab=active"   label="Active"     value={String(metrics.activeCount)}   sub={`${formatUSD(metrics.activeAmount)} promised`}   accent="copper" />
      <Tile to="?tab=due-soon" label="Due soon"   value={String(metrics.dueSoonCount)}  sub={`${formatUSD(metrics.dueSoonAmount)} promised`}  accent="ink" />
      <Tile to="?tab=broken"   label="Broken"     value={String(metrics.brokenCount)}   sub={`${formatUSD(metrics.brokenOutstanding)} outstanding`} accent="warm" />
      <Tile to="?tab=kept"     label="Kept rate"  value={keptRateLabel}                 sub="of resolved promises"                          accent="cool" />
    </div>
  );
}
```

- [ ] **Step 3: Create `app/components/PromiseQuickPanel.tsx`**

```tsx
// app/components/PromiseQuickPanel.tsx
import { Link } from "react-router";
import type { PromiseRow, PromiseLinkedInvoice } from "../lib/promise-ledger";
import { formatUSD } from "../lib/format";
import { formatDate } from "../lib/dates";
import { PROMISE_STATUS_LABEL, PROMISE_STATUS_CHIP } from "./PromisesLedger";
import { Icon } from "./Icons";

interface Props {
  promise: PromiseRow | null;
  invoices: PromiseLinkedInvoice[];
  note: string | null;
}

export function PromiseQuickPanel({ promise, invoices, note }: Props) {
  if (!promise) {
    return (
      <aside className="hidden lg:flex flex-col items-center justify-center bg-surface border border-border rounded-card p-8 text-center text-muted">
        <Icon name="check" size={28} className="mb-2 text-muted/60" />
        <p className="text-sm">Select a promise to preview it here.</p>
      </aside>
    );
  }
  return (
    <aside className="flex flex-col bg-surface border border-border rounded-card overflow-hidden">
      <header className="bg-ink text-surface px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-surface/50">Promise</p>
        <h2 className="font-display text-lg font-semibold leading-tight">{promise.customerName}</h2>
        <span className={`mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PROMISE_STATUS_CHIP[promise.status]}`}>
          {PROMISE_STATUS_LABEL[promise.status]}
        </span>
        {promise.awaitingEvaluation ? (
          <p className="mt-1.5 text-[11px] text-warm">Past grace — awaiting the next sync to settle.</p>
        ) : null}
      </header>

      <div className="grid grid-cols-2 gap-3 p-4 bg-paper border-b border-border">
        <div><p className="font-mono text-[10px] uppercase text-muted">Promised</p><p className="font-display text-lg text-text tabular-nums">{formatUSD(promise.promisedAmount)}</p></div>
        <div><p className="font-mono text-[10px] uppercase text-muted">Received</p><p className="font-display text-lg text-text tabular-nums">{formatUSD(promise.amountReceived)}</p></div>
      </div>

      <dl className="p-4 space-y-2 text-sm border-b border-border">
        <div className="flex justify-between"><dt className="text-muted">Promised date</dt><dd className="text-text">{formatDate(promise.promisedDate)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Grace until</dt><dd className="text-text">{formatDate(promise.graceUntil)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Outstanding</dt><dd className="text-text tabular-nums">{formatUSD(promise.outstanding)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Owner</dt><dd className="text-text">{promise.owner}</dd></div>
      </dl>

      <div className="p-4 border-b border-border">
        <p className="font-mono text-[10px] uppercase text-muted mb-2">Linked invoices</p>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted">No linked invoices.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {invoices.map((inv) => (
              <li key={inv.invoiceId} className="flex justify-between">
                <span className="text-text">#{inv.docNumber ?? inv.invoiceId.slice(0, 8)}</span>
                <span className="text-muted tabular-nums">{formatUSD(inv.balance)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {note ? (
        <div className="p-4 border-b border-border">
          <p className="font-mono text-[10px] uppercase text-muted mb-1">Originating note</p>
          <p className="text-sm text-text whitespace-pre-wrap">{note}</p>
        </div>
      ) : null}

      <div className="p-4 flex flex-wrap gap-2">
        <Link
          to={`/dashboard?case=${promise.caseId}`}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-copper text-surface text-sm font-medium hover:bg-copper/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          Open in Collections <Icon name="chevronRight" size={16} />
        </Link>
        <Link
          to={`/accounts/${promise.customerId}`}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded border border-border text-text text-sm font-medium hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          View account
        </Link>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Verify it typechecks and builds**

Run: `npx tsc -p tsconfig.json --noEmit && npm run build`
Expected: both succeed, 0 errors. (No route consumes the components yet — this confirms the components compile in isolation.)

- [ ] **Step 5: Commit**

```bash
git add app/components/PromisesLedger.tsx app/components/PromisesMetrics.tsx app/components/PromiseQuickPanel.tsx
git commit -m "feat(promises): ledger, metrics, and quick-view components"
```

---

### Task 3: Loader, route registration, and AppShell wiring

**Files:**
- Create: `app/routes/promises.tsx`
- Modify: `app/routes.ts` (add the route)
- Modify: `app/components/AppShell.tsx` (extend `activeNav`, section title, nav target)

**Interfaces:**
- Consumes: Task 1 deriver fns/consts/types; Task 2 components; `loadOrgConfig` (`app/lib/org-config.server.ts`); the accounts-loader prelude helpers (`getEnv`, `requireUser`, `resolveOrg`, `getConnectionStatus`, `createSupabaseServiceClient`, `listOrgMembers`).
- Produces: a live `/promises` route reachable from the side-nav.

- [ ] **Step 1: Create `app/routes/promises.tsx`**

```tsx
import { useLoaderData, redirect, data, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { listOrgMembers } from "../lib/orgs.server";
import { loadOrgConfig } from "../lib/org-config.server";
import {
  buildPromiseRows,
  applyPromiseTab,
  sortPromiseRows,
  computePromiseMetrics,
  PROMISE_TABS,
  PROMISE_SORTS,
  type PromiseTab,
  type PromiseSort,
  type PromiseInput,
  type PromiseLinkedInvoice,
} from "../lib/promise-ledger";
import { AppShell } from "../components/AppShell";
import { PromisesMetrics } from "../components/PromisesMetrics";
import { PromisesLedger } from "../components/PromisesLedger";
import { PromiseQuickPanel } from "../components/PromiseQuickPanel";

export async function loader({ request, context }: LoaderFunctionArgs) {
  // --- Prelude: mirrors accounts.tsx / dashboard.tsx exactly ---
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const { data: orgRow } = await supabase
    .from("organizations").select("name").eq("id", org.org_id).single();

  const emailParts = (user.email ?? "").split("@")[0].split(/[.\-_]/);
  const initials =
    emailParts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";

  const service = createSupabaseServiceClient(env);
  const conn = await getConnectionStatus(service, org.org_id);
  const connected = conn?.status === "connected";
  if (!connected) throw redirect("/settings", { headers });

  const { data: connMeta } = await service
    .from("qbo_connections").select("last_sync_at").eq("org_id", org.org_id).maybeSingle();
  const lastSyncAt = (connMeta?.last_sync_at as string | null) ?? null;
  let syncLabel: string;
  if (lastSyncAt) {
    const diffMs = Date.now() - new Date(lastSyncAt).getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    if (diffMin < 2) syncLabel = "Synced just now";
    else if (diffMin < 60) syncLabel = `Synced ${diffMin}m ago`;
    else if (diffHr < 24) syncLabel = `Synced ${diffHr}h ago`;
    else syncLabel = `Synced ${diffDay}d ago`;
  } else {
    syncLabel = "Connected";
  }
  const isOwner = org.role === "owner";

  // --- URL params ---
  const url = new URL(request.url);
  const sp = url.searchParams;
  const tab: PromiseTab = (PROMISE_TABS as string[]).includes(sp.get("tab") ?? "")
    ? (sp.get("tab") as PromiseTab)
    : "due-soon";
  const sort: PromiseSort = (PROMISE_SORTS as string[]).includes(sp.get("sort") ?? "")
    ? (sp.get("sort") as PromiseSort)
    : "due-date";
  const promiseId = sp.get("promiseId");

  const today = new Date().toISOString().slice(0, 10);

  // --- Org config for the due-soon business-day window ---
  const config = await loadOrgConfig(supabase, org.org_id);

  // --- Data loading (USER client, explicit org_id scope) ---
  const { data: promiseRows } = await supabase
    .from("promises")
    .select("id, case_id, customer_id, status, promised_amount, amount_received, baseline_balance, promised_date, grace_until, created_at, contact_log_id")
    .eq("org_id", org.org_id);
  const rawPromises = (promiseRows as any[]) ?? [];

  const { data: custRows } = await supabase
    .from("customers").select("id, name, owner").eq("org_id", org.org_id);
  const custById = new Map(((custRows as any[]) ?? []).map((c) => [c.id, c]));

  const promisesInput: PromiseInput[] = rawPromises.map((r) => {
    const c = custById.get(r.customer_id);
    return {
      promiseId: r.id,
      caseId: r.case_id,
      customerId: r.customer_id,
      customerName: c?.name ?? "(unknown customer)",
      ownerId: c?.owner ?? null,
      status: r.status,
      promisedAmount: Number(r.promised_amount) || 0,
      amountReceived: Number(r.amount_received) || 0,
      baselineBalance: Number(r.baseline_balance) || 0,
      promisedDate: r.promised_date,
      graceUntil: r.grace_until,
      createdAt: r.created_at,
    };
  });

  const roster = await listOrgMembers(service, org.org_id);
  const ownerLabels = new Map(roster.map((m) => [m.userId, m.label]));

  const allRows = buildPromiseRows(promisesInput, today, ownerLabels);
  const metrics = computePromiseMetrics(allRows, today, config);
  const counts = Object.fromEntries(
    PROMISE_TABS.map((t) => [t, applyPromiseTab(allRows, t, today, config).length]),
  ) as Record<PromiseTab, number>;
  const rows = sortPromiseRows(applyPromiseTab(allRows, tab, today, config), sort);

  // --- Selected promise: linked invoices + originating note ---
  const selected = promiseId ? (allRows.find((r) => r.promiseId === promiseId) ?? null) : null;
  let selectedInvoices: PromiseLinkedInvoice[] = [];
  let selectedNote: string | null = null;
  if (selected) {
    const { data: piRows } = await supabase
      .from("promise_invoices")
      .select("invoice_id")
      .eq("org_id", org.org_id)
      .eq("promise_id", selected.promiseId);
    const invIds = ((piRows as any[]) ?? []).map((r) => r.invoice_id as string);
    let invById = new Map<string, any>();
    if (invIds.length > 0) {
      const { data: invRows } = await supabase
        .from("invoices")
        .select("id, qbo_doc_number, balance")
        .eq("org_id", org.org_id)
        .in("id", invIds);
      invById = new Map(((invRows as any[]) ?? []).map((r) => [r.id, r]));
    }
    selectedInvoices = invIds.map((id) => ({
      invoiceId: id,
      docNumber: invById.get(id)?.qbo_doc_number ?? null,
      balance: Number(invById.get(id)?.balance ?? 0),
    }));

    const contactLogId = rawPromises.find((r) => r.id === selected.promiseId)?.contact_log_id ?? null;
    if (contactLogId) {
      const { data: log } = await supabase
        .from("contact_logs").select("notes").eq("org_id", org.org_id).eq("id", contactLogId).maybeSingle();
      selectedNote = (log as any)?.notes ?? null;
    }
  }

  return data(
    {
      orgName: orgRow?.name ?? "(unknown)",
      initials, syncLabel, connected, isOwner,
      rows, metrics, counts, tab, sort,
      selected, selectedInvoices, selectedNote,
    },
    { headers },
  );
}

export default function Promises() {
  const d = useLoaderData<typeof loader>();
  return (
    <AppShell
      orgName={d.orgName}
      userInitials={d.initials}
      syncLabel={d.syncLabel}
      connected={d.connected}
      isOwner={d.isOwner}
      activeNav="promises"
    >
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <PromisesMetrics metrics={d.metrics} />
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <PromisesLedger
            rows={d.rows}
            tab={d.tab}
            sort={d.sort}
            counts={d.counts}
            selectedId={d.selected?.promiseId ?? null}
          />
          <PromiseQuickPanel
            promise={d.selected}
            invoices={d.selectedInvoices}
            note={d.selectedNote}
          />
        </div>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 2: Register the route in `app/routes.ts`**

Add this line immediately after the `accounts/:id` route (line 13):

```ts
  route("promises", "routes/promises.tsx"),
```

- [ ] **Step 3: Wire the nav in `app/components/AppShell.tsx`**

Change 3a — extend the `activeNav` union (the `AppShellProps` interface):

```ts
  /** Which primary section is active (drives the nav rail + topbar title). */
  activeNav?: "collections" | "accounts" | "promises";
```

Change 3b — replace the `sectionTitle` + `NAV_TARGETS` lines inside the component body:

```ts
  const SECTION_TITLES: Record<string, string> = {
    collections: "Collections", accounts: "Accounts", promises: "Promises",
  };
  const sectionTitle = SECTION_TITLES[activeNav] ?? "Collections";
  const NAV_TARGETS: Record<string, string> = {
    collections: "/dashboard", accounts: "/accounts", promises: "/promises",
  };
```

(`promises` is already present in `NAV_ITEMS` at line 30, so adding it to `NAV_TARGETS` automatically promotes it from the inert branch to a live nav link — no other change needed.)

- [ ] **Step 4: Verify typecheck, build, and full test suite**

Run: `npx tsc -p tsconfig.json --noEmit && npx vitest run && npm run build`
Expected: tsc 0 errors; all vitest tests pass (the prior count + 7 new from Task 1); build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/routes/promises.tsx app/routes.ts app/components/AppShell.tsx
git commit -m "feat(promises): /promises loader, route, and live nav wiring"
```

---

### Task 4: Manual verification + record Phase 12 in the gap checklist

**Files:**
- Modify: `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` (add a Phase 12 section)

- [ ] **Step 1: Manual smoke test (local)**

Run the app (`npm run dev` per the project's run convention) and, signed in as a seeded connected org:
- Visit `/promises` → redirects to `/settings` if the org is not QBO-connected (connect-gate parity with `/accounts`); otherwise renders.
- Confirm: KPI strip shows Active/Due soon/Broken/Kept-rate; default tab is **Due soon**; each pill shows a count; clicking a row opens the quick panel with `?promiseId=` in the URL; "Open in Collections" lands on the case in `/dashboard`; "View account" lands on `/accounts/:id`; the side-nav "Promises" item is now active (copper rail) rather than greyed out.
- Note any visual issues; fix inline if trivial, otherwise record under the checklist entry.

> If no connected seed org is available, record the same deferral the Accounts tab used: "Visual fidelity pass deferred to a manual local run (seed + connected/synced org)." The automated gates (Step in Task 3) remain the merge gate.

- [ ] **Step 2: Add the Phase 12 entry to the gap checklist**

Insert a new section after the Phase 11 "I." section:

```markdown
## J. Promises tab — Phase 12 (promise pipeline / ledger)

- [x] **J1 — Promises tab built: cross-customer promise ledger + quick-view.** ✅ **Phase 12.** Activates the previously-inert `promises` side-nav item with a promise-centric lens over the existing Phase 6b data. Pure `app/lib/promise-ledger.ts` (`buildPromiseRows`/`isDueSoon`/`applyPromiseTab`(active/due-soon/broken/kept/all)/`sortPromiseRows`/`computePromiseMetrics`, frozen `PROMISE_TABS`/`PROMISE_SORTS`) feeds one RLS-scoped loader `/promises` reusing the accounts prelude (connect-gate → `/settings`). Lifecycle status pill tabs + heat-rail visual language, KPI strip (Active/Due soon/Broken counts + $, strict null-safe kept rate), `?promiseId=` quick-view panel (linked invoices, originating note, "Open in Collections" `/dashboard?case=` + "View account" deep-links). Read-only — **no new write routes, no migration**; the grace-lag subtlety handled by a read-time display bucket (`awaitingEvaluation` marker for pending-past-grace; DB status never mutated). "Due soon" = 3 business days via `addBusinessDays` honoring org working-days/holidays. vitest +7, tsc 0, build clean. Promise-table RLS already covered by `promise-evaluation-rls.test.ts` (same `promises_all` policy) — no redundant RLS test added.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md
git commit -m "docs: record Phase 12 Promises tab in gap checklist"
```

---

## Self-Review

**Spec coverage:**
- §1 Purpose (surface existing data, activate inert nav, no new write routes) → Tasks 1–3. ✓
- §2 Architecture (pure deriver / one loader / three components / route + shell wiring) → Tasks 1, 2, 3. ✓
- §3 Data model + grace-lag display bucket + `awaitingEvaluation` + 3-business-day window → Task 1 (`isDueSoon`, `awaitingEvaluation`) + Task 3 (passes `loadOrgConfig`). ✓
- §4 Layout (KPI strip w/ counts+$+kept-rate, default Due soon, pill tabs, row anatomy, quick panel w/ linked invoices + note + deep-links) → Task 2 components + Task 3 loader. ✓
- §5 Error handling (connect-gate, empty states), testing (pure deriver tests), scope (deep-link only) → Task 3 prelude, Task 2 empty states, Task 1 tests. ✓
- §6 Locked decisions (read+deep-link, lifecycle tabs, quick panel, KPI+$, default Due soon, N=3, partial under Kept, default sort due-date) → all reflected. ✓

**Spec deviation (deliberate, noted in Task 4):** the spec suggested "a loader/RLS test mirroring the accounts loader test." The Accounts tab actually shipped with **no** loader/RLS test, and the `promises` table's `promises_all` (`is_org_member`) policy is already exercised by `tests/promise-evaluation-rls.test.ts`. Adding a redundant RLS test would duplicate existing coverage, so this plan does not — matching the established precedent. Verification rigor is preserved via full `tsc` + `vitest` + `build` gates.

**Placeholder scan:** none — every step contains literal code/commands.

**Type consistency:** `PromiseTab`/`PromiseSort`/`PromiseRow`/`PromiseInput`/`PromiseLinkedInvoice`/`PromiseMetrics` and `PROMISE_TABS`/`PROMISE_SORTS`/`PROMISE_STATUS_CHIP`/`PROMISE_STATUS_LABEL` are defined in Task 1/Task 2 and consumed with identical names/signatures in Tasks 2–3. Loader return shape (`rows`, `metrics`, `counts`, `tab`, `sort`, `selected`, `selectedInvoices`, `selectedNote`) matches the `Promises()` component's `useLoaderData` usage and each component's props.
