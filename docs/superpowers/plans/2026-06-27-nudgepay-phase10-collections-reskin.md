# Phase 10 — Collections UI Re-skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the existing Collections dashboard (`/dashboard`) to match the approved Claude Design canvas — a warm parchment palette, KPI cards, pill filter tabs, a dark detail-panel header, and node-style timeline — changing only presentation.

**Architecture:** Pure presentation change. The shared `@theme` tokens in `app/app.css` carry the palette shift app-wide; each existing component (`MetricsStrip`, `WorkQueue`, `DetailPanel`, `AppShell`, `ThermalBand`) is restyled in place with new Tailwind utility classes. One small pure helper (`status-style.ts`) centralizes the status-chip tone. No loaders, actions, routes, pure-library behavior, component props, forms, or URL state change.

**Tech Stack:** React Router 7 (framework mode), Tailwind CSS v4 (`@theme`), TypeScript, Vitest (node env — no jsdom, no `.tsx` render tests), Supabase/Postgres (DB-backed tests).

## Global Constraints

- **Presentation only.** Do NOT change loaders, actions, route registration, pure libraries (`worklist`, `cases`, `priority`, `timeline`, `collision`, `comm-prefs`, `format`, `channel-actions`, `exceptions`, `bulk`, `sms-templates`), forms, `action=`/`method=` attributes, hidden inputs, `returnTo` values, `name=` attributes, URL params, or any event handler. Change only JSX class strings, element wrappers, the theme tokens, and the presentational sub-structures this plan specifies.
- **No component prop signature changes.** Every component keeps its current props so `dashboard.tsx` compiles without edits. Any edit to a route file is incidental (wrapper classes only) and must be called out.
- **Preserve every existing feature.** Especially in `DetailPanel`: the priority-override form, the "Why this priority" breakdown, the on-hold exception panel, the owner-assign select, the SMS-consent toggle/row, the full SMS composer + templates, the cancel-promise form, the collision banners/confirm flow, and all send-gating (`canSendSms`, contact-blocked, no-invoice, no-phone, do-not-text). Restyle them; never remove them.
- **Tailwind v4 scanner rule:** class names must be literal strings. No `text-${x}` interpolation. Use static `Record` maps keyed by a semantic token, exactly as the existing code does (`LEVEL_BADGE`, `TONE_CLASS`, `BUBBLE`).
- **Keep Phase 9's top bar:** do NOT reintroduce Refresh/Disconnect buttons. The sync pill keeps `Link to="/settings"`.
- **Verification gates** (run from `nudgepay-app/`, Supabase must be up — every `vitest` run hits the DB via global-setup):
  - `npx react-router typegen && npx tsc -b` → exit 0
  - `npx vitest run` → green, **same test count as the branch baseline** (this re-skin adds no tests except Task 2's and removes none; a broken existing test signals an accidental behavior/structure change to investigate, not a test to delete)
  - `npx react-router build` → clean
- **Conventional Commits.** Trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FRXXDxVnamDk58w8A7m3Qn
  ```
  Commit ONLY named source files (explicit `git add <paths>`; never `git add -A`; never `.superpowers/` scratch or `scripts/demo-*`).
- **Note on "complete code":** `WorkQueue.tsx` (≈590 lines) and `DetailPanel.tsx` (≈800 lines) are large. This plan gives the exact new token values, the exact static class maps, and the exact new JSX sub-structures (fragments). The implementer applies those fragments while preserving all surrounding logic per the constraints above — it does NOT rewrite these files from scratch.

## Exact palette / token values (single source of truth)

These values are referenced by multiple tasks. Authoritative copy in Task 1.

| Token | New value |
|-------|-----------|
| `--color-ink` | `#16202b` (unchanged) |
| `--color-text` | `#16202b` (unchanged) |
| `--color-panel` | `#e9e4db` |
| `--color-surface` | `#fffdf9` |
| `--color-paper` *(new)* | `#fbf8f1` |
| `--color-border` | `#ddd6c9` |
| `--color-copper` | `#cf8136` |
| `--color-warm` | `#cf8136` |
| `--color-cool` | `#2e7fb8` (unchanged) |
| `--color-hot` | `#d23b2e` (unchanged) |
| `--color-muted` | `#6b7689` |
| `--radius-tile` | `12px` |
| `--radius-card` | `14px` |
| `--shadow-tile` | `0 1px 2px rgba(22, 32, 43, 0.05)` |
| `--shadow-panel` | `0 2px 8px rgba(22, 32, 43, 0.07)` |

---

## File Structure

- `app/app.css` — theme tokens (palette + radii + shadow). Foundation; all visuals depend on it.
- `app/lib/status-style.ts` *(new, pure)* — `statusChipTone(status) → "cool" | "copper" | "neutral"`. Single source for status→chip-tone, used by `WorkQueue` and `DetailPanel`.
- `tests/status-style.test.ts` *(new)* — unit tests for `statusChipTone`.
- `app/components/MetricsStrip.tsx` — KPI cards.
- `app/components/ThermalBand.tsx` — slimmed heat label (color carried by the row rail).
- `app/components/WorkQueue.tsx` — warm header, pill tabs, row heat-rail + status chip.
- `app/components/DetailPanel.tsx` — dark header, stat tiles, action tiles, overview status cards, node timeline, warm message bubbles.
- `app/components/Icons.tsx` — add icons only if Task 5 needs one (prefer reuse).
- `app/components/AppShell.tsx` — confirm token-driven restyle; minor touch-ups only.

---

### Task 1: Theme tokens + baseline capture

**Files:**
- Modify: `nudgepay-app/app/app.css:3-26`

**Interfaces:**
- Consumes: nothing.
- Produces: the CSS custom properties (`--color-panel`, `--color-surface`, `--color-paper`, `--color-border`, `--color-copper`, `--color-warm`, `--color-muted`, radii, shadows) that every later task's utility classes resolve against. New utility class available: `bg-paper`, `text-paper`, `border-paper`.

- [ ] **Step 1: Capture the test baseline**

Run (from `nudgepay-app/`, Supabase up):
```bash
npx vitest run 2>&1 | tail -5
```
Record the passing test count (e.g. "Tests 362 passed"). This is the number every later task's `vitest run` must still match.

- [ ] **Step 2: Replace the `@theme` block**

In `app/app.css`, replace the `@theme { … }` block (lines 3-26) with:

```css
@theme {
	--font-display: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
	--font-sans: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
	--font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;

	--color-ink: #16202b;
	--color-panel: #e9e4db;
	--color-surface: #fffdf9;
	--color-paper: #fbf8f1;
	--color-copper: #cf8136;
	--color-cool: #2e7fb8;
	--color-warm: #cf8136;
	--color-hot: #d23b2e;
	--color-text: #16202b;
	--color-muted: #6b7689;
	--color-border: #ddd6c9;

	/* Radii → rounded-tile, rounded-card */
	--radius-tile: 12px;
	--radius-card: 14px;

	/* Elevation → shadow-tile, shadow-panel */
	--shadow-tile: 0 1px 2px rgba(22, 32, 43, 0.05);
	--shadow-panel: 0 2px 8px rgba(22, 32, 43, 0.07);
}
```

Leave the `@utility scrollbar-none` block and the `html, body` rule below it unchanged.

- [ ] **Step 3: Verify gates**

Run:
```bash
npx react-router typegen && npx tsc -b
npx vitest run 2>&1 | tail -5
npx react-router build 2>&1 | tail -5
```
Expected: `tsc -b` exit 0; vitest count = the Step 1 baseline; build clean. (No `.tsx` is type-affected by a CSS change; this confirms nothing else regressed.)

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/app.css
git commit -m "feat(ui): warm parchment theme tokens for collections re-skin

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FRXXDxVnamDk58w8A7m3Qn"
```

---

### Task 2: Pure status-chip tone helper (TDD)

**Files:**
- Create: `nudgepay-app/app/lib/status-style.ts`
- Test: `nudgepay-app/tests/status-style.test.ts`

**Interfaces:**
- Consumes: `CaseStatus` from `app/lib/cases.ts` (`"new" | "working" | "promised" | "waiting" | "on_hold" | "resolved"`).
- Produces: `export type ChipTone = "cool" | "copper" | "neutral"` and `export function statusChipTone(status: CaseStatus | string): ChipTone`. Consumed by Task 4 (`WorkQueue`) and Task 5 (`DetailPanel`).

- [ ] **Step 1: Write the failing test**

Create `tests/status-style.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { statusChipTone } from "../app/lib/status-style";

describe("statusChipTone", () => {
  it("maps promised to cool", () => {
    expect(statusChipTone("promised")).toBe("cool");
  });
  it("maps new and working to copper", () => {
    expect(statusChipTone("new")).toBe("copper");
    expect(statusChipTone("working")).toBe("copper");
  });
  it("maps waiting, on_hold, resolved to neutral", () => {
    expect(statusChipTone("waiting")).toBe("neutral");
    expect(statusChipTone("on_hold")).toBe("neutral");
    expect(statusChipTone("resolved")).toBe("neutral");
  });
  it("falls back to neutral for an unknown status", () => {
    expect(statusChipTone("something-else")).toBe("neutral");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run:
```bash
npx vitest run tests/status-style.test.ts
```
Expected: FAIL — cannot resolve `../app/lib/status-style`.

- [ ] **Step 3: Implement the helper**

Create `app/lib/status-style.ts`:

```ts
// Pure presentation helper: maps a collection-case status to a chip tone.
// No I/O, no node:*, no .server — safe in client + server bundles.
// The tone is a semantic key; components map it to literal Tailwind classes
// (the v4 scanner needs literal class strings, so the class map lives there).
import type { CaseStatus } from "./cases";

export type ChipTone = "cool" | "copper" | "neutral";

export function statusChipTone(status: CaseStatus | string): ChipTone {
  switch (status) {
    case "promised":
      return "cool";
    case "new":
    case "working":
      return "copper";
    case "waiting":
    case "on_hold":
    case "resolved":
    default:
      return "neutral";
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run:
```bash
npx vitest run tests/status-style.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Verify gates + commit**

Run:
```bash
npx react-router typegen && npx tsc -b
```
Expected: exit 0. Then:
```bash
git add nudgepay-app/app/lib/status-style.ts nudgepay-app/tests/status-style.test.ts
git commit -m "feat(ui): pure statusChipTone helper for status chips

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FRXXDxVnamDk58w8A7m3Qn"
```

---

### Task 3: MetricsStrip → KPI cards

**Files:**
- Modify: `nudgepay-app/app/components/MetricsStrip.tsx`

**Interfaces:**
- Consumes: `Metrics`, `ViewId`, `SortId` (unchanged props); `formatUSD`.
- Produces: no API change — same `MetricsStrip` props, same 7 `<Link to="?view=">` tiles.

- [ ] **Step 1: Replace the accent maps**

Replace the existing `accentText` map (lines 16-21) with two maps and an `Accent` type:

```tsx
type Accent = "copper" | "cool" | "hot" | "ink" | "neutral";

// Static literal maps for the Tailwind v4 scanner.
const ACCENT_TEXT: Record<Accent, string> = {
  copper: "text-copper",
  cool: "text-cool",
  hot: "text-hot",
  ink: "text-text",
  neutral: "text-muted",
};
const ACCENT_DOT: Record<Accent, string> = {
  copper: "bg-copper",
  cool: "bg-cool",
  hot: "bg-hot",
  ink: "bg-ink",
  neutral: "bg-muted",
};
```

Update the `TileProps["accent"]` type usage so `accent: Accent`.

- [ ] **Step 2: Replace the `MetricTile` body**

Replace the `MetricTile` return (the `<Link>…</Link>`) with the KPI-card markup:

```tsx
return (
  <Link
    to={href}
    aria-label={`${label}: ${count} accounts, ${formatUSD(amount)}`}
    aria-current={active ? "true" : undefined}
    className={[
      "relative flex flex-col text-left p-4 rounded-tile overflow-hidden min-w-0 transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
      active
        ? "bg-copper/5 border border-copper shadow-tile"
        : "bg-paper border border-border hover:border-copper/50",
    ].join(" ")}
  >
    <span
      aria-hidden="true"
      className={`absolute top-0 inset-x-0 h-0.5 ${active ? "bg-copper" : "bg-transparent"}`}
    />
    <span className="flex items-center gap-1.5 mb-2">
      <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${ACCENT_DOT[accent]}`} />
      <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted truncate">
        {label}
      </span>
    </span>
    <span className="font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-text">
      {formatUSD(amount)}
    </span>
    <span className="mt-1.5 text-xs text-muted">
      <span className={`font-mono font-semibold ${ACCENT_TEXT[accent]}`}>{count}</span>{" "}
      {count === 1 ? "account" : "accounts"}
    </span>
  </Link>
);
```

- [ ] **Step 3: Re-point the tile accents to the design's dot colors**

In `MetricsStrip`, update the `tiles` array `accent` values to match the mock's per-metric dots (keep label/viewId/`m` unchanged):

```tsx
{ label: "30+ days past due", viewId: "30-plus",         accent: "copper",  m: metrics.thirtyPlus },
{ label: "High value",        viewId: "high-value",      accent: "cool",    m: metrics.highValue },
{ label: "Never contacted",   viewId: "never-contacted", accent: "neutral", m: metrics.neverContacted },
{ label: "All open",          viewId: "all-open",        accent: "ink",     m: metrics.allOpen },
{ label: "Follow-ups due",    viewId: "follow-ups-due",  accent: "copper",  m: metrics.followUpsDue },
{ label: "Broken promises",   viewId: "broken-promises", accent: "hot",     m: metrics.brokenPromises },
{ label: "On hold",           viewId: "on-hold",         accent: "neutral", m: metrics.onHold },
```

Leave the outer grid wrapper (`grid grid-cols-2 … xl:grid-cols-7`) and the `.map` unchanged.

- [ ] **Step 4: Verify gates**

```bash
npx react-router typegen && npx tsc -b
npx vitest run 2>&1 | tail -5
npx react-router build 2>&1 | tail -5
```
Expected: `tsc -b` 0; vitest = baseline; build clean.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/components/MetricsStrip.tsx
git commit -m "feat(ui): KPI cards for the collections metrics strip

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FRXXDxVnamDk58w8A7m3Qn"
```

---

### Task 4: WorkQueue — warm header, pill tabs, heat rail, status chips

**Files:**
- Modify: `nudgepay-app/app/components/ThermalBand.tsx`
- Modify: `nudgepay-app/app/components/WorkQueue.tsx`

**Interfaces:**
- Consumes: `statusChipTone`, `ChipTone` from Task 2; `Heat` (`heat.band`/`heat.label`/`heat.days`); `STATUS_LABEL`, `formatUSD`, `formatDate`, `exceptionLabel`.
- Produces: no API change — same `WorkQueue` / `ThermalBand` props.

- [ ] **Step 1: Slim ThermalBand (color now lives on the row rail)**

Replace the `ThermalBand` return with the label-only treatment (drop the tint background and the inner bar):

```tsx
export function ThermalBand({ heat }: ThermalBandProps) {
  const tokens = bandTokens[heat.band];
  return (
    <span
      className="inline-flex items-center gap-1.5"
      aria-label={`${heat.label.toLowerCase()}, ${heat.days} days overdue`}
    >
      <span className={`font-mono text-[10px] font-semibold uppercase tracking-wide leading-none ${tokens.text}`}>
        {heat.label}
      </span>
      <span className="font-mono text-[11px] leading-none text-muted">{heat.days}d</span>
    </span>
  );
}
```
Keep the `bandTokens` map (the `.text` entries are still used; `.tint`/`.bar` become unused — remove the `tint` and `bar` keys to avoid dead fields, leaving `{ text }` per band).

- [ ] **Step 2: Add the chip maps + import in WorkQueue**

At the top of `WorkQueue.tsx`, add the import and static maps (near the existing `LEVEL_BADGE` map):

```tsx
import { statusChipTone, type ChipTone } from "../lib/status-style";

// Status chip — literal class strings for the Tailwind v4 scanner.
const CHIP: Record<ChipTone, string> = {
  cool: "bg-cool/10 text-cool",
  copper: "bg-copper/10 text-copper",
  neutral: "bg-muted/10 text-muted",
};
const CHIP_DOT: Record<ChipTone, string> = {
  cool: "bg-cool",
  copper: "bg-copper",
  neutral: "bg-muted",
};
// Heat → left-rail fill.
const HEAT_BAR: Record<string, string> = {
  cool: "bg-cool",
  warm: "bg-warm",
  hot: "bg-hot",
};
```

- [ ] **Step 3: Row wrapper — heat rail + selection rail**

In `QueueRow`, change the outer wrapper `<div>` to be `relative` and carry the heat rail; replace the current `border-l-2 …` selection treatment with an inboard copper rail + tint:

```tsx
<div
  className={[
    "relative flex items-center border-b border-border transition-colors duration-100 hover:bg-paper",
    selected ? "bg-copper/5" : "",
  ].join(" ")}
>
  <span aria-hidden="true" className={`absolute left-0 inset-y-0 w-1 ${HEAT_BAR[item.heat.band] ?? "bg-muted"}`} />
  {selected ? <span aria-hidden="true" className="absolute left-1 inset-y-0 w-0.5 bg-copper" /> : null}
  {/* …existing checkbox <label> and <Link> unchanged… */}
</div>
```
Keep the checkbox `<label>` and the `<Link>` exactly as they are (including the grid templates and all cells). The `ThermalBand` in the Heat cell now renders the slimmed label.

- [ ] **Step 4: Status cell → chip + sub-line**

Replace the Status `<span data-label="Status" …>` cell in `QueueRow` with:

```tsx
{/* Status + next action date */}
<span data-label="Status" className="hidden lg:flex flex-col items-start gap-0.5 min-w-0">
  {(() => {
    const tone = statusChipTone(item.status);
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] font-sans font-semibold ${CHIP[tone]}`}>
        <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${CHIP_DOT[tone]}`} />
        {STATUS_LABEL[item.status] ?? item.status}
        {item.nextActionAt ? <span className="font-normal opacity-80"> · {formatDate(item.nextActionAt)}</span> : null}
      </span>
    );
  })()}
  {item.promiseStatus === "broken" ? (
    <span className="text-[11px] text-hot pl-0.5">Promise broken</span>
  ) : item.status === "on_hold" && item.exceptionReason ? (
    <span className="text-[11px] text-muted pl-0.5">{exceptionLabel(item.exceptionReason)}</span>
  ) : null}
</span>
```
This preserves the same information (status label, next-action date, broken-promise and exception sub-states) in chip form. Leave every other cell (Heat, Customer, Total, Oldest, Last contact, Owner) unchanged.

- [ ] **Step 5: Toolbar header band → paper**

In the `WorkQueue` toolbar, change the header band background from `bg-surface` to `bg-paper`:
- The header+toolbar `<div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-surface">` → `… bg-paper`.

Leave the search input, sort select, and Apply button markup unchanged (they already use `bg-panel`/`border-border` tokens which now read warm).

- [ ] **Step 6: Saved-view tabs → pills**

Replace the saved-view tabs container + each tab. Container:

```tsx
<div
  role="tablist"
  aria-label="Saved queue views"
  className="flex gap-1 overflow-x-auto border-b border-border bg-paper px-3.5 py-2 scrollbar-none"
>
```

Each tab `<Link>`:

```tsx
<Link
  key={sv.id}
  to={`?${params.toString()}`}
  role="tab"
  aria-selected={isActive ? "true" : "false"}
  className={[
    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12.5px] whitespace-nowrap transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
    isActive
      ? "bg-ink border-ink text-surface font-semibold"
      : "bg-surface border-border text-muted font-medium hover:border-copper/50 hover:text-text",
  ].join(" ")}
>
  {sv.label}
  <span
    className={`inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full font-mono text-[10.5px] font-semibold ${
      isActive ? "bg-surface/20 text-surface" : "bg-panel text-muted"
    }`}
  >
    {viewCounts[sv.id] ?? 0}
  </span>
</Link>
```
Keep the `SAVED_VIEWS.map`, the `params` construction, and the `isActive` logic unchanged.

- [ ] **Step 7: Column header + table body bands**

- Column-header `<div className="flex items-center px-4 py-2 border-b border-border bg-panel">` → `… bg-paper`.
- Table body container `<div className="flex-1 overflow-auto bg-surface">` → keep `bg-surface` (now warm paper-white) — no change needed.
- Empty-state icon circle `bg-panel` → `bg-paper` (optional polish).

Leave the `MobileCard` markup logic intact, but for warmth change its hover/selected to match (`border-copper`/`bg-copper/5` already correct; card `bg-surface` now warm). Update the mobile card status text to reuse the chip if trivial — OPTIONAL; if not trivial, leave the mobile status text as-is (it already renders the same data).

- [ ] **Step 8: Verify gates**

```bash
npx react-router typegen && npx tsc -b
npx vitest run 2>&1 | tail -5
npx react-router build 2>&1 | tail -5
```
Expected: `tsc -b` 0; vitest = baseline; build clean.

- [ ] **Step 9: Commit**

```bash
git add nudgepay-app/app/components/WorkQueue.tsx nudgepay-app/app/components/ThermalBand.tsx
git commit -m "feat(ui): warm work queue — pill tabs, heat rail, status chips

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FRXXDxVnamDk58w8A7m3Qn"
```

---

### Task 5: DetailPanel — dark header, stat tiles, action tiles, status cards, node timeline

**Files:**
- Modify: `nudgepay-app/app/components/DetailPanel.tsx`
- Modify (only if a node icon is missing): `nudgepay-app/app/components/Icons.tsx`

**Interfaces:**
- Consumes: `statusChipTone`, `ChipTone` (Task 2); existing `CaseItem`, `TimelineEntry`, `MessageEntry`, `formatUSD`, `formatDate`, `STATUS_LABEL`, `resolveCallAction`, all current props.
- Produces: no API change — same `DetailPanel` props.

> **Preserve-everything reminder:** restyle the following but do NOT remove or rewire them: the priority-override `<form action="/api/priority-override">`, the "Why this priority" factors/score block, the owner-assign `<form action="/api/assign">`, the cancel-promise `<form action="/api/promises/cancel">`, the on-hold exception detail, the consent row + `<form action="/api/sms-consent">`, the SMS templates + `<form action="/api/text/send">` composer with its collision-confirm `onSubmit`, the heartbeat `useEffect`, and the empty-state.

- [ ] **Step 1: Add chip maps + import**

Near the top of `DetailPanel.tsx` (by the existing `TONE_CLASS` map), add:

```tsx
import { statusChipTone, type ChipTone } from "~/lib/status-style";

const CHIP_TEXT: Record<ChipTone, string> = {
  cool: "text-cool",
  copper: "text-copper",
  neutral: "text-muted",
};
const CHIP_DOT: Record<ChipTone, string> = {
  cool: "bg-cool",
  copper: "bg-copper",
  neutral: "bg-muted",
};
// Heat → text token on the dark header (legible on ink).
const HEAT_TEXT: Record<string, string> = {
  cool: "text-cool",
  warm: "text-warm",
  hot: "text-hot",
};
```

- [ ] **Step 2: Dark `ink` header block**

Replace the header `<div className="px-5 pt-4 pb-3 border-b border-border">` … through the customer name + invoice/age line (the kicker, close link, `<h2>`, and the "N open invoice(s) · oldest …" `<p>`) with a dark block. Keep the same `Link` close target and the same data:

```tsx
<div className="px-5 pt-4 pb-4 bg-ink text-surface">
  <div className="flex items-center justify-between">
    <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-surface/50">
      Selected account
    </p>
    <Link
      to={`?${new URLSearchParams({ view, sort, ...(q ? { q } : {}) }).toString()}`}
      aria-label="Close detail panel"
      className="hidden md:flex items-center justify-center w-6 h-6 rounded text-surface/60 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
    >
      <span aria-hidden="true" className="text-base leading-none">×</span>
    </Link>
  </div>
  <h2 className="mt-1.5 font-display text-xl font-semibold leading-tight text-surface">
    {selected.customerName}
  </h2>
  <p className="mt-1 text-xs text-surface/60">
    {selected.invoiceCount} open invoice(s)
    <span className="mx-1.5 text-surface/30 select-none">·</span>
    oldest <span className={`font-mono font-semibold ${HEAT_TEXT[selected.heat.band] ?? "text-surface"}`}>{selected.oldestAgeDays}d</span> overdue
  </p>
</div>
```

- [ ] **Step 3: Stat tiles band**

Move the existing "Total overdue / Status" two-up grid out of the (now dark) header into its own paper band immediately below the header, and color Status with the chip tone:

```tsx
<div className="grid grid-cols-2 gap-2.5 px-4 py-3 bg-paper border-b border-border">
  <div className="flex flex-col gap-1 bg-surface rounded-card p-3 border border-border">
    <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-muted">Total overdue</span>
    <span className="font-display text-xl font-bold tracking-tight tabular-nums text-text">{formatUSD(selected.totalOverdue)}</span>
  </div>
  <div className="flex flex-col gap-1 bg-surface rounded-card p-3 border border-border">
    <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-muted">Status</span>
    <span className={`inline-flex items-center gap-1.5 font-display text-base font-semibold ${CHIP_TEXT[statusChipTone(selected.status)]}`}>
      <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${CHIP_DOT[statusChipTone(selected.status)]}`} />
      {STATUS_LABEL[selected.status] ?? selected.status}
    </span>
  </div>
</div>
```

- [ ] **Step 4: Action tiles**

Replace the "Action row" (`<div role="group" aria-label="Account actions" className="flex flex-wrap gap-2">…`) with icon+label tiles on a paper band. Preserve the three existing affordances and their exact gating/targets — only the wrapper/markup changes. Use `flex` so the row adapts when Call is hidden:

```tsx
<div role="group" aria-label="Account actions" className="flex gap-2 px-4 py-3 border-b border-border bg-paper">
  {/* Call — keep the existing callAction.kind === "live" / "blocked" / null branches.
      For each rendered branch, use this tile shell (live = <a href=tel:…> with the
      existing onClick; blocked = <span aria-disabled> with the existing title): */}
  {/* live: */}
  <a
    href={`tel:${selected.phone}`}
    onClick={() => navigate(callLogHref)}
    className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-card bg-surface border border-border text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
  >
    <Icon name="phone" size={16} aria-hidden />
    <span className="text-[11.5px] font-sans font-semibold text-text">Call</span>
  </a>
  {/* …blocked branch: same shell as <span aria-disabled title={callAction.reason}> with opacity-50 cursor-not-allowed, label "Call"… */}

  {/* Text → Messages tab (keep existing Link target) */}
  <Link
    to={`?${new URLSearchParams({ case: selected.caseId, tab: "messages", view, sort, ...(q ? { q } : {}) }).toString()}`}
    className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-card bg-surface border border-border text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
  >
    <Icon name="message" size={16} aria-hidden />
    <span className="text-[11.5px] font-sans font-semibold text-text">Text</span>
  </Link>

  {/* Log → log drawer (keep existing logHref) */}
  <Link
    to={logHref}
    className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-card bg-surface border border-border text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
  >
    <Icon name="note" size={16} aria-hidden />
    <span className="text-[11.5px] font-sans font-semibold text-text">Log</span>
  </Link>
</div>
```
(The mock shows a fourth "Email" tile; there is no standalone email action in the app today, so do NOT add one — keep the three real actions. This is per the spec's "do not invent a new email action.")

- [ ] **Step 5: Tab bar underline → copper, slightly larger**

In the tab bar `<Link>` map, bump the active style to the panel-tab look (keep structure):
```tsx
className={[
  "px-4 py-3 text-[13px] font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors",
  isActive
    ? "border-b-2 border-copper text-text font-semibold -mb-px"
    : "border-b-2 border-transparent text-muted font-medium hover:text-text",
].join(" ")}
```
Add `bg-paper` to the tablist container: `className="flex border-b border-border shrink-0 bg-paper"`.

- [ ] **Step 6: Overview status cards (promise / exception) → accent footer cards**

Restyle the existing **Promise card** and **Exception panel** blocks into the mock's accent footer-card style (left accent border + tinted bg), preserving their inner content (including the cancel-promise form). Add a tone→class map near the top:

```tsx
// Footer/status accent cards — literal classes for the scanner.
const ACCENT_CARD: Record<string, string> = {
  cool: "bg-cool/5 border-cool/30 border-l-cool",
  hot: "bg-hot/5 border-hot/30 border-l-hot",
  warm: "bg-warm/5 border-warm/30 border-l-warm",
  neutral: "bg-panel border-border border-l-muted",
};
const ACCENT_TITLE: Record<string, string> = {
  cool: "text-cool", hot: "text-hot", warm: "text-warm", neutral: "text-muted",
};
```
For the Promise card wrapper, pick the accent by promise status (`broken` → `hot`, `pending`/`kept` → `cool`, else `neutral`) and apply:
```tsx
<div className={`mt-4 rounded-card border border-l-[3px] p-4 ${ACCENT_CARD[accent]}`}>
```
For the Exception panel, use `warm` accent. Keep the title (`PROMISE_STATUS[...]?.label` / `Exception · …`), the amount, the note, the `promiseError` line, and the cancel-promise `<form>` exactly as they are — only the wrapper class and title color (`ACCENT_TITLE[accent]`) change.

- [ ] **Step 7: "Why this priority", owner-assign, info grid, invoice list — token polish**

Leave the structure of the "Why this priority" block, the owner-assign select, the InfoRow grid, and the invoice list intact. They already use `bg-panel`/`border-border`/`shadow-tile` tokens that now read warm. Only optional change: invoice list rows `bg-panel` → `bg-paper` for a touch more contrast against the cream panel bg. No logic changes.

- [ ] **Step 8: Timeline → node style**

Add a timeline tone/icon map near the top:
```tsx
// Timeline node tone by log method / sms direction. Literal classes for the scanner.
const TL_NODE: Record<string, { bg: string; color: string }> = {
  call:     { bg: "bg-copper/10", color: "text-copper" },
  email:    { bg: "bg-copper/10", color: "text-copper" },
  text:     { bg: "bg-muted/10",  color: "text-muted" },
  note:     { bg: "bg-muted/10",  color: "text-muted" },
  inbound:  { bg: "bg-cool/10",   color: "text-cool" },
  outbound: { bg: "bg-muted/10",  color: "text-muted" },
};
```
In the activity `<ol>`, restyle each `<li>` to a node row (icon circle + connector + body), keeping the existing SMS-vs-log branching and all annotations (broken-promise, follow-up, notes, error code). For an SMS entry use `TL_NODE[e.direction]` and `Icon name="message"`; for a log entry use `TL_NODE[e.method] ?? TL_NODE.note` and `Icon name={METHOD_ICON[e.method] ?? "note"}`. Node `<li>`:

```tsx
<li key={e.id} className="flex gap-3 pb-4 last:pb-0">
  <div className="flex flex-col items-center shrink-0">
    <span className={`grid place-items-center w-7 h-7 rounded-lg ${node.bg} ${node.color}`}>
      <Icon name={iconName} size={14} aria-hidden />
    </span>
    <span aria-hidden="true" className="flex-1 w-0.5 bg-border mt-1.5" />
  </div>
  <div className="min-w-0 flex flex-col gap-0.5 pt-0.5">
    {/* …existing title (outcomeLabel), date, body, promise/follow-up/notes/error spans… */}
  </div>
</li>
```
Keep the `today` broken-promise computation and the inbound title color (`text-cool`). Remove the old per-row `border-b` (the connector replaces it). The empty-state stays.

- [ ] **Step 9: Message bubbles + composer — warm polish**

Leave `MessagesTab` logic intact (consent row, banner, templates, composer, gating, collision-confirm). Update only the `BUBBLE` map for warmth:
```tsx
const BUBBLE: Record<string, { wrap: string; bubble: string }> = {
  outbound: { wrap: "items-end", bubble: "bg-ink text-surface border border-ink" },
  inbound:  { wrap: "items-start", bubble: "bg-paper text-text border border-border" },
};
```
Optional: the consent-row and composer container `border-border`/`bg-panel` already read warm — no change required.

- [ ] **Step 10: Empty-state + verify gates**

Empty state (`selected === null`) `bg-surface` reads warm already; no change required. Then:
```bash
npx react-router typegen && npx tsc -b
npx vitest run 2>&1 | tail -5
npx react-router build 2>&1 | tail -5
```
Expected: `tsc -b` 0; vitest = baseline; build clean.

- [ ] **Step 11: Commit**

```bash
git add nudgepay-app/app/components/DetailPanel.tsx
# include Icons.tsx ONLY if a new icon was added in this task
git commit -m "feat(ui): restyle detail panel — dark header, tiles, node timeline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FRXXDxVnamDk58w8A7m3Qn"
```

---

### Task 6: AppShell touch-up + full verification + visual & cohesion check

**Files:**
- Modify (if needed): `nudgepay-app/app/components/AppShell.tsx`
- Modify: `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` (record the re-skin)

**Interfaces:**
- Consumes: the finished theme + components.
- Produces: a verified, visually-confirmed branch.

- [ ] **Step 1: Confirm AppShell reads correctly; minor touch-ups only**

Load the app (see Step 3) and inspect the top bar + side-nav. The ink chrome and copper active rail are token-driven and should already match. Make ONLY token-level touch-ups if something reads wrong (e.g. side-nav inactive label contrast). Do not reintroduce Refresh/Disconnect. If no change is needed, skip editing this file.

- [ ] **Step 2: Full verification sweep**

```bash
npx react-router typegen && npx tsc -b
npx vitest run 2>&1 | tail -5
npx react-router build 2>&1 | tail -5
```
Expected: `tsc -b` 0; vitest = the Task 1 baseline count; build clean.

- [ ] **Step 3: Visual fidelity pass (local only, not committed)**

With Supabase up and the Phase-8 demo seed applied if available, run the dev server and capture screenshots via Playwright (reuse the local `scripts/demo-*` pattern; do NOT commit scripts or images):
```bash
npx react-router dev   # in one shell; login diskin@chancey.test / password123
```
Capture: the dashboard with a case selected, across the Overview / Timeline / Messages tabs, plus the KPI strip and pill tabs. Compare against the mock (`NudgePay Collections.dc.html`). Note any fidelity gaps; fix token/class issues found, re-running Step 2 after any change.

- [ ] **Step 4: Cohesion spot-check (other pages)**

Load `/settings`, `/reports` (as owner), and an auth page (`/login`). Confirm the warm palette reads correctly — no unreadable contrast, no broken cool-on-warm combinations. Fix any token issue found (a token fix is app-wide; re-run Step 2 after).

- [ ] **Step 5: Record in the gap checklist**

In `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md`, add a short note under the appropriate section that the Collections UI was re-skinned to the approved design (Phase 10), warm palette applied app-wide, all dashboard functionality preserved. (Documentation only — match the file's existing format.)

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md
# include AppShell.tsx ONLY if it was touched in Step 1
git commit -m "docs: record Phase 10 collections re-skin in gap checklist

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FRXXDxVnamDk58w8A7m3Qn"
```

---

## Self-Review

**1. Spec coverage:**
- Warm palette app-wide → Task 1. ✓
- Copper retune, paper band token → Task 1. ✓
- KPI cards → Task 3. ✓
- Pill tabs, heat rail, status chips, warm queue → Task 4. ✓
- Status-chip tone single source → Task 2 (used by 4 + 5). ✓
- DetailPanel dark header / stat tiles / action tiles / underline tabs / status footer cards / node timeline / warm bubbles → Task 5. ✓
- Preserve all panel features (override, why-this-priority, exception, consent, composer, cancel-promise, collision) → Task 5 preserve-reminder + Steps 6-9. ✓
- AppShell keeps Phase 9 top bar → Global Constraints + Task 6 Step 1. ✓
- Verification (tsc -b / vitest baseline / build) → every task. ✓
- Visual fidelity + cohesion spot-check → Task 6 Steps 3-4. ✓
- No migrations, no loader/action/route changes → Global Constraints. ✓

**2. Placeholder scan:** No TBD/TODO. Code fragments are concrete; the two large files are explicitly fragment-applied (per the Global Constraints note) rather than full-rewritten, with exact class strings given. ✓

**3. Type consistency:** `ChipTone = "cool" | "copper" | "neutral"` defined in Task 2, imported and keyed identically in Tasks 4 and 5. `statusChipTone(status)` signature consistent. `Accent` type local to Task 3. `HEAT_BAR`/`HEAT_TEXT` keyed by `heat.band` (`"cool"|"warm"|"hot"`). Status labels via `STATUS_LABEL`. ✓
