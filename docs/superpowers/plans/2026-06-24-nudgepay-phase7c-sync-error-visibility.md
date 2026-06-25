# NudgePay Phase 7c — Sync & Error Visibility (B6) + Root-Cause Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Durably record failed QBO syncs and surface an unresolved-error count + dismissible panel; plus two root-cause fixes (`case_id` stamped on texts at send time; `api.assign` org-scoping + error capture).

**Architecture:** A new `sync_errors` table (RLS read+update for org members) records failures. A pure-ish server module `app/lib/sync-errors.server.ts` owns `recordSyncError`/`resolveSyncErrors`. The three QBO sync entry points (manual refresh, cron CDC, webhook) record on failure and resolve on success; the webhook also moves from abort-on-first-error to per-event isolation. The dashboard loader reads unresolved errors via the user (RLS) client; a `SyncIssues` header component shows a badge + dismissible panel posting to a new org-scoped `api/sync-errors/dismiss` route. Separately, `sendInvoiceText`/`recordInboundMessage` stamp `case_id` (column already exists since `0009`) so the Phase 7b customer-keyed SMS workaround is removed, and `api.assign` gains explicit org-scoping + error capture.

**Tech Stack:** React Router 7, TypeScript 5.9, Supabase (Postgres + RLS), Vitest 4, Cloudflare Workers. Spec: `docs/superpowers/specs/2026-06-24-nudgepay-phase7c-sync-error-visibility-design.md`.

## Global Constraints

- **Manual route table.** Routes live in `nudgepay-app/app/routes.ts` (NOT file-based). A new `api.*` route file is a silent 404 until registered. `tests/routes-registration.test.ts` guards this.
- **RLS scoping pattern (from 7b).** Any case/customer/error mutation through a user client must bind BOTH the guard and the write with explicit `.eq("org_id", org.org_id)` AND capture the returned `error` — never swallow a failed write. RLS (`is_org_member`) permits *every* org the user belongs to, so explicit org scoping is required, not optional.
- **`.server.ts` may use `new Date()`.** Only pure `app/lib/*.ts` (no `.server`) modules are forbidden I/O / `new Date()`. Everything in this plan is `.server.ts` or routes, so `new Date()` is allowed.
- **`truncated` stays separate.** The >1000-invoice warning keeps its existing flag; it is NOT recorded in `sync_errors`.
- **`payments_eval` is NOT recorded.** 3 recording points only: manual `full`, cron `cdc`, webhook `<entity>:<qboId>` (entity lowercased). The inner payments/eval catch keeps its existing `console.error`.
- **Webhook retry contract.** Intuit retries on non-2xx; upserts are idempotent. Per-event isolation must still return 500 if any event failed, so Intuit re-delivers the batch.
- **Commands (run from `nudgepay-app/`):** tests `npx vitest run`; a single file `npx vitest run tests/<file>`; types `npx tsc -b`; build `npx react-router build`; apply migrations to the local/test DB `npx supabase db reset` (applies `0001`–`0013`). Tests run against local Supabase; `tests/global-setup.ts` truncates tables once but does NOT apply migrations — run `db reset` after adding `0013` before running tests.
- **Conventional Commits** + trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Baseline:** 218 tests green on branch `phase7c-sync-visibility`.

---

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `supabase/migrations/0013_sync_errors.sql` (create) | 1 | `sync_errors` table + RLS policies + `case_id` straggler re-backfill |
| `tests/global-setup.ts` (modify) | 1 | add `sync_errors` to the truncation list |
| `tests/sync-errors-schema.test.ts` (create) | 1 | schema + check-constraint + RLS read contract |
| `app/lib/sync-errors.server.ts` (create) | 2 | `recordSyncError` / `resolveSyncErrors` |
| `tests/sync-errors.test.ts` (create) | 2 | helper unit tests |
| `app/routes/api.sync-errors.dismiss.tsx` (create) | 3 | org-scoped manual-dismiss resource route |
| `app/routes.ts` (modify) | 3 | register the dismiss route |
| `tests/api-sync-errors-dismiss.test.ts` (create) | 3 | dismiss RLS contract |
| `app/routes/api.qbo.refresh.tsx` (modify) | 4 | record on failure / resolve-all on success |
| `app/lib/qbo-cron.server.ts` (modify) | 4 | per-org record/resolve |
| `app/routes/webhooks.qbo.tsx` (modify) | 4 | per-event isolation + record/resolve |
| `tests/sync-errors-wiring.test.ts` (create) | 4 | cron-recording + webhook per-event isolation |
| `app/routes/dashboard.tsx` (modify) | 5 | load unresolved errors; render `SyncIssues` |
| `app/components/SyncIssues.tsx` (create) | 5 | badge + dismissible panel |
| `app/components/AppShell.tsx` (modify) | 5 | accept a `syncIssues` slot next to the sync chip |
| `app/lib/twilio-messaging.server.ts` (modify) | 6 | `activeCaseId` + stamp `case_id` on send/inbound |
| `app/routes/dashboard.tsx` (modify) | 6 | drop customer-keyed SMS workaround; key on `case_id` |
| `tests/twilio-send.test.ts` (modify) | 6 | outbound `case_id` assertions |
| `tests/twilio-inbound.test.ts` (modify) | 6 | inbound `case_id` assertion |
| `app/routes/api.assign.tsx` (modify) | 7 | org-scope guard+update + error capture |
| `tests/api-assign.test.ts` (modify) | 7 | org-scoped update assertion |

---

## Task 1: `sync_errors` table + RLS + `case_id` re-backfill

**Files:**
- Create: `nudgepay-app/supabase/migrations/0013_sync_errors.sql`
- Modify: `nudgepay-app/tests/global-setup.ts` (add `sync_errors` truncation)
- Test: `nudgepay-app/tests/sync-errors-schema.test.ts`

