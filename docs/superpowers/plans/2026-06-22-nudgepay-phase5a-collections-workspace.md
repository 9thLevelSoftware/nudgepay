# NudgePay Phase 5a — Collections Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `-app`'s placeholder `/dashboard` with a secure, polished two-pane collections workspace (app shell + metrics + work-queue + read-only detail panel) in the "thermal-instrument" design identity, with all derived intelligence computed server-side.

**Architecture:** A pure typed module (`worklist.server.ts`, ported from the prototype `domain.js`) computes priority/heat/next-action/views/metrics from RLS-scoped invoice + customer + text-message data. The `/dashboard` loader composes it and returns ready-to-render typed data; the browser does no data fetching. Presentational components (AppShell, MetricsStrip, WorkQueue, DetailPanel, ThermalBand, Icons) render that data in Tailwind v4 using the thermal-instrument theme tokens. Row selection is a URL search param.

**Tech Stack:** React Router v7 (framework mode) on Cloudflare Workers, Supabase (user client/RLS for reads), Tailwind v4 (CSS-first `@theme` in `app/app.css`), Google Fonts (Space Grotesk, IBM Plex Sans, IBM Plex Mono), Vitest.

## Global Constraints

Copied from the Phase 5a design spec (`docs/superpowers/specs/2026-06-22-nudgepay-phase5a-collections-workspace-design.md`) and the project invariants. Bind every task.

- **Design tokens (exact hex):** `ink #16202B`, `panel #F5F6F4`, `surface #FFFFFF`, `copper #B7702D`, thermal `cool #2E7FB8` / `warm #E08A1E` / `hot #D23B2E`, `text #16202B`, `muted #5B667A`, `border #D7DEE8`. Thermal spectrum is used ONLY for aging/priority; copper is the sole brand/action accent; chrome is `ink`. Every color in a component must be a theme token — no ad-hoc hex.
- **Fonts:** display **Space Grotesk**, body/UI **IBM Plex Sans**, numeric/data **IBM Plex Mono** (tabular figures for balances/ages). No Inter.
- **Signature:** the thermal aging band (cool→warm→hot) on each work-queue row; spend boldness only here, keep the rest quiet (frontend-design).
- **Security boundary:** browser → server routes only; reads via the user (RLS) client; service client server-side only; never expose tokens/secrets. No browser→DB.
- **No `node:*` in `app/**`** (Web standards only); `node:fs` only in `tests/**`.
- **Multi-tenant:** all reads org-scoped via the session (`requireUser` + `resolveOrg`).
- **Quality floor (unannounced):** responsive to mobile (two-pane stacks; table → stacked cards), visible keyboard focus (copper ring), reduced-motion respected, ARIA roles on queue rows + tabs.
- **Copy (frontend-design writing):** active voice, sentence case, specific; empty/error states give direction in the interface's voice, never raw provider errors.
- **Tests:** run against shared local Supabase in parallel — NEVER global-truncate; per-test fresh org + org-scoped assertions + globally-unique data. No live external calls.
- **Conventional Commits** (`feat:`/`test:`/`docs:`/`refactor:`); `.env.test` gitignored.
- **Verification floor:** logic/route tasks → `npx vitest run <file>` + `npx tsc --noEmit` + `npx react-router build`; presentational tasks → `npx tsc --noEmit` + `npx react-router build` (no render-test infra exists — do NOT add one). Visual verification is performed by the controller via the dev server + Chrome after Task 6, with a frontend-design self-critique pass.

---

## File Structure

- `app/app.css` — **Modify.** Add thermal-instrument tokens to `@theme` (colors + 3 font families).
- `app/root.tsx` — **Modify.** Swap the Inter `<link>` for Space Grotesk + IBM Plex Sans + IBM Plex Mono.
- `app/lib/worklist.server.ts` — **Create.** Pure typed logic: types + `ageInDays`/`heatOf`/`priorityOf`/`nextActionOf`/`buildWorkItems`/`applyView`/`sortItems`/`computeMetrics`.
- `tests/worklist.test.ts` — **Create.** Unit tests (TDD) for the module.
- `app/components/Icons.tsx` — **Create.** Typed inline-SVG icon set (port of prototype `Icons.jsx`).
- `app/components/ThermalBand.tsx` — **Create.** Presentational heat band.
- `app/components/AppShell.tsx` — **Create.** Top bar + side nav frame.
- `app/components/MetricsStrip.tsx` — **Create.** 4 metric tiles.
- `app/components/WorkQueue.tsx` — **Create.** Toolbar + responsive queue table.
- `app/components/DetailPanel.tsx` — **Create.** Selected-account header + Overview/placeholder tabs.
- `app/routes/dashboard.tsx` — **Replace.** Loader composes `worklist.server.ts` over RLS data + search params; page wires the components.
- `tests/dashboard-worklist.test.ts` — **Create.** Loader-level integration test for the composed payload.

