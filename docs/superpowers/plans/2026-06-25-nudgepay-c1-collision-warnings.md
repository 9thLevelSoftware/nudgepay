# NudgePay Phase 8b (C1) — Collision Warnings & Presence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn when a teammate recently contacted a customer or is viewing its case right now, and make the acting user acknowledge it once before sending an SMS or logging a contact.

**Architecture:** Two signals — recent-contact attribution (existing `contact_logs.user_id` / `text_messages.sent_by_user_id`) and poll-based live presence (new `case_presence` heartbeat table) — feed one pure derivation (`collision.ts`). The dashboard loader computes a per-case `Collision`, threaded to the queue (row marker), the detail panel (banner + heartbeat + revalidate poll), and the two contact forms (confirm-gate). No websockets.

**Tech Stack:** React Router 7 (SSR, single-fetch), TypeScript 5.9, Supabase Postgres + RLS, Tailwind v4, Vitest 4 (node env, no jsdom), Cloudflare Workers.

## Global Constraints

- **RLS scoping:** `is_org_member` permits EVERY org the caller belongs to. Every user-client read/write binds `.eq("org_id", org.org_id)` explicitly. Capture-and-throw on error — EXCEPT the one documented advisory exception: the dashboard **presence read degrades gracefully** (binds org_id, logs, treats as empty; never throws the loader). The service client is **not** used in this feature.
- **Heartbeat writes are best-effort:** a failure is logged and swallowed; it never blocks a contact action or surfaces an error to the polling client.
- **Tailwind v4:** class strings are LITERAL — no `text-${x}` interpolation. Use static maps.
- **Tunable constants** live only in `app/lib/collision.ts`: `RECENT_WINDOW_MIN = 60`, `HEARTBEAT_INTERVAL_MS = 20_000`, `PRESENCE_FRESH_SEC = 45`. UI and tests import them; never re-literal these values elsewhere.
- **Self-exclusion:** the current viewer is never counted in their own collision signals.
- **Precedence:** `live` > `recent` > `none`. A passive "last contacted by X" may render even when `level === "none"` (a different-user contact exists but is outside the window).
- **Conventional Commits** (`feat:`/`fix:`/`test:`/`docs:`). Commit bodies end with the trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Migrations** are append-only; the next number is `0014`.
- **Tests run against a local Supabase** (`tests/helpers.ts`: `serviceClient()`, `makeUserClient(email)`); `fileParallelism: false` is already set. Route-action tests exercise the queries/guards the route relies on (repo convention), not the action export directly.
- Run the full suite (`npm test`), `npx tsc --noEmit`, and `npm run build` before declaring a task done where applicable.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `app/lib/collision.ts` | **Create.** Pure constants + `summarizeRecentContact` / `liveViewers` / `collisionState`. No I/O. |
| `supabase/migrations/0014_case_presence.sql` | **Create.** `case_presence` table + RLS + index. |
| `app/lib/presence.server.ts` | **Create.** `recordHeartbeat` (upsert) / `readPresence` (org-scoped read). |
| `app/routes/api.presence.heartbeat.tsx` | **Create.** Heartbeat resource route (member-scoped, best-effort). |
| `app/routes.ts` | **Modify.** Register the heartbeat route. |
| `app/routes/dashboard.tsx` | **Modify.** Attribution selects, presence read (degrade), collision compute, thread to components. |
| `app/components/WorkQueue.tsx` | **Modify.** Row collision marker. |
| `app/components/DetailPanel.tsx` | **Modify.** Banner, heartbeat + revalidate poll effect, SMS confirm-gate. |
| `app/components/LogContactDrawer.tsx` | **Modify.** Log-contact confirm-gate. |
| `tests/collision.test.ts` | **Create.** Pure unit tests. |
| `tests/presence.test.ts` | **Create.** Integration: upsert idempotency, org-scope, cross-org RLS. |
| `tests/api-presence-heartbeat.test.ts` | **Create.** Route guards + own-row write. |
| `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` | **Modify.** Mark C1 `[x]` (final task). |

---

## Task 1: Pure collision module