**Interfaces:**
- Produces: table `sync_errors(id uuid pk, org_id uuid, source text, scope text, message text, occurred_at timestamptz, resolved_at timestamptz, resolved_by uuid)`; RLS policies `sync_errors_member_read` (select) and `sync_errors_member_update` (update); partial index on unresolved rows. Consumed by Tasks 2–5.

- [ ] **Step 1: Write the migration**

Create `nudgepay-app/supabase/migrations/0013_sync_errors.sql`:

```sql
-- Phase 7c (B6): durable record of failed QBO syncs so the dashboard can show an
-- unresolved-error count. A successful sync auto-resolves; a user can also
-- manually dismiss. The `truncated` (>1000 invoices) warning stays a separate
-- flag and is intentionally NOT recorded here.
create table sync_errors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  source text not null check (source in ('manual','webhook','cron')),
  scope text not null,
  message text not null,
  occurred_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index sync_errors_org_unresolved_idx on sync_errors (org_id) where resolved_at is null;

alter table sync_errors enable row level security;
-- Members read their own org's errors (dashboard loader uses the user/RLS client).
-- Inserts + auto-resolution run via the service client (bypasses RLS) from sync
-- paths. Manual dismiss runs through an org-scoped resource route (user client).
create policy sync_errors_member_read on sync_errors
  for select using (is_org_member(org_id));
create policy sync_errors_member_update on sync_errors
  for update using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Root-cause fix groundwork: migration 0009 added text_messages.case_id and
-- backfilled it once, but sendInvoiceText never set it for new sends, so every
-- text since 0009 has case_id = null. Re-backfill stragglers to the customer's
-- currently-open case (one open case per customer, enforced by the partial
-- unique index in 0009). Going-forward stamping is Task 6.
update text_messages tm
  set case_id = c.id
  from collection_cases c
  where c.customer_id = tm.customer_id
    and c.closed_at is null
    and tm.case_id is null;
```

- [ ] **Step 2: Apply the migration and verify it lands**

Run: `cd nudgepay-app && npx supabase db reset`
Expected: migrations `0001`–`0013` apply with no error; reset completes successfully.

- [ ] **Step 3: Add `sync_errors` to the test truncation list**

In `nudgepay-app/tests/global-setup.ts`, add a delete line immediately BEFORE the `organizations` delete (org delete cascades it, but be explicit/parallel-safe):

```ts
  await svc.from("sync_errors").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("oauth_states").delete().neq("state", "");
  await svc.from("organizations").delete().neq("id", "00000000-0000-0000-0000-000000000000");
```

(The `oauth_states` + `organizations` lines already exist; insert the `sync_errors` line just above them.)

- [ ] **Step 4: Write the failing schema/RLS test**

Create `nudgepay-app/tests/sync-errors-schema.test.ts`:

```ts
import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

test("service inserts a sync_error and a member reads it via RLS; outsider cannot", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "SyncErr Org A" }).select("id").single();
  const orgId = org!.id;
  const member = await makeUserClient("syncerr-a@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: member.userId, role: "owner" });

  const { error: insErr } = await svc.from("sync_errors")
    .insert({ org_id: orgId, source: "cron", scope: "cdc", message: "boom" });
  expect(insErr).toBeNull();

  // member reads own-org error
  const { data: mine } = await member.client.from("sync_errors")
    .select("id, source, scope, message, resolved_at").eq("org_id", orgId);
  expect(mine!.length).toBe(1);
  expect(mine![0].source).toBe("cron");
  expect(mine![0].resolved_at).toBe(null);

  // outsider sees nothing
  const outsider = await makeUserClient("syncerr-outsider@example.com");
  const { data: theirs } = await outsider.client.from("sync_errors").select("id").eq("org_id", orgId);
  expect(theirs ?? []).toEqual([]);
});

test("the source check constraint rejects an invalid source", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "SyncErr Org B" }).select("id").single();
  const { error } = await svc.from("sync_errors")
    .insert({ org_id: org!.id, source: "bogus", scope: "x", message: "y" });
  expect(error).not.toBeNull(); // check constraint violation
});
```

- [ ] **Step 5: Run the test**

Run: `cd nudgepay-app && npx vitest run tests/sync-errors-schema.test.ts`
Expected: PASS (2 tests). If it fails with "relation sync_errors does not exist", re-run Step 2 (`npx supabase db reset`).

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/supabase/migrations/0013_sync_errors.sql nudgepay-app/tests/global-setup.ts nudgepay-app/tests/sync-errors-schema.test.ts
git commit -m "feat(sync): add sync_errors table + RLS, re-backfill text case_id (7c)"
```

---

## Task 2: `recordSyncError` / `resolveSyncErrors` helper

**Files:**
- Create: `nudgepay-app/app/lib/sync-errors.server.ts`
- Test: `nudgepay-app/tests/sync-errors.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient`; the `sync_errors` table (Task 1).
- Produces:
  - `recordSyncError(service, { orgId: string; source: "manual"|"webhook"|"cron"; scope: string; message: string }): Promise<void>` — inserts one row, message truncated to 500 chars.
  - `resolveSyncErrors(service, { orgId: string; scope?: string; resolvedBy?: string|null }): Promise<void>` — sets `resolved_at`/`resolved_by` on unresolved rows; `scope` omitted ⇒ all for the org. Used by Tasks 3–4.

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/sync-errors.test.ts`:

```ts
import { expect, test } from "vitest";
import { serviceClient } from "./helpers";
import { recordSyncError, resolveSyncErrors } from "../app/lib/sync-errors.server";

async function newOrg(name: string): Promise<string> {
  const svc = serviceClient();
  const { data } = await svc.from("organizations").insert({ name }).select("id").single();
  return data!.id as string;
}

test("recordSyncError inserts a row and truncates the message to 500 chars", async () => {
  const svc = serviceClient();
  const orgId = await newOrg("Rec Org A");
  await recordSyncError(svc, { orgId, source: "manual", scope: "full", message: "x".repeat(600) });
  const { data } = await svc.from("sync_errors").select("source, scope, message, resolved_at").eq("org_id", orgId);
  expect(data!.length).toBe(1);
  expect(data![0].source).toBe("manual");
  expect(data![0].scope).toBe("full");
  expect((data![0].message as string).length).toBe(500);
  expect(data![0].resolved_at).toBe(null);
});

test("resolveSyncErrors with no scope resolves all unresolved for the org only", async () => {
  const svc = serviceClient();
  const orgId = await newOrg("Rec Org B");
  const otherOrgId = await newOrg("Rec Org B-other");
  await recordSyncError(svc, { orgId, source: "cron", scope: "cdc", message: "a" });
  await recordSyncError(svc, { orgId, source: "webhook", scope: "invoice:1", message: "b" });
  await recordSyncError(svc, { orgId: otherOrgId, source: "cron", scope: "cdc", message: "c" });

  await resolveSyncErrors(svc, { orgId });

  const { data: mine } = await svc.from("sync_errors").select("resolved_at").eq("org_id", orgId);
  expect(mine!.every((r) => r.resolved_at !== null)).toBe(true);
  const { data: other } = await svc.from("sync_errors").select("resolved_at").eq("org_id", otherOrgId);
  expect(other!.every((r) => r.resolved_at === null)).toBe(true); // untouched
});

test("resolveSyncErrors with a scope resolves only matching unresolved rows", async () => {
  const svc = serviceClient();
  const orgId = await newOrg("Rec Org C");
  await recordSyncError(svc, { orgId, source: "webhook", scope: "invoice:9", message: "a" });
  await recordSyncError(svc, { orgId, source: "webhook", scope: "customer:9", message: "b" });

  await resolveSyncErrors(svc, { orgId, scope: "invoice:9" });

  const { data } = await svc.from("sync_errors").select("scope, resolved_at").eq("org_id", orgId);
  const byScope = Object.fromEntries(data!.map((r) => [r.scope, r.resolved_at]));
  expect(byScope["invoice:9"]).not.toBe(null);
  expect(byScope["customer:9"]).toBe(null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/sync-errors.test.ts`
Expected: FAIL — cannot import `recordSyncError` / `resolveSyncErrors` (module not found).

- [ ] **Step 3: Write the module**

Create `nudgepay-app/app/lib/sync-errors.server.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_MESSAGE_LEN = 500;

export async function recordSyncError(
  service: SupabaseClient,
  args: { orgId: string; source: "manual" | "webhook" | "cron"; scope: string; message: string },
): Promise<void> {
  const message = args.message.slice(0, MAX_MESSAGE_LEN);
  const { error } = await service.from("sync_errors").insert({
    org_id: args.orgId, source: args.source, scope: args.scope, message,
  });
  if (error) throw error;
}

// scope omitted => resolve ALL unresolved errors for the org (a full sync is the
// broad healer). scope provided => resolve only matching unresolved rows (a
// webhook apply is narrow).
export async function resolveSyncErrors(
  service: SupabaseClient,
  args: { orgId: string; scope?: string; resolvedBy?: string | null },
): Promise<void> {
  let q = service.from("sync_errors")
    .update({ resolved_at: new Date().toISOString(), resolved_by: args.resolvedBy ?? null })
    .eq("org_id", args.orgId).is("resolved_at", null);
  if (args.scope) q = q.eq("scope", args.scope);
  const { error } = await q;
  if (error) throw error;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/sync-errors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/sync-errors.server.ts nudgepay-app/tests/sync-errors.test.ts
git commit -m "feat(sync): record/resolve sync errors helper (7c)"
```

---

## Task 3: Manual-dismiss resource route + registration

**Files:**
- Create: `nudgepay-app/app/routes/api.sync-errors.dismiss.tsx`
- Modify: `nudgepay-app/app/routes.ts` (register the route)
- Test: `nudgepay-app/tests/api-sync-errors-dismiss.test.ts`

**Interfaces:**
- Consumes: `getEnv`, `requireUser`, `resolveOrg`, `safeReturnTo` (existing libs); `sync_errors` table (Task 1).
- Produces: `POST /api/sync-errors/dismiss` with form fields `id`, `returnTo`. Org-scoped, error-checked, sets `resolved_at`/`resolved_by`. Consumed by the panel in Task 5.

- [ ] **Step 1: Write the route (mirror `api.priority-override.tsx`)**

Create `nudgepay-app/app/routes/api.sync-errors.dismiss.tsx`:

```ts
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
  const errorId = typeof form.get("id") === "string" ? (form.get("id") as string) : "";
  if (!errorId) return redirect(returnTo, { headers });

  // Org-scoped: RLS permits every org the user belongs to, so bind the update to
  // the active dashboard org as well. Capture the error — a silent redirect would
  // imply the dismiss saved when it didn't.
  const { error } = await supabase.from("sync_errors")
    .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq("org_id", org.org_id).eq("id", errorId);
  if (error) throw new Error(`Failed to dismiss sync error: ${error.message}`);

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
```

- [ ] **Step 2: Register the route**

In `nudgepay-app/app/routes.ts`, add after the `api/priority-override` line (line 17):

```ts
  route("api/sync-errors/dismiss", "routes/api.sync-errors.dismiss.tsx"),
```

- [ ] **Step 3: Write the failing RLS contract test (mirror `api-priority-override.test.ts`)**