Components are presentational and props-driven (typed); all business state is computed in `worklist.server.ts` and threaded through the loader.

---

## Task 1: Design tokens + fonts

**Files:**
- Modify: `nudgepay-app/app/app.css`
- Modify: `nudgepay-app/app/root.tsx:13-24` (the `links` function)

**Interfaces:**
- Produces: Tailwind theme utilities `bg-ink`, `bg-panel`, `bg-surface`, `text-copper`, `bg-copper`, `text-cool/warm/hot`, `bg-cool/warm/hot`, `border-border`, `text-muted`, and font utilities `font-display`, `font-sans`, `font-mono`. Later tasks use these class names verbatim.

- [ ] **Step 1: Replace the `@theme` block in `app/app.css`**

```css
@import "tailwindcss" source(".");

@theme {
	--font-display: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
	--font-sans: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
	--font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;

	--color-ink: #16202b;
	--color-panel: #f5f6f4;
	--color-surface: #ffffff;
	--color-copper: #b7702d;
	--color-cool: #2e7fb8;
	--color-warm: #e08a1e;
	--color-hot: #d23b2e;
	--color-text: #16202b;
	--color-muted: #5b667a;
	--color-border: #d7dee8;
}

html,
body {
	@apply bg-panel text-text;
	font-family: var(--font-sans);
}
```

- [ ] **Step 2: Swap the font `<link>`s in `app/root.tsx`**

Replace the Inter stylesheet link object (the 3rd entry of `links`) with the three-family Google Fonts URL; keep the two `preconnect` entries:

```tsx
		{
			rel: "stylesheet",
			href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap",
		},
```

- [ ] **Step 3: Verify typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: both succeed. (Tailwind v4 generates the new color/font utilities from `@theme`; no `tailwind.config` needed.)

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/app.css nudgepay-app/app/root.tsx
git commit -m "feat: add thermal-instrument design tokens and fonts"
```

---

## Task 2: `worklist.server.ts` — derived-intelligence module (TDD)

**Files:**
- Create: `nudgepay-app/app/lib/worklist.server.ts`
- Create: `nudgepay-app/tests/worklist.test.ts`

**Interfaces:**
- Produces (consumed by the loader in Task 6 and the components in Tasks 4–5):

```ts
export type HeatBand = "cool" | "warm" | "hot";
export type Heat = { band: HeatBand; label: "COOL" | "WARM" | "HOT"; days: number };
export type Priority = { level: "Critical" | "High" | "Medium" | "Low"; tone: HeatBand; reason: string; rank: number };
export type NextAction = { label: string; tone: HeatBand | "neutral" };
export type LastContact = { date: string; channel: string } | null;

export type WorkItem = {
  invoiceId: string;
  docNumber: string | null;
  customerId: string | null;
  customerName: string;
  phone: string | null;
  email: string | null;
  owner: string;          // always "Unassigned" in 5a
  balance: number;
  customerBalance: number;
  dueDate: string | null;
  ageDays: number;        // positive = overdue
  heat: Heat;
  priority: Priority;
  nextAction: NextAction;
  lastContact: LastContact;
  invoiceCount: number;
  searchText: string;
};

export type Metric = { count: number; amount: number };
export type Metrics = { thirtyPlus: Metric; highValue: Metric; neverContacted: Metric; allOpen: Metric };
export type ViewId = "all-open" | "30-plus" | "high-value" | "never-contacted";
export type SortId = "recommended" | "most-overdue" | "highest-balance" | "customer";

