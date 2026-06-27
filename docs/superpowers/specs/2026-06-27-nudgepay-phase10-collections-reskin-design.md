# Phase 10 — Collections UI Re-skin — Design Spec

Date: 2026-06-27
Status: Approved (brainstorming) — pending plan
Source design: claude.ai/design project "Improving app UI cohesion"
(`7c929783-74d9-4a3c-8642-150f0f00f607`), file `NudgePay Collections.dc.html`.

## Summary

Re-skin the existing Collections dashboard (`/dashboard`) to match the approved
Claude Design canvas. The mock maps **1:1** onto the current implementation:
its top bar + icon sidebar = `AppShell`, its KPI strip = `MetricsStrip`, its work
queue = `WorkQueue`, its account panel = `DetailPanel`. The project goal is visual
cohesion, not new behavior.

**This is a pure presentation change.** Loaders, actions, route registration,
pure libraries (`worklist`, `cases`, `priority`, `timeline`, `collision`,
`comm-prefs`, `format`, etc.), forms, and all URL-driven state are untouched.
Only Tailwind utility classes, the `@theme` tokens in `app.css`, and small
presentational sub-pieces change.

### Key constraint (decided in brainstorming)

The real `DetailPanel` is **richer than the mock**. The mock omits the
priority-override control, the "Why this priority" breakdown, the on-hold
exception panel, the SMS-consent toggle, and the full SMS composer + templates.
**Decision: preserve every existing feature and restyle it** into the new visual
language. The shipped panel stays functionally complete; it is simply more
capable than the static mock. Removing any of these would be a feature
regression and is explicitly out of scope.

### Decisions (from brainstorming)

1. **Approach:** re-skin the live dashboard components in place (not a separate
   preview route, not theme-tokens-only).
2. **Topbar conflict with Phase 9:** the mock shows Refresh/Disconnect buttons in
   the top bar. Phase 9 deliberately relocated those to `/settings`, leaving only
   a sync pill that links there. **Keep Phase 9's relocation** — do not
   reintroduce Refresh/Disconnect into the top bar.
3. **Palette reach:** apply the warm palette **app-wide** via the shared `@theme`
   tokens (Collections, Settings, Reports, auth all move to the warm palette).
   Spot-check the other pages for regressions.
4. **Panel scope:** preserve all `DetailPanel` features; restyle to match.

## Visual system — theme tokens (`app/app.css`)

The signature change is a shift from today's cool-grey/white palette to a warm
parchment palette. Fonts (`Space Grotesk` / `IBM Plex Sans` / `IBM Plex Mono`)
and `ink` already match the design and stay.

| Token | Today | New | Drives |
|-------|-------|-----|--------|
| `--color-panel` | `#f5f6f4` | `#e9e4db` | app/work-area background (app-wide) |
| `--color-surface` | `#ffffff` | `#fffdf9` | cards, queue body, panel surfaces |
| `--color-paper` *(new)* | — | `#fbf8f1` | warm header bands (queue header, KPI strip) |
| `--color-border` | `#d7dee8` | `#ddd6c9` | warm hairline borders |
| `--color-copper` | `#b7702d` | `#cf8136` | brand mark, active nav rail, sync dot, KPI-active, Send |
| `--color-warm` | `#e08a1e` | `#cf8136` | warm-heat tone (aligns with the mock's copper-amber) |
| `--color-cool` | `#2e7fb8` | `#2e7fb8` | unchanged (already matches) |
| `--color-hot` | `#d23b2e` | `#d23b2e` | unchanged (already matches) |
| `--color-ink` / `--color-text` | `#16202b` | `#16202b` | unchanged |
| `--color-muted` | `#5b667a` | `#6b7689` | warm-neutral text (minor nudge) |

New radii/shadows may be added only if a component needs them; reuse
`--radius-tile`/`--radius-card`/`--shadow-tile`/`--shadow-panel` where possible.

Because these tokens are shared, the warm palette propagates to every page that
uses `bg-panel`/`bg-surface`/`border-border`. That is the intended cohesion
effect; the plan must include a spot-check of `/settings`, `/reports`, and the
auth pages.

## Component changes

### AppShell (`app/components/AppShell.tsx`)

Already matches the design's chrome (ink top bar + ink icon side-nav, copper
active rail). Changes are limited to:
- The active nav rail and active-item label/icon pick up the brighter copper via
  the token change (no structural edit needed beyond confirming tokens render).