Create `nudgepay-app/tests/api-sync-errors-dismiss.test.ts`:

```ts
import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

// Mirrors the RLS + guard paths /api/sync-errors/dismiss relies on.
test("a member dismisses an own-org sync error via RLS", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Dismiss Org A" }).select("id").single();
  const orgId = org!.id;
  const a = await makeUserClient("dismiss-a@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: a.userId, role: "owner" });
  const { data: se } = await svc.from("sync_errors")
    .insert({ org_id: orgId, source: "cron", scope: "cdc", message: "boom" }).select("id").single();

  const { error } = await a.client.from("sync_errors")
    .update({ resolved_at: new Date().toISOString(), resolved_by: a.userId })
    .eq("org_id", orgId).eq("id", se!.id);
  expect(error).toBeNull();

  const { data: after } = await svc.from("sync_errors")
    .select("resolved_at, resolved_by").eq("id", se!.id).single();
  expect(after!.resolved_at).not.toBe(null);
  expect(after!.resolved_by).toBe(a.userId);
});

test("a member of another org cannot dismiss the error (RLS blocks)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Dismiss Org B" }).select("id").single();
  const orgId = org!.id;
  const { data: se } = await svc.from("sync_errors")
    .insert({ org_id: orgId, source: "cron", scope: "cdc", message: "private" }).select("id").single();

  const outsider = await makeUserClient("dismiss-outsider@example.com"); // no membership in Org B
  await outsider.client.from("sync_errors")
    .update({ resolved_at: new Date().toISOString(), resolved_by: outsider.userId }).eq("id", se!.id);
  const { data: after } = await svc.from("sync_errors").select("resolved_at").eq("id", se!.id).single();
  expect(after!.resolved_at).toBe(null); // unchanged — RLS blocked it
});
```

- [ ] **Step 4: Run tests (contract + registration guard)**

Run: `cd nudgepay-app && npx vitest run tests/api-sync-errors-dismiss.test.ts tests/routes-registration.test.ts`
Expected: PASS — dismiss contract (2) green; `routes-registration` confirms `api.sync-errors.dismiss.tsx` is registered. If `routes-registration` fails, the route was not added to `routes.ts` (Step 2).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/routes/api.sync-errors.dismiss.tsx nudgepay-app/app/routes.ts nudgepay-app/tests/api-sync-errors-dismiss.test.ts
git commit -m "feat(sync): org-scoped sync-error dismiss route (7c)"
```

---

## Task 4: Wire recording/resolution into the three sync paths

**Files:**
- Modify: `nudgepay-app/app/routes/api.qbo.refresh.tsx`
- Modify: `nudgepay-app/app/lib/qbo-cron.server.ts`
- Modify: `nudgepay-app/app/routes/webhooks.qbo.tsx`
- Test: `nudgepay-app/tests/sync-errors-wiring.test.ts`

**Interfaces:**
- Consumes: `recordSyncError`, `resolveSyncErrors` (Task 2).
- Produces: failures recorded as `sync_errors` rows; webhook returns 500 if any event failed (per-event isolation), 200 otherwise.

- [ ] **Step 1: Wire `api.qbo.refresh.tsx`**

In `nudgepay-app/app/routes/api.qbo.refresh.tsx`, add the import and replace the `try/catch`:

```ts
import { recordSyncError, resolveSyncErrors } from "../lib/sync-errors.server";
```

Replace lines 23–29 (the `try { await syncOverdueInvoices… } catch { … }` block) with:

```ts
  try {
    await syncOverdueInvoices(deps, org.org_id);
    await resolveSyncErrors(service, { orgId: org.org_id }); // full sync heals all prior errors
    return redirect("/dashboard?sync=ok", { headers });
  } catch (err) {
    await recordSyncError(service, {
      orgId: org.org_id, source: "manual", scope: "full",
      message: err instanceof Error ? err.message : String(err),
    }).catch(() => {}); // best-effort: never mask the original failure
    // e.g. QBO not connected, or a transient API error.
    return redirect("/dashboard?sync=error", { headers });
  }