**Files:**
- Create: `nudgepay-app/app/lib/collision.ts`
- Test: `nudgepay-app/tests/collision.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Constants `RECENT_WINDOW_MIN: number`, `HEARTBEAT_INTERVAL_MS: number`, `PRESENCE_FRESH_SEC: number`.
  - `type RecentContactInput = { userId: string | null; at: string }` (`at` = ISO).
  - `type HeartbeatInput = { userId: string; lastSeenAt: string }` (ISO).
  - `type CollisionLevel = "none" | "recent" | "live"`.
  - `type Collision = { level: CollisionLevel; byUser: string | null; recentAt: string | null; liveUsers: string[] }`.
  - `summarizeRecentContact(contacts: RecentContactInput[], currentUserId: string, nowMs: number): { userId: string; at: string; withinWindow: boolean } | null`.
  - `liveViewers(heartbeats: HeartbeatInput[], currentUserId: string, nowMs: number): string[]`.
  - `collisionState(args: { contacts: RecentContactInput[]; heartbeats: HeartbeatInput[]; currentUserId: string; nowMs: number; label: (userId: string) => string }): Collision`.

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/collision.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  summarizeRecentContact, liveViewers, collisionState,
  RECENT_WINDOW_MIN, PRESENCE_FRESH_SEC,
} from "../app/lib/collision";

const ME = "user-me";
const JANE = "user-jane";
const BOB = "user-bob";
const NOW = Date.parse("2026-06-25T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const secondsAgo = (s: number) => new Date(NOW - s * 1000).toISOString();
const label = (id: string) => ({ [JANE]: "Jane", [BOB]: "Bob", [ME]: "Me" }[id] ?? "A teammate");

test("summarizeRecentContact picks the latest different-user contact and flags the window", () => {
  const r = summarizeRecentContact(
    [{ userId: JANE, at: minutesAgo(10) }, { userId: BOB, at: minutesAgo(90) }],
    ME, NOW,
  );
  expect(r).toEqual({ userId: JANE, at: minutesAgo(10), withinWindow: true });
});

test("summarizeRecentContact ignores my own contacts and null-user (automated) contacts", () => {
  const r = summarizeRecentContact(
    [{ userId: ME, at: minutesAgo(1) }, { userId: null, at: minutesAgo(2) }, { userId: JANE, at: minutesAgo(5) }],
    ME, NOW,
  );
  expect(r?.userId).toBe(JANE);
});

test("summarizeRecentContact returns null when only my own / automated contacts exist", () => {
  expect(summarizeRecentContact([{ userId: ME, at: minutesAgo(1) }, { userId: null, at: minutesAgo(2) }], ME, NOW)).toBeNull();
});

test(`summarizeRecentContact flags withinWindow=false past ${RECENT_WINDOW_MIN}m`, () => {
  const r = summarizeRecentContact([{ userId: JANE, at: minutesAgo(RECENT_WINDOW_MIN + 1) }], ME, NOW);
  expect(r?.withinWindow).toBe(false);
});

test("liveViewers returns fresh non-self viewers, deduped", () => {
  const live = liveViewers(
    [
      { userId: JANE, lastSeenAt: secondsAgo(5) },
      { userId: JANE, lastSeenAt: secondsAgo(10) },
      { userId: BOB, lastSeenAt: secondsAgo(PRESENCE_FRESH_SEC + 5) }, // stale
      { userId: ME, lastSeenAt: secondsAgo(1) },                       // self
    ],
    ME, NOW,
  );
  expect(live).toEqual([JANE]);
});

test("collisionState: live wins over recent", () => {
  const c = collisionState({
    contacts: [{ userId: BOB, at: minutesAgo(5) }],
    heartbeats: [{ userId: JANE, lastSeenAt: secondsAgo(3) }],
    currentUserId: ME, nowMs: NOW, label,
  });
  expect(c.level).toBe("live");
  expect(c.byUser).toBe("Jane");
  expect(c.liveUsers).toEqual(["Jane"]);
});

test("collisionState: recent within window when nobody live", () => {
  const c = collisionState({
    contacts: [{ userId: BOB, at: minutesAgo(5) }], heartbeats: [], currentUserId: ME, nowMs: NOW, label,
  });
  expect(c.level).toBe("recent");
  expect(c.byUser).toBe("Bob");
  expect(c.recentAt).toBe(minutesAgo(5));
});

test("collisionState: none past the window, but still exposes byUser for passive display", () => {
  const c = collisionState({
    contacts: [{ userId: BOB, at: minutesAgo(RECENT_WINDOW_MIN + 30) }], heartbeats: [], currentUserId: ME, nowMs: NOW, label,
  });
  expect(c.level).toBe("none");
  expect(c.byUser).toBe("Bob");
});

test("collisionState: clean none when no signals", () => {
  const c = collisionState({ contacts: [], heartbeats: [], currentUserId: ME, nowMs: NOW, label });
  expect(c).toEqual({ level: "none", byUser: null, recentAt: null, liveUsers: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/collision.test.ts`
Expected: FAIL — cannot import from `../app/lib/collision` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `nudgepay-app/app/lib/collision.ts`:

