# Phase 11 — Accounts Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Accounts tab — a customer directory (all customers) with a quick-view side panel and a full 360° profile page that edits org-owned fields plus local account notes.

**Architecture:** A new pure lib `app/lib/accounts.ts` (customer-centric, mirroring `cases.ts`/`worklist.ts`) feeds two thin RLS-scoped route loaders (`/accounts` list, `/accounts/:id` profile) that render new presentational components reusing the Phase 10 warm-parchment design system. Editing reuses `api.assign` + `api.comm-prefs` (the latter gains a `customerId` branch) and a new `api.account-notes` route backed by additive `customers` columns.

**Tech Stack:** React Router v7 (framework mode, manual route table), TypeScript, Tailwind v4 (`@theme` tokens in `app/app.css`), Supabase (Postgres + RLS), Vitest (Node environment — **no jsdom, no `.tsx` render tests**), local Supabase CLI.

## Global Constraints

- **Pure libs only in `app/lib/*.ts` (no `.server`):** no I/O, no `node:*`, no secrets — they import into client bundle, server, and tests. `accounts.ts` must stay pure (`worklist.ts`/`cases.ts` are the reference).
- **Tailwind v4 scanner needs literal class strings.** No `text-${tone}` interpolation — use static `Record` maps of literal classes (see `WorkQueue.tsx` `CHIP`/`HEAT_BAR`, `MetricsStrip.tsx` `ACCENT_TEXT`).
- **Design tokens are the single source of palette truth** (`app/app.css` `@theme`): `bg-panel`, `bg-surface`, `bg-paper`, `bg-ink`, `text-text`, `text-muted`, `border-border`, `text-copper`/`bg-copper`, `text-cool`, `text-hot`, `bg-warm`, `rounded-tile`/`rounded-card`, `shadow-tile`/`shadow-panel`. Fonts: `font-display` (Space Grotesk), `font-sans` (IBM Plex Sans), `font-mono` (IBM Plex Mono).
- **QBO owns `name`/`email`/`phone`** (`mapQboCustomer` overwrites them every sync) → render read-only with a "from QuickBooks" note. **Never** add a local write path for them.
- **`sms_consent` is the legal record** — read-only here; STOP/START is its only mutator.
- **Every `api.*`/`webhooks.*`/`auth.*` route file MUST be registered in `app/routes.ts`** or it 404s silently — enforced by `tests/routes-registration.test.ts`.
- **Security pattern for write routes:** `requireUser` → `resolveOrg` → explicit `.eq("org_id", org.org_id)` bind on the customer read AND the update (RLS alone permits every org the caller belongs to). Throw on write error (never silent-redirect a failed write). See `api.assign.tsx`.
- **Customer-level org-owned columns are sync-safe** (`owner`, `preferred_channel`, `do_not_call`, `do_not_text`, and the new `notes*`) — the QBO upsert column set is only `name/email/phone/qbo_id/org_id`, so sync never clobbers them.
- **Verification commands** (run from `nudgepay-app/`):
  - Typecheck: `npx react-router typegen && npx tsc -b` → exit 0
  - Tests: `npx vitest run` → green
  - Build: `npx react-router build` → clean
  - Apply a new migration locally: `npx supabase db reset` (re-applies `supabase/migrations/*` in order; the vitest `globalSetup` only cleans data, it does not run migrations).
