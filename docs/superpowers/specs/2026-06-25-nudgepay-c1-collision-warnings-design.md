# NudgePay Phase 8b (C1) — Collision / Recent-Contact Warnings & Presence — Design

**Created:** 2026-06-25
**Requirement:** Gap checklist C1 — "Collision / recent-contact warnings & presence. Warn when a teammate recently contacted or is actively working the same customer." Maps to risk scenario F: "Two employees open the same customer simultaneously."
**Phase:** 8b (P1 throughput). Follows 8a (C5, bulk ops, merged PR #5).

---

## Goal

Stop duplicate / colliding collections work: when a teammate recently contacted a
customer, or is viewing that customer's case right now, surface it clearly and make
the acting user acknowledge it once before sending an SMS or logging a contact.

## Scope

Two collision signals, one shared pure derivation, surfaced in three places, with a
confirm-gate on the two contact actions. The current viewer is **always excluded**
from their own signals (you never collide with yourself).

- **Signal A — Recent contact** (existing data, no migration). The most-recent contact
  per case by a *different* user, and whether it falls inside a recency window.
  Sourced from `contact_logs.user_id` + `text_messages.sent_by_user_id` (+ `created_at`),
  mapped to a display label through the existing org roster.
- **Signal B — Live presence** (new, poll-based). A `case_presence` heartbeat table.
  The open DetailPanel pings a heartbeat every `HEARTBEAT_INTERVAL_MS` while a customer
  is selected; a teammate counts as "live" if their last beat is within
  `PRESENCE_FRESH_SEC` (tolerates one missed beat).

**Out of scope (YAGNI / deferred):** websocket/Supabase Realtime presence (explicitly
rejected — the app has zero client-side Supabase footprint and a node-env, no-jsdom test
philosophy); cross-customer "team activity feed"; presence-row pruning (the unique upsert
key bounds growth); blocking/hard-stop on collision (we warn + confirm, never block).

---

## Tunable constants (in `collision.ts`)

| Constant | Value | Meaning |
| --- | --- | --- |
| `RECENT_WINDOW_MIN` | `60` | A recent-contact collision is "active" (banner emphasis + confirm-gate) only if the last different-user contact was within this many minutes. Older contact still shows passively. |
| `HEARTBEAT_INTERVAL_MS` | `20_000` | How often the open panel pings the heartbeat route, and the `useRevalidator` poll cadence. |
| `PRESENCE_FRESH_SEC` | `45` | A heartbeat is "live" if `last_seen_at` is within this many seconds of now (≥ 2× interval, so one dropped beat does not flap presence off). |

These live as named exports so tests and UI read the same values; tuning is a one-line change.

---

## Data model

### Migration `0014_case_presence.sql`

```sql
-- Phase 8b (C1): poll-based presence. One heartbeat row per (org, customer, user),
-- upserted in place so the table is bounded by distinct user×customer view pairs.
-- "Live" is derived at read time from last_seen_at freshness — no background job,
-- no pruning required (a stale row simply fails the freshness check).
create table case_presence (
  org_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (org_id, customer_id, user_id)
);
create index case_presence_org_customer_idx on case_presence (org_id, customer_id);

alter table case_presence enable row level security;
-- Members read their own org's presence (dashboard loader uses the user/RLS client).
-- Members upsert their own heartbeat via an org-scoped resource route (user client).
create policy case_presence_member_read on case_presence
  for select using (is_org_member(org_id));
create policy case_presence_member_write on case_presence
  for insert with check (is_org_member(org_id) and user_id = auth.uid());
create policy case_presence_member_update on case_presence
  for update using (is_org_member(org_id) and user_id = auth.uid())
  with check (is_org_member(org_id) and user_id = auth.uid());
```

The composite primary key `(org_id, customer_id, user_id)` is the upsert conflict target,
so a heartbeat is a single `upsert ... on conflict` that touches at most one row.
RLS write policies additionally pin `user_id = auth.uid()` so a member can only write
their own presence (defense in depth beyond the route's own scoping).

### No schema change for recent contact

`contact_logs.user_id` (not null) and `text_messages.sent_by_user_id` (nullable —
inbound / automated sends have no user) already exist (migration `0001`). The loader
simply starts selecting those columns.

---

## Pure module: `app/lib/collision.ts`

No I/O, no `node:*`, no `.server` suffix (imported by the loader, the UI via type-only
imports, and tests). Holds the constants above plus:

```ts
export type RecentContactInput = { userId: string | null; at: string }; // at = ISO
export type HeartbeatInput = { userId: string; lastSeenAt: string };     // ISO

export type CollisionLevel = "none" | "recent" | "live";

export type Collision = {
  level: CollisionLevel;
  // Display label for the most relevant colliding teammate, e.g. "Jane" — null when level==="none".
  byUser: string | null;
  // ISO timestamp of the recent contact (for "12m ago" rendering); null unless a recent contact drove it.
  recentAt: string | null;
  // All distinct other-user labels currently live (for "Jane, Bob viewing now"); [] when none.
  liveUsers: string[];
};
```

- `summarizeRecentContact(contacts, currentUserId, now)` → the latest contact by a
  user other than `currentUserId`, with a `withinWindow` flag (≤ `RECENT_WINDOW_MIN`).
  Contacts whose `userId` is null (automated/inbound) are ignored for attribution.
- `liveViewers(heartbeats, currentUserId, now)` → distinct `userId`s (excluding self)
  whose `lastSeenAt` is within `PRESENCE_FRESH_SEC`.
- `collisionState({ recent, heartbeats, currentUserId, now, label })` → a `Collision`.
  Precedence: **live wins over recent** (`level: "live"` if any fresh other viewer,
  else `"recent"` if a different-user contact within the window, else `"none"`).
  `label` is a `(userId) => string` resolver (the loader passes a roster-backed lookup).

A passive "last contacted by X, Nm ago" can be shown even when `level==="none"` (old
contact); the confirm-gate only fires for `level !== "none"`.

---

## Server module: `app/lib/presence.server.ts`

```ts
recordHeartbeat(userClient, { orgId, customerId, userId }): Promise<void>
readPresence(userClient, { orgId, customerIds }): Promise<HeartbeatRow[]>
```

- `recordHeartbeat` does a single `upsert({ org_id, customer_id, user_id, last_seen_at: now }, { onConflict: "org_id,customer_id,user_id" })`. Binds `org_id`. On error it **throws** at the helper boundary; the route catches and degrades (heartbeat is best-effort — see Error handling).
- `readPresence` selects `user_id, last_seen_at` for the org's visible `customerIds`,
  binding `.eq("org_id", orgId).in("customer_id", customerIds)`. Returns rows; the
  loader applies freshness via `liveViewers`. Per the RLS rule it binds org_id and
  surfaces errors to the caller; the loader decides how to handle them (degrade).

Both use the **user/RLS client** (member-scoped). No service-client reads here.

---

## Route: `app/routes/api.presence.heartbeat.tsx`

`action`-only resource route, registered in `app/routes.ts`.

1. Resolve session → user; resolve org (→ `/onboarding` redirect if none, mirroring sibling routes).
2. Membership guard (same pattern as `api.assign` / `api.bulk-assign`).
3. Parse `customerId` from the form body; empty → 204/no-op redirect back.
4. `recordHeartbeat(userClient, { orgId: org.org_id, customerId, userId: user.id })`
   inside try/catch — on failure, log and return success-ish (best-effort; never surfaces
   an error to the polling client).
5. Returns a minimal response (no redirect chain needed — it's a background `fetch`).

The membership guard plus the RLS `user_id = auth.uid()` write policy means a member can
only ever stamp their own presence in an org they belong to.

---

## Loader wiring (`app/routes/dashboard.tsx`)

1. **Recent-contact attribution:** the existing per-case `contact_logs` and
   `text_messages` reads add `user_id` / `sent_by_user_id` to their `select`. Build a
   per-case `RecentContactInput[]` (existing strict-throw error handling unchanged —
   these are part of the critical load).
2. **Presence read:** for the visible customers, `readPresence(...)`. **Degrade
   gracefully:** wrap in try/catch — bind `org_id` (still RLS-correct), and on error
   log + treat presence as empty rather than throwing the whole dashboard. This is a
   **deliberate, documented deviation** from the repo's strict capture-and-throw rule,
   justified because presence is advisory and must never take down the work queue. The
   recent-contact reads do *not* get this treatment.
3. Compute a per-case `Collision` via `collisionState`, self-excluded (`currentUserId = user.id`),
   resolving labels through the already-loaded roster (`userId → label`).
4. Thread the `Collision` to the queue items and the selected case (a parallel
   `Map<caseId, Collision>` passed to `WorkQueue` / `DetailPanel`, so `CaseItem` in the
   pure `cases.ts` stays unchanged — collision is loader-derived, not part of the case
   identity).

---

## UI

- **WorkQueue row marker.** When a row's collision `level !== "none"`, a small amber
  indicator (icon + tooltip/`aria-label`): "Being viewed by Jane" (live) or
  "Contacted by Jane 12m ago" (recent). Literal Tailwind classes (no interpolation).
- **DetailPanel banner.** When the selected case has a collision, a banner above the
  composer: live → "⚠ Jane is viewing this customer now"; recent → "Last contacted by
  Jane, 12m ago." Live takes precedence.
- **Heartbeat + poll.** A small effect in DetailPanel (e.g. `usePresenceHeartbeat`)
  that, while a customer is selected: (a) `fetch`-POSTs the heartbeat immediately and
  every `HEARTBEAT_INTERVAL_MS`; (b) drives a `useRevalidator()` re-load on the same
  cadence so a teammate who joins mid-session appears. Both clear on unmount / customer
  change. No customer selected → no heartbeat, no poll.
- **Confirm-gate.** The SMS composer (`/api/text/send`, DetailPanel) and the
  LogContactDrawer (`/api/contact-logs`) gain a one-step confirm when the selected
  case's collision `level !== "none"` at submit time: "Jane is viewing this customer —
  send anyway?" / "Jane contacted this customer 12m ago — log anyway?". Acknowledging
  proceeds with the original submit; cancelling aborts. Never blocks; it is a single
  acknowledgment, client-side (the server action is unchanged). When `level === "none"`
  the forms submit exactly as today.

---

## Data flow

1. User opens customer **X** → DetailPanel mounts → heartbeat POST immediately, then
   every 20s; `useRevalidator` poll every 20s.
2. Each loader run reads recent-contact attribution + fresh heartbeats → computes
   per-case `Collision` (self-excluded) → renders markers, banner, and arms the
   confirm-gate.
3. On an SMS-send / log-contact submit, if the selected case has an active collision,
   the confirm-gate intercepts once; on acknowledge, the normal POST proceeds.
4. Closing the panel / switching customer stops the heartbeat and the poll; the row's
   own heartbeat ages out after `PRESENCE_FRESH_SEC` so other users stop seeing the
   user as live without any explicit "leave" call.

---

## Error handling

- **Heartbeat writes** are best-effort: a failure is logged and swallowed — it must
  never block the contact action or surface an error to the polling client.
- **Presence read** in the loader degrades to "no presence" on error (logged), so a
  presence hiccup never takes down the dashboard. Documented deviation from strict-throw.
- **Recent-contact reads** keep the existing strict capture-and-throw behavior (critical load).
- **Confirm-gate** is purely additive client UX; the server actions and their validation
  are untouched, so a JS-disabled client simply gets today's behavior (submit goes through).

---

## Testing

- **`tests/collision.test.ts`** (pure): self vs other attribution; null-user contact
  ignored; within / outside the 60-min window; fresh vs stale heartbeat; self-excluded
  live viewer; live-over-recent precedence; multi-live label list.
- **`tests/presence.test.ts`** (integration, local Supabase): heartbeat upsert
  idempotency (second beat updates `last_seen_at`, no duplicate row); org-scoping;
  cross-org RLS isolation (member of org A cannot read/write org B presence).
- **`tests/api-presence-heartbeat.test.ts`**: route guards (no session / no membership
  rejected; valid member writes own row) following the repo's route-action convention
  (exercise the queries/guards the route relies on).
- **Loader wiring**: a test asserting the per-case collision queries bind `org_id` and
  the presence read degrades on error (no throw). Confirm-gate decision is covered by
  the pure `collisionState` tests.

---

## RLS / security notes (binding constraints)

- `is_org_member` permits **every** org the caller belongs to, so every user-client read
  and write here binds `.eq("org_id", org.org_id)` and surfaces errors (presence read's
  graceful degrade still binds org_id — it only changes error *handling*, not scoping).
- The service client is **not** used in this feature; all presence I/O is member-scoped
  via the user/RLS client.
- The `case_presence` write policies pin `user_id = auth.uid()`, so even with a forged
  body a member can only stamp their own presence in their own org.

---

## Files summary

| File | Action |
| --- | --- |
| `supabase/migrations/0014_case_presence.sql` | Create — table + RLS + index |
| `app/lib/collision.ts` | Create — pure derivation + constants |
| `app/lib/presence.server.ts` | Create — `recordHeartbeat` / `readPresence` |
| `app/routes/api.presence.heartbeat.tsx` | Create — heartbeat resource route |
| `app/routes.ts` | Modify — register the heartbeat route |
| `app/routes/dashboard.tsx` | Modify — attribution selects, presence read, collision compute + thread |
| `app/components/WorkQueue.tsx` | Modify — row collision marker |
| `app/components/DetailPanel.tsx` | Modify — banner, heartbeat/poll effect, SMS confirm-gate |
| `app/components/LogContactDrawer.tsx` | Modify — log-contact confirm-gate |
| `tests/collision.test.ts` | Create |
| `tests/presence.test.ts` | Create |
| `tests/api-presence-heartbeat.test.ts` | Create |
| `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` | Modify — mark C1 `[x]` on completion |