```ts
// Pure collision derivation for C1. No I/O, no node:*, no .server suffix
// (imported by the dashboard loader, client components via type-only imports, and tests).

export const RECENT_WINDOW_MIN = 60;
export const HEARTBEAT_INTERVAL_MS = 20_000;
export const PRESENCE_FRESH_SEC = 45;

export type RecentContactInput = { userId: string | null; at: string }; // at = ISO
export type HeartbeatInput = { userId: string; lastSeenAt: string };     // ISO

export type CollisionLevel = "none" | "recent" | "live";

export type Collision = {
  level: CollisionLevel;
  byUser: string | null;     // display label of the most relevant colliding teammate
  recentAt: string | null;   // ISO of the recent different-user contact (for "12m ago")
  liveUsers: string[];       // distinct labels viewing now (excludes self)
};

// Latest contact by a user other than currentUserId (null-user contacts are
// automated/inbound and ignored for attribution). withinWindow = within RECENT_WINDOW_MIN.
export function summarizeRecentContact(
  contacts: RecentContactInput[], currentUserId: string, nowMs: number,
): { userId: string; at: string; withinWindow: boolean } | null {
  let best: { userId: string; at: string } | null = null;
  for (const c of contacts) {
    if (!c.userId || c.userId === currentUserId) continue;
    if (!best || c.at > best.at) best = { userId: c.userId, at: c.at };
  }
  if (!best) return null;
  const ageMin = (nowMs - Date.parse(best.at)) / 60_000;
  return { ...best, withinWindow: ageMin <= RECENT_WINDOW_MIN };
}

// Distinct non-self userIds whose last heartbeat is within PRESENCE_FRESH_SEC.
export function liveViewers(
  heartbeats: HeartbeatInput[], currentUserId: string, nowMs: number,
): string[] {
  const live = new Set<string>();
  for (const h of heartbeats) {
    if (h.userId === currentUserId) continue;
    const ageSec = (nowMs - Date.parse(h.lastSeenAt)) / 1000;
    if (ageSec <= PRESENCE_FRESH_SEC) live.add(h.userId);
  }
  return [...live];
}

export function collisionState(args: {
  contacts: RecentContactInput[];
  heartbeats: HeartbeatInput[];
  currentUserId: string;
  nowMs: number;
  label: (userId: string) => string;
}): Collision {
  const { contacts, heartbeats, currentUserId, nowMs, label } = args;
  const live = liveViewers(heartbeats, currentUserId, nowMs);
  const recent = summarizeRecentContact(contacts, currentUserId, nowMs);
  const liveUsers = live.map(label);

  if (live.length > 0) {
    return { level: "live", byUser: liveUsers[0], recentAt: recent?.at ?? null, liveUsers };
  }
  if (recent && recent.withinWindow) {
    return { level: "recent", byUser: label(recent.userId), recentAt: recent.at, liveUsers: [] };
  }
  return {
    level: "none",
    byUser: recent ? label(recent.userId) : null,
    recentAt: recent?.at ?? null,
    liveUsers: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/collision.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/collision.ts nudgepay-app/tests/collision.test.ts
git commit -m "feat(collision): pure recent-contact + live-presence derivation (C1)"
```

---

## Task 2: case_presence migration + RLS schema test

**Files:**
- Create: `nudgepay-app/supabase/migrations/0014_case_presence.sql`
- Test: `nudgepay-app/tests/presence.test.ts` (the RLS-isolation test; Task 3 adds the helper tests to the same file)

**Interfaces:**
- Consumes: nothing.
- Produces: table `case_presence (org_id, customer_id, user_id, last_seen_at)` with PK `(org_id, customer_id, user_id)`, index `case_presence_org_customer_idx`, and RLS policies (member read; member insert/update pinned to `user_id = auth.uid()`).

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/presence.test.ts`:

```ts
import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

test("cross-org RLS: a member of org A cannot read or write org B presence", async () => {
  const svc = serviceClient();
  const { data: orgA } = await svc.from("organizations").insert({ name: "Presence RLS A" }).select("id").single();
  const { data: orgB } = await svc.from("organizations").insert({ name: "Presence RLS B" }).select("id").single();
  const a = await makeUserClient("presence-rls-a@example.com");
  await svc.from("memberships").insert({ org_id: orgA!.id, user_id: a.userId, role: "owner" });
  // a is NOT a member of org B.
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgB!.id, qbo_id: "prls-b1", name: "B Co" }).select("id").single();

  // Read of B's presence from A's client returns nothing (RLS).
  const { data: readB } = await a.client.from("case_presence")
    .select("user_id").eq("org_id", orgB!.id).eq("customer_id", custB!.id);
  expect(readB ?? []).toEqual([]);

  // Write to B from A's client is rejected by RLS (insert error, no row created).
  const { error: writeErr } = await a.client.from("case_presence")
    .insert({ org_id: orgB!.id, customer_id: custB!.id, user_id: a.userId, last_seen_at: new Date().toISOString() });
  expect(writeErr).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/presence.test.ts`
Expected: FAIL — relation `case_presence` does not exist (or the cross-org read errors).

- [ ] **Step 3: Write the migration, then reset the local DB**

Create `nudgepay-app/supabase/migrations/0014_case_presence.sql`:

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
create policy case_presence_member_read on case_presence
  for select using (is_org_member(org_id));
-- Members upsert only their own heartbeat in an org they belong to.
create policy case_presence_member_insert on case_presence
  for insert with check (is_org_member(org_id) and user_id = auth.uid());
create policy case_presence_member_update on case_presence
  for update using (is_org_member(org_id) and user_id = auth.uid())
  with check (is_org_member(org_id) and user_id = auth.uid());
```

Apply it to the local test DB. Run: `cd nudgepay-app && npx supabase db reset`
Expected: migrations apply cleanly through `0014`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/presence.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/supabase/migrations/0014_case_presence.sql nudgepay-app/tests/presence.test.ts
git commit -m "feat(presence): case_presence table + RLS, cross-org isolation test (C1)"
```

---

## Task 3: presence.server helpers

**Files:**
- Create: `nudgepay-app/app/lib/presence.server.ts`
- Test: `nudgepay-app/tests/presence.test.ts` (append helper tests)

**Interfaces:**
- Consumes: `case_presence` table (Task 2).
- Produces:
  - `type HeartbeatRow = { customer_id: string; user_id: string; last_seen_at: string }`.
  - `recordHeartbeat(service: SupabaseClient, args: { orgId: string; customerId: string; userId: string }): Promise<void>` — single upsert on `(org_id,customer_id,user_id)`; binds org_id; throws on error.
  - `readPresence(service: SupabaseClient, args: { orgId: string; customerIds: string[] }): Promise<HeartbeatRow[]>` — org-scoped read; returns `[]` for empty input; throws on query error.

- [ ] **Step 1: Write the failing test (append to `tests/presence.test.ts`)**

```ts
import { recordHeartbeat, readPresence } from "../app/lib/presence.server";