- **Commit style:** Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`).
- **Out of scope (do not build):** editing QBO fields; SMS/log/promise action surfaces on Accounts; bulk ops on the directory; any change to Collections/`cases.ts`/`worklist.ts`/`priority.ts`/sync.

---

## File Structure

**Phase 11a — directory:**
- Create `app/lib/accounts.ts` — pure: `AccountRow`/`AccountStanding`/`AccountMetrics` types, `buildAccountRows`, `deriveStanding`, `applyAccountFilter`, `sortAccountRows`, `computeAccountMetrics`.
- Create `tests/accounts.test.ts` — pure-lib unit tests.
- Modify `app/components/AppShell.tsx` — activate the Accounts nav item; make the active item route-derived via a new `activeNav` prop; derive the topbar section title.
- Create `app/components/AccountsMetrics.tsx` — KPI strip (accounts metrics).
- Create `app/components/AccountsDirectory.tsx` — toolbar + list + mobile cards.
- Create `app/components/AccountQuickPanel.tsx` — condensed side panel.
- Create `app/routes/accounts.tsx` — `/accounts` loader + page.
- Modify `app/routes.ts` — register `accounts` and (11b) `accounts/:id` + `api/account-notes`.
- Modify `app/routes/dashboard.tsx` — pass `activeNav="collections"` to `AppShell` (explicit; behavior unchanged).

**Phase 11b — profile + editing:**
- Create `supabase/migrations/0019_account_notes.sql` — additive `customers.notes`/`notes_updated_at`/`notes_updated_by`.
- Create `tests/account-notes-schema.test.ts` — column existence/writability.
- Modify `app/routes/api.comm-prefs.tsx` — add a bare-`customerId` resolution branch.
- Modify `tests/api-comm-prefs.test.ts` — cover the `customerId` branch.
- Create `app/routes/api.account-notes.tsx` — write `notes`.
- Create `tests/api-account-notes.test.ts` — RLS/org-scope.
- Create `app/components/AccountProfile.tsx` — full 360 profile.
- Create `app/routes/accounts.$id.tsx` — `/accounts/:id` loader + page.

---

# Phase 11a — Directory

## Task 1: `accounts.ts` — types, `deriveStanding`, `buildAccountRows`

**Files:**
- Create: `app/lib/accounts.ts`
- Test: `tests/accounts.test.ts`

**Interfaces:**
- Consumes: `CustomerInput`, `InvoiceInput`, `ageInDays`, `LastContact` from `app/lib/worklist`; `CommPrefs`, `DEFAULT_COMM_PREFS` from `app/lib/comm-prefs`.
- Produces:
  - `type AccountStanding = "current" | "overdue" | "in_collections" | "on_hold"`
  - `type AccountCaseInput = { customerId: string; onHold: boolean }` (presence = has an active/open case)
  - `type AccountLastContactInput = { customerId: string; date: string; channel: string }`
  - `type AccountRow = { customerId; name; ownerId; owner; email; phone; openBalance; openInvoiceCount; oldestOverdueDays; hasActiveCase; onHold; standing; commPrefs; smsConsent; lastContact; searchText }`
  - `deriveStanding(input: { openBalance: number; hasActiveCase: boolean; onHold: boolean }): AccountStanding`
  - `buildAccountRows(customers, invoices, cases, lastContacts, today, ownerLabels): AccountRow[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/accounts.test.ts
import { expect, test } from "vitest";
import {
  deriveStanding, buildAccountRows,
  type AccountCaseInput, type AccountLastContactInput,
} from "../app/lib/accounts";
import type { CustomerInput, InvoiceInput } from "../app/lib/worklist";

const TODAY = "2026-06-22";

test("deriveStanding: no open balance is current (even with a stale case)", () => {
  expect(deriveStanding({ openBalance: 0, hasActiveCase: true, onHold: false })).toBe("current");
});
test("deriveStanding: on-hold wins over everything", () => {
  expect(deriveStanding({ openBalance: 500, hasActiveCase: true, onHold: true })).toBe("on_hold");
});
test("deriveStanding: open balance + active case is in_collections", () => {
  expect(deriveStanding({ openBalance: 500, hasActiveCase: true, onHold: false })).toBe("in_collections");
});
test("deriveStanding: open balance + no case is overdue", () => {
  expect(deriveStanding({ openBalance: 500, hasActiveCase: false, onHold: false })).toBe("overdue");
});

const CUSTOMERS: CustomerInput[] = [
  { id: "c1", name: "Acme", phone: "+13105550101", email: "ap@acme.test", owner: "u1", smsConsent: true },
  { id: "c2", name: "Globex", phone: null, email: null, owner: null, smsConsent: false },
  { id: "c3", name: "Initech", phone: null, email: null, owner: "u1", smsConsent: false }, // paid-up, no invoices
];
const INVOICES: InvoiceInput[] = [
  { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 6000, due_date: "2026-03-01" }, // overdue 113d
  { id: "i2", qbo_doc_number: "1002", customer_id: "c1", balance: 300,  due_date: "2026-09-01" }, // open, not due
  { id: "i3", qbo_doc_number: "2001", customer_id: "c2", balance: 800,  due_date: "2026-05-01" }, // overdue 52d
];
const CASES: AccountCaseInput[] = [{ customerId: "c1", onHold: false }];
const LCS: AccountLastContactInput[] = [
  { customerId: "c1", date: "2026-06-10", channel: "Call" },
  { customerId: "c1", date: "2026-06-18", channel: "Text" }, // newer wins
];
const LABELS = new Map([["u1", "diskin"]]);

test("buildAccountRows aggregates balance, open count, oldest overdue, owner, last contact, standing", () => {
  const rows = buildAccountRows(CUSTOMERS, INVOICES, CASES, LCS, TODAY, LABELS);
  const acme = rows.find((r) => r.customerId === "c1")!;
  expect(acme.openBalance).toBe(6300);
  expect(acme.openInvoiceCount).toBe(2);
  expect(acme.oldestOverdueDays).toBe(113); // only the overdue invoice counts toward age
  expect(acme.owner).toBe("diskin");
  expect(acme.hasActiveCase).toBe(true);
  expect(acme.standing).toBe("in_collections");
  expect(acme.lastContact).toEqual({ date: "2026-06-18", channel: "Text" });
  expect(acme.searchText).toContain("acme");

  const globex = rows.find((r) => r.customerId === "c2")!;
  expect(globex.owner).toBe("Unassigned");
  expect(globex.standing).toBe("overdue"); // open balance, no case

  const initech = rows.find((r) => r.customerId === "c3")!;
  expect(initech.openBalance).toBe(0);
  expect(initech.openInvoiceCount).toBe(0);
  expect(initech.standing).toBe("current"); // directory includes paid-up customers
  expect(initech.lastContact).toBeNull();
});

test("buildAccountRows includes every customer, even with no invoices", () => {
  const rows = buildAccountRows(CUSTOMERS, INVOICES, CASES, LCS, TODAY, LABELS);
  expect(rows.map((r) => r.customerId).sort()).toEqual(["c1", "c2", "c3"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/accounts.test.ts`
Expected: FAIL — cannot find module `../app/lib/accounts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/lib/accounts.ts
// Pure derived-intelligence for the customer directory (Accounts tab). No I/O,
// no node:*, no .server — imported by the route loader, the directory/profile
// components (type-only), and tests. Mirrors the worklist/cases aggregation shape.

import { ageInDays, type CustomerInput, type InvoiceInput, type LastContact } from "./worklist";
import { DEFAULT_COMM_PREFS, type CommPrefs } from "./comm-prefs";

export type AccountStanding = "current" | "overdue" | "in_collections" | "on_hold";

// Presence of a customerId in the cases array = that customer has an OPEN case.
export type AccountCaseInput = { customerId: string; onHold: boolean };
export type AccountLastContactInput = { customerId: string; date: string; channel: string };

export type AccountRow = {
  customerId: string;
  name: string;
  ownerId: string | null;
  owner: string;
  email: string | null;
  phone: string | null;
  openBalance: number;
  openInvoiceCount: number;
  oldestOverdueDays: number;
  hasActiveCase: boolean;
  onHold: boolean;
  standing: AccountStanding;
  commPrefs: CommPrefs;
  smsConsent: boolean;
  lastContact: LastContact;
  searchText: string;
};

export function deriveStanding(input: {
  openBalance: number; hasActiveCase: boolean; onHold: boolean;
}): AccountStanding {
  if (input.onHold) return "on_hold";
  if (input.openBalance <= 0) return "current";
  if (input.hasActiveCase) return "in_collections";
  return "overdue";
}

export function buildAccountRows(
  customers: CustomerInput[],
  invoices: InvoiceInput[],
  cases: AccountCaseInput[],
  lastContacts: AccountLastContactInput[],
  today: string,
  ownerLabels: Map<string, string>,
): AccountRow[] {
  // Open-invoice aggregation per customer (caller passes only balance>0 invoices).
  const balanceByCustomer = new Map<string, number>();
  const countByCustomer = new Map<string, number>();
  const oldestByCustomer = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.customer_id) continue;
    const bal = Number(inv.balance || 0);
    balanceByCustomer.set(inv.customer_id, (balanceByCustomer.get(inv.customer_id) ?? 0) + bal);
    countByCustomer.set(inv.customer_id, (countByCustomer.get(inv.customer_id) ?? 0) + 1);
    const age = inv.due_date ? ageInDays(inv.due_date, today) : 0;
    if (age > 0) {
      oldestByCustomer.set(inv.customer_id, Math.max(oldestByCustomer.get(inv.customer_id) ?? 0, age));
    }
  }

  const caseByCustomer = new Map(cases.map((c) => [c.customerId, c]));

  // Newest contact per customer (explicit max-by-date; do not rely on order).
  const lastByCustomer = new Map<string, AccountLastContactInput>();
  for (const lc of lastContacts) {
    const prev = lastByCustomer.get(lc.customerId);
    if (!prev || lc.date > prev.date) lastByCustomer.set(lc.customerId, lc);
  }

  return customers.map((cust) => {
    const openBalance = balanceByCustomer.get(cust.id) ?? 0;
    const cse = caseByCustomer.get(cust.id) ?? null;
    const hasActiveCase = cse != null;
    const onHold = cse?.onHold ?? false;
    const ownerId = cust.owner ?? null;
    const owner = ownerId ? (ownerLabels.get(ownerId) ?? "Unknown") : "Unassigned";
    const lc = lastByCustomer.get(cust.id) ?? null;
    return {
      customerId: cust.id,
      name: cust.name,
      ownerId,
      owner,
      email: cust.email ?? null,
      phone: cust.phone ?? null,
      openBalance,
      openInvoiceCount: countByCustomer.get(cust.id) ?? 0,
      oldestOverdueDays: oldestByCustomer.get(cust.id) ?? 0,
      hasActiveCase,
      onHold,
      standing: deriveStanding({ openBalance, hasActiveCase, onHold }),
      commPrefs: cust.commPrefs ?? DEFAULT_COMM_PREFS,
      smsConsent: cust.smsConsent ?? false,
      lastContact: lc ? { date: lc.date, channel: lc.channel } : null,
      searchText: [cust.name, cust.phone ?? "", cust.email ?? "", owner].filter(Boolean).join(" ").toLowerCase(),
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/accounts.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/accounts.ts tests/accounts.test.ts
git commit -m "feat(accounts): pure account rows + standing derivation"
```

---

## Task 2: `accounts.ts` — filter, sort, metrics

**Files:**
- Modify: `app/lib/accounts.ts`
- Test: `tests/accounts.test.ts`

**Interfaces:**
- Produces:
  - `type AccountFilter = "all" | "open-balance" | "paid-up" | "unassigned" | "on-hold"`
  - `type AccountSort = "name" | "balance" | "last-contact"`
  - `type AccountMetrics = { totalCustomers: number; totalOpenAR: number; unassignedCount: number; paidUpCount: number }`
  - `applyAccountFilter(rows: AccountRow[], filter: AccountFilter): AccountRow[]`
  - `sortAccountRows(rows: AccountRow[], sort: AccountSort): AccountRow[]`
  - `computeAccountMetrics(rows: AccountRow[]): AccountMetrics`
  - `const ACCOUNT_FILTERS: AccountFilter[]` and `const ACCOUNT_SORTS: AccountSort[]` (for the loader's validation + the toolbar).

- [ ] **Step 1: Write the failing test (append to `tests/accounts.test.ts`)**

```ts
import {
  applyAccountFilter, sortAccountRows, computeAccountMetrics,
} from "../app/lib/accounts";

test("applyAccountFilter: open-balance / paid-up / unassigned / on-hold", () => {
  const rows = buildAccountRows(CUSTOMERS, INVOICES, CASES, LCS, TODAY, LABELS);
  expect(applyAccountFilter(rows, "all").length).toBe(3);
  expect(applyAccountFilter(rows, "open-balance").map((r) => r.customerId).sort()).toEqual(["c1", "c2"]);
  expect(applyAccountFilter(rows, "paid-up").map((r) => r.customerId)).toEqual(["c3"]);
  expect(applyAccountFilter(rows, "unassigned").map((r) => r.customerId)).toEqual(["c2"]);
  expect(applyAccountFilter(rows, "on-hold").length).toBe(0);
});

test("sortAccountRows: name asc, balance desc, last-contact newest-first (nulls last)", () => {
  const rows = buildAccountRows(CUSTOMERS, INVOICES, CASES, LCS, TODAY, LABELS);
  expect(sortAccountRows(rows, "name").map((r) => r.name)).toEqual(["Acme", "Globex", "Initech"]);
  expect(sortAccountRows(rows, "balance").map((r) => r.customerId)).toEqual(["c1", "c2", "c3"]);
  expect(sortAccountRows(rows, "last-contact").map((r) => r.customerId)[0]).toBe("c1"); // only c1 has contact
  expect(sortAccountRows(rows, "last-contact").map((r) => r.customerId).slice(1).sort()).toEqual(["c2", "c3"]);
});

test("computeAccountMetrics totals customers, open AR, unassigned, paid-up", () => {
  const rows = buildAccountRows(CUSTOMERS, INVOICES, CASES, LCS, TODAY, LABELS);
  const m = computeAccountMetrics(rows);
  expect(m.totalCustomers).toBe(3);
  expect(m.totalOpenAR).toBe(7100); // 6300 + 800
  expect(m.unassignedCount).toBe(1);
  expect(m.paidUpCount).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/accounts.test.ts`
Expected: FAIL — `applyAccountFilter` etc. not exported.

- [ ] **Step 3: Write minimal implementation (append to `app/lib/accounts.ts`)**

```ts
export type AccountFilter = "all" | "open-balance" | "paid-up" | "unassigned" | "on-hold";
export type AccountSort = "name" | "balance" | "last-contact";
export type AccountMetrics = {
  totalCustomers: number; totalOpenAR: number; unassignedCount: number; paidUpCount: number;
};

export const ACCOUNT_FILTERS: AccountFilter[] = ["all", "open-balance", "paid-up", "unassigned", "on-hold"];
export const ACCOUNT_SORTS: AccountSort[] = ["name", "balance", "last-contact"];

export function applyAccountFilter(rows: AccountRow[], filter: AccountFilter): AccountRow[] {
  if (filter === "open-balance") return rows.filter((r) => r.openBalance > 0);
  if (filter === "paid-up") return rows.filter((r) => r.standing === "current");
  if (filter === "unassigned") return rows.filter((r) => r.ownerId == null);
  if (filter === "on-hold") return rows.filter((r) => r.onHold);
  return rows;
}

export function sortAccountRows(rows: AccountRow[], sort: AccountSort): AccountRow[] {
  const copy = [...rows];
  if (sort === "balance") return copy.sort((a, b) => b.openBalance - a.openBalance);
  if (sort === "last-contact") {
    return copy.sort((a, b) => {
      const ad = a.lastContact?.date ?? "";
      const bd = b.lastContact?.date ?? "";
      if (ad === bd) return a.name.localeCompare(b.name);
      return bd.localeCompare(ad); // newest first; "" (no contact) sorts last
    });
  }
  return copy.sort((a, b) => a.name.localeCompare(b.name));
}

export function computeAccountMetrics(rows: AccountRow[]): AccountMetrics {
  return {
    totalCustomers: rows.length,
    totalOpenAR: rows.reduce((s, r) => s + r.openBalance, 0),
    unassignedCount: rows.filter((r) => r.ownerId == null).length,
    paidUpCount: rows.filter((r) => r.standing === "current").length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/accounts.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/accounts.ts tests/accounts.test.ts
git commit -m "feat(accounts): directory filter, sort, and metrics"
```

---

## Task 3: AppShell — activate Accounts nav + route-derived active state

**Files:**
- Modify: `app/components/AppShell.tsx`
- Modify: `app/routes/dashboard.tsx` (pass `activeNav="collections"`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `AppShellProps` gains `activeNav?: "collections" | "accounts"` (default `"collections"`).

**Context:** Today `NAV_ITEMS` hardcodes `active: true` on Collections and renders Accounts as an inert `<a href="#">`. This task makes the active item derive from `activeNav`, turns Accounts into a real `<Link to="/accounts">`, and derives the topbar section title. Promises/Messages stay inert; Reports stays an owner-only link.

- [ ] **Step 1: Add the prop and section title**

In `interface AppShellProps`, add after `isOwner`:

```tsx
  /** Which primary section is active (drives the nav rail + topbar title). */
  activeNav?: "collections" | "accounts";
```

In the `AppShell({ ... })` destructure, add `activeNav = "collections",`.

Replace the hardcoded topbar title span text `Collections` with a derived title. Just above the `return (`:

```tsx
  const sectionTitle = activeNav === "accounts" ? "Accounts" : "Collections";
  const NAV_TARGETS: Record<string, string> = { collections: "/dashboard", accounts: "/accounts" };
```

Change the topbar title line:

```tsx
            <span className="text-surface/90 font-medium">{sectionTitle}</span>
```

- [ ] **Step 2: Make the nav render route-derived active + activate Accounts**

Replace the `NAV_ITEMS.map(...)` body so the active item is `item.name === activeNav`, Collections/Accounts are real links, Reports stays owner-only, and Promises/Messages stay inert. Replace the whole `{NAV_ITEMS.map((item) => { ... })}` block with:

```tsx
            {NAV_ITEMS.map((item) => {
              const isActive = item.name === activeNav;
              const target = NAV_TARGETS[item.name];
              const isReportsForOwner = item.name === "reports" && isOwner;

              if (isActive && target) {
                return (
                  <li key={item.name} className="relative w-full">
                    <Link
                      to={target}
                      className="relative flex flex-col items-center justify-center w-full py-3 gap-1 text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset"
                      aria-current="page"
                      aria-label={item.label}
                      onClick={() => setNavOpen(false)}
                    >
                      <span className="absolute left-0 inset-y-0 w-0.5 bg-copper rounded-r" aria-hidden="true" />
                      <Icon name={item.icon} size={18} className="text-copper" />
                      <span className="text-[9px] font-sans font-medium uppercase tracking-wide text-copper leading-none">
                        {item.label}
                      </span>
                    </Link>
                  </li>
                );
              }

              if (target || isReportsForOwner) {
                const to = target ?? "/reports";
                return (
                  <li key={item.name} className="relative w-full">
                    <Link
                      to={to}
                      className="flex flex-col items-center justify-center w-full py-3 gap-1 text-surface/70 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset"
                      aria-label={item.label}
                      onClick={() => setNavOpen(false)}
                    >
                      <Icon name={item.icon} size={18} />
                      <span className="text-[9px] font-sans font-medium uppercase tracking-wide leading-none">{item.label}</span>
                    </Link>
                  </li>
                );
              }

              return (
                <li key={item.name} className="relative w-full">
                  {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
                  <a
                    href="#"
                    className="flex flex-col items-center justify-center w-full py-3 gap-1 text-surface/40 cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset"
                    aria-disabled="true"
                    aria-label={`${item.label} (coming soon)`}
                    tabIndex={-1}
                    onClick={(e) => e.preventDefault()}
                  >
                    <Icon name={item.icon} size={18} />
                    <span className="text-[9px] font-sans font-medium uppercase tracking-wide leading-none">{item.label}</span>
                  </a>
                </li>
              );
            })}
```

Also delete the now-unused `active: true` field on the collections entry in `NAV_ITEMS` (and the `active?: boolean` from `interface NavItem`).

- [ ] **Step 3: Pass `activeNav` from dashboard**

In `app/routes/dashboard.tsx`, find the `<AppShell` JSX and add the prop (keeps Collections explicitly active):

```tsx
        activeNav="collections"
```

- [ ] **Step 4: Typecheck + build**

Run: `npx react-router typegen && npx tsc -b && npx react-router build`
Expected: exit 0, clean build. (No render tests — AppShell is presentational.)

- [ ] **Step 5: Commit**

```bash
git add app/components/AppShell.tsx app/routes/dashboard.tsx
git commit -m "feat(accounts): activate Accounts nav + route-derived active state"
```

---

## Task 4: `AccountsMetrics` KPI strip

**Files:**
- Create: `app/components/AccountsMetrics.tsx`

**Interfaces:**
- Consumes: `AccountMetrics` from `app/lib/accounts`; `formatUSD` from `app/lib/format`.
- Produces: `export function AccountsMetrics({ metrics }: { metrics: AccountMetrics }): JSX.Element`.

**Context:** Reuse the `MetricsStrip.tsx` KPI-card visual language (paper card, top accent bar, status dot, mono label, `font-display` figure). Four non-clickable tiles (these are summaries, not filters — filtering lives in the directory toolbar): Total customers · Open A/R · Unassigned · Paid up.

- [ ] **Step 1: Implement the component**

```tsx
// app/components/AccountsMetrics.tsx
import type { AccountMetrics } from "../lib/accounts";
import { formatUSD } from "../lib/format";

type Accent = "ink" | "copper" | "neutral" | "cool";
const ACCENT_TEXT: Record<Accent, string> = {
  ink: "text-text", copper: "text-copper", neutral: "text-muted", cool: "text-cool",
};
const ACCENT_DOT: Record<Accent, string> = {
  ink: "bg-ink", copper: "bg-copper", neutral: "bg-muted", cool: "bg-cool",
};

function Tile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: Accent }) {
  return (
    <div className="relative flex flex-col p-4 rounded-tile overflow-hidden min-w-0 bg-paper border border-border">
      <span aria-hidden="true" className={`absolute top-0 inset-x-0 h-0.5 ${ACCENT_DOT[accent]}`} />
      <span className="flex items-center gap-1.5 mb-2">
        <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${ACCENT_DOT[accent]}`} />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted truncate">{label}</span>
      </span>
      <span className="font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-text">{value}</span>
      <span className={`mt-1.5 text-xs ${ACCENT_TEXT[accent]}`}>{sub}</span>
    </div>
  );
}

export function AccountsMetrics({ metrics }: { metrics: AccountMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-4" aria-label="Accounts summary metrics">
      <Tile label="Total customers" value={String(metrics.totalCustomers)} sub="in directory" accent="ink" />
      <Tile label="Open A/R" value={formatUSD(metrics.totalOpenAR)} sub="across all accounts" accent="copper" />
      <Tile label="Unassigned" value={String(metrics.unassignedCount)} sub="no owner" accent="neutral" />
      <Tile label="Paid up" value={String(metrics.paidUpCount)} sub="zero balance" accent="cool" />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx react-router typegen && npx tsc -b`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/components/AccountsMetrics.tsx
git commit -m "feat(accounts): KPI metrics strip"
```

---

## Task 5: `AccountsDirectory` + `AccountQuickPanel`

**Files:**
- Create: `app/components/AccountsDirectory.tsx`
- Create: `app/components/AccountQuickPanel.tsx`

**Interfaces:**
- Consumes: `AccountRow`, `AccountStanding`, `AccountFilter`, `AccountSort` from `app/lib/accounts`; `formatUSD` from `app/lib/format`; `formatDate` from `app/lib/dates`; `Icon` from `./Icons`.
- Produces:
  - `STANDING_LABEL: Record<AccountStanding, string>` and `STANDING_CHIP: Record<AccountStanding, string>` (literal Tailwind classes) — exported from `AccountsDirectory.tsx` for reuse by the panel/profile.
  - `AccountsDirectory({ rows, filter, sort, search, counts, selectedId }): JSX.Element`
  - `AccountQuickPanel({ account }: { account: AccountRow | null }): JSX.Element`

**Context:** Mirror `WorkQueue.tsx`'s warm toolbar (paper header band, search input, sort `<select>`, pill filter tabs with count badges) and row treatment, but over `AccountRow` (no heat rail, no bulk-select, no SMS). Selection is URL-driven via `?customerId=` (a `<Link>` per row, preserving `filter`/`sort`/`q`). Standing chip replaces the case status chip.

- [ ] **Step 1: Implement `AccountsDirectory.tsx`**

Build it to this contract (follow `WorkQueue.tsx` for exact toolbar/row class patterns; key pieces below):

```tsx
// app/components/AccountsDirectory.tsx
import { Form, Link } from "react-router";
import type { AccountRow, AccountStanding, AccountFilter, AccountSort } from "../lib/accounts";
import { formatUSD } from "../lib/format";
import { formatDate } from "../lib/dates";

export const STANDING_LABEL: Record<AccountStanding, string> = {
  current: "Current", overdue: "Overdue", in_collections: "In collections", on_hold: "On hold",
};
// Literal class strings for the Tailwind v4 scanner.
export const STANDING_CHIP: Record<AccountStanding, string> = {
  current: "bg-cool/10 text-cool",
  overdue: "bg-warm/10 text-warm",
  in_collections: "bg-copper/10 text-copper",
  on_hold: "bg-muted/10 text-muted",
};

const FILTER_TABS: { id: AccountFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open-balance", label: "Open balance" },
  { id: "paid-up", label: "Paid up" },
  { id: "unassigned", label: "Unassigned" },
  { id: "on-hold", label: "On hold" },
];
const SORTS: { id: AccountSort; label: string }[] = [
  { id: "name", label: "Name (A–Z)" },
  { id: "balance", label: "Open balance" },
  { id: "last-contact", label: "Last contact" },
];

interface Props {
  rows: AccountRow[];
  filter: AccountFilter;
  sort: AccountSort;
  search: string;
  counts: Record<AccountFilter, number>;
  selectedId: string | null;
}

export function AccountsDirectory({ rows, filter, sort, search, counts, selectedId }: Props) {
  const link = (customerId: string) => {
    const p = new URLSearchParams({ filter, sort, ...(search ? { q: search } : {}) });
    p.set("customerId", customerId);
    return `?${p.toString()}`;
  };
  const tabHref = (id: AccountFilter) => {
    const p = new URLSearchParams({ filter: id, sort, ...(search ? { q: search } : {}) });
    return `?${p.toString()}`;
  };

  return (
    <section className="flex flex-col bg-surface border border-border rounded-card overflow-hidden">
      {/* Header band (paper) */}
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 bg-paper border-b border-border">
        <h2 className="font-display text-sm font-semibold text-text">Accounts</h2>
        <span className="text-xs text-muted">{rows.length} matching</span>
        <Form method="get" className="ml-auto flex items-center gap-2">
          {/* Preserve filter+sort across a search submit */}
          <input type="hidden" name="filter" value={filter} />
          <input type="hidden" name="sort" value={sort} />
          <input
            type="search" name="q" defaultValue={search} placeholder="Search name, phone, email…"
            className="h-8 w-48 px-2 rounded border border-border bg-surface text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
          <button type="submit" className="h-8 px-3 rounded bg-ink text-surface text-xs font-medium">Search</button>
        </Form>
        <Form method="get" className="flex items-center gap-2">
          <input type="hidden" name="filter" value={filter} />
          {search ? <input type="hidden" name="q" value={search} /> : null}
          <label className="sr-only" htmlFor="acct-sort">Sort</label>
          <select
            id="acct-sort" name="sort" defaultValue={sort}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-8 px-2 rounded border border-border bg-surface text-sm"
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Form>
      </header>

      {/* Pill filter tabs with count badges */}
      <nav className="flex flex-wrap gap-2 px-4 py-2 border-b border-border" aria-label="Account filters">
        {FILTER_TABS.map((t) => {
          const active = t.id === filter;
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

      {/* Column header (paper, mono uppercase) */}
      <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2 bg-paper border-b border-border font-mono text-[10px] uppercase tracking-wide text-muted">
        <span>Customer</span><span>Standing</span><span>Owner</span><span className="text-right">Open balance</span><span>Last contact</span>
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">No accounts match this filter.</p>
      ) : (
        <ul role="list" className="divide-y divide-border">
          {rows.map((r) => {
            const selected = r.customerId === selectedId;
            return (
              <li key={r.customerId} className={selected ? "bg-copper/5" : ""}>
                <Link
                  to={link(r.customerId)}
                  className="relative grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-1 md:gap-3 px-4 py-3 items-center hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset"
                  aria-current={selected ? "true" : undefined}
                >
                  {selected ? <span className="absolute left-0 inset-y-0 w-0.5 bg-copper" aria-hidden="true" /> : null}
                  <span className="font-medium text-text truncate">{r.name}</span>
                  <span><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STANDING_CHIP[r.standing]}`}>{STANDING_LABEL[r.standing]}</span></span>
                  <span className="text-sm text-muted truncate">{r.owner}</span>
                  <span className="text-sm text-text text-right tabular-nums">{formatUSD(r.openBalance)}</span>
                  <span className="text-sm text-muted">{r.lastContact ? `${r.lastContact.channel} · ${formatDate(r.lastContact.date)}` : "—"}</span>
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

- [ ] **Step 2: Implement `AccountQuickPanel.tsx`**

```tsx
// app/components/AccountQuickPanel.tsx
import { Link } from "react-router";
import type { AccountRow } from "../lib/accounts";
import { formatUSD } from "../lib/format";
import { STANDING_LABEL, STANDING_CHIP } from "./AccountsDirectory";
import { Icon } from "./Icons";

export function AccountQuickPanel({ account }: { account: AccountRow | null }) {
  if (!account) {
    return (
      <aside className="hidden lg:flex flex-col items-center justify-center bg-surface border border-border rounded-card p-8 text-center text-muted">
        <Icon name="user" size={28} className="mb-2 text-muted/60" />
        <p className="text-sm">Select an account to preview it here.</p>
      </aside>
    );
  }
  return (
    <aside className="flex flex-col bg-surface border border-border rounded-card overflow-hidden">
      <header className="bg-ink text-surface px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-surface/50">Account</p>
        <h2 className="font-display text-lg font-semibold leading-tight">{account.name}</h2>
        <span className={`mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STANDING_CHIP[account.standing]}`}>
          {STANDING_LABEL[account.standing]}
        </span>
      </header>
      <div className="grid grid-cols-2 gap-3 p-4 bg-paper border-b border-border">
        <div><p className="font-mono text-[10px] uppercase text-muted">Open balance</p><p className="font-display text-lg text-text tabular-nums">{formatUSD(account.openBalance)}</p></div>
        <div><p className="font-mono text-[10px] uppercase text-muted">Open invoices</p><p className="font-display text-lg text-text tabular-nums">{account.openInvoiceCount}</p></div>
      </div>
      <dl className="p-4 space-y-2 text-sm">
        <div className="flex justify-between"><dt className="text-muted">Owner</dt><dd className="text-text">{account.owner}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Phone</dt><dd className="text-text">{account.phone ?? "—"}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Email</dt><dd className="text-text truncate max-w-[60%]">{account.email ?? "—"}</dd></div>
      </dl>
      <div className="p-4 border-t border-border">
        <Link
          to={`/accounts/${account.customerId}`}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-copper text-surface text-sm font-medium hover:bg-copper/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          Open full profile <Icon name="chevronRight" size={16} />
        </Link>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx react-router typegen && npx tsc -b`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/components/AccountsDirectory.tsx app/components/AccountQuickPanel.tsx
git commit -m "feat(accounts): directory list + quick-view panel"
```

---

## Task 6: `/accounts` route — loader + page

**Files:**
- Create: `app/routes/accounts.tsx`
- Modify: `app/routes.ts` (register `accounts`)

**Interfaces:**
- Consumes: `accounts.ts` (`buildAccountRows`/`applyAccountFilter`/`sortAccountRows`/`computeAccountMetrics`/`ACCOUNT_FILTERS`/`ACCOUNT_SORTS`/types), `AccountsDirectory`/`AccountsMetrics`/`AccountQuickPanel`, `AppShell`. Reuses the dashboard loader's auth/org/connection/sync-label prelude and `isCaseSuppressed` from `app/lib/exceptions`.
- Produces: `/accounts` page.

**Context:** Mirror `dashboard.tsx`'s loader prelude verbatim (`requireUser` → `resolveOrg` → org name → initials → service client → `getConnectionStatus`; redirect to `/settings` if not connected; build `syncLabel`). Then load directory data with the USER client.

- [ ] **Step 1: Register the route**

In `app/routes.ts`, add after the `dashboard` line:

```ts
  route("accounts", "routes/accounts.tsx"),
```

- [ ] **Step 2: Implement the loader**

Loader reads (all USER-client, `.eq("org_id", org.org_id)`):
- **Customers (ALL):** `supabase.from("customers").select("id, name, phone, email, owner, sms_consent, preferred_channel, do_not_call, do_not_text").eq("org_id", org.org_id)` → map to `CustomerInput[]` (use `resolveCommPrefs(row)` for `commPrefs`, `sms_consent` → `smsConsent`).
- **Open invoices:** `.from("invoices").select("id, qbo_doc_number, customer_id, balance, due_date").eq("org_id", org.org_id).gt("balance", 0)` → `InvoiceInput[]`.
- **All cases:** `.from("collection_cases").select("id, customer_id, status, exception_reason, next_action_at, closed_at").eq("org_id", org.org_id)`. Build:
  - `activeCases: AccountCaseInput[]` from rows where `closed_at == null`, `onHold: isCaseSuppressed({ status, exceptionReason: exception_reason, nextActionAt: next_action_at, today })`.
  - `caseToCustomer: Map<caseId, customerId>` from ALL rows (for the text-message join).
- **Last contact per customer:**
  - `.from("contact_logs").select("customer_id, created_at, method").eq("org_id", org.org_id).not("customer_id", "is", null).order("created_at", { ascending: false })` → push `{ customerId, date: created_at, channel: methodLabel[method] ?? "Note" }`.
  - `.from("text_messages").select("case_id, created_at").eq("org_id", org.org_id).eq("direction", "outbound").order("created_at", { ascending: false })` → map `case_id` via `caseToCustomer` → push `{ customerId, date: created_at, channel: "Text" }` (skip when unmapped).
  - Concatenate into `AccountLastContactInput[]`; `buildAccountRows` takes the max per customer.
- **Owner labels:** `listOrgMembers(service, org.org_id)` → `Map<userId, label>` (same as dashboard).

Then:

```ts
const today = new Date().toISOString().slice(0, 10);
const allRows = buildAccountRows(customersInput, invoicesInput, activeCases, lastContactsInput, today, ownerLabels);
const searched = q.trim() === "" ? allRows : allRows.filter((r) => r.searchText.includes(q.toLowerCase()));
const metrics = computeAccountMetrics(searched);
const counts = Object.fromEntries(ACCOUNT_FILTERS.map((f) => [f, applyAccountFilter(searched, f).length])) as Record<AccountFilter, number>;
const rows = sortAccountRows(applyAccountFilter(searched, filter), sort);
const selected = customerId ? (searched.find((r) => r.customerId === customerId) ?? null) : null;
```

URL params (validate against `ACCOUNT_FILTERS`/`ACCOUNT_SORTS`, defaults `"all"`/`"name"`):
```ts
const url = new URL(request.url); const sp = url.searchParams;
const filter = (ACCOUNT_FILTERS as string[]).includes(sp.get("filter") ?? "") ? (sp.get("filter") as AccountFilter) : "all";
const sort = (ACCOUNT_SORTS as string[]).includes(sp.get("sort") ?? "") ? (sp.get("sort") as AccountSort) : "name";
const q = sp.get("q") ?? "";
const customerId = sp.get("customerId");
```

Return `data({ orgName, initials, syncLabel, connected, isOwner, rows, metrics, counts, filter, sort, q, selected }, { headers })`. (`isOwner` from membership role, as dashboard derives it.)

- [ ] **Step 3: Implement the page component**

```tsx
export default function Accounts() {
  const d = useLoaderData<typeof loader>();
  return (
    <AppShell
      orgName={d.orgName} userInitials={d.initials} syncLabel={d.syncLabel}
      connected={d.connected} isOwner={d.isOwner} activeNav="accounts"
    >
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <AccountsMetrics metrics={d.metrics} />
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <AccountsDirectory rows={d.rows} filter={d.filter} sort={d.sort} search={d.q} counts={d.counts} selectedId={d.selected?.customerId ?? null} />
          <AccountQuickPanel account={d.selected} />
        </div>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 4: Typecheck, test, build**

Run: `npx react-router typegen && npx tsc -b && npx vitest run && npx react-router build`
Expected: exit 0; vitest green (routes-registration test still passes — `accounts.tsx` is a page route, not `api.*`, but the new file must not break the build); clean build.

- [ ] **Step 5: Visual checkpoint (local, not committed)**

Start the seeded app (`npm run dev`), log in (`diskin@chancey.test`), open `/accounts`. Confirm: directory lists all customers incl. paid-up, filter pills + counts work, search works, sort works, clicking a row opens the quick panel, "Open full profile →" points to `/accounts/:id` (404 until Task 11 — expected). Also reload `/dashboard` to confirm Collections nav still active + unaffected.

- [ ] **Step 6: Commit**

```bash
git add app/routes/accounts.tsx app/routes.ts
git commit -m "feat(accounts): /accounts directory route"
```

---

# Phase 11b — Profile + editing

## Task 7: `0019_account_notes` migration

**Files:**
- Create: `supabase/migrations/0019_account_notes.sql`
- Test: `tests/account-notes-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

```ts
// tests/account-notes-schema.test.ts
import { expect, test } from "vitest";
import { serviceClient } from "./helpers";

const svc = serviceClient();

test("customers accepts notes + notes_updated_at/by", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "Notes schema" }).select("id").single();
  const { data, error } = await svc.from("customers")
    .insert({ org_id: org!.id, name: "NoteCo", notes: "Called twice, prefers Mondays." })
    .select("notes, notes_updated_at, notes_updated_by").single();
  expect(error).toBeNull();
  expect(data!.notes).toBe("Called twice, prefers Mondays.");
  expect(data!.notes_updated_at).toBeNull();
  expect(data!.notes_updated_by).toBeNull();
});

test("notes defaults to null", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "Notes null" }).select("id").single();
  const { data } = await svc.from("customers")
    .insert({ org_id: org!.id, name: "NoNote" }).select("notes").single();
  expect(data!.notes).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/account-notes-schema.test.ts`
Expected: FAIL — column `notes` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/0019_account_notes.sql
-- NudgePay-only customer notes (Accounts tab). Additive; NOT in the QBO upsert
-- column set (name/email/phone/qbo_id/org_id), so customer sync never clobbers
-- these. RLS already governs `customers` via the existing customers_all policy.
alter table customers add column notes text;
alter table customers add column notes_updated_at timestamptz;
alter table customers add column notes_updated_by uuid;
```

- [ ] **Step 4: Apply locally and verify the test passes**

Run: `npx supabase db reset && npx vitest run tests/account-notes-schema.test.ts`
Expected: migrations re-apply through `0019`; test PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0019_account_notes.sql tests/account-notes-schema.test.ts
git commit -m "feat(accounts): account notes columns (migration 0019)"
```

---

## Task 8: `api.comm-prefs` — bare `customerId` branch

**Files:**
- Modify: `app/routes/api.comm-prefs.tsx`
- Test: `tests/api-comm-prefs.test.ts`

**Context:** Today the action resolves the customer via `caseId` then `invoiceId`. Accounts posts a bare `customerId` (a customer may have neither). Add a `customerId` branch, org-scoped exactly like `api.assign` (bind `.eq("org_id", org.org_id)`), tried first.

- [ ] **Step 1: Write the failing test (append to `tests/api-comm-prefs.test.ts`)**

```ts
test("comm-prefs resolves a bare customerId (Accounts profile path)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Prefs by customer" }).select("id").single();
  const a = await makeUserClient("prefs-cust-a@example.com");
  await svc.from("memberships").insert({ org_id: org!.id, user_id: a.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org!.id, name: "DirectCo" }).select("id").single();

  // Simulate the route's org-scoped resolve + update for a bare customerId.
  const { data: resolved } = await a.client.from("customers")
    .select("id").eq("org_id", org!.id).eq("id", cust!.id).maybeSingle();
  expect(resolved?.id).toBe(cust!.id);
  await a.client.from("customers")
    .update({ preferred_channel: "call", do_not_text: true }).eq("org_id", org!.id).eq("id", cust!.id);
  const { data: after } = await svc.from("customers")
    .select("preferred_channel, do_not_text").eq("id", cust!.id).single();
  expect(after!.preferred_channel).toBe("call");
  expect(after!.do_not_text).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-comm-prefs.test.ts`
Expected: FAIL only if the resolve path is wrong — but since this test exercises the DB pattern, it will PASS already at the DB level. **To make it a true guard of the route, instead assert the route file contains the branch.** Replace the test body's final assertions with ALSO importing the route is unnecessary; keep the DB-pattern test above AND add this source guard:

```ts
import { readFileSync } from "node:fs";
test("api.comm-prefs source resolves a bare customerId", () => {
  const src = readFileSync(new URL("../app/routes/api.comm-prefs.tsx", import.meta.url), "utf8");
  expect(src).toMatch(/form\.get\("customerId"\)/);
});
```

Run again: this guard FAILS (no `customerId` handling yet).

- [ ] **Step 3: Add the branch to `api.comm-prefs.tsx`**

After the `invRaw`/`invoiceId` parse and before the `let customerId` resolution, add a direct-id parse, then try it FIRST in resolution:

```tsx
  const custRaw = form.get("customerId");
  const directCustomerId = typeof custRaw === "string" ? custRaw : "";
```

Change the resolution block to try the bare id first (org-scoped):

```tsx
  let customerId: string | null = null;
  if (directCustomerId) {
    const { data: cust } = await supabase
      .from("customers").select("id").eq("org_id", org.org_id).eq("id", directCustomerId).maybeSingle();
    customerId = (cust?.id as string | undefined) ?? null;
  }
  if (!customerId && caseId) {
    const { data: cse } = await supabase
      .from("collection_cases").select("customer_id").eq("id", caseId).maybeSingle();
    customerId = (cse?.customer_id as string | undefined) ?? null;
  }
  if (!customerId && invoiceId) {
    const { data: inv } = await supabase
      .from("invoices").select("customer_id").eq("id", invoiceId).maybeSingle();
    customerId = (inv?.customer_id as string | undefined) ?? null;
  }
```

Also bind the update org-scoped (defense in depth, matching `api.assign`):

```tsx
  const { error } = await supabase.from("customers")
    .update(parseCommPrefsUpdate(form)).eq("org_id", org.org_id).eq("id", customerId);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api-comm-prefs.test.ts`
Expected: PASS (existing tests + the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add app/routes/api.comm-prefs.tsx tests/api-comm-prefs.test.ts
git commit -m "feat(accounts): comm-prefs accepts a bare customerId"
```

---

## Task 9: `api.account-notes` route

**Files:**
- Create: `app/routes/api.account-notes.tsx`
- Modify: `app/routes.ts` (register `api/account-notes`)
- Test: `tests/api-account-notes.test.ts`

**Interfaces:**
- Produces: an action that updates `customers.notes`/`notes_updated_at`/`notes_updated_by` for an org-scoped customer, then redirects to `returnTo`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api-account-notes.test.ts
import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

test("a member writes notes to an own-org customer (org-scoped)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Notes Org A" }).select("id").single();
  const a = await makeUserClient("notes-a@example.com");
  await svc.from("memberships").insert({ org_id: org!.id, user_id: a.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org!.id, name: "Notable Co" }).select("id").single();

  await a.client.from("customers")
    .update({ notes: "Prefers email; AP is Dana." }).eq("org_id", org!.id).eq("id", cust!.id);
  const { data: after } = await svc.from("customers").select("notes").eq("id", cust!.id).single();
  expect(after!.notes).toBe("Prefers email; AP is Dana.");
});

test("an outsider cannot write notes (RLS blocks)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Notes Org B" }).select("id").single();
  const owner = await makeUserClient("notes-owner@example.com");
  await svc.from("memberships").insert({ org_id: org!.id, user_id: owner.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org!.id, name: "Private Notes Co", notes: "original" }).select("id").single();

  const outsider = await makeUserClient("notes-outsider@example.com");
  await outsider.client.from("customers").update({ notes: "hacked" }).eq("id", cust!.id);
  const { data: after } = await svc.from("customers").select("notes").eq("id", cust!.id).single();
  expect(after!.notes).toBe("original"); // unchanged — RLS blocked it
});

test("api.account-notes is registered in routes.ts", () => {
  const { readFileSync } = require("node:fs");
  const table = readFileSync(new URL("../app/routes.ts", import.meta.url), "utf8");
  expect(table).toContain('"routes/api.account-notes.tsx"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-account-notes.test.ts`
Expected: FAIL — the registration test fails (route not registered yet); RLS tests pass at the DB level.

- [ ] **Step 3: Implement the route**

```tsx
// app/routes/api.account-notes.tsx
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const customerId = typeof form.get("customerId") === "string" ? (form.get("customerId") as string) : "";
  const notesRaw = form.get("notes");
  const notes = typeof notesRaw === "string" ? notesRaw : "";
  if (!customerId) return redirect(returnTo, { headers });

  // Org-scope guard (RLS alone permits every org the caller belongs to).
  const { data: cust } = await supabase
    .from("customers").select("id").eq("org_id", org.org_id).eq("id", customerId).maybeSingle();
  if (!cust) return redirect(returnTo, { headers });

  const { error } = await supabase.from("customers")
    .update({ notes: notes.trim() === "" ? null : notes, notes_updated_at: new Date().toISOString(), notes_updated_by: user.id })
    .eq("org_id", org.org_id).eq("id", customerId);
  if (error) throw new Error(`Failed to save notes: ${error.message}`);
  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/accounts");
}
```

- [ ] **Step 4: Register the route**

In `app/routes.ts`, add with the other `api/*` routes:

```ts
  route("api/account-notes", "routes/api.account-notes.tsx"),
```

- [ ] **Step 5: Run tests + the registration guard**

Run: `npx vitest run tests/api-account-notes.test.ts tests/routes-registration.test.ts`
Expected: PASS (all 3 + the global registration guard).

- [ ] **Step 6: Commit**

```bash
git add app/routes/api.account-notes.tsx app/routes.ts tests/api-account-notes.test.ts
git commit -m "feat(accounts): api.account-notes write route"
```

---

## Task 10: `/accounts/:id` loader

**Files:**
- Create: `app/routes/accounts.$id.tsx` (loader only in this task; default component is a stub returning `null` until Task 11)
- Modify: `app/routes.ts` (register `accounts/:id`)

**Interfaces:**
- Consumes: dashboard loader prelude; `buildTimeline` + `TimelineLogInput`/`TimelineSmsInput` from `app/lib/timeline`; `resolveCommPrefs` from `app/lib/comm-prefs`; `STATUS_LABEL`/`formatUSD` from `app/lib/format`; `listOrgMembers`.
- Produces: loader data `{ orgName, initials, syncLabel, connected, isOwner, account, invoices, timeline, roster, activeCaseId, notes, returnTo }`.

**Context:** Mirror the dashboard prelude. Then load one customer (org-scoped) + their full invoice history + account-wide timeline.

- [ ] **Step 1: Register the route**

In `app/routes.ts`, add directly after the `accounts` line:

```ts
  route("accounts/:id", "routes/accounts.$id.tsx"),
```

- [ ] **Step 2: Implement the loader**

Reads (USER client, org-scoped):
- **Customer:** `.from("customers").select("id, name, phone, email, owner, sms_consent, preferred_channel, do_not_call, do_not_text, notes").eq("org_id", org.org_id).eq("id", params.id).maybeSingle()`. If null → `throw new Response("Account not found", { status: 404, headers })`.
- **Invoices (ALL, paid + open):** `.from("invoices").select("id, qbo_doc_number, amount, balance, due_date, status").eq("org_id", org.org_id).eq("customer_id", params.id).order("due_date", { ascending: false })`.
- **Customer's cases:** `.from("collection_cases").select("id, closed_at").eq("org_id", org.org_id).eq("customer_id", params.id)` → `caseIds: string[]`; `activeCaseId = first row with closed_at == null ?? null`.
- **Timeline logs:** `.from("contact_logs").select("id, created_at, method, outcome, notes, follow_up_at, promised_amount, promised_date").eq("org_id", org.org_id).eq("customer_id", params.id)` → `TimelineLogInput[]` (`at: created_at`, `followUpAt: follow_up_at`, numbers `Number(...) || null`).
- **Timeline SMS:** if `caseIds.length`, `.from("text_messages").select("id, created_at, direction, body, status, error_code").eq("org_id", org.org_id).in("case_id", caseIds)` → `TimelineSmsInput[]`.
- `const timeline = buildTimeline(logInputs, smsInputs);`
- **Roster:** `listOrgMembers(service, org.org_id)` → `RosterMember[]` (`{ userId, email, label }`), plus owner label resolution for the header.

Compute `commPrefs = resolveCommPrefs(customerRow)`, `owner` label from roster, and `returnTo = `/accounts/${params.id}``.

Return `data({ orgName, initials, syncLabel, connected, isOwner, account: {...}, invoices, timeline, roster, activeCaseId, returnTo }, { headers })`.

- [ ] **Step 3: Stub the component**

```tsx
export default function AccountProfilePage() {
  return null; // implemented in Task 11
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npx react-router typegen && npx tsc -b && npx react-router build`
Expected: exit 0; clean build.

- [ ] **Step 5: Commit**

```bash
git add app/routes/accounts.$id.tsx app/routes.ts
git commit -m "feat(accounts): /accounts/:id loader"
```

---

## Task 11: `AccountProfile` component + page wiring

**Files:**
- Create: `app/components/AccountProfile.tsx`
- Modify: `app/routes/accounts.$id.tsx` (render `AccountProfile`)

**Interfaces:**
- Consumes: loader data from Task 10; `STANDING_LABEL`/`STANDING_CHIP` from `./AccountsDirectory`; `formatUSD`/`STATUS_LABEL` from `app/lib/format`; `formatDate` from `app/lib/dates`; `TimelineEntry`/`OUTCOME_LABELS` from `app/lib/timeline`; `CHANNELS` from `app/lib/comm-prefs`; `Icon`.
- Produces: `AccountProfile(props)` — the full 360 page body (rendered inside `AppShell`).

**Context:** Reuse the `DetailPanel` visual language (ink header, paper stat tiles, node timeline, warm cards) but as a full-width page. Sections: header · stat tiles · contact card (read-only + "from QuickBooks") · edit forms (owner → `api.assign`; comm prefs → `api.comm-prefs`; notes → `api.account-notes`) · invoice table · account-wide timeline · "Open in Collections" link when `activeCaseId`.

- [ ] **Step 1: Implement `AccountProfile.tsx`**

Build to this structure (key pieces; reuse `DetailPanel.tsx` class patterns for the ink header, paper tiles, and node timeline). All three edit forms post with a hidden `returnTo` and `customerId`:

```tsx
// app/components/AccountProfile.tsx
import { Form, Link } from "react-router";
import type { AccountStanding } from "../lib/accounts";
import type { TimelineEntry } from "../lib/timeline";
import { STANDING_LABEL, STANDING_CHIP } from "./AccountsDirectory";
import { formatUSD, STATUS_LABEL } from "../lib/format";
import { formatDate } from "../lib/dates";
import { CHANNELS } from "../lib/comm-prefs";
import { Icon } from "./Icons";

interface InvoiceLine { id: string; docNumber: string | null; amount: number; balance: number; dueDate: string | null; status: string; }
interface Props {
  customerId: string;
  name: string;
  standing: AccountStanding;
  owner: string;
  ownerId: string | null;
  email: string | null;
  phone: string | null;
  smsConsent: boolean;
  commPrefs: { preferredChannel: string | null; doNotCall: boolean; doNotText: boolean };
  notes: string | null;
  openBalance: number;
  openInvoiceCount: number;
  oldestOverdueDays: number;
  lifetimeInvoiced: number;
  invoices: InvoiceLine[];
  timeline: TimelineEntry[];
  roster: { userId: string; label: string }[];
  activeCaseId: string | null;
  returnTo: string;
}

export function AccountProfile(p: Props) {
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <Link to="/accounts" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <Icon name="chevronRight" size={14} className="rotate-180" /> Back to accounts
      </Link>

      {/* Header (ink) */}
      <header className="bg-ink text-surface rounded-card px-6 py-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-surface/50">Account</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold">{p.name}</h1>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STANDING_CHIP[p.standing]}`}>{STANDING_LABEL[p.standing]}</span>
        </div>
        <p className="mt-1 text-sm text-surface/70">{p.owner} · {formatUSD(p.openBalance)} open</p>
        {p.activeCaseId ? (
          <Link to={`/dashboard?case=${p.activeCaseId}`} className="mt-3 inline-flex items-center gap-1.5 h-8 px-3 rounded bg-copper text-surface text-xs font-medium">
            Open in Collections <Icon name="external" size={14} />
          </Link>
        ) : null}
      </header>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Open A/R", value: formatUSD(p.openBalance) },
          { label: "Open invoices", value: String(p.openInvoiceCount) },
          { label: "Oldest overdue", value: p.oldestOverdueDays > 0 ? `${p.oldestOverdueDays}d` : "—" },
          { label: "Lifetime invoiced (synced)", value: formatUSD(p.lifetimeInvoiced) },
        ].map((t) => (
          <div key={t.label} className="bg-paper border border-border rounded-tile p-4">
            <p className="font-mono text-[10px] uppercase text-muted">{t.label}</p>
            <p className="font-display text-xl text-text tabular-nums mt-1">{t.value}</p>
          </div>
        ))}
      </div>

      {/* Contact (read-only) */}
      <section className="bg-surface border border-border rounded-card p-5">
        <h2 className="font-display text-sm font-semibold text-text mb-1">Contact</h2>
        <p className="text-xs text-muted mb-3">From QuickBooks — read-only.</p>
        <dl className="grid sm:grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted">Phone</dt><dd className="text-text">{p.phone ?? "—"}</dd></div>
          <div><dt className="text-muted">Email</dt><dd className="text-text">{p.email ?? "—"}</dd></div>
          <div><dt className="text-muted">SMS consent</dt><dd className="text-text">{p.smsConsent ? "Yes" : "No"}</dd></div>
        </dl>
      </section>

      {/* Owner + comm prefs + notes (editable) */}
      <section className="bg-surface border border-border rounded-card p-5 space-y-5">
        <h2 className="font-display text-sm font-semibold text-text">Settings</h2>

        <Form method="post" action="/api/assign" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="returnTo" value={p.returnTo} />
          <input type="hidden" name="customerId" value={p.customerId} />
          <label className="text-sm text-muted">Owner
            <select name="ownerId" defaultValue={p.ownerId ?? ""} className="mt-1 block h-9 px-2 rounded border border-border bg-surface text-sm">
              <option value="">Unassigned</option>
              {p.roster.map((m) => <option key={m.userId} value={m.userId}>{m.label}</option>)}
            </select>
          </label>
          <button type="submit" className="h-9 px-3 rounded bg-ink text-surface text-sm font-medium">Save owner</button>
        </Form>

        <Form method="post" action="/api/comm-prefs" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="returnTo" value={p.returnTo} />
          <input type="hidden" name="customerId" value={p.customerId} />
          <label className="text-sm text-muted">Preferred channel
            <select name="preferred_channel" defaultValue={p.commPrefs.preferredChannel ?? "none"} className="mt-1 block h-9 px-2 rounded border border-border bg-surface text-sm">
              <option value="none">No preference</option>
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="do_not_call" value="true" defaultChecked={p.commPrefs.doNotCall} /> Do not call</label>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="do_not_text" value="true" defaultChecked={p.commPrefs.doNotText} /> Do not text</label>
          <button type="submit" className="h-9 px-3 rounded bg-ink text-surface text-sm font-medium">Save preferences</button>
        </Form>

        <Form method="post" action="/api/account-notes" className="space-y-2">
          <input type="hidden" name="returnTo" value={p.returnTo} />
          <input type="hidden" name="customerId" value={p.customerId} />
          <label className="text-sm text-muted block">Account notes
            <textarea name="notes" defaultValue={p.notes ?? ""} rows={4} className="mt-1 block w-full p-2 rounded border border-border bg-surface text-sm" placeholder="NudgePay-only notes (not synced to QuickBooks)…" />
          </label>
          <button type="submit" className="h-9 px-3 rounded bg-copper text-surface text-sm font-medium">Save notes</button>
        </Form>
      </section>

      {/* Invoices */}
      <section className="bg-surface border border-border rounded-card overflow-hidden">
        <h2 className="font-display text-sm font-semibold text-text px-5 py-3 bg-paper border-b border-border">Invoices</h2>
        {p.invoices.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">No invoices.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="font-mono text-[10px] uppercase text-muted text-left">
              <th className="px-5 py-2">Doc #</th><th className="px-5 py-2 text-right">Amount</th><th className="px-5 py-2 text-right">Balance</th><th className="px-5 py-2">Due</th><th className="px-5 py-2">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {p.invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-5 py-2 text-text">{inv.docNumber ?? "—"}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{formatUSD(inv.amount)}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{formatUSD(inv.balance)}</td>
                  <td className="px-5 py-2 text-muted">{inv.dueDate ? formatDate(inv.dueDate) : "—"}</td>
                  <td className="px-5 py-2 text-muted">{STATUS_LABEL[inv.status] ?? inv.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Timeline (account-wide) */}
      <section className="bg-surface border border-border rounded-card p-5">
        <h2 className="font-display text-sm font-semibold text-text mb-3">Activity</h2>
        {p.timeline.length === 0 ? (
          <p className="text-sm text-muted">No activity yet.</p>
        ) : (
          <ul className="space-y-3">
            {p.timeline.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="mt-1 w-2 h-2 rounded-full bg-copper shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-sm text-text">
                    {e.kind === "log" ? (e.outcomeLabel ?? "Logged") : (e.outcomeLabel)}
                    <span className="text-muted"> · {formatDate(e.at.slice(0, 10))}</span>
                  </p>
                  {e.kind === "log" && e.notes ? <p className="text-sm text-muted">{e.notes}</p> : null}
                  {e.kind === "sms" && e.body ? <p className="text-sm text-muted">{e.body}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Wire the page in `accounts.$id.tsx`**

Replace the stub default export with one that renders `AppShell` (`activeNav="accounts"`) wrapping `<AccountProfile {...} />`, mapping loader data to props (compute `lifetimeInvoiced = invoices.reduce((s, i) => s + i.amount, 0)` and `oldestOverdueDays`/`openBalance`/`openInvoiceCount` from the open invoices, or fold them into the loader return — prefer computing in the loader and passing through).

> **Note:** add `lifetimeInvoiced`, `oldestOverdueDays`, `openBalance`, `openInvoiceCount`, `standing` to the Task 10 loader return so the component stays presentational. Compute `standing` with `deriveStanding({ openBalance, hasActiveCase: activeCaseId != null, onHold })` where `onHold` comes from the active case via `isCaseSuppressed` (load `status, exception_reason, next_action_at` on the active case row).

- [ ] **Step 3: Typecheck, test, build**

Run: `npx react-router typegen && npx tsc -b && npx vitest run && npx react-router build`
Expected: exit 0; full suite green; clean build.

- [ ] **Step 4: Visual checkpoint (local, not committed)**

Open `/accounts`, click a customer, "Open full profile →". Confirm header/standing, stat tiles, read-only contact, invoice history (paid + open), account-wide timeline, and that **each edit form round-trips**: change owner → Save (redirects back, owner updated); toggle do-not-text → Save; edit notes → Save (persists). Confirm "Open in Collections" appears only when an active case exists and deep-links to `/dashboard?case=…`.

- [ ] **Step 5: Commit**

```bash
git add app/components/AccountProfile.tsx app/routes/accounts.$id.tsx
git commit -m "feat(accounts): 360 profile page with inline editing"
```

---

## Final verification (run after Task 11)

- [ ] `npx react-router typegen && npx tsc -b` → exit 0
- [ ] `npx vitest run` → green (prior count + new: accounts lib, account-notes schema, api-account-notes, comm-prefs additions)
- [ ] `npx react-router build` → clean
- [ ] Cohesion spot-check: `/dashboard` (Collections still active + unchanged), `/accounts`, `/accounts/:id`, `/settings`, `/reports` all render in the warm palette with no contrast regressions.
- [ ] Update `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` (new section: Phase 11 — Accounts tab) and commit (`docs:`).

---

## Self-Review

**Spec coverage:**
- Directory of all customers incl. paid-up → Tasks 1, 6 (loader reads ALL customers; `buildAccountRows` includes caseless/zero-balance). ✓
- Standing derivation (current/overdue/in_collections/on_hold) → Task 1 `deriveStanding`. ✓
- Hybrid layout (list + quick panel + `/accounts/:id`) → Tasks 5, 6 (panel + "Open full profile"), 10–11 (full page). ✓
- Edit scope = owner + comm prefs + notes; QBO fields read-only → Task 11 forms (assign/comm-prefs/account-notes) + read-only contact card; Tasks 7–9 write paths. ✓
- `api.comm-prefs` `customerId` branch → Task 8. ✓
- Account notes columns + RLS reuse → Task 7 (migration), 9 (route + RLS test). ✓
- Account-wide timeline via `buildTimeline` → Task 10 loader. ✓
- AppShell nav activation → Task 3. ✓
- Node-only tests, no `.tsx` render tests → all tests are pure-lib or DB/RLS or source-guards; components verified by typecheck/build/visual. ✓
- "Open in Collections" link → Task 11. ✓
- Out-of-scope items (no QBO field edits, no action surfaces, no bulk, no Collections changes) → respected; Collections only gains an explicit `activeNav` prop (Task 3). ✓

**Placeholder scan:** No TBD/TODO; every code step shows the code; the one cross-task note (lifetime/standing in the loader) is spelled out with the exact computation. ✓

**Type consistency:** `AccountRow`/`AccountStanding`/`AccountFilter`/`AccountSort`/`AccountMetrics`/`AccountCaseInput`/`AccountLastContactInput` defined in Tasks 1–2 and consumed unchanged in 5/6; `STANDING_LABEL`/`STANDING_CHIP` defined in Task 5 and reused in the panel (5) and profile (11); loader return fields in Task 10 match `AccountProfile` `Props` in Task 11. ✓
