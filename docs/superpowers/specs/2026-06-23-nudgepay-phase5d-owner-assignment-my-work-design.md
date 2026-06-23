# Phase 5d — Owner / Assignment + "My work" View — Design

**Status:** Approved (design) — 2026-06-23
**Project:** NudgePay (AR-collections workspace for QuickBooks Online; Chancey Heating & Cooling)
**Predecessors:** Phases 1–5c complete and merged to `main`. 5a built the read-only worklist; 5b added contact logging + promises; 5c wired the Messages tab + SMS templates.

## 1. Goal

Let the 5-person AR team divide the worklist by **owning accounts**: assign a customer to a team member, see the owner in the queue and detail panel, and filter to a personal **"My work"** view. Ownership is per-customer (you work an account, not a single invoice).

## 2. Background — current state

- `customers` has **no owner column**. `WorkItem.owner` (`worklist.ts:18`) is a hardcoded `"Unassigned"` string; the WorkQueue OWNER column and the DetailPanel Overview "Owner" row already display it.
- `memberships` links `user_id` ↔ `org_id` with `role` (`owner`|`member`). Org members are the assignable users.
- Member **emails** live in `auth.users`, which the RLS user client cannot read. The app currently resolves only the *current* user's email (from the session). No org-member roster helper exists yet.
- `ViewId` has six views; the worklist view machinery (`applyView`, `computeMetrics`, `buildDashboardData`) is pure and unit-tested. Writes go through resource routes (`api.contact-logs`, `api.text.send`, `api.sms-consent`) using the shared `safeReturnTo` guard.

## 3. Scope (locked decisions)

| Decision | Choice |
| --- | --- |
| Ownership granularity | **Per-customer** (`customers.owner`); all of a customer's invoices share the owner. |
| Assignment permissions | **Open** — any member can assign/reassign/unassign any account to any member (collaborative 5-person team), not self-assign-only. |
| "My work" surface | A **saved view** (7th `ViewId`) with a count badge — NOT a metric tile (the strip stays org-wide KPIs). |
| Owner display label | Email **local-part** (e.g. `diskin`), for compactness. |
| Member roster source | **Service client** (`auth.users` is not user-client-readable) — the same boundary exception already used for own-org connection status. |

## 4. Architecture

Per-customer ownership stored as a nullable FK on `customers`. The loader resolves `owner` (a user_id) to a display label via a once-per-load member roster (service client). Assignment writes go through a new RLS resource route. "My work" is a pure view filter keyed on the current user's id.

## 5. Components & data flow

### 5.1 Migration `supabase/migrations/0008_customer_owner.sql`

```sql
alter table customers
  add column owner uuid references auth.users(id) on delete set null;
create index customers_org_owner_idx on customers (org_id, owner);
```

No RLS policy change — `customers` RLS already gates all access by `is_org_member(org_id)`.

### 5.2 `app/lib/orgs.server.ts` → `listOrgMembers`

```ts
export type OrgMember = { userId: string; email: string; label: string };
export async function listOrgMembers(
  service: SupabaseClient, orgId: string,
): Promise<OrgMember[]>;
```

- Reads `memberships` (`user_id`, `role`) for `orgId`.
- Resolves emails via the service client (`service.auth.admin.listUsers({ perPage: 1000 })`, matching the seed), mapping `user_id → email`.
- `label` = email local-part (substring before `@`); falls back to a short id slice if email is missing.
- Returns members sorted by label. Service client is required because `auth.users` is not user-client-readable; this is the same own-org boundary exception as `getConnectionStatus`.

### 5.3 `app/lib/worklist.ts`

- `CustomerInput` gains `owner: string | null` (the user_id).
- `WorkItem` gains `ownerId: string | null` (user_id) alongside the existing `owner: string` (now a real label; default `"Unassigned"`). `buildWorkItems` takes an `ownerLabels: Map<string,string>` (userId → label) and sets `ownerId = customer.owner` and `owner = ownerId ? (ownerLabels.get(ownerId) ?? "Unknown") : "Unassigned"`.
- `ViewId` adds `"my-work"`.
- `applyView(items, view, today, currentUserId)` — gains `currentUserId: string | null`; the `my-work` case returns `items.filter(i => i.ownerId != null && i.ownerId === currentUserId)`. Existing views ignore `currentUserId`.
- `buildDashboardData(invoices, customers, lastContacts, promiseSignals, params, today, ownerLabels, currentUserId)` — threads `ownerLabels` into `buildWorkItems` and `currentUserId` into `applyView` (for both the active view and the `my-work` count in `viewCounts`). `searchText` includes the owner label so search matches owners.

### 5.4 Dashboard loader (`app/routes/dashboard.tsx`)

- Add `owner` to the invoice→customers embed select (`customers(name, phone, email, owner)`); thread `owner` into `CustomerInput`.
- Build the roster once: `const roster = await listOrgMembers(service, org.org_id)`; derive `ownerLabels = new Map(roster.map(m => [m.userId, m.label]))`.
- Call `buildDashboardData(..., ownerLabels, user.id)`.
- Return `roster` (for the assign dropdown) and `currentUserId: user.id` in the loader data.

### 5.5 `/api/assign` (new resource route `app/routes/api.assign.tsx`)

Action-only, RLS user client (`requireUser` + `resolveOrg`). Reads `customerId`, `ownerId` (`""` = unassign), `returnTo` (validated by `safeReturnTo`).