test("recordHeartbeat upserts one row per (org,customer,user); a second beat updates last_seen_at", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Presence HB" }).select("id").single();
  const u = await makeUserClient("presence-hb@example.com");
  await svc.from("memberships").insert({ org_id: org!.id, user_id: u.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org!.id, qbo_id: "hb-1", name: "HB Co" }).select("id").single();

  await recordHeartbeat(u.client, { orgId: org!.id, customerId: cust!.id, userId: u.userId });
  const { data: first } = await svc.from("case_presence")
    .select("last_seen_at").eq("org_id", org!.id).eq("customer_id", cust!.id).eq("user_id", u.userId);
  expect(first).toHaveLength(1);

  await recordHeartbeat(u.client, { orgId: org!.id, customerId: cust!.id, userId: u.userId });
  const { data: second } = await svc.from("case_presence")
    .select("last_seen_at").eq("org_id", org!.id).eq("customer_id", cust!.id).eq("user_id", u.userId);
  expect(second).toHaveLength(1); // still one row (upsert, not insert)
  expect(Date.parse(second![0].last_seen_at)).toBeGreaterThanOrEqual(Date.parse(first![0].last_seen_at));
});

test("readPresence returns the org's rows for the requested customers and [] for empty input", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Presence Read" }).select("id").single();
  const u = await makeUserClient("presence-read@example.com");
  await svc.from("memberships").insert({ org_id: org!.id, user_id: u.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org!.id, qbo_id: "pr-1", name: "PR Co" }).select("id").single();
  await recordHeartbeat(u.client, { orgId: org!.id, customerId: cust!.id, userId: u.userId });

  expect(await readPresence(u.client, { orgId: org!.id, customerIds: [] })).toEqual([]);
  const rows = await readPresence(u.client, { orgId: org!.id, customerIds: [cust!.id] });
  expect(rows.map((r) => r.user_id)).toEqual([u.userId]);
  expect(rows[0].customer_id).toBe(cust!.id);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/presence.test.ts`
Expected: FAIL — cannot import from `../app/lib/presence.server`.

- [ ] **Step 3: Write minimal implementation**

Create `nudgepay-app/app/lib/presence.server.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type HeartbeatRow = { customer_id: string; user_id: string; last_seen_at: string };

// Upsert the caller's heartbeat for one customer. RLS pins user_id = auth.uid().
// Binds org_id. Throws on error (the route catches — heartbeats are best-effort).
export async function recordHeartbeat(
  service: SupabaseClient,
  args: { orgId: string; customerId: string; userId: string },
): Promise<void> {
  const { error } = await service.from("case_presence").upsert(
    {
      org_id: args.orgId,
      customer_id: args.customerId,
      user_id: args.userId,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "org_id,customer_id,user_id" },
  );
  if (error) throw error;
}

// Org-scoped presence read for the given customers. Returns [] for empty input.
// Binds org_id (RLS permits every member org, so scope explicitly). Throws on error;
// the loader decides how to handle it (presence read degrades gracefully).
export async function readPresence(
  service: SupabaseClient,
  args: { orgId: string; customerIds: string[] },
): Promise<HeartbeatRow[]> {
  if (args.customerIds.length === 0) return [];
  const { data, error } = await service
    .from("case_presence")
    .select("customer_id, user_id, last_seen_at")
    .eq("org_id", args.orgId)
    .in("customer_id", args.customerIds);
  if (error) throw error;
  return (data as HeartbeatRow[]) ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/presence.test.ts`
Expected: PASS (3 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/presence.server.ts nudgepay-app/tests/presence.test.ts
git commit -m "feat(presence): recordHeartbeat + readPresence helpers (C1)"
```

---

## Task 4: heartbeat resource route

**Files:**
- Create: `nudgepay-app/app/routes/api.presence.heartbeat.tsx`
- Modify: `nudgepay-app/app/routes.ts`
- Test: `nudgepay-app/tests/api-presence-heartbeat.test.ts`

**Interfaces:**
- Consumes: `recordHeartbeat` (Task 3); `requireUser`, `resolveOrg` (`app/lib/session.server`); `getEnv` (`app/lib/env.server`).
- Produces: POST `/api/presence/heartbeat` with form field `customerId`. Membership-guarded, best-effort, returns a minimal 204-style response.

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/api-presence-heartbeat.test.ts` (route-action convention — exercise the queries/guards the route relies on):

```ts
import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { recordHeartbeat } from "../app/lib/presence.server";

test("a member's heartbeat upserts their own presence row (route happy path)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "HB Route OK" }).select("id").single();
  const u = await makeUserClient("hb-route-ok@example.com");
  await svc.from("memberships").insert({ org_id: org!.id, user_id: u.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org!.id, qbo_id: "hbr-1", name: "HBR Co" }).select("id").single();

  // The route resolves org from membership then calls recordHeartbeat with user.id.
  const { data: resolved } = await u.client.from("memberships")
    .select("org_id").eq("user_id", u.userId).order("created_at", { ascending: true }).limit(1).maybeSingle();
  expect(resolved!.org_id).toBe(org!.id);

  await recordHeartbeat(u.client, { orgId: resolved!.org_id, customerId: cust!.id, userId: u.userId });
  const { data: rows } = await svc.from("case_presence")
    .select("user_id").eq("org_id", org!.id).eq("customer_id", cust!.id);
  expect(rows!.map((r) => r.user_id)).toEqual([u.userId]);
});

test("a non-member cannot write presence for a foreign org's customer (route membership guard / RLS)", async () => {
  const svc = serviceClient();
  const { data: orgA } = await svc.from("organizations").insert({ name: "HB Route A" }).select("id").single();
  const { data: orgB } = await svc.from("organizations").insert({ name: "HB Route B" }).select("id").single();
  const a = await makeUserClient("hb-route-a@example.com");
  await svc.from("memberships").insert({ org_id: orgA!.id, user_id: a.userId, role: "owner" });
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgB!.id, qbo_id: "hbr-b1", name: "B Co" }).select("id").single();

  // Even if a forged body named org B, the user client's RLS rejects the write.
  await expect(
    recordHeartbeat(a.client, { orgId: orgB!.id, customerId: custB!.id, userId: a.userId }),
  ).rejects.toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/api-presence-heartbeat.test.ts`
Expected: FAIL — the happy-path upsert/read or import resolves but the route file does not exist yet (write the route in Step 3; the test asserts the guard/query behavior the route uses).

> Note: this file's assertions are about the queries the route performs; they should already pass once `recordHeartbeat` exists. If they pass at Step 2, that is acceptable — proceed to write the route (Step 3) which is the actual deliverable, then re-run.

- [ ] **Step 3: Write the route and register it**

Create `nudgepay-app/app/routes/api.presence.heartbeat.tsx`:

```tsx
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { recordHeartbeat } from "../lib/presence.server";

// Background heartbeat for presence (C1). Best-effort: a failure is logged and
// swallowed so the 20s poll never surfaces an error to the client.
export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return new Response(null, { status: 204, headers });

  const form = await request.formData();
  const customerId = form.get("customerId");
  if (typeof customerId !== "string" || customerId.length === 0) {
    return new Response(null, { status: 204, headers });
  }

  try {
    await recordHeartbeat(supabase, { orgId: org.org_id, customerId, userId: user.id });
  } catch (e) {
    console.error("presence heartbeat failed (best-effort):", e);
  }
  return new Response(null, { status: 204, headers });
}