// Inputs to buildWorkItems:
export type InvoiceInput = { id: string; qbo_doc_number: string | null; customer_id: string | null; balance: number; due_date: string | null };
export type CustomerInput = { id: string; name: string; phone: string | null; email: string | null };
export type LastContactInput = { invoiceId: string; date: string; channel: string };
```

Function signatures: `ageInDays(dueDate: string, today: string): number`, `heatOf(ageDays: number): Heat`, `priorityOf(ageDays: number, neverContacted: boolean): Priority`, `nextActionOf(ageDays: number, neverContacted: boolean): NextAction`, `buildWorkItems(invoices: InvoiceInput[], customers: CustomerInput[], lastContacts: LastContactInput[], today: string): WorkItem[]`, `applyView(items: WorkItem[], view: ViewId): WorkItem[]`, `sortItems(items: WorkItem[], sort: SortId): WorkItem[]`, `computeMetrics(items: WorkItem[]): Metrics`, `HIGH_VALUE_THRESHOLD = 5000`.

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/worklist.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  ageInDays, heatOf, priorityOf, nextActionOf, buildWorkItems,
  applyView, sortItems, computeMetrics,
} from "../app/lib/worklist.server";

const TODAY = "2026-06-22";

test("ageInDays counts whole days overdue (UTC, positive = overdue)", () => {
  expect(ageInDays("2026-06-12", TODAY)).toBe(10);
  expect(ageInDays("2026-06-22", TODAY)).toBe(0);
  expect(ageInDays("2026-06-25", TODAY)).toBe(-3);
});

test("heatOf bands at 30 and 90 day boundaries", () => {
  expect(heatOf(0).band).toBe("cool");
  expect(heatOf(29).band).toBe("cool");
  expect(heatOf(30).band).toBe("warm");
  expect(heatOf(89).band).toBe("warm");
  expect(heatOf(90).band).toBe("hot");
  expect(heatOf(90).label).toBe("HOT");
  expect(heatOf(45).days).toBe(45);
});

test("priorityOf escalates by age and notes never-contacted", () => {
  expect(priorityOf(95, false).level).toBe("Critical");
  expect(priorityOf(95, false).tone).toBe("hot");
  expect(priorityOf(95, true).reason).toContain("never contacted");
  expect(priorityOf(70, false).level).toBe("High");
  expect(priorityOf(45, false).level).toBe("Medium");
  expect(priorityOf(10, false).level).toBe("Low");
  // rank: Critical < High < Medium < Low (lower sorts first)
  expect(priorityOf(95, false).rank).toBeLessThan(priorityOf(10, false).rank);
});

test("nextActionOf recommends contact-today for aged never-contacted", () => {
  expect(nextActionOf(40, true).label).toBe("Contact today");
  expect(nextActionOf(40, true).tone).toBe("hot");
  expect(nextActionOf(5, true).label).toBe("Make first contact");
  expect(nextActionOf(95, false).label).toBe("Escalate");
  expect(nextActionOf(20, false).label).toBe("Follow up");
});

test("buildWorkItems joins invoice+customer, derives fields, owner=Unassigned", () => {
  const items = buildWorkItems(
    [
      { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 6000, due_date: "2026-03-01" },
      { id: "i2", qbo_doc_number: "1002", customer_id: "c1", balance: 500, due_date: "2026-06-10" },
    ],
    [{ id: "c1", name: "Acme", phone: "+13105550101", email: "ap@acme.test" }],
    [{ invoiceId: "i2", date: "2026-06-15T10:00:00Z", channel: "Text" }],
    TODAY,
  );
  const i1 = items.find((x) => x.invoiceId === "i1")!;
  expect(i1.customerName).toBe("Acme");
  expect(i1.owner).toBe("Unassigned");
  expect(i1.customerBalance).toBe(6500);
  expect(i1.invoiceCount).toBe(2);
  expect(i1.heat.band).toBe("hot");        // >90 days
  expect(i1.lastContact).toBeNull();        // i1 never contacted
  expect(items.find((x) => x.invoiceId === "i2")!.lastContact?.channel).toBe("Text");
});

test("applyView filters by each view id", () => {
  const items = buildWorkItems(
    [
      { id: "a", qbo_doc_number: "1", customer_id: "c", balance: 6000, due_date: "2026-03-01" }, // hot, high-value, never
      { id: "b", qbo_doc_number: "2", customer_id: "c", balance: 200, due_date: "2026-06-18" },  // cool, low-value
    ],
    [{ id: "c", name: "C", phone: null, email: null }],
    [{ invoiceId: "b", date: "2026-06-19T00:00:00Z", channel: "Text" }],
    TODAY,
  );
  expect(applyView(items, "all-open").length).toBe(2);
  expect(applyView(items, "30-plus").map((x) => x.invoiceId)).toEqual(["a"]);
  expect(applyView(items, "high-value").map((x) => x.invoiceId)).toEqual(["a"]);
  expect(applyView(items, "never-contacted").map((x) => x.invoiceId)).toEqual(["a"]);
});

test("sortItems orders by the chosen key", () => {
  const items = buildWorkItems(
    [
      { id: "old", qbo_doc_number: "1", customer_id: "c", balance: 100, due_date: "2026-01-01" },
      { id: "big", qbo_doc_number: "2", customer_id: "c", balance: 9000, due_date: "2026-06-10" },
    ],
    [{ id: "c", name: "C", phone: null, email: null }],
    [],
    TODAY,
  );
  expect(sortItems(items, "most-overdue")[0].invoiceId).toBe("old");
  expect(sortItems(items, "highest-balance")[0].invoiceId).toBe("big");
});

test("computeMetrics totals count and amount per bucket", () => {
  const items = buildWorkItems(
    [
      { id: "a", qbo_doc_number: "1", customer_id: "c", balance: 6000, due_date: "2026-03-01" }, // 30+, high-value, never
      { id: "b", qbo_doc_number: "2", customer_id: "c", balance: 400, due_date: "2026-06-19" },  // recent, contacted
    ],
    [{ id: "c", name: "C", phone: null, email: null }],
    [{ invoiceId: "b", date: "2026-06-20T00:00:00Z", channel: "Text" }],
    TODAY,
  );
  const m = computeMetrics(items);
  expect(m.allOpen).toEqual({ count: 2, amount: 6400 });
  expect(m.thirtyPlus).toEqual({ count: 1, amount: 6000 });
  expect(m.highValue).toEqual({ count: 1, amount: 6000 });
  expect(m.neverContacted).toEqual({ count: 1, amount: 6000 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd nudgepay-app && npx vitest run tests/worklist.test.ts`
