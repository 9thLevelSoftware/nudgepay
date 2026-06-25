# NudgePay Phase 7c — Sync & Error Visibility (B6) + Root-Cause Fixes — Design

**Created:** 2026-06-24
**Phase:** 7c (closes the Phase 7 "fidelity" group: B4/B7 ✅ 7a, B5 ✅ 7b, **B6 here**)
**Scope:** One spec, three deliverables on one branch/PR:
1. **B6 — Sync & error visibility.** Durably record failed QBO syncs; surface an unresolved-error count + dismissible detail panel.
2. **Root-cause fix — `case_id` at send time.** Stamp `case_id` on outbound/inbound texts so the Phase 7b customer-keyed SMS workaround can be removed.
3. **Root-cause fix — `api.assign` hardening.** Explicit org-scoping + error capture on the owner update.

**Source of B6:** `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` line 37 — "Surface failed-sync state and an 'unresolved sync errors' count." Overlaps G3 (Settings sync panel, Phase 9), which will relocate this surface later.

---

## 1. Problem statement

### B6
QBO sync can fail in four places, and **every failure is currently swallowed**:

| Path | File | Current handling |
|---|---|---|
| Manual refresh | `app/routes/api.qbo.refresh.tsx` | `catch {}` → `redirect("/dashboard?sync=error")` (transient flash only) |
| Scheduled CDC catch-up (per org) | `app/lib/qbo-cron.server.ts` `runScheduledCdc` | per-org `catch` → `console.error`, continue |
| Webhook apply | `app/routes/webhooks.qbo.tsx` | `catch` → `console.error`, return 500 (aborts whole batch on first failure) |
| Payments/eval inside full sync | `app/lib/qbo-sync.server.ts` `syncOverdueInvoices` | inner `catch` → `console.error` ("cron will re-converge") |

`qbo_connections` stores only `status`, `last_sync_at`, `last_cdc_time` — **no error state**. The dashboard surfaces only a `syncLabel` ("Synced 5m ago") and the `truncated` (>1000 invoices) flag. A collector whose sync silently broke (revoked token, QBO API outage, malformed entity) has **no signal** that the work queue is stale.

### Root-cause fix 1 — `case_id` at send time
Migration `0009` added `case_id` to `text_messages` and one-time-backfilled it. But `sendInvoiceText` and `recordInboundMessage` (`app/lib/twilio-messaging.server.ts`) **never set `case_id`** on new rows, so every text sent since `0009` has `case_id = null`. Phase 7b worked around this in the dashboard loader by keying SMS to the customer and bounding to the case's `opened_at`. That works but is fragile across reopen cycles and complicates the loader. The column already exists — the fix is to populate it.

### Root-cause fix 2 — `api.assign` hardening
`app/routes/api.assign.tsx:31` runs `supabase.from("customers").update({ owner }).eq("id", customerId)`:
- The returned `error` is **ignored** (same swallow class fixed in 7b commit `c157ad6`).
- Scoped by `id` only — no explicit `org_id`. RLS (`is_org_member`) permits **any** org the caller belongs to, so a multi-org user could update a customer in org B while `resolveOrg` resolved org A, and assign an org-A member as owner of an org-B customer. 7b commit `3ff959b` fixed the identical looseness on the override route.

---

## 2. Data model

One new table. The `case_id` and `api.assign` fixes need no schema change (`case_id` column already exists).

```sql
-- supabase/migrations/0013_sync_errors.sql

create table sync_errors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  source text not null check (source in ('manual','webhook','cron')),
  scope text not null,                 -- 'full' | 'cdc' | '<entity>:<qboId>' where entity is the
                                        -- lowercased QBO entity name (invoice|customer|payment|creditmemo)
  message text not null,               -- caller truncates to <= 500 chars before insert
  occurred_at timestamptz not null default now(),
  resolved_at timestamptz,             -- null = unresolved (counts toward the badge)
  resolved_by uuid                     -- null = auto-resolved by a later success; uuid = manual dismiss
);

create index sync_errors_org_unresolved_idx on sync_errors (org_id) where resolved_at is null;

alter table sync_errors enable row level security;
-- Members read their own org's errors (dashboard loader uses the user/RLS client).
-- Inserts and auto-resolution run via the service client (bypasses RLS) from sync paths.
-- Manual dismiss runs through an org-scoped resource route (user client).
create policy sync_errors_member_read on sync_errors
  for select using (is_org_member(org_id));
create policy sync_errors_member_update on sync_errors
  for update using (is_org_member(org_id)) with check (is_org_member(org_id));
```