```

- [ ] **Step 2: Wire `qbo-cron.server.ts`**

In `nudgepay-app/app/lib/qbo-cron.server.ts`, add the import:

```ts
import { runCdcCatchup, type SyncDeps } from "./qbo-sync.server";
import { recordSyncError, resolveSyncErrors } from "./sync-errors.server";
```

Replace the per-org loop (lines 29–36) with:

```ts
  for (const c of conns ?? []) {
    const orgId = c.org_id as string;
    try {
      await runCdcCatchup(deps, orgId);
      await resolveSyncErrors(service, { orgId }); // CDC catch-up heals all prior errors
    } catch (err) {
      // Isolate per-org failures so one bad connection doesn't abort the batch,
      // and record it so the org's dashboard surfaces the failed sync.
      await recordSyncError(service, {
        orgId, source: "cron", scope: "cdc",
        message: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    }
  }
```

- [ ] **Step 3: Wire `webhooks.qbo.tsx` — per-event isolation**

In `nudgepay-app/app/routes/webhooks.qbo.tsx`, add the import:

```ts
import { recordSyncError, resolveSyncErrors } from "../lib/sync-errors.server";
```

Replace the whole `try { for (const ev …) … } catch (err) { … }` block (lines 30–47) with:

```ts
  // Per-event isolation: a failed event records a durable sync_error and does not
  // abort sibling events. If any event failed we still return 500 so Intuit
  // re-delivers the batch (upserts are idempotent, so re-applied events are safe).
  let hadFailure = false;
  for (const ev of parseQboWebhook(rawBody)) {
    const { data: conn } = await service.from("qbo_connections")
      .select("org_id").eq("realm_id", ev.realmId).eq("status", "connected").maybeSingle();
    if (!conn) continue; // unknown/disconnected realm — ignore
    const orgId = conn.org_id as string;
    const scope = `${ev.entityName.toLowerCase()}:${ev.id}`;
    try {
      if (ev.entityName === "Invoice") await applyInvoiceWebhook(deps, orgId, ev.id);
      else if (ev.entityName === "Customer") await applyCustomerWebhook(deps, orgId, ev.id);
      else if (ev.entityName === "Payment") await applyPaymentWebhook(deps, orgId, ev.id, "payment");
      else if (ev.entityName === "CreditMemo") await applyPaymentWebhook(deps, orgId, ev.id, "credit_memo");
      else continue; // other entity types are ignored — no record, no resolve
      await resolveSyncErrors(service, { orgId, scope }); // this entity is now consistent
    } catch (err) {
      hadFailure = true;
      console.error("QBO webhook event failed", ev.entityName, ev.id, err);
      await recordSyncError(service, {
        orgId, source: "webhook", scope,
        message: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    }
  }
  if (hadFailure) return new Response("processing error", { status: 500 });
  return new Response("ok", { status: 200 });
```

- [ ] **Step 4: Write the failing wiring test**

Create `nudgepay-app/tests/sync-errors-wiring.test.ts`. Both cases force a failure with a "connected" connection that has NO tokens, so `getValidAccessToken` throws "QBO not connected for this organization" inside the apply — exercising the record path without mocking the QBO API.

```ts
import { expect, test } from "vitest";
import { serviceClient, TEST_ENV } from "./helpers";
import { runScheduledCdc } from "../app/lib/qbo-cron.server";
import { action as webhookAction } from "../app/routes/webhooks.qbo";
import { signQboPayload } from "../app/lib/qbo-webhook.server";

function ctx() {
  return { cloudflare: { env: TEST_ENV } } as any;
}

test("cron records a 'cdc' sync_error for a connected-but-tokenless org", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Cron Wiring Org" }).select("id").single();
  const orgId = org!.id as string;
  // status 'connected' but no refresh token => getValidAccessToken throws.
  await svc.from("qbo_connections").insert({ org_id: orgId, realm_id: "CRON-R1", status: "connected" });

  await runScheduledCdc(TEST_ENV);

  const { data } = await svc.from("sync_errors")
    .select("source, scope, resolved_at").eq("org_id", orgId);
  expect(data!.length).toBe(1);
  expect(data![0].source).toBe("cron");
  expect(data![0].scope).toBe("cdc");
  expect(data![0].resolved_at).toBe(null);
});

test("webhook isolates a failing event: records it and returns 500", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "WH Wiring Org" }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("qbo_connections").insert({ org_id: orgId, realm_id: "WH-R1", status: "connected" });

  // Legacy webhook payload shape: one Invoice event for our realm.
  const body = JSON.stringify({
    eventNotifications: [{
      realmId: "WH-R1",
      dataChangeEvent: { entities: [{ name: "Invoice", id: "777", operation: "Update" }] },
    }],
  });
  const signature = await signQboPayload(body, TEST_ENV.QBO_WEBHOOK_VERIFIER_TOKEN);
  const request = new Request("http://localhost/webhooks/qbo", {
    method: "POST", headers: { "intuit-signature": signature }, body,
  });

  const res = await webhookAction({ request, context: ctx(), params: {} } as any);
  expect(res.status).toBe(500); // hadFailure -> Intuit retries

  const { data } = await svc.from("sync_errors").select("source, scope").eq("org_id", orgId);
  expect(data!.length).toBe(1);
  expect(data![0].source).toBe("webhook");
  expect(data![0].scope).toBe("invoice:777");
});
```

> If `parseQboWebhook`'s legacy entity field is not `dataChangeEvent.entities[].name`, open `app/lib/qbo-webhook.server.ts` and match the exact shape it parses (the existing `tests/qbo-webhook.test.ts` shows a valid payload to copy). The test must produce one parsed event with `entityName === "Invoice"` and `id === "777"` for realm `WH-R1`.

- [ ] **Step 5: Run the wiring test + the existing webhook signature test**

Run: `cd nudgepay-app && npx vitest run tests/sync-errors-wiring.test.ts tests/webhooks-route.test.ts`
Expected: PASS — cron records `cdc`; webhook records `invoice:777` and returns 500; the existing 401-signature tests still pass.

- [ ] **Step 6: Typecheck + commit**

Run: `cd nudgepay-app && npx tsc -b`
Expected: clean.

```bash
git add nudgepay-app/app/routes/api.qbo.refresh.tsx nudgepay-app/app/lib/qbo-cron.server.ts nudgepay-app/app/routes/webhooks.qbo.tsx nudgepay-app/tests/sync-errors-wiring.test.ts
git commit -m "feat(sync): record/resolve sync errors across refresh, cron, webhook (7c)"
```

---

## Task 5: Dashboard surface — load errors + `SyncIssues` badge/panel

**Files:**
- Create: `nudgepay-app/app/components/SyncIssues.tsx`
- Modify: `nudgepay-app/app/components/AppShell.tsx` (add a `syncIssues` slot)
- Modify: `nudgepay-app/app/routes/dashboard.tsx` (load unresolved errors; pass to shell)
- Test: none new (UI is presentational; verified by `tsc` + build; the dismiss route already has its own test in Task 3). The vitest env is `node` with no jsdom and `include: tests/**/*.test.ts`, so there is no component-render harness — do NOT add a `.test.tsx`.

**Interfaces:**
- Consumes: `sync_errors` table via the USER client; `api/sync-errors/dismiss` route (Task 3).
- Produces: `SyncIssues` component rendering a `⚠ N` badge + a disclosure panel of dismissible errors.

- [ ] **Step 1: Build the `SyncIssues` component**

Create `nudgepay-app/app/components/SyncIssues.tsx`:

```tsx
import { useState } from "react";
import { Form } from "react-router";

export type SyncIssue = {
  id: string;
  source: string;       // 'manual' | 'webhook' | 'cron'
  scope: string;
  message: string;
  occurredAt: string;   // ISO timestamp
};

function relativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

/**
 * SyncIssues — header indicator for unresolved QBO sync failures (B6).
 * Renders nothing when there are no issues. Otherwise a warning badge that
 * toggles a panel listing each error with a Dismiss action that POSTs to
 * /api/sync-errors/dismiss (org-scoped on the server).
 */
export function SyncIssues({ issues, returnTo }: { issues: SyncIssue[]; returnTo: string }) {
  const [open, setOpen] = useState(false);
  if (issues.length === 0) return null;
  const label = issues.length === 1 ? "1 sync issue" : `${issues.length} sync issues`;

  return (
    <div className="relative">
      <button
        type="button"
        className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-400/10 px-2.5 h-8 text-xs font-sans text-amber-200 hover:border-amber-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} — show details`}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">⚠</span>
        <span>{issues.length}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Sync issues"
          className="absolute right-0 top-10 z-40 w-80 max-h-96 overflow-auto rounded-lg border border-border bg-surface text-text shadow-panel p-2"
        >
          <p className="px-2 py-1 text-[11px] font-sans font-semibold uppercase tracking-wide text-muted">
            {label}
          </p>
          <ul className="flex flex-col gap-1" role="list">
            {issues.map((it) => (
              <li key={it.id} className="rounded-md border border-border p-2 text-xs font-sans">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text capitalize">{it.source}</span>
                  <span className="text-muted">{relativeTime(it.occurredAt)}</span>
                </div>
                <p className="mt-0.5 break-words text-text/80">{it.message}</p>
                <Form method="post" action="/api/sync-errors/dismiss" className="mt-1.5">
                  <input type="hidden" name="id" value={it.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button
                    type="submit"
                    className="text-[11px] font-medium text-copper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
                  >
                    Dismiss
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Add a `syncIssues` slot to `AppShell`**

In `nudgepay-app/app/components/AppShell.tsx`, add a prop to `AppShellProps` (after `headerActions`):

```ts
  /** Optional sync-issues indicator rendered next to the sync chip. */
  syncIssues?: React.ReactNode;
```

Add it to the destructured params (after `headerActions,`):

```ts
  syncIssues,
```

Render it immediately AFTER the sync chip `</div>` and BEFORE `{headerActions}` in the right-controls group (around line 111–113):

```tsx
          {syncIssues}

          {headerActions}
```

- [ ] **Step 3: Load unresolved errors in the dashboard loader**

In `nudgepay-app/app/routes/dashboard.tsx`, inside the loader. After the sync-label block (after line 190, before "Parse URL params"), add a USER-client read:

```ts
  // Unresolved sync errors for this org (B6). USER client → RLS scopes to own org.
  const { data: syncErrorRows } = await supabase
    .from("sync_errors")
    .select("id, source, scope, message, occurred_at")
    .is("resolved_at", null)
    .order("occurred_at", { ascending: false })
    .limit(20);
  const syncIssues = ((syncErrorRows as any[]) ?? []).map((r) => ({
    id: r.id as string, source: r.source as string, scope: r.scope as string,
    message: r.message as string, occurredAt: r.occurred_at as string,
  }));
```

Add `syncIssues` to the loader's returned `data({ … })` object (alongside `syncLabel`, around line 430):

```ts
      syncLabel,
      syncIssues,
```

- [ ] **Step 4: Render `SyncIssues` in the component**

In `nudgepay-app/app/routes/dashboard.tsx`:

Add the import near the other component imports (with `AppShell`, line 21):

```ts
import { SyncIssues } from "../components/SyncIssues";
```

Destructure `syncIssues` from the loader data in the `Dashboard()` component (with `syncLabel`, around line 465):

```ts
    syncLabel,
    syncIssues,
```

Pass it into `<AppShell …>` (after the `connected`/`isOwner` props, around line 493). Use the current URL as `returnTo` so a dismiss returns to the same view:

```tsx
      syncIssues={
        <SyncIssues
          issues={syncIssues}
          returnTo={`/dashboard?${new URLSearchParams({ view, sort, ...(q ? { q } : {}), ...(selected ? { case: selected.caseId } : {}), tab }).toString()}`}
        />
      }
```

> `view`, `sort`, `q`, `tab`, `selected` are already destructured from loader data in `Dashboard()` (they drive the queue/detail panel). If `selected` is not in scope at that point, use `{ view, sort, tab, ...(q ? { q } : {}) }` only.

- [ ] **Step 5: Typecheck + build**

Run: `cd nudgepay-app && npx tsc -b && npx react-router build`
Expected: both clean. (`SyncIssue` type flows from the component; `syncIssues` array shape matches.)

- [ ] **Step 6: Full suite regression**

Run: `cd nudgepay-app && npx vitest run`
Expected: all green (baseline 218 + new tests from Tasks 1–4; no regressions).

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/components/SyncIssues.tsx nudgepay-app/app/components/AppShell.tsx nudgepay-app/app/routes/dashboard.tsx
git commit -m "feat(sync): unresolved sync-issues badge + dismiss panel in header (7c)"
```

---

## Task 6: Root-cause fix — stamp `case_id` at send time + simplify the read

**Files:**
- Modify: `nudgepay-app/app/lib/twilio-messaging.server.ts`
- Modify: `nudgepay-app/app/routes/dashboard.tsx` (drop the customer-keyed SMS workaround)
- Test: `nudgepay-app/tests/twilio-send.test.ts`, `nudgepay-app/tests/twilio-inbound.test.ts`

**Interfaces:**
- Consumes: `collection_cases` (active case = `closed_at is null`); `text_messages.case_id` (exists since `0009`).
- Produces: outbound + inbound `text_messages` rows carry `case_id` of the customer's active case (or `null` if none). The dashboard loader keys SMS off `case_id` like contact logs.

- [ ] **Step 1: Write failing tests for `case_id` stamping**

Add to `nudgepay-app/tests/twilio-send.test.ts` (the `seed` helper there does NOT create a case — add a case-aware test). Append:

```ts
test("sendInvoiceText stamps case_id from the customer's active case", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550111");
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: customerId, status: "working" }).select("id").single();
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-CASE", status: "queued" }));
  await sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "Past due" });
  const { data: msg } = await svc.from("text_messages").select("case_id").eq("twilio_message_sid", "SM-CASE").single();
  expect(msg!.case_id).toBe(cse!.id);
});

test("sendInvoiceText leaves case_id null when the customer has no open case", async () => {
  const { orgId, invoiceId } = await seed(true, "+12295550112");
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-NOCASE", status: "queued" }));
  await sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "Past due" });
  const { data: msg } = await svc.from("text_messages").select("case_id").eq("twilio_message_sid", "SM-NOCASE").single();
  expect(msg!.case_id).toBe(null);
});
```

Add to `nudgepay-app/tests/twilio-inbound.test.ts` an assertion that an inbound message is threaded to the active case. Inspect that file's existing seed/setup first; add a test that creates an open case for the matched customer and asserts the inserted inbound row's `case_id` equals the case id. Pattern:

```ts
test("recordInboundMessage stamps case_id from the customer's active case", async () => {
  // ...seed org + customer with phone + an open collection_case (status 'working')...
  // ...call recordInboundMessage(svc, { from, to, body: "hello", messageSid: "SM-IN-CASE" })...
  // const { data } = await svc.from("text_messages").select("case_id, direction")
  //   .eq("twilio_message_sid", "SM-IN-CASE").single();
  // expect(data!.direction).toBe("inbound");
  // expect(data!.case_id).toBe(caseId);
});
```

Fill the placeholder using the existing seed pattern already present in `twilio-inbound.test.ts` (reuse its customer/phone setup; add one `collection_cases` insert).

- [ ] **Step 2: Run to verify they fail**

Run: `cd nudgepay-app && npx vitest run tests/twilio-send.test.ts tests/twilio-inbound.test.ts`
Expected: the new tests FAIL — `case_id` comes back `null` (send) because `sendInvoiceText` does not set it yet.

- [ ] **Step 3: Add `activeCaseId` and stamp it on send + inbound**

In `nudgepay-app/app/lib/twilio-messaging.server.ts`, add a helper after `resolveSender` (after line 26):

```ts
// The customer's currently-open collection case (one per customer, enforced by
// the partial unique index in 0009). Returns null if none is open.
export async function activeCaseId(
  service: SupabaseClient, orgId: string, customerId: string,
): Promise<string | null> {
  const { data } = await service.from("collection_cases")
    .select("id").eq("org_id", orgId).eq("customer_id", customerId).is("closed_at", null).maybeSingle();
  return (data?.id as string) ?? null;
}
```

In `sendInvoiceText`, after the `resolveSender` call and before the insert (after line 43), resolve the case id, then add `case_id` to the insert object:

```ts
  const caseId = await activeCaseId(deps.service, args.orgId, cust.id as string);
```

Add to the `text_messages` insert (after the `customer_id` line, line 50):

```ts
    case_id: caseId,
```

In `recordInboundMessage`, after the customer `match` is found and before the inbound insert (after line 96, where `lastOut` is fetched), resolve the case for the matched customer's org:

```ts
  const caseId = await activeCaseId(service, match.org_id as string, match.id as string);
```

Add to the inbound `text_messages` insert (after its `customer_id` line, line 100):

```ts
    case_id: caseId,
```

- [ ] **Step 4: Run to verify the stamping tests pass**

Run: `cd nudgepay-app && npx vitest run tests/twilio-send.test.ts tests/twilio-inbound.test.ts`
Expected: PASS — outbound/inbound rows carry the active `case_id`; null when no open case.

- [ ] **Step 5: Simplify the dashboard SMS read (remove the 7b workaround)**

In `nudgepay-app/app/routes/dashboard.tsx`, the last-contact block currently keys outbound texts by CUSTOMER and maps them to the open case via `openCaseByCustomer` + an `opened_at` window (lines ~297–333). Replace that block so texts are read by `case_id` directly, like contact logs.

Replace lines ~303–333 (from `const caseIds = cases.map(...)` through the closing `}` of the `if (caseIds.length > 0)` block) with:

```ts
    const caseIds = cases.map((c) => c.id);
    const lastContactsInput: CaseLastContactInput[] = [];
    if (caseIds.length > 0) {
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
    }
```

This removes the now-unused `openCaseByCustomer` map and `customerIds`. Verify no other code in the loader references `openCaseByCustomer` or `customerIds` (search the file); if the selected-case Messages thread still reads by `customer_id` (it does, intentionally — the SMS console is per-customer), leave that read untouched.

- [ ] **Step 6: Typecheck, build, full suite**

Run: `cd nudgepay-app && npx tsc -b && npx react-router build && npx vitest run`
Expected: clean types, clean build, all tests green. If `tsc` flags an unused `openCaseByCustomer`/`customerIds`, delete the leftover declarations.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/twilio-messaging.server.ts nudgepay-app/app/routes/dashboard.tsx nudgepay-app/tests/twilio-send.test.ts nudgepay-app/tests/twilio-inbound.test.ts
git commit -m "fix(sms): stamp case_id at send/inbound; key dashboard SMS on case_id (7c)"
```

---

## Task 7: Root-cause fix — `api.assign` org-scoping + error capture

**Files:**
- Modify: `nudgepay-app/app/routes/api.assign.tsx`
- Test: `nudgepay-app/tests/api-assign.test.ts`

**Interfaces:**
- Consumes: `customers` table; `org.org_id` from `resolveOrg`.
- Produces: the owner update is bound to `org_id` AND `id`, and a failed write throws instead of silently redirecting.

- [ ] **Step 1: Write the failing org-scoped-update test**

Add to `nudgepay-app/tests/api-assign.test.ts`:

```ts
test("the owner update is org-scoped: a customer in another org is not reassigned", async () => {
  const svc = serviceClient();
  // Org A: caller's resolved org, with member to assign.
  const { data: orgA } = await svc.from("organizations").insert({ name: "Assign Scope A" }).select("id").single();
  const a = await makeUserClient("assign-scope-a@example.com");
  await svc.from("memberships").insert({ org_id: orgA!.id, user_id: a.userId, role: "owner" });
  // Org B: the caller is ALSO a member (so RLS alone would permit the write).
  const { data: orgB } = await svc.from("organizations").insert({ name: "Assign Scope B" }).select("id").single();
  await svc.from("memberships").insert({ org_id: orgB!.id, user_id: a.userId, role: "member" });
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgB!.id, qbo_id: "scope-b1", name: "Org B Co" }).select("id").single();

  // The route binds the update to the RESOLVED org (A). A customer in org B must
  // not be updated even though RLS would allow it.
  const { error } = await a.client.from("customers")
    .update({ owner: a.userId }).eq("org_id", orgA!.id).eq("id", custB!.id);
  expect(error).toBeNull(); // update matched 0 rows, not an error
  const { data: after } = await svc.from("customers").select("owner").eq("id", custB!.id).single();
  expect(after!.owner).toBe(null); // unchanged — org scope prevented the cross-org write
});
```

- [ ] **Step 2: Run to verify the new test passes only with org scoping**

Run: `cd nudgepay-app && npx vitest run tests/api-assign.test.ts`
Expected: the new test PASSES at the query level (it already uses `.eq("org_id", …)`), demonstrating the contract the route must enforce. (This test asserts the DB behavior the route relies on; Step 3 makes the route match it.)

- [ ] **Step 3: Harden the route**

In `nudgepay-app/app/routes/api.assign.tsx`, scope the customer guard SELECT to the org (line 20–22):

```ts
  const { data: cust } = await supabase
    .from("customers").select("id").eq("org_id", org.org_id).eq("id", customerId).maybeSingle();
  if (!cust) return redirect(returnTo, { headers });