- Cross-org guard: read the customer via the user client (`select id from customers where id = customerId`); if not found (foreign org) → redirect to `returnTo` (no change).
- Membership guard: if `ownerId` is non-empty, verify it is a member of the caller's org (`select user_id from memberships where org_id = org.org_id and user_id = ownerId`); if not a member → redirect to `returnTo` (reject; do not assign to a foreign user).
- Update `customers.owner = ownerId || null` (RLS `with check (is_org_member(org_id))` protects the write). Redirect to `returnTo`.

Registered in `app/routes.ts` as `route("api/assign", "routes/api.assign.tsx")`.

### 5.6 DetailPanel Overview "Owner" row

Replace the static `InfoRow label="Owner"` with an assign control: a `<form method="post" action="/api/assign">` containing a `<select name="ownerId">` with an "Unassigned" option (`value=""`) plus one `<option value={m.userId}>{m.label}</option>` per roster member, the current `selected.ownerId` preselected, hidden `customerId` (= `selected.customerId`) + `returnTo` (absolute `/dashboard?invoice=…&tab=…&view=…&sort=…[&q=…]`). The select auto-submits on change (`onChange` submits its form). DetailPanel receives `roster: OrgMember[]`.

### 5.7 WorkQueue

`SAVED_VIEWS` gains `{ id: "my-work", label: "My work" }` (7-view set) with the existing count-badge treatment. The OWNER column renders the real `item.owner` label (still "Unassigned" when null).

## 6. Security boundary

- **Reads:** user client for `memberships` and `customers`; service client only for member **emails** (own-org roster) — the connection-status exception. No secrets to the client (the roster carries only userId + email-local-part label; full email is included for the dropdown title but no tokens).
- **Assignment write:** user client (RLS `with check`), with a server-side org-membership check on the target owner — a foreign `ownerId` or cross-org `customerId` changes nothing.
- `returnTo` on `/api/assign` validated by the shared `safeReturnTo` (rejects `//host`, `https://`, query-only, null). No open redirect.
- The browser never touches the DB.

## 7. Error & edge handling

- **Unassign** — `ownerId=""` → `owner = null`; UI shows "Unassigned".
- **Foreign/invalid owner or customer** — redirect back with no change (silent no-op; the guards prevent any cross-org or non-member write).
- **Owner who left the org** (`on delete set null`) — FK nulls the column; UI shows "Unassigned". A stale `ownerId` not in the roster resolves to label `"Unknown"`.
- **"My work" with no assignments** — empty view + count 0.
- **Search** — owner label is part of `searchText`, so searching a member name surfaces their accounts.

## 8. Testing

- **`tests/worklist.test.ts`** — `my-work` filters by `ownerId === currentUserId`; `buildWorkItems` sets `ownerId` + resolves `owner` label from the map (incl. unassigned → "Unassigned", unknown id → "Unknown").
- **`tests/dashboard-worklist.test.ts`** — `buildDashboardData` with `ownerLabels` + `currentUserId` yields correct `my-work` items and `viewCounts["my-work"]`.
- **`tests/api-assign.test.ts`** (DB-backed) — a member assigns an own-org customer to a fellow member (read back = the new owner); a cross-org `customerId` is unchanged; assigning to a non-member user_id is rejected (unchanged); unassign sets null.
- **`tests/orgs.test.ts`** (new or extended) — `listOrgMembers` returns the org's roster with labels (DB-backed: two members → two rows with correct labels).
- **Components** — `npx tsc -b` + `npx react-router build`. Live Chrome pass: assign an account, see it in the queue OWNER column + Overview, filter "My work", unassign.

## 9. File structure

| Action | File | Responsibility |
| --- | --- | --- |
| Create | `supabase/migrations/0008_customer_owner.sql` | `customers.owner` column + index |
| Modify | `app/lib/orgs.server.ts` | `listOrgMembers` roster helper |
| Modify | `app/lib/worklist.ts` | `ownerId` on items, `my-work` view, `currentUserId` threading |
| Create | `app/routes/api.assign.tsx` | RLS assign/unassign route |
| Modify | `app/routes.ts` | register `api/assign` |
| Modify | `app/routes/dashboard.tsx` | owner embed, roster, `buildDashboardData` args, loader data |
| Modify | `app/components/DetailPanel.tsx` | Owner assign control |
| Modify | `app/components/WorkQueue.tsx` | `my-work` saved view + real owner label |
| Create | `tests/worklist.test.ts` additions | view + item owner unit tests |
| Modify | `tests/dashboard-worklist.test.ts` | my-work composition |
| Create | `tests/api-assign.test.ts` | DB-backed RLS assignment |
| Create/Modify | `tests/orgs.test.ts` | `listOrgMembers` |

## 10. Global constraints (carried)

- React Router v7 framework mode on Cloudflare Workers. No `node:*` in `app/**`. No client→`.server.ts` module-graph reference; pure modules (`worklist.ts`) stay suffix-free. Type-only imports from route modules are erased at build and safe.
- Tailwind v4 CSS-first; static literal class strings only. Thermal tokens (cool/warm/hot), copper sole accent, ink/panel/surface/border/text/muted.
- Supabase RLS via `is_org_member(org_id)`; user client for reads + the assignment write; service client only for the member-email roster (own-org). The browser never touches the DB.
- Vitest against local Supabase; per-test fresh orgs + globally-unique data; never global truncation. Run via `npx vitest run`.
- Conventional Commits. Never commit secrets. Never `git add` untracked prototype dirs or local-only scripts.
- Migrations applied via `npx supabase migration up` against local Supabase.
