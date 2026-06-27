# Phase 9 — Settings & Connections — Design Spec

Date: 2026-06-26
Status: Approved (brainstorming) — pending plan
Gap items: G1 (Connect QuickBooks CTA + connection management), G2 (SMS sender / A2P
status surface), G3 (sync status & error visibility), C7 settings write path
(org_settings/org_holidays editing UI + `updated_at` trigger + RLS tests).

## Summary

Build a single **Settings page** (`/settings`) that becomes the canonical home for
connection management, sync health, text-messaging info, and collections-rule editing.
Most of G1 and G3 already ship in the dashboard header (Connect/Refresh/Disconnect
forms, `SyncIssues`, status dot, last-sync label) — Phase 9 **relocates** those into
Settings and fills the two genuine gaps: a read-only **text-messaging** panel (G2) and
the **collections-rules editor** (C7 write path).

### Key discovery (reframes the checklist)

The gap checklist's "G1 is just a status dot" / "G3 is an open gap" notes are stale.
As of `main`:
- **G1 already built** — `dashboard.tsx` renders Connect CTA (disconnected, owner-only),
  Refresh + Disconnect (connected), wired to `/api/qbo/connect|disconnect|refresh`;
  `qbo-connection.server.ts` has connect/disconnect/refresh/status logic.
- **G3 already built** — `SyncIssues` component lists unresolved `sync_errors` with a
  Dismiss action (`/api/sync-errors/dismiss`), plus the relative last-sync label and a
  connection-health dot.
- **G2 not built** — `messaging_config` (`messaging_service_sid`, `sender`) is read
  server-side but never displayed. There is **no A2P-status column** in the schema and no
  in-app writer; A2P registration is platform-managed out-of-band.
- **C7 not built** — `org-config.server.ts` only reads `org_settings`/`org_holidays`;
  there is no edit UI, no `updated_at` trigger (column exists), and no RLS tests. The
  `Settings` nav item is inert.

## Decisions (from brainstorming)

1. **Scope:** consolidate everything into one Settings page (connection + sync + messaging
   + collections rules).
2. **Relocation:** **full relocate** — remove connection/sync controls from the dashboard;
   Settings is the only place to connect/manage. The AppShell status dot remains but becomes
   a link to `/settings`. A disconnected org's dashboard **redirects to `/settings`**.
3. **Access:** **members view, owners manage.** All members can open `/settings` read-only;
   owners get the action controls. Enforced server-side and by existing RLS (`is_org_owner`
   write on `org_settings`/`org_holidays`; owner-only connect/disconnect; member-level
   sync-error read/dismiss).
4. **G2 messaging panel:** **show what we know** — the "from" number, a Set-up /
   Not-provisioned indicator derived from `messaging_config`, and a static "carrier
   registration is managed by NudgePay" note. **No schema change**, no invented A2P badge.
5. **C7:** edit all four rule groups (grace days, working days, follow-up cadence, holidays);
   add the `updated_at` trigger; add RLS tests.

## Architecture

### Route & navigation
- New route `app/routes/settings.tsx` → `/settings`.
- AppShell: point the inert "Settings" nav item at `/settings` (remove `aria-disabled` /
  "coming soon"); make the top-bar status dot a link to `/settings`.
- **Loader** (`/settings`): one batch of org-scoped reads — connection status + last-sync
  (`qbo_connections`), unresolved `sync_errors`, `messaging_config`, `org_settings` +
  `org_holidays`, and the current user's role (owner?). Returns a view model; owner flag
  drives which controls are interactive.
- Access: the loader is member-readable. Owner-only actions are guarded in their action
  routes and by RLS — a non-owner POST is denied at the DB, not merely hidden in the UI.

### Dashboard relocation (`dashboard.tsx`)
- Remove: header Refresh/Disconnect forms, the disconnected "Connect QuickBooks" block, and
  the `SyncIssues` header indicator.
- When **not connected**, the dashboard loader **redirects to `/settings`**.
- The AppShell status dot stays (passive indicator) and links to `/settings`.

### Page layout — four stacked cards
1. **QuickBooks connection** (G1): status + last-sync; `[Refresh]` (member) ·
   `[Disconnect]` / `[Reconnect]` (owner) · Connect CTA when disconnected (owner).
2. **Sync health** (G3): last-sync detail + unresolved `sync_errors` list with `[Dismiss]`
   (member-allowed).
3. **Text messaging** (G2): "from" number · Set-up/Not-provisioned indicator · NudgePay-managed
   note. Read-only for everyone.
4. **Collections rules** (C7): grace days · working days · follow-up cadence · holidays.
   Owner-editable; members see disabled inputs.