export function loader() {
  return redirect("/dashboard");
}
```

Modify `nudgepay-app/app/routes.ts` — add the route after the existing `api/sync-errors/dismiss` line (line 19):

```ts
  route("api/sync-errors/dismiss", "routes/api.sync-errors.dismiss.tsx"),
  route("api/presence/heartbeat", "routes/api.presence.heartbeat.tsx"),
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd nudgepay-app && npx vitest run tests/api-presence-heartbeat.test.ts && npx tsc --noEmit`
Expected: tests PASS (2); tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/routes/api.presence.heartbeat.tsx nudgepay-app/app/routes.ts nudgepay-app/tests/api-presence-heartbeat.test.ts
git commit -m "feat(presence): heartbeat resource route, registered (C1)"
```

---

## Task 5: dashboard loader wiring

**Files:**
- Modify: `nudgepay-app/app/routes/dashboard.tsx`
- Test: `nudgepay-app/tests/presence.test.ts` (append a loader-shape test)

**Interfaces:**
- Consumes: `collisionState`, `type Collision` (Task 1); `readPresence` (Task 3); existing `roster`/`ownerLabels`, `cases`, `user.id`.
- Produces: a `collisions: Record<string, Collision>` keyed by `caseId` in the loader's returned data; passed to `WorkQueue` (all) and to `DetailPanel` / `LogContactDrawer` (the selected case's entry).

> Context: the per-case contact reads are around `dashboard.tsx:327-347`; roster/ownerLabels at `:371-372`; the returned data object and component render are later in the file. Anchor edits by the surrounding code shown below, not by line number.

- [ ] **Step 1: Add imports**

At the top of `dashboard.tsx`, add to the imports:

```ts
import { collisionState, type Collision } from "../lib/collision";
import { readPresence } from "../lib/presence.server";
import type { RecentContactInput } from "../lib/collision";
```

- [ ] **Step 2: Capture contact attribution in the existing read loops**

The existing block builds `lastContactsInput`. Extend the two `select`s to include the actor columns and accumulate a per-case attribution map. Replace the existing block:

```ts
      const { data: logRows } = await supabase
        .from("contact_logs")
        .select("case_id, method, created_at")
        .eq("org_id", org.org_id).in("case_id", caseIds)
        .order("created_at", { ascending: false });
      const methodLabel: Record<string, string> = { call: "Call", email: "Email", text: "Text", note: "Note" };
      for (const r of (logRows as any[]) ?? []) {
        if (r.case_id) lastContactsInput.push({ caseId: r.case_id, date: r.created_at, channel: methodLabel[r.method] ?? "Note" });
      }
      // Outbound texts now carry case_id (stamped at send time, 7c), so key on it
      // directly — no customer mapping / opened_at window needed.
      const { data: msgRows } = await supabase
        .from("text_messages")
        .select("case_id, created_at")
        .eq("org_id", org.org_id).in("case_id", caseIds).eq("direction", "outbound")
        .order("created_at", { ascending: false });
      for (const r of (msgRows as any[]) ?? []) {
        if (r.case_id) lastContactsInput.push({ caseId: r.case_id, date: r.created_at, channel: "Text" });
      }
```

with (adds `user_id` / `sent_by_user_id` and a `recentByCase` accumulator):