```

Replace the swallowed update (line 31) with an org-scoped, error-checked write:

```ts
  const { error } = await supabase.from("customers")
    .update({ owner: ownerId }).eq("org_id", org.org_id).eq("id", customerId);
  // Don't swallow a failed write — a silent redirect would imply the assignment
  // saved when it didn't. Surface it to the error boundary.
  if (error) throw new Error(`Failed to assign owner: ${error.message}`);
  return redirect(returnTo, { headers });
```

- [ ] **Step 4: Run the assign suite + typecheck**

Run: `cd nudgepay-app && npx vitest run tests/api-assign.test.ts && npx tsc -b`
Expected: all assign tests green; types clean.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/routes/api.assign.tsx nudgepay-app/tests/api-assign.test.ts
git commit -m "fix(assign): org-scope the owner update + surface write errors (7c)"
```

---

## Final verification (after all tasks)

- [ ] **Full gate:** `cd nudgepay-app && npx tsc -b && npx react-router build && npx vitest run`
  Expected: types clean, build clean, all tests green (baseline 218 + ~11 new across Tasks 1–7).
- [ ] **Manual smoke (optional, if a local QBO sandbox is connected):** trigger a failing refresh → badge shows `⚠ 1`; open the panel → see the error; click Dismiss → badge clears; a successful refresh also clears it.

