# NudgePay UI Polish Pass (Design Spec)

**Date:** 2026-06-23
**Status:** Approved (design); pending spec review → writing-plans.
**Scope:** Purely **presentational** polish of the collections dashboard. No backend/feature/loader/route/test-logic changes. Runs **before Phase 7** so later feature work inherits a consistent surface.
**Reference screenshots:** `nudgepay-app/demo-recording/app-dashboard.png`, `app-case-detail.png`, `frontend-screenshot.png` (the prototype, used as restraint inspiration only).

---

## 1. Goal

The app is feature-complete (Phase 6 done) but the dashboard reads as jumbled, squished, and unbalanced: a half-empty landing (empty detail panel), a left-sparse/right-dense work queue, mismatched KPI-tile treatments, an orphaned QuickBooks controls band, loose vertical rhythm, and redundant row text. Fix the layout and codify a small, consistent **density + elevation token system** applied across the dashboard, keeping the existing brand (copper/ink, IBM Plex + Space Grotesk).

## 2. Architecture

Work **with** the codebase grain: Tailwind-v4-utility-classes-in-JSX plus a thin `@theme` token block in `app.css`. Add a small semantic token layer (radius, elevation) + a documented density convention, then refactor the **markup and classes** of the dashboard shell and its components. No logic, loader, action, pure-module, type, or route change — so the existing 190 tests are untouched and serve as a regression guard.

**Rejected alternatives:** pushing styles into hand-written `app.css` component classes (fragments the utility model); adopting a component library (new deps, fights the bespoke brand). Both are larger than a polish pass needs.

## 3. Locked decisions (from brainstorming)

1. **Empty panel → collapse until clicked.** With no `?case` selected, the work queue renders **full width**; the detail panel mounts only when a case is selected. (Desktop now matches the existing mobile behavior.)
2. **Ambition = targeted layout fixes + a codified token system** (not a full visual refresh).
3. **Presentational-only.** No behavior, data, route, or test-logic changes; the 190 tests stay green.
4. **One accent for "active."** A single copper active treatment (ring + faint tint) across selected row, active tab, and active tile — replacing the current three different selected looks.
5. **Tiles become clickable filters** (a `<Link>` with `?view=`), differentiated from the tabs by leading with the dollar amount.

## 4. Token & density system (`app.css`)

Add to the existing `@theme` block (palette/fonts unchanged). Tailwind v4 auto-generates the utilities:

```css
/* Radii  → rounded-tile, rounded-card */
--radius-tile: 10px;
--radius-card: 12px;
/* Elevation → shadow-tile, shadow-panel */
--shadow-tile:  0 1px 2px rgba(22,32,43,.06), 0 1px 1px rgba(22,32,43,.04);
--shadow-panel: -1px 0 3px rgba(22,32,43,.05);
```

**Density convention** — every spacing value comes from this short list (replacing scattered ad-hoc `py-1.5`/`py-2`/`py-3`), applied via existing Tailwind utilities:

| Measure | Value | Applied to |
|---|---|---|
| Page gutter | `px-6` | all top-level bands |
| Band padding (vertical) | `py-3` | metrics strip, queue toolbar |
| Major block gap | `gap-6` | tiles, panel sections |
| Card padding | `p-4` | KPI tiles, panel cards |
| Control height | `h-9` (36px) | search, sort, buttons |
| Queue row | `py-2.5`, `gap-x-6` | uniform row height + column gap |

Elevation replaces the all-borders look with a calm hierarchy: tiles and the detail panel lift slightly (`shadow-tile`/`shadow-panel`); the queue stays flat.

## 5. Dashboard layout shell (`routes/dashboard.tsx`, `components/AppShell.tsx`)