### G1 — connection section (reuse)
Reuses `/api/qbo/connect`, `/api/qbo/disconnect`, `/api/qbo/refresh`. Adds a **Reconnect**
control for the expired/error state (re-runs the OAuth connect flow — same endpoint as
Connect; "Reconnect" is just the connected-but-erroring label). Owner-only:
connect/disconnect/reconnect. Refresh: member-allowed (matches today's behavior).

### G3 — sync health section (reuse)
Moves `SyncIssues` rendering into the Settings page. Unresolved `sync_errors` list +
Dismiss via the existing `/api/sync-errors/dismiss` (member-allowed per RLS). Shows the
last-sync timestamp and a connection-health indicator. No new server logic.

### G2 — text-messaging section (new, read-only)
Reads `messaging_config` (`sender`, `messaging_service_sid`). Renders:
- **From:** the `sender` number, or "Not provisioned" if absent.
- **Status:** "Set up" when `messaging_service_sid` is present, else "Not provisioned."
- A static note: "Text-message carrier registration is managed by NudgePay."
No schema change; no A2P column; no actions.

### C7 — collections-rules editor (new write path)
- **Pure module** `app/lib/org-settings.ts` — `parseOrgSettingsUpdate(form)` (mirrors
  `parseCommPrefsUpdate`): validates and returns `{ settings, addHolidays, removeHolidays }`.
  Validation rules (mirroring the DB CHECKs in migration 0016):
  - `promise_grace_days`: integer ≥ 0 (0 allowed = same-day; DB has no lower CHECK, but the
    UI treats < 0 as invalid).
  - `working_days`: non-empty subset of `{0..6}` (Sun–Sat).
  - `cadence_critical|high|medium|low`: integer > 0 each.
  - holidays: each a valid `YYYY-MM-DD` date string.
  Invalid input → the parser returns a typed error; the action redirects with `?error=`.
- **New route** `app/routes/api.org-settings.tsx` (action): owner-gated. Upserts
  `org_settings` (on `org_id`), inserts new `org_holidays`, deletes removed ones. RLS
  (`is_org_owner`) is the real boundary; a non-owner write is a no-op/denied. Redirect-on-error
  convention (matches `api.comm-prefs`, `api.sms-consent`).
- **New migration** `0018_org_settings_updated_at.sql`: a `before update` trigger on
  `org_settings` that sets `updated_at = now()` (the parked item — the column exists from
  0016 but nothing bumps it on UPDATE). `org_holidays` has no `updated_at` and needs none.
- Members render the values with disabled inputs (read-only).

## Data flow

- **Read:** `/settings` loader → one set of org-scoped SELECTs → view model → render.
- **Write:** section forms POST to existing `/api/qbo/*` + `/api/sync-errors/dismiss`, and
  the new `/api/org-settings`. Each redirects back to `/settings` with a status/`error` flash
  (existing redirect-on-error convention). The `updated_at` trigger stamps the row server-side.

## Error handling

- Redirect-on-error everywhere (no thrown 500s for user-correctable input) — consistent with
  `api.sms-consent` / `api.comm-prefs`.
- Validation failures in the collections-rules form → redirect to `/settings?error=<code>` and
  surface a message in the card.
- Owner-only writes attempted by a non-owner are denied by RLS; the action redirects without
  mutating.

## Isolation / units

- `parseOrgSettingsUpdate` (pure, no I/O) — single-purpose validator/normalizer, unit-tested.
- `api.org-settings.tsx` — thin action: parse → RLS-scoped writes → redirect.
- `settings.tsx` loader + small section components (`SettingsConnection`, `SettingsSync`,
  `SettingsMessaging`, `SettingsCollectionsRules`) — each one card, one responsibility.
- Reuse `SyncIssues`, the existing QBO action routes, `org-config` resolution, and
  `business-days`/`follow-up-cadence` defaults (single source of default truth).

## Testing

Node-only harness (no jsdom); UI verified by `tsc -b` + `react-router build`; pure modules
and DB/RLS carry real coverage.

1. **`parseOrgSettingsUpdate` unit tests** — valid input; each invalid case (grace < 0,
   empty working days, working day out of range, cadence ≤ 0, malformed holiday date);
   holiday add/remove diffing.
2. **RLS tests** (parked item) for `org_settings` + `org_holidays`: member can read; a
   non-owner member write is denied; an owner write succeeds; cross-org isolation holds.
3. **`updated_at` trigger test**: update an `org_settings` row → `updated_at` advances past
   its previous value.
4. **`api.org-settings` action test**: owner upsert + holiday add/remove succeeds; a
   non-owner POST is a no-op.
5. **Settings loader shape test**: the loader returns the expected view model (connection,
   sync errors, messaging, settings, isOwner) for a seeded org.
6. **Dashboard redirect test**: a disconnected org's dashboard loader redirects to `/settings`.
7. `tsc -b` exit 0 · full `vitest run` green · `react-router build` clean.

## Out of scope (explicit)

- No A2P-status column or messaging write path (platform-managed; "show what we know" only).
- No relocation of Accounts/Promises/Messages nav (still inert — unrelated).
- No new connection logic — G1/G3 reuse existing routes/components.
- P2 items (Section E) remain deferred.

## Migrations

- `0018_org_settings_updated_at.sql` — `before update` trigger bumping `org_settings.updated_at`.
  No data change; backward-compatible.