Expected: FAIL — `Failed to resolve import "../app/lib/worklist.server"`.

- [ ] **Step 3: Implement `app/lib/worklist.server.ts`**

```ts
// Pure derived-intelligence for the collections worklist. No I/O. Ported and
// typed from the prototype domain.js. Computed server-side; the browser only
// renders the result.

export type HeatBand = "cool" | "warm" | "hot";
export type Heat = { band: HeatBand; label: "COOL" | "WARM" | "HOT"; days: number };
export type Priority = { level: "Critical" | "High" | "Medium" | "Low"; tone: HeatBand; reason: string; rank: number };
export type NextAction = { label: string; tone: HeatBand | "neutral" };
export type LastContact = { date: string; channel: string } | null;

export type WorkItem = {
  invoiceId: string;
  docNumber: string | null;
  customerId: string | null;
  customerName: string;
  phone: string | null;
  email: string | null;
  owner: string;
  balance: number;
  customerBalance: number;
  dueDate: string | null;
  ageDays: number;
  heat: Heat;
  priority: Priority;
  nextAction: NextAction;
  lastContact: LastContact;
  invoiceCount: number;
  searchText: string;
};

export type Metric = { count: number; amount: number };
export type Metrics = { thirtyPlus: Metric; highValue: Metric; neverContacted: Metric; allOpen: Metric };
export type ViewId = "all-open" | "30-plus" | "high-value" | "never-contacted";
export type SortId = "recommended" | "most-overdue" | "highest-balance" | "customer";

export type InvoiceInput = { id: string; qbo_doc_number: string | null; customer_id: string | null; balance: number; due_date: string | null };
export type CustomerInput = { id: string; name: string; phone: string | null; email: string | null };
export type LastContactInput = { invoiceId: string; date: string; channel: string };

export const HIGH_VALUE_THRESHOLD = 5000;

function dayNumber(value: string): number {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function ageInDays(dueDate: string, today: string): number {
  return dayNumber(today) - dayNumber(dueDate);
}

export function heatOf(ageDays: number): Heat {
  if (ageDays >= 90) return { band: "hot", label: "HOT", days: ageDays };
  if (ageDays >= 30) return { band: "warm", label: "WARM", days: ageDays };
  return { band: "cool", label: "COOL", days: ageDays };
}

export function priorityOf(ageDays: number, neverContacted: boolean): Priority {
  if (ageDays >= 90) {
    const reason = neverContacted ? `${ageDays} days overdue, never contacted` : `${ageDays} days overdue`;
    return { level: "Critical", tone: "hot", reason, rank: 0 };
  }
  if (ageDays >= 60) return { level: "High", tone: "warm", reason: `${ageDays} days overdue`, rank: 1 };
  if (ageDays >= 30) return { level: "Medium", tone: "warm", reason: `${ageDays} days overdue`, rank: 2 };
  return { level: "Low", tone: "cool", reason: ageDays > 0 ? `${ageDays} days overdue` : "Not yet due", rank: 3 };
}

export function nextActionOf(ageDays: number, neverContacted: boolean): NextAction {
  if (neverContacted && ageDays >= 30) return { label: "Contact today", tone: "hot" };
  if (neverContacted) return { label: "Make first contact", tone: "warm" };
  if (ageDays >= 90) return { label: "Escalate", tone: "hot" };
  return { label: "Follow up", tone: "warm" };
}

export function buildWorkItems(
  invoices: InvoiceInput[], customers: CustomerInput[], lastContacts: LastContactInput[], today: string,
): WorkItem[] {
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const lastByInvoice = new Map(lastContacts.map((l) => [l.invoiceId, l]));
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
      invoiceCount: inv.customer_id ? customerInvoiceCount.get(inv.customer_id) ?? 1 : 1,
      searchText: [name, inv.qbo_doc_number ?? "", cust?.phone ?? "", cust?.email ?? ""].join(" ").toLowerCase(),
    };
  });
}

export function applyView(items: WorkItem[], view: ViewId): WorkItem[] {
  if (view === "30-plus") return items.filter((i) => i.ageDays >= 30);
  if (view === "high-value") return items.filter((i) => i.balance >= HIGH_VALUE_THRESHOLD);
  if (view === "never-contacted") return items.filter((i) => i.lastContact === null);
  return items;
}

export function sortItems(items: WorkItem[], sort: SortId): WorkItem[] {
  const copy = [...items];
  if (sort === "most-overdue") return copy.sort((a, b) => b.ageDays - a.ageDays);
  if (sort === "highest-balance") return copy.sort((a, b) => b.balance - a.balance);
  if (sort === "customer") return copy.sort((a, b) => a.customerName.localeCompare(b.customerName));
  return copy.sort((a, b) => a.priority.rank - b.priority.rank || b.ageDays - a.ageDays || b.balance - a.balance);
}

export function computeMetrics(items: WorkItem[]): Metrics {
  const bucket = (pred: (i: WorkItem) => boolean): Metric => {
    const matched = items.filter(pred);
    return { count: matched.length, amount: matched.reduce((s, i) => s + i.balance, 0) };
  };
  return {
    thirtyPlus: bucket((i) => i.ageDays >= 30),
    highValue: bucket((i) => i.balance >= HIGH_VALUE_THRESHOLD),
    neverContacted: bucket((i) => i.lastContact === null),
    allOpen: bucket(() => true),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/worklist.test.ts && npx tsc --noEmit`