1. **Move the QuickBooks controls into the topbar.** "Refresh from QuickBooks" and "Disconnect" (owner-only) move from their standalone bordered band into the `AppShell` topbar, beside the sync label + settings gear, as compact icon+label buttons. Deletes an entire horizontal band — the biggest vertical-rhythm fix.
2. **Full-width queue by default; panel mounts on selection.** When `selected == null`, render the queue alone (full width). When a case is selected, render the two-pane layout (queue `flex-1` + detail panel `w-80 xl:w-96`) with `shadow-panel` + left border. (Replaces today's always-present empty-state panel on desktop.)
3. **Even cascade.** Remaining bands are: **topbar → metrics strip → queue (+ panel)**, all on the `px-6` gutter and `py-3` rhythm.

## 6. Work queue (`components/WorkQueue.tsx`)

1. **Grid rebalance.** Replace the `grid-cols-[auto_1fr_auto_…]` template (Customer is the only flexible track, so it stretches and bunches the numeric columns at the far right). Retarget so slack is shared and metric columns distribute across the right half — direction: `[auto · minmax(200px,1.6fr) · evenly-distributed metric columns · auto]` with a uniform `gap-x-6`. **Exact track widths are tuned against the live render** (before/after screenshots); the invariant is: capped identity column, evenly distributed metric columns, no mid-row gulf.
2. **Kill the redundant "Promised."** The row's promise indicator surfaces only the actionable **"Promise broken"** state; it stays silent for pending (the Status column already shows "Promised"). Single conditional, duplication gone.
3. **Header → one toolbar.** Collapse the stacked title+count / search / sort(+Apply) bands into **one compact toolbar row** ("Work queue · N open" left; search + sort right, `h-9` controls). Remaining header = **toolbar → view tabs → column headers** (three tight rows, was five loose ones). If sort can auto-submit on change, drop the explicit Apply; otherwise keep it as a compact `h-9` button.
4. **Row consistency.** Uniform `py-2.5` row height, the existing copper left-border + faint tint on the active row, heat band aligned to the gap scale.

## 7. KPI metrics strip (`components/MetricsStrip.tsx`)

The tiles and the view tabs currently show overlapping counts. Differentiate and connect them:

1. **Tiles lead with the dollar amount** (count + label beneath) — the at-a-glance financial row; tabs remain the compact, complete filter set (they also carry Waiting and My work, which have no tile).
2. **Tiles are clickable** — each is a `<Link>` to its `?view=…` (same URL-driven selection the tabs use; no new logic).
3. **Consistent treatment.** Every tile: `rounded-tile` + `shadow-tile` + `p-4`, same internal rhythm. Remove the per-tile colored top-border and the one-off heavy border on "All open." A tile whose view is active gets the **single copper active treatment** (ring + faint tint).
4. **Breathing room.** `px-6` gutter (no longer edge-to-edge), `gap-6`, responsive grid that wraps gracefully on narrow widths instead of cramming six across.

## 8. Detail panel touch-ups (`components/DetailPanel.tsx`)

Light alignment only (it's already strong):
- The TOTAL OVERDUE / STATUS cards, the promise card, and the exception panel adopt `rounded-card` + `p-4` + `shadow-tile`.
- Field grid (Status/Next action, Owner/Phone, Email) normalized to `gap-6`; Call/Text/Email/Log buttons to `h-9`.
- Receives `shadow-panel` + left border for the slide-in seam (from §5).
No structural change.

## 9. Accessibility & constraints

- Preserve `role="tab"` on view tabs, `aria-label` on rows, and `focus-visible:ring-copper` rings. The new clickable tiles are real `<Link>`s with accessible labels + focus rings.
- **Tailwind v4:** all classes stay **static literal strings** (no `text-${x}`); the new `@theme` tokens must generate utilities in the build.
- No client → `.server` import introduced (these are client components already).

## 10. Verification (no test files change)

- `npx tsc -b` (types) → `npx react-router build` (RR7 bundler + Tailwind v4 token/utility generation) → `npx vitest run` (full suite **190/190** green, proving behavior unchanged).
- **Before/after Playwright screenshots** via the `scripts/shoot-app.mjs` helper: (a) empty/full-width landing, (b) a selected case, (c) a waiting/exception case. Visual confirmation is the acceptance gate for this pass.

## 11. Out of scope

- Any new feature, data, or behavior (Phases 7–9).
- A new palette / typography / brand identity (full visual refresh).
- Reworking the detail panel's structure (only token alignment).
- Mobile-specific redesign beyond the existing responsive behavior beginning to match desktop for the panel show/hide.

## 12. File manifest (all presentational)

**Modified:** `app/app.css` (tokens), `app/routes/dashboard.tsx` (shell: controls move, full-width default + slide-in panel, gutters), `app/components/AppShell.tsx` (topbar QBO controls), `app/components/MetricsStrip.tsx` ($-first clickable tiles + consistent treatment), `app/components/WorkQueue.tsx` (grid + toolbar + redundant-text + row density), `app/components/DetailPanel.tsx` (token alignment).

**No new files. No test files modified.** (If `MetricsStrip` inlines tile markup, a small internal `MetricTile` may be extracted within that file for clarity — not a new module.)