- **No** reintroduction of Refresh/Disconnect (decision 2). The sync pill keeps
  its `Link to="/settings"`.

### MetricsStrip → KPI cards (`app/components/MetricsStrip.tsx`)

Restyle each tile to the mock's KPI card:
- A 3px **top accent bar** (copper when active, transparent otherwise).
- A header row: small **status dot** (per-metric color) + mono uppercase label.
- The big `Space Grotesk` dollar amount (kept).
- A count line: `<N>` (accent-colored) + `accounts`/`account` unit.
- Active state: copper border + copper-tint fill + top bar + soft shadow
  (replacing today's ring treatment).

Unchanged: the 7 tiles, their order, the per-tile `<Link to="?view=">`, the data
(`Metrics`), and accessibility labels.

### WorkQueue (`app/components/WorkQueue.tsx`)

- **Header band** → warm `paper`; keep the title + "matching · open" counts,
  the search input, the sort `<select>`, and the Apply button (the mock's
  "Recommended" pill corresponds to our sort control).
- **Filter tabs** → **pill style** with a count badge each: active = `ink` fill
  with light text; inactive = paper with neutral text. Same 9 saved views, same
  `viewCounts`. (Replaces the current underline tabs.)
- **Column header** → warm `paper`, mono uppercase labels.
- **Rows**:
  - Heat → a 4px **left color rail** in the heat color, plus the mono
    `WARM/COOL/HOT` label + age. (Fold `ThermalBand`'s treatment into the row;
    `ThermalBand` may be restyled or inlined — its only consumers are the queue
    row and mobile card.)
  - Selection → copper rail (inboard of the heat rail) + copper-tint row bg.
  - Status → a **soft chip** colored by status (Promised→cool, Working→copper,
    Waiting/On hold→neutral) plus the existing sub-line (`· <date>`,
    `· Promise broken`, exception label).
  - Customer name, invoice count, comm-pref badges, collision marker, total,
    oldest, last-contact two-line, owner chip — all kept, restyled.
- **Checkbox / bulk-select**, `BulkActionBar`, `BulkSmsDrawer`, the empty state,
  and the **mobile cards** — all kept and restyled to the warm palette.

### DetailPanel (`app/components/DetailPanel.tsx`)

- **Header** → a dark `ink` block: "SELECTED ACCOUNT" mono kicker, the customer
  name in `Space Grotesk`, and the "N open invoice(s) · oldest Nd overdue" line.
  Keep the close (×) control and the mobile "Back to queue" link.
- **Stat tiles** (Total overdue / Status) on a paper sub-band; Status uses the
  status chip color.
- **Action tiles** → icon+label tiles (Call / Text / Log). The mock's "Email"
  maps to the existing mail/email affordance where present; do not invent a new
  email action beyond what exists today. Preserve the call-action gating
  (`resolveCallAction`: live / blocked / hidden) and the Text/Log link targets.
- **Tabs** → underline style (Overview / Timeline / Messages), copper underline.
- **Overview tab**:
  - The mock's 2-col grid for Status / Next action / Owner / Phone, plus Email
    and the **Invoice list**, restyled.
  - A **colored status footer card** representing the promise/exception state
    (promise pending / broken / waiting / exception), styled per the mock's
    footer card, driven by the existing `promiseStatus` / `exceptionReason` data.
  - **Preserved and restyled (no mock equivalent):** the "Why this priority"
    breakdown (factors + computed score + override provenance), the
    priority-override `<form>`, the owner-assign `<select>` form, and the on-hold
    exception detail.
- **Timeline tab** → **node-style** entries: a colored icon circle + a vertical
  connector line + title/date/body. Driven by the **real** timeline data
  (`contact_logs` methods call/email/text/note + SMS direction via
  `buildTimeline`) — not the mock's invented `payment`/`reply`/`promise` event
  types. Map method → icon/color; keep the broken-promise and follow-up
  annotations.
- **Messages tab** → chat bubbles (already close): warm the palette, keep the
  consent row + toggle, the SMS-send banner, the templates, the composer, the
  collision-confirm flow, and all send-gating
  (`canSendSms`, contact-blocked, no-invoice, no-phone, do-not-text).
- **Empty state** (no account selected) → restyled to warm palette.

### Icons (`app/components/Icons.tsx`)

Add icons only if the timeline node treatment needs them (e.g. a card/payment or
reply glyph). Prefer reusing the existing set (`message`, `phone`, `mail`,
`note`, `check`, `circle`). Any addition follows the existing `paths` pattern.

## Status-chip color mapping

A small static map (literal Tailwind classes, mirroring the existing
`LEVEL_BADGE` pattern so the v4 scanner keeps them) keyed by `CaseStatus`,
reused by the queue row and the panel stat tile:
- Promised-like statuses → `cool` tint/text
- Working/active statuses → `copper` tint/text
- Waiting / on-hold → neutral (`muted`) tint/text

Exact `CaseStatus` → chip assignment is finalized in the plan against the real
`CaseStatus` union and `STATUS_LABEL`.

## Data flow

Unchanged. The loader builds `DashboardData` exactly as today; components receive
the same props and render them with new classes. No new loader reads, no new
actions, no route changes.

## Error handling

No new error paths. All existing redirect-on-error and send-gating behavior is
preserved verbatim; only its presentation changes.

## Isolation / units

Each touched file keeps its current responsibility and public props:
- `app.css` — theme tokens (single source of palette truth).
- `MetricsStrip` — KPI cards; props (`Metrics`, `view`, `sort`, `search`)
  unchanged.
- `WorkQueue` — toolbar + table/cards; props unchanged.
- `DetailPanel` — account detail; props unchanged.
- `AppShell` — frame; props unchanged.
- `ThermalBand` — may be restyled or inlined into the row; if kept, its prop
  (`heat`) is unchanged.

No public component prop signatures change, so the route files compile without
edits (any edit to `dashboard.tsx` is incidental, e.g. wrapper classes).

## Testing

Node-only harness (no jsdom; no `.tsx` render tests — established constraint).
Because no data, logic, or pure-library behavior changes, the existing suite
should stay green unchanged.

1. `npx react-router typegen && npx tsc -b` → exit 0.
2. `npx vitest run` → green (same count as `main`; this re-skin adds no tests and
   should remove none — if any existing test breaks, that signals an accidental
   behavior/structure change to investigate, not a test to delete).
3. `npx react-router build` → clean.
4. **Visual confirmation:** a Playwright screenshot pass against the seeded local
   app (login `diskin@chancey.test`), capturing the dashboard with a case
   selected across the three panel tabs, to confirm fidelity to the mock. Local
   only; screenshots/scripts are not committed.
5. **Cohesion spot-check:** load `/settings`, `/reports`, and an auth page to
   confirm the app-wide palette change reads correctly (no unreadable
   contrast, no broken cool-on-warm combinations).

## Out of scope (explicit)

- No reintroduction of Refresh/Disconnect to the top bar (Phase 9 stands).
- No changes to loaders, actions, routes, or pure libraries.
- No new features, columns, filters, or data.
- No mock-driven removal of existing panel functionality.
- The mock's invented timeline event types (`payment`/`reply`/`promise`) are a
  presentation reference only; real timeline data drives the tab.
- Activating the inert nav items (Accounts/Promises/Messages/Reports beyond
  today's behavior) — unrelated.

## Migrations

None. No schema or data changes.