Expected: all tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/worklist.server.ts nudgepay-app/tests/worklist.test.ts
git commit -m "feat: add server-side worklist intelligence module"
```

---

## Task 3: Icons + ThermalBand + AppShell (chrome)

**Files:**
- Create: `nudgepay-app/app/components/Icons.tsx`
- Create: `nudgepay-app/app/components/ThermalBand.tsx`
- Create: `nudgepay-app/app/components/AppShell.tsx`

**Interfaces:**
- Consumes: theme tokens from Task 1; `Heat`/`HeatBand` types from Task 2.
- Produces:
  - `Icon({ name, size?, className?, title? })` — `name` ∈ the prototype set (`menu,settings,circle,user,check,message,note,search,filter,arrowDownUp,alert,bookmark,phone,mail,external,calendar,chevronRight,plus`).
  - `ThermalBand({ heat }: { heat: Heat })` — renders the signature band.
  - `AppShell({ orgName, userInitials, syncLabel, connected, isOwner, children })` — the frame; `children` is the page body.

**Implementation notes (build to the design spec §3; craft the markup, derive every color/font from theme tokens):**
- **Icons.tsx** — port `nudgepay-frontend/src/components/Icons.jsx` verbatim to TSX with a typed `name` union and `size?: number; className?: string; title?: string`. Same SVG paths.
- **ThermalBand.tsx** — the signature. A short bar + `HEAT.label` + `{heat.days}d`, colored by `heat.band` → `cool`/`warm`/`hot` token (text + a subtle `bg-{band}/10` chip; the bar itself is the saturated band color). Mono font for the day count. Static color (no animation; reduced-motion safe by construction).
- **AppShell.tsx** — `ink` top bar: brand mark (`font-display`, copper accent on "Nudge"), workspace title "Collections", a right-side live sync chip (`syncLabel`, a small status dot — copper if `connected` else `muted`), settings + avatar (`userInitials`). `ink` left icon side-nav: Collections (active, copper indicator) + Accounts/Promises/Messages/Reports/Settings as inert `muted` links (cursor-default, `aria-disabled`). Main area renders `children` on `panel`. Responsive: side-nav collapses to a top sheet/hidden behind the menu icon under `md`. Visible copper focus rings on all interactive chrome.

- [ ] **Step 1: Create the three components per the notes above**, using only theme tokens and the three font families. (No tests — presentational; gated by typecheck + build + the controller's visual pass after Task 6.)

- [ ] **Step 2: Verify typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add nudgepay-app/app/components/Icons.tsx nudgepay-app/app/components/ThermalBand.tsx nudgepay-app/app/components/AppShell.tsx
git commit -m "feat: add app shell, icons, and thermal-band components"
```