```ts
      const recentByCase = new Map<string, RecentContactInput[]>();
      const pushRecent = (caseId: string, userId: string | null, at: string) => {
        const list = recentByCase.get(caseId) ?? [];
        list.push({ userId, at });
        recentByCase.set(caseId, list);
      };

      const { data: logRows } = await supabase
        .from("contact_logs")
        .select("case_id, method, created_at, user_id")
        .eq("org_id", org.org_id).in("case_id", caseIds)
        .order("created_at", { ascending: false });
      const methodLabel: Record<string, string> = { call: "Call", email: "Email", text: "Text", note: "Note" };
      for (const r of (logRows as any[]) ?? []) {
        if (r.case_id) {
          lastContactsInput.push({ caseId: r.case_id, date: r.created_at, channel: methodLabel[r.method] ?? "Note" });
          pushRecent(r.case_id, r.user_id ?? null, r.created_at);
        }
      }
      // Outbound texts now carry case_id (stamped at send time, 7c), so key on it
      // directly — no customer mapping / opened_at window needed.
      const { data: msgRows } = await supabase
        .from("text_messages")
        .select("case_id, created_at, sent_by_user_id")
        .eq("org_id", org.org_id).in("case_id", caseIds).eq("direction", "outbound")
        .order("created_at", { ascending: false });
      for (const r of (msgRows as any[]) ?? []) {
        if (r.case_id) {
          lastContactsInput.push({ caseId: r.case_id, date: r.created_at, channel: "Text" });
          pushRecent(r.case_id, r.sent_by_user_id ?? null, r.created_at);
        }
      }
```

> The `recentByCase` map must be declared in the same scope as `cases`/`ownerLabels` so Step 4 can read it. If the `if (caseIds.length > 0)` block is a narrower scope, hoist `const recentByCase = new Map<string, RecentContactInput[]>();` (and `pushRecent`) to just before that block instead, leaving only the `pushRecent(...)` calls inside.

- [ ] **Step 3: Read presence (graceful degrade) after roster/ownerLabels are built**

Immediately after `const ownerLabels = new Map(roster.map((m) => [m.userId, m.label]));`, add:

```ts
    // Presence (C1): advisory. Degrade to empty on error — never throw the loader.
    const presenceCustomerIds = [...new Set(cases.map((c) => c.customerId))];
    let presenceRows: { customer_id: string; user_id: string; last_seen_at: string }[] = [];
    try {
      presenceRows = await readPresence(supabase, { orgId: org.org_id, customerIds: presenceCustomerIds });
    } catch (e) {
      console.error("presence read failed (degrading to no presence):", e);
      presenceRows = [];
    }
    const presenceByCustomer = new Map<string, { userId: string; lastSeenAt: string }[]>();
    for (const r of presenceRows) {
      const list = presenceByCustomer.get(r.customer_id) ?? [];
      list.push({ userId: r.user_id, lastSeenAt: r.last_seen_at });
      presenceByCustomer.set(r.customer_id, list);
    }

    // Per-case collision (self-excluded). Plain object so it serializes over the loader.
    const nowMs = Date.now();
    const collisions: Record<string, Collision> = {};
    for (const cse of cases) {
      collisions[cse.id] = collisionState({
        contacts: recentByCase.get(cse.id) ?? [],
        heartbeats: presenceByCustomer.get(cse.customerId) ?? [],
        currentUserId: user.id,
        nowMs,
        label: (id) => ownerLabels.get(id) ?? "A teammate",
      });
    }
```

- [ ] **Step 4: Return `collisions` from the loader**

Find the loader's returned object (the one carrying `roster`, `items`, etc. — it appears twice: the connected path and a fallback). Add `collisions` to the connected-path return (the one alongside `dashboardData`/`roster`). For the not-connected/fallback return, add `collisions: {} as Record<string, Collision>`.

Example (connected path), add the field:

```ts
      roster,
      collisions,
```

And in the fallback return object near the other defaults:

```ts
    roster,
    collisions: {} as Record<string, Collision>,
```

- [ ] **Step 5: Destructure and thread to components**

In the component body, add `collisions` to the `useLoaderData` destructure. Then:

- Pass to `WorkQueue`: add prop `collisions={collisions}`.
- Pass to `DetailPanel`: add prop `collision={selected ? (collisions[selected.caseId] ?? null) : null}`.
- Pass to `LogContactDrawer`: add prop `collision={collisions[selected.caseId] ?? null}` (inside the `{log && selected ? ...}` block).

- [ ] **Step 6: Append a loader-shape test (`tests/presence.test.ts`)**

```ts
import { collisionState } from "../app/lib/collision";

test("loader collision compute: a teammate's recent contact yields a recent-level collision", async () => {
  // Mirrors the loader's per-case compute over real rows (the loader is not exported,
  // so we exercise the same query + collisionState it runs).
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Collide Loader" }).select("id").single();
  const me = await makeUserClient("collide-me@example.com");
  const jane = await makeUserClient("collide-jane@example.com");
  await svc.from("memberships").insert([
    { org_id: org!.id, user_id: me.userId, role: "owner" },
    { org_id: org!.id, user_id: jane.userId, role: "member" },
  ]);
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org!.id, qbo_id: "cl-1", name: "CL Co" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: org!.id, customer_id: cust!.id, status: "working" }).select("id").single();
  await svc.from("contact_logs").insert({
    org_id: org!.id, case_id: cse!.id, customer_id: cust!.id, user_id: jane.userId, method: "call",
  });

  const { data: logRows } = await me.client.from("contact_logs")
    .select("case_id, created_at, user_id").eq("org_id", org!.id).in("case_id", [cse!.id]);
  const contacts = (logRows ?? []).map((r) => ({ userId: r.user_id, at: r.created_at }));
  const c = collisionState({
    contacts, heartbeats: [], currentUserId: me.userId, nowMs: Date.now(),
    label: (id) => (id === jane.userId ? "collide-jane" : "A teammate"),
  });
  expect(c.level).toBe("recent");
  expect(c.byUser).toBe("collide-jane");
});
```

