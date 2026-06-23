# NudgePay Phase 5a — Collections Workspace (Design System + Shell + Work-Queue) Design

**Status:** Approved design (brainstorming output). Next step: writing-plans.

**Parent:** Phase 5 (Cutover & UI port) of the NudgePay production rebuild. Phase 5 is decomposed into 5a–5e; this spec covers **5a only**.

## 1. Goal

Replace `-app`'s placeholder `/dashboard` with a polished, secure **collections workspace** — an app shell, a metrics strip, and a two-pane work-queue + read-only detail panel — porting the UX of the `nudgepay-frontend` prototype into `-app`'s typed, server-secured, multi-tenant architecture. No new customer data path: every read is RLS-scoped through the server; the browser never touches the database.

## 2. Scope

**In 5a:** design system (Tailwind), app shell (top bar + side nav), metrics strip, work-queue (search, sort, saved views, priority/age/next-action), read-only detail panel (Overview tab), all derived intelligence computed server-side.

**Out of 5a (later slices):** contact logging + promise tracking (5b), Messages tab + Twilio templates (5c), owner/assignment (5d), Accounts/Promises/Reports nav destinations, retiring Netlify/Railway + final security review (5e).

## 3. Visual design system (frontend-design output)

The identity is grounded in the subject — an AR collections desk for **Chancey Heating & Cooling** — rather than the templated navy/blue SaaS default. Boldness is spent in one place: a **thermal aging** treatment (invoice age = temperature), which is both on-brand (a heating & cooling company) and functional (collectors scan the queue for the "hottest" accounts).

### 3.1 Color tokens (Tailwind theme)
- `ink` `#16202B` — graphite instrument-panel base; top bar + side nav.
- `panel` `#F5F6F4` — cool enameled-white app canvas (deliberately not cream).
- `surface` `#FFFFFF` — cards, table, detail panel.
- `copper` `#B7702D` — sole brand/primary-action accent (HVAC copper tubing); replaces SaaS blue.
- **Thermal spectrum (signature; used ONLY for aging/priority):** `cool` `#2E7FB8`, `warm` `#E08A1E`, `hot` `#D23B2E`. Plus tints for backgrounds (`cool/10`, `warm/10`, `hot/10`).
- Neutrals: `text` `#16202B`, `muted` `#5B667A`, `border` `#D7DEE8`.

### 3.2 Typography (Google Fonts, self-hostable later)
- **Display:** Space Grotesk — headings, the brand mark, prominent counts. Used with restraint.
- **Body / UI:** IBM Plex Sans — labels, controls, table text.
- **Numeric / data:** IBM Plex Mono — balances, ages, temperature readouts (tabular numerals aligned).
- Type scale: a defined Tailwind scale (e.g. display 28/600, h2 20/600, body 14/400, caption 12/500-uppercase-tracked for eyebrows/labels).

### 3.3 Signature — thermal aging gauge
Each work-queue row carries a **temperature band** (a short vertical/edge bar + a `COOL/WARM/HOT` label + days) instead of a generic colored pill. The band color is driven by the computed priority/age. The thermal spectrum appears nowhere else (chrome stays quiet). Reduced-motion respected; the band is static color, not animated.

### 3.4 Quality floor (non-negotiable, unannounced)
Responsive down to mobile (the two-pane collapses to stacked; the queue table switches to stacked cards via `data-label` like the prototype), visible keyboard focus rings (copper), reduced-motion honored, semantic/ARIA roles on the queue rows and tabs (carried from the prototype).

## 4. Architecture & data flow

- **Server-computed intelligence.** A new typed module `app/lib/worklist.server.ts` holds pure functions ported from the prototype `domain.js`. The `/dashboard` loader fetches RLS-scoped invoices + customers (user client), computes work items + metrics + view counts + sorted/filtered results server-side, and returns typed data ready to render. The browser does no data fetching and no computation of business state.
- **Selection via URL.** Row selection is a URL search param: `/dashboard?invoice=<id>` (and `&view=`, `&sort=`, `&q=` for view/sort/search). The loader resolves the selected account's Overview from the same RLS-scoped data. Shareable, back-button-friendly, no client store.
- **QBO controls preserved.** The shell header shows a live "QuickBooks synced …" chip from `qbo_connections.last_sync_at`, a Refresh action (reuses `/api/qbo/refresh`), and owner-only Connect/Disconnect (reuse existing `/api/qbo/connect` and `/api/qbo/disconnect`). Not-connected → the workspace shows a connect prompt instead of the queue.

## 5. Components (new, typed, Tailwind)