---

## Task 4: MetricsStrip + WorkQueue

**Files:**
- Create: `nudgepay-app/app/components/MetricsStrip.tsx`
- Create: `nudgepay-app/app/components/WorkQueue.tsx`

**Interfaces:**
- Consumes: `WorkItem`, `Metrics`, `ViewId`, `SortId`, `Heat` from Task 2; `Icon`, `ThermalBand` from Task 3; theme tokens.
- Produces:
  - `MetricsStrip({ metrics }: { metrics: Metrics })` — 4 tiles: **30+ days past due** (`thirtyPlus`), **High value** (`highValue`), **Never contacted** (`neverContacted`), **All open** (`allOpen`). Each shows count (`font-display`) + dollar total (`font-mono`, via `Intl.NumberFormat` USD) + a label. The 30+/never tiles carry a subtle `hot`/`warm` accent; high-value/all-open stay neutral copper/ink.
  - `WorkQueue({ items, view, sort, search, selectedInvoiceId, totalCount, viewCounts })` — renders a toolbar + table. It is a **presentational** component: view/sort/search controls are an RR7 `<Form method="get">` (GET) whose inputs are named `view`, `sort`, `q` and submit on change, and saved-view tabs are `<Link>`s to `?view=<id>` (preserving `q`/`sort`). Rows are `<Link to={?invoice=<id>&...}>` styled as table rows with `role="button"`-equivalent semantics and visible focus. Columns: **Heat** (`<ThermalBand>`), **Customer / invoice** (name `font-sans` + doc `font-mono muted`), **Balance** (`font-mono`, right-aligned), **Age** (`{ageDays}d` or "Due in Nd"), **Last contact** (date + channel, or "Never contacted" `muted`), **Next action** (toned label), **Owner** (chip, "Unassigned"). Selected row gets a copper left-border + tint.