- [ ] **Step 7: Verify**

Run: `cd nudgepay-app && npx vitest run tests/presence.test.ts && npx tsc --noEmit && npm run build`
Expected: tests PASS; tsc exit 0; build clean.

- [ ] **Step 8: Commit**

```bash
git add nudgepay-app/app/routes/dashboard.tsx nudgepay-app/tests/presence.test.ts
git commit -m "feat(collision): loader attribution + presence read + per-case collision (C1)"
```

---

## Task 6: WorkQueue row marker

**Files:**
- Modify: `nudgepay-app/app/components/WorkQueue.tsx`

**Interfaces:**
- Consumes: `type Collision` (Task 1); `collisions` prop from the loader (Task 5).
- Produces: a row indicator rendered when a case's collision `level !== "none"`.

- [ ] **Step 1: Add the prop + a shared marker helper**

Add a type-only import at the top of `WorkQueue.tsx`:

```ts
import type { Collision } from "../lib/collision";
```

Add `collisions: Record<string, Collision>` to the `WorkQueue` props type and destructure it. Thread it down to whatever renders each row (`QueueRow` / `MobileCard`) as `collision={collisions[item.caseId]}`.

Add this static marker component near the top of the file (literal Tailwind classes only):

```tsx
function CollisionMarker({ collision }: { collision?: Collision }) {
  if (!collision || collision.level === "none") return null;
  const text =
    collision.level === "live"
      ? `${collision.byUser ?? "A teammate"} viewing now`
      : `Contacted by ${collision.byUser ?? "a teammate"} recently`;
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-sans font-medium text-amber-200 bg-amber-400/10 border border-amber-400/30"
      title={text}
      aria-label={text}
    >
      <span aria-hidden="true">⚠</span>
      {collision.level === "live" ? "Viewing" : "Recent"}
    </span>
  );
}
```

- [ ] **Step 2: Render the marker in the row**

In `QueueRow` (and `MobileCard`), render `<CollisionMarker collision={collision} />` in the row's metadata area — e.g. next to the owner/last-contact line. Accept `collision?: Collision` in the row component's props.

- [ ] **Step 3: Verify**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build`
Expected: tsc exit 0; build clean. (No unit test — UI rendering is not unit-tested in this repo; the gate is the typecheck + build.)

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/components/WorkQueue.tsx
git commit -m "feat(collision): work-queue row marker for live/recent collisions (C1)"
```

---

## Task 7: DetailPanel banner + heartbeat/poll + SMS confirm-gate

**Files:**
- Modify: `nudgepay-app/app/components/DetailPanel.tsx`

**Interfaces:**
- Consumes: `type Collision`, `HEARTBEAT_INTERVAL_MS` (Task 1); `collision` prop (Task 5); `useRevalidator` (react-router).
- Produces: collision banner; a heartbeat POST + `useRevalidator` poll on `HEARTBEAT_INTERVAL_MS` while a customer is selected; a one-step confirm on the SMS composer when `collision.level !== "none"`.

- [ ] **Step 1: Add imports + prop**

DetailPanel already imports `{ useState }` from `react` and `{ Link }` from `react-router`. **Extend those existing import lines** (do not add duplicates):
- `react`: `import { useEffect, useState } from "react";`
- `react-router`: `import { Link, useRevalidator } from "react-router";`

Add a new import line:

```ts
import { HEARTBEAT_INTERVAL_MS, type Collision } from "~/lib/collision";
```

Add `collision: Collision | null` to the `DetailPanel` props type and destructure it. The composer lives in `MessagesTab`; pass `collision` into `MessagesTab` as a prop too.

- [ ] **Step 2: Heartbeat + revalidate poll effect**

In `DetailPanel`, add an effect keyed on the selected customer id (no customer → nothing runs):

```tsx
  const revalidator = useRevalidator();
  const customerId = selected?.customerId ?? null;
  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    const beat = () => {
      const body = new FormData();
      body.set("customerId", customerId);
      fetch("/api/presence/heartbeat", { method: "POST", body }).catch(() => {});
    };
    beat(); // immediate
    const id = setInterval(() => {
      if (cancelled) return;
      beat();
      revalidator.revalidate();
    }, HEARTBEAT_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [customerId, revalidator]);
```

- [ ] **Step 3: Collision banner**

Render a banner near the top of the panel body when there is a collision signal (literal Tailwind):