---

## Self-Review (plan author)

**Spec coverage:**
- B6 storage → Task 1 (`sync_errors` + RLS). ✅
- B6 record/resolve helper → Task 2. ✅
- B6 auto-resolve on success + manual dismiss → Task 4 (resolve wiring) + Task 3 (dismiss route). ✅
- B6 three recording points (manual/cron/webhook), per-event isolation → Task 4. ✅
- B6 surface (badge + panel + dismiss form) → Task 5. ✅
- `payments_eval` excluded, `truncated` separate → encoded in Global Constraints + Task 4 (not wired). ✅
- Fix 1 `case_id` at send/inbound + re-backfill + read simplification → Task 1 (backfill SQL) + Task 6. ✅
- Fix 2 `api.assign` org-scope + error capture → Task 7. ✅

**Placeholder scan:** Task 6 Step 1 inbound test is a guided stub (the only place exact existing-seed code can't be transcribed blind) — the implementer fills it from the existing `twilio-inbound.test.ts` seed pattern, with the assertion fully specified. All other steps carry complete code.

**Type consistency:** `recordSyncError`/`resolveSyncErrors` signatures identical across Tasks 2/4. `SyncIssue` shape (`id/source/scope/message/occurredAt`) matches the loader mapping in Task 5 Step 3. `activeCaseId` signature consistent across Task 6 uses. Scope strings (`'full'`, `'cdc'`, `'<entity>:<id>'`) consistent between Task 4 record/resolve and the Task 4 test (`invoice:777`).