- `AppShell` — top bar (brand mark, workspace title, sync chip, settings, user avatar) + dark icon side-nav (Collections active; Accounts/Promises/Messages/Reports/Settings render as present-but-inert links). Layout frame; consumes loader data for header state.
- `MetricsStrip` — 4 tiles from server metrics: **30+ days past due**, **High value (≥ $5k)**, **Never contacted**, **All open** (count + dollar total each). (The prototype's "Follow-ups due" / "Broken promises" tiles depend on promise data → deferred to 5b; 5a ships the four computable today.)
- `WorkQueue` — toolbar (search input, sort `<select>`, saved-view tabs with counts) + responsive table: **Heat** (thermal band), **Customer / invoice**, **Balance** (mono), **Age**, **Last contact**, **Next action**, **Owner**. Rows are keyboard-activatable (`role="button"`, Enter/Space) and link to `?invoice=<id>`.
- `DetailPanel` — selected-account header (name, invoice, due, age, dual balance — invoice balance + customer open balance, Call/Text/Email/Log action buttons) + tabs **Overview** (populated: priority reason, next action, phone, email, open-invoice count, owner="Unassigned") / **Activity** / **Messages** (latter two: "Coming in the next update" placeholders). Call/Email buttons are `tel:`/`mailto:` links; Text routes to the existing `/invoices/:id` for now (folded into the Messages tab in 5c); Log is inert until 5b.
- `ThermalBand` / small presentational primitives (priority→heat mapping lives in the server module; the component only renders the band from a typed `heat` field).
- `Icons` — typed inline SVG set (ported from the prototype `Icons.jsx`).

## 6. Server module interface (`app/lib/worklist.server.ts`)

Pure, unit-tested functions (typed ports of `domain.js`). Indicative signatures:
- `ageInDays(dueDate: string, today: string): number`
- `heatOf(item): { band: "cool" | "warm" | "hot"; label: string }` — drives the signature.
- `priorityOf(item): { level: "Critical"|"High"|"Medium"|"Low"; tone: "hot"|"warm"|"cool"; reason: string; rank: number }`
- `nextActionOf(item): { label: string; tone: string }`
- `buildWorkItems(invoices, customers, lastContactByInvoice, today): WorkItem[]`
- `applyView(items, view): WorkItem[]` — views: `all-open`, `30-plus`, `high-value`, `never-contacted`.
- `sortItems(items, sortBy): WorkItem[]` — `recommended` (priority rank), `most-overdue`, `highest-balance`, `customer`.
- `computeMetrics(items): { thirtyPlus, highValue, neverContacted, allOpen }` (each `{ count, amount }`).

`WorkItem` is a typed shape (invoiceId, customerName, balance, dueDate, ageDays, heat, priority, nextAction, lastContact|null, owner). `lastContact` is derived from the **existing** `text_messages` (Phase 3); contact-log entries fold in at 5b.

## 7. Data reality in 5a (no schema changes)

- Priority / next-action / age / balances / metrics — derivable from `invoices.balance`/`due_date` + `customers`. ✅
- Last contact — from existing `text_messages.created_at`; "Never contacted" where none.
- Owner — no column yet (5d) → "Unassigned" everywhere.
- Saved views shipped: **All open**, **30+ days**, **High value**, **Never contacted** (the ones that compute meaningfully today). Follow-ups-due / Broken-promises arrive in 5b; My-work in 5d.

## 8. Routing

- `/dashboard` route is replaced by the collections workspace (loader + `AppShell`-wrapped `WorkQueue` + `DetailPanel`). Reads `?invoice/&view/&sort/&q` search params.
- `/invoices/:id` (Phase 3 thread) stays intact; the detail panel's Text action links to it for now. 5c folds it into the Messages tab.

## 9. Error handling & copy (frontend-design writing guidance)

- Not-connected → "Connect QuickBooks to load your collections worklist." (owner sees the Connect action; non-owner sees "Ask an owner to connect QuickBooks.")
- Empty queue / empty view → an invitation to act, not a mood ("No accounts match this view. Clear the search or pick another view.").
- Errors are specific, in the interface's voice, never raw provider errors.
- Action labels are active and consistent (the button that says "Refresh from QuickBooks" produces a "Synced …" chip). Plain verbs, sentence case.

## 10. Testing

- **TDD** the pure `worklist.server.ts` — age/heat/priority/next-action boundaries (e.g. 0/29/30/59/60/89/90 days; balance ≥ $5k threshold; never-contacted), each `applyView`, each `sortItems` ordering, and `computeMetrics` totals. This is the bulk of testable logic.
- One **loader-level integration test** against a seeded org (reusing the test helpers + per-test fresh org pattern; never global truncation; globally-unique data) asserting the composed payload (counts, a known row's heat/priority).
- Components verified by `npx tsc --noEmit` + `npx react-router build` (consistent with `-app`'s no-render-test-infra convention). Visual verification via the dev server + Chrome screenshots during the build, with a frontend-design self-critique pass.

## 11. Global constraints (inherited)

- No `node:*` in `app/**`; Web standards only.
- Security boundary intact: browser → server routes only; user client (RLS) for reads; service client server-side only; no secret/token exposure.
- Multi-tenant: all reads org-scoped via the session.
- Conventional Commits; `.env.test` gitignored.
- Tailwind v4 (already installed) is the styling system; the design tokens above become the Tailwind theme. Three Google fonts (Space Grotesk, IBM Plex Sans, IBM Plex Mono) loaded via the document head (self-hosting deferred to 5e).

## 12. Out of scope (restated)

Contact logging / promise tracking (5b), Messages/Twilio templates (5c), owner/assignment + My-work view (5d), Accounts/Promises/Reports destinations, Netlify/Railway retirement + final security review (5e).