**Implementation notes:** saved views in 5a are exactly `All open / 30+ days / High value / Never contacted` with `viewCounts[view]` shown. Sort options: `Recommended / Most overdue / Highest balance / Customer`. Responsive: under `md`, the table becomes stacked cards (carry the prototype's `data-label` approach). Empty view → an empty state with direction ("No accounts match this view. Clear the search or pick another view."). Balance/age use `font-mono` tabular figures.

- [ ] **Step 1: Create both components per the notes**, theme tokens only, GET-form + Link navigation (no client fetching/state). 

- [ ] **Step 2: Verify typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add nudgepay-app/app/components/MetricsStrip.tsx nudgepay-app/app/components/WorkQueue.tsx
git commit -m "feat: add metrics strip and work-queue components"
```

---

## Task 5: DetailPanel

**Files:**
- Create: `nudgepay-app/app/components/DetailPanel.tsx`

**Interfaces:**
- Consumes: `WorkItem` from Task 2; `Icon` from Task 3; theme tokens.
- Produces: `DetailPanel({ selected, activeTab }: { selected: WorkItem | null; activeTab: "overview" | "activity" | "messages" })`.

**Implementation notes:**
- `selected === null` → empty state aside ("Select an account from the work queue." + a line about what will appear).
- Header: kicker "Selected account", customer name (`font-display`), line `{docNumber} · Due {date} · {ageDays}d overdue`, dual balance grid (Invoice balance / Customer open balance, `font-mono`), action row: **Call** (`<a href="tel:...">`), **Text** (`<Link to={/invoices/:invoiceId}>` — the existing Phase 3 thread), **Email** (`<a href="mailto:...">`), **Log** (button, `disabled`, title "Coming with contact logging"). Call/Email disabled if no phone/email.
- Tabs (`<Link>` to `?invoice=...&tab=overview|activity|messages`, preserving other params; `role="tab"`): **Overview** populated (priority reason, next action, owner "Unassigned", phone, email, open-invoice count — an info grid with toned priority/next-action); **Activity** + **Messages** render a "Coming in the next update" placeholder with a one-line description.
- Copper focus rings; responsive (under `md` the panel is full-width below the queue with a "Close" affordance that links back to the queue without `?invoice`).

- [ ] **Step 1: Create the component per the notes**, theme tokens only.

- [ ] **Step 2: Verify typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add nudgepay-app/app/components/DetailPanel.tsx
git commit -m "feat: add detail panel with read-only overview"
```

---

## Task 6: Dashboard route — loader + composition (replace existing) + integration test

**Files:**
- Replace: `nudgepay-app/app/routes/dashboard.tsx`
- Create: `nudgepay-app/tests/dashboard-worklist.test.ts`

**Interfaces:**
- Consumes: everything above. `requireUser`, `resolveOrg` (`app/lib/session.server`), `getEnv`/`getQboEnv` (`app/lib/env.server`), `createSupabaseServiceClient` (`app/lib/supabase.server`), `getConnectionStatus` (`app/lib/qbo-connection.server`).
- Produces: the `/dashboard` page; an exported pure helper `buildDashboardData(invoices, customers, lastContacts, params, today)` that returns `{ items, metrics, viewCounts, selected }` so the integration test can assert the composition without cookies.

**Loader behavior:** `requireUser` → `resolveOrg` (→ `/onboarding` if none). Read connection status (service client) for the header sync chip. If connected: read RLS-scoped past-due invoices (`balance > 0`, `due_date < today`, user client) with `customers(name, phone, email)` embed, and the latest outbound `text_messages` per invoice for `lastContact` (user client, `direction=outbound`, order by `created_at desc`). Compute via `buildDashboardData` using `?view`/`?sort`/`?q`/`?invoice` search params (defaults: view `all-open`, sort `recommended`, q ``). Return typed data + headers.

**`buildDashboardData` (pure, the testable seam):** builds work items (`buildWorkItems`), applies search (`searchText.includes(q)`), `applyView`, `sortItems`, computes `computeMetrics` over the **search-but-not-view-filtered** set for tile totals and `viewCounts` per view, and resolves `selected` = the item whose `invoiceId === params.invoice` (from the full set), or null.

- [ ] **Step 1: Write the failing integration test**

Create `nudgepay-app/tests/dashboard-worklist.test.ts` — exercises `buildDashboardData` (pure) AND a DB-backed seed proving RLS read shape. Per the project's test invariant: a per-test fresh org, globally-unique data, no global truncation.

```ts
import { expect, test, beforeAll } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { buildDashboardData } from "../app/routes/dashboard";

const TODAY = "2026-06-22";

test("buildDashboardData composes items, metrics, viewCounts, and selection", () => {
  const invoices = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 6000, due_date: "2026-03-01" },
    { id: "i2", qbo_doc_number: "1002", customer_id: "c1", balance: 300, due_date: "2026-06-18" },
  ];
  const customers = [{ id: "c1", name: "Acme", phone: "+13105550101", email: "ap@acme.test" }];
  const lastContacts = [{ invoiceId: "i2", date: "2026-06-19T00:00:00Z", channel: "Text" }];
  const data = buildDashboardData(invoices, customers, lastContacts,
    { view: "30-plus", sort: "recommended", q: "", invoice: "i1" }, TODAY);

  expect(data.metrics.allOpen.count).toBe(2);
  expect(data.viewCounts["30-plus"]).toBe(1);
  expect(data.items.map((i) => i.invoiceId)).toEqual(["i1"]); // 30-plus view
  expect(data.selected?.invoiceId).toBe("i1");
  expect(data.selected?.heat.band).toBe("hot");
});

test("buildDashboardData search filters across customer/invoice/contact text", () => {
  const invoices = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 6000, due_date: "2026-03-01" },
    { id: "i2", qbo_doc_number: "2002", customer_id: "c2", balance: 800, due_date: "2026-04-01" },
  ];
  const customers = [
    { id: "c1", name: "Acme", phone: null, email: null },
    { id: "c2", name: "Globex", phone: null, email: null },
  ];
  const data = buildDashboardData(invoices, customers, [],
    { view: "all-open", sort: "recommended", q: "globex", invoice: null }, TODAY);
  expect(data.items.map((i) => i.invoiceId)).toEqual(["i2"]);
  expect(data.metrics.allOpen.count).toBe(1); // metrics reflect the search set
});

// DB-backed: proves the RLS-scoped read shape the loader relies on.
let user: Awaited<ReturnType<typeof makeUserClient>>;
let orgId: string;
beforeAll(async () => {
  const svc = serviceClient();
  user = await makeUserClient("worklist-reader@example.com");
  const { data: org } = await svc.from("organizations").insert({ name: "Worklist Org" }).select("id").single();
  orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "wl-c1", name: "Riverside", phone: "+13105559001", sms_consent: true })
    .select("id").single();
  await svc.from("invoices").insert({
    org_id: orgId, qbo_id: "wl-i1", qbo_doc_number: "9001", customer_id: cust!.id,
    amount: 4850, balance: 4850, due_date: "2026-03-01", status: "overdue",
  });
});

test("RLS user client reads only the member's past-due invoices with customer embed", async () => {
  const today = TODAY;
  const { data: rows, error } = await user.client
    .from("invoices")
    .select("id, qbo_doc_number, balance, due_date, customer_id, customers(name, phone, email)")
    .eq("org_id", orgId).gt("balance", 0).lt("due_date", today);
  expect(error).toBeNull();
  expect(rows!.length).toBe(1);
  expect((rows![0] as any).customers.name).toBe("Riverside");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd nudgepay-app && npx vitest run tests/dashboard-worklist.test.ts`
Expected: FAIL — `buildDashboardData` not exported from `../app/routes/dashboard`.

- [ ] **Step 3: Replace `app/routes/dashboard.tsx`** with the loader + `buildDashboardData` + the composed page (AppShell › MetricsStrip + WorkQueue + DetailPanel). The loader reads search params, fetches RLS-scoped invoices + per-invoice latest outbound text (for `lastContact`), calls `buildDashboardData`, and returns typed data with `headers`. The page reads `useLoaderData` and renders the components; `selected`/`view`/`sort`/`q`/`tab` come from the loader data. Not-connected → render the AppShell with a connect prompt (owner: a Connect form to `/api/qbo/connect`; non-owner: "Ask an owner to connect QuickBooks."). Keep a Refresh form to `/api/qbo/refresh` and owner Disconnect form to `/api/qbo/disconnect` in the shell header/menu. (Write the full loader + `buildDashboardData` + page here; derive `lastContacts` by mapping each invoice's latest outbound `text_messages.created_at` → `{ invoiceId, date, channel: "Text" }`.)

- [ ] **Step 4: Run tests + typecheck + build**

Run: `cd nudgepay-app && npx vitest run tests/dashboard-worklist.test.ts && npx tsc --noEmit && npx react-router build`
Expected: tests pass; typecheck clean; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/routes/dashboard.tsx nudgepay-app/tests/dashboard-worklist.test.ts
git commit -m "feat: compose collections workspace dashboard with worklist loader"
```

- [ ] **Step 6: Visual verification (controller, after the task review)**

The controller runs `npm run dev`, re-seeds demo data (`scripts/demo-seed.mjs`), logs in (`diskin@chancey.test` / `password123`), and screenshots the workspace (queue, selected Overview, metrics, mobile width) via Chrome. Apply a frontend-design self-critique against design spec §3 (tokens used correctly, thermal signature reads, type roles correct, responsive, focus visible, "remove one accessory"). File any refinements as a fix pass.

---

## Final Verification (whole-branch, before merge)

- [ ] Full suite green: `cd nudgepay-app && npx vitest run`.
- [ ] `npx tsc --noEmit` clean; `npx react-router build` succeeds.
- [ ] Controller visual pass complete (screenshots reviewed; frontend-design critique applied).
- [ ] Dispatch the final whole-branch code review (most-capable model).

## Out of Scope (later slices — do NOT build in 5a)

Contact logging + promise tracking (5b), Messages tab + Twilio templates (5c), owner/assignment + My-work view (5d), Accounts/Promises/Reports destinations, Netlify/Railway retirement + final security review (5e).