**`truncated` stays a separate existing flag.** It is a completeness *warning*, not a failure, and folding it into `sync_errors` collides with the auto-resolve-on-success rule (a successful sync would clear the truncation notice it just produced). B6's table is failures only; `truncated` keeps its current dashboard treatment.

**Manual-dismiss path:** the dismiss resource route uses the **user client** with an explicit `.eq("org_id", org.org_id)` AND relies on the `sync_errors_member_update` policy — defense in depth, consistent with the 7b override route.

---

## 3. Recording & resolution

New pure-ish server module `app/lib/sync-errors.server.ts`:

```ts
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

// scope omitted => resolve ALL unresolved errors for the org (a full sync is the broad healer).
// scope provided => resolve only matching unresolved errors (a webhook apply is narrow).
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

> `new Date()` is allowed here — this is a `.server.ts` module, not a pure `app/lib/*.ts` client/test module.

### Wiring

| Path | On failure (record) | On success (resolve) |
|---|---|---|
| `api.qbo.refresh` (manual) | `catch` → `recordSyncError(source:'manual', scope:'full', message)` | `resolveSyncErrors(orgId)` — **all** |
| `qbo-cron` `runScheduledCdc` (per org) | per-org `catch` → `recordSyncError(source:'cron', scope:'cdc', message)` | `resolveSyncErrors(orgId)` — **all** |
| `webhooks.qbo` per event | per-event `catch` → `recordSyncError(source:'webhook', scope:'<entity>:<id>', message)` | `resolveSyncErrors(orgId, scope:'<entity>:<id>')` per applied event |

The **payments/eval sub-step** inside `syncOverdueInvoices`/`runCdcCatchup` is intentionally NOT a recorded scope: both functions already `catch` it internally and return success, so recording it would be instantly auto-resolved by the enclosing full-sync success (a contradiction). It keeps its existing `console.error` and self-heals on the next sync ("cron will re-converge"). Recording it correctly would require threading a partial-failure flag through both functions and both call sites — deferred as YAGNI.

**Resolution semantics.** A **full sync** (manual refresh or cron CDC catch-up) re-pulls the org's data, so on success it resolves *all* unresolved errors for the org — including any prior webhook-scoped failures, which are now moot. A **webhook apply** is narrow: it resolves only its own `<entity>:<id>` scope.

**Webhook loop change.** `webhooks.qbo` moves from abort-on-first-error to **per-event isolation**:
- Wrap each event's apply in its own `try/catch`.
- On event success: `resolveSyncErrors(orgId, scope)`.
- On event failure: `recordSyncError(...)`, set a `hadFailure` flag, continue the loop.
- After the loop: if `hadFailure`, return 500 so Intuit retries the batch (upserts are idempotent; already-applied events simply re-apply). Otherwise 200.

This preserves Intuit's safe-retry contract while making failures durable and per-entity.

**Failure-of-the-recorder.** `recordSyncError` is wrapped so a recording failure never masks the original error or breaks the sync path (best-effort: log and proceed). The manual/cron call sites already sit in `catch` blocks; the webhook keeps returning 500 regardless.

---

## 4. UI surface

### Loader (`app/routes/dashboard.tsx`)
Read unresolved errors for the org via the **user (RLS) client**:
```ts
const { data: syncErrors } = await supabase
  .from("sync_errors")
  .select("id, source, scope, message, occurred_at")
  .is("resolved_at", null)
  .order("occurred_at", { ascending: false })
  .limit(20);
```
Pass `syncErrors` (array) + `syncErrorCount = syncErrors?.length ?? 0` to the shell/header. (≤20 is plenty for a Chancey-scale tenant; the badge shows the true count, capped display "20+" if it ever hits the limit.)

### Header (`AppShell` / dashboard header, next to `syncLabel`)
- When `syncErrorCount > 0`: render a `⚠ {n} sync issue(s)` badge (warning tone).
- Click toggles a disclosure **panel** listing each error: `source` · relative time (existing `formatDate`/relative helper) · `message`. Each row has a **Dismiss** button — a `<form method="post" action="/api/sync-errors/dismiss">` carrying the error `id` + `returnTo`.
- Zero errors ⇒ no badge, no panel (unchanged header).

### Dismiss route (`app/routes/api.sync-errors.dismiss.tsx`, registered in `app/routes.ts`)
```ts
// user client; resolve a single error, org-scoped + error-checked (7b pattern)
const { error } = await supabase.from("sync_errors")
  .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
  .eq("org_id", org.org_id).eq("id", errorId);
if (error) throw new Error(`Failed to dismiss sync error: ${error.message}`);
return redirect(returnTo, { headers });
```
`loader` redirects to `/dashboard`. "Dismiss all" is out of scope (YAGNI) — add later if requested.

---

## 5. Root-cause fix — `case_id` at send time

`app/lib/twilio-messaging.server.ts`:

- **Helper** `activeCaseId(service, orgId, customerId): Promise<string | null>` — `select id from collection_cases where org_id=… and customer_id=… and closed_at is null` (the partial unique index guarantees at most one). Returns `null` if none.
- **`sendInvoiceText`:** after resolving the customer, call `activeCaseId(...)` and include `case_id` in the `text_messages` insert.
- **`recordInboundMessage`:** after matching the customer, look up the active case and set `case_id` on the inbound insert (thread inbound to the case too).
- **Re-backfill stragglers** in `0013` (rows since `0009` with null `case_id`):
  ```sql
  update text_messages tm set case_id = c.id
  from collection_cases c
  where c.customer_id = tm.customer_id and c.closed_at is null and tm.case_id is null;
  ```

**Dashboard loader cleanup:** drop the customer-keyed + `opened_at`-window SMS lookup added in 7b; key SMS off `case_id` directly, the same way contact logs are keyed. Texts with `case_id = null` (sent before any case existed) are simply excluded from case-scoped reads — acceptable.

---

## 6. Root-cause fix — `api.assign` hardening

`app/routes/api.assign.tsx`:
- Customer SELECT guard: add `.eq("org_id", org.org_id)`.
- Owner UPDATE: add `.eq("org_id", org.org_id)` and **capture the error**:
  ```ts
  const { error } = await supabase.from("customers")
    .update({ owner: ownerId }).eq("org_id", org.org_id).eq("id", customerId);
  if (error) throw new Error(`Failed to assign owner: ${error.message}`);
  ```
Mirrors 7b commit `3ff959b` (org-scope) + `c157ad6` (error capture).

---

## 7. Testing

- **`sync-errors.server`** (`tests/sync-errors.test.ts`): `recordSyncError` truncates message + inserts; `resolveSyncErrors` with no scope resolves all unresolved for the org; with scope resolves only matching; both throw on db error.
- **Dismiss route** (`tests/api-sync-errors-dismiss.test.ts`): org-scoped update (`.eq org_id` AND `.eq id`), error capture throws, RLS contract — mirror `tests/api-priority-override.test.ts`.
- **Routes registration** (`tests/routes-registration.test.ts`): assert `api/sync-errors/dismiss` is registered (this guard already exists for all api/webhooks/auth routes).
- **`sendInvoiceText`** (extend `tests/twilio-send.test.ts`): insert includes `case_id` from the active case; `null` when the customer has no open case. `recordInboundMessage` `case_id` threading (extend `tests/twilio-inbound.test.ts`).
- **`api.assign`** (extend `tests/api-assign.test.ts`): update is org-scoped (`.eq org_id`); surfaced error throws rather than silently swallowing.
- **Webhook per-event isolation** (extend `tests/webhooks-route.test.ts` / `tests/qbo-webhook.test.ts`): one failing event records a `sync_errors` row + still returns 500; sibling good events apply and resolve their scope.
- Full suite stays green (currently 218 tests).

---

## 8. Decisions made during design (reversible)

- `truncated` stays a separate flag, excluded from `sync_errors`.
- `payments_eval` is NOT a recorded scope (resolve-order conflict; self-heals). 3 recording points: manual `full`, cron `cdc`, webhook `<entity>:<id>`.
- Webhook moves to per-event isolation (was abort-on-first-error).
- `case_id` re-backfill of stragglers ships in the same `0013` migration.
- Resolution model: full sync resolves all org errors; webhook resolves its scope; user can also manually dismiss.
- Surface: header badge + expandable dismiss panel now; Phase 9 (G3) relocates it into Settings.

## 9. Out of scope

- SMS/Twilio delivery errors (already surfaced per-message via `error_code`).
- "Dismiss all" bulk action.
- A dedicated `/sync-status` route or full Settings/Connections page (Phase 9, G1–G3).
- Configurable retry/alerting/notifications on sync failure.