```tsx
  {collision && (collision.level !== "none" || collision.byUser) ? (
    <div
      role="status"
      className={
        collision.level === "live"
          ? "mx-5 mt-3 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-sans text-amber-200"
          : "mx-5 mt-3 rounded-md border border-border bg-panel px-3 py-2 text-xs font-sans text-muted"
      }
    >
      {collision.level === "live"
        ? `⚠ ${collision.liveUsers.join(", ")} ${collision.liveUsers.length > 1 ? "are" : "is"} viewing this customer now`
        : `Last contacted by ${collision.byUser}`}
    </div>
  ) : null}
```

- [ ] **Step 4: SMS confirm-gate**

In `MessagesTab`, gate the send `<form>` with a confirm step when `collision && collision.level !== "none"`. Add local state and intercept submit:

```tsx
  const [confirmSend, setConfirmSend] = useState(false);
  const needsConfirm = !!collision && collision.level !== "none";
```

Change the form to intercept the first submit when a collision is active:

```tsx
        <form
          method="post"
          action="/api/text/send"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            if (needsConfirm && !confirmSend) {
              e.preventDefault();
              setConfirmSend(true);
            }
          }}
        >
```

And render the confirm prompt above the send button when `confirmSend` is true:

```tsx
          {confirmSend ? (
            <p className="text-xs font-sans text-amber-200" role="alert">
              {collision?.level === "live"
                ? `${collision.byUser} is viewing this customer now. Send anyway?`
                : `${collision?.byUser} contacted this customer recently. Send anyway?`}
            </p>
          ) : null}
```

The submit button keeps its existing markup; when `confirmSend` is true the next real submit proceeds (the `onSubmit` guard passes because `confirmSend` is now true). Reset `confirmSend` to `false` whenever `selected?.caseId` changes (add it to the body-reset effect, or a small effect keyed on `selected?.caseId`).

- [ ] **Step 5: Verify**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build`
Expected: tsc exit 0; build clean.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/components/DetailPanel.tsx
git commit -m "feat(collision): detail-panel banner, heartbeat poll, SMS confirm-gate (C1)"
```

---

## Task 8: LogContactDrawer confirm-gate

**Files:**
- Modify: `nudgepay-app/app/components/LogContactDrawer.tsx`

**Interfaces:**
- Consumes: `type Collision` (Task 1); `collision` prop (Task 5).
- Produces: a one-step confirm on the log-contact `<form>` when `collision.level !== "none"`.

- [ ] **Step 1: Add prop + state**

Add type-only import:

```ts
import type { Collision } from "../lib/collision";
```

Add `collision: Collision | null` to the props type and destructure it. Add:

```ts
  const [confirmSave, setConfirmSave] = useState(false);
  const needsConfirm = !!collision && collision.level !== "none";
```

- [ ] **Step 2: Gate the form submit**

Add an `onSubmit` guard to the `<Form method="post" action="/api/contact-logs" ...>`:

```tsx
        <Form
          method="post"
          action="/api/contact-logs"
          className="flex flex-col gap-4 px-5 py-4"
          onSubmit={(e) => {
            if (needsConfirm && !confirmSave) {
              e.preventDefault();
              setConfirmSave(true);
            }
          }}
        >
```

Render a confirm line just above the action buttons (before the `<div className="flex items-center justify-end gap-2 pt-2">`):

```tsx
          {confirmSave ? (
            <p className="text-xs font-sans text-amber-200" role="alert">
              {collision?.level === "live"
                ? `${collision.byUser} is viewing this customer now. Log anyway?`
                : `${collision?.byUser} contacted this customer recently. Log anyway?`}
            </p>
          ) : null}
```

The existing "Save contact" submit button is unchanged; once `confirmSave` is true the next submit proceeds.

- [ ] **Step 3: Verify**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build`
Expected: tsc exit 0; build clean.

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/components/LogContactDrawer.tsx
git commit -m "feat(collision): log-contact confirm-gate on active collision (C1)"
```

---

## Task 9: Mark C1 complete in the gap checklist

**Files:**
- Modify: `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md`

- [ ] **Step 1: Mark C1 done**

Replace the C1 line:

```markdown
- [ ] **C1 — Collision / recent-contact warnings & presence.** Warn when a teammate recently contacted or is actively working the same customer.
```

with:

```markdown
- [x] **C1 — Collision / recent-contact warnings & presence.** ✅ **8b.** Recent-contact attribution (`contact_logs.user_id` + `text_messages.sent_by_user_id` → roster label) + poll-based live presence (`case_presence` table, migration `0014`; 20s heartbeat, 45s freshness). Pure `collision.ts` derivation (self-excluded; live > recent > none). Surfaced as a queue-row marker, a DetailPanel banner, a 20s `useRevalidator` poll, and a confirm-gate on SMS send + log-contact. Presence read degrades gracefully (documented RLS deviation).
```

- [ ] **Step 2: Run the full suite**

Run: `cd nudgepay-app && npm test && npx tsc --noEmit && npm run build`
Expected: all tests PASS; tsc exit 0; build clean.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md
git commit -m "docs: mark C1 complete (Phase 8b) in gap checklist"
```

---

## Final verification (whole-branch)

- [ ] `cd nudgepay-app && npm test` — full suite green (existing + new: `collision`, `presence`, `api-presence-heartbeat`).
- [ ] `npx tsc --noEmit` — exit 0.
- [ ] `npm run build` — client + SSR clean.
- [ ] Manual/Chrome smoke (optional): two users on the same customer → live banner + marker appear within ~20s; sending SMS / logging while a collision is active shows the confirm step; closing the panel ages out presence within `PRESENCE_FRESH_SEC`.
