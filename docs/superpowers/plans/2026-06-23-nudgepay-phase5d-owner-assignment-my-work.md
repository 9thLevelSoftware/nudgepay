# Phase 5d — Owner / Assignment + "My work" View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AR team own accounts — assign a customer to a team member, show the owner in the queue and detail panel, and filter to a personal "My work" view.

**Architecture:** Per-customer ownership via a nullable `customers.owner` FK. The loader resolves owner→label through a service-client member roster; assignment writes go through a new RLS resource route; "My work" is a pure view filter keyed on the current user's id.

**Tech Stack:** TypeScript, React Router v7 (framework mode) on Cloudflare Workers, Supabase Postgres + RLS, Tailwind v4 (CSS-first), Vitest against local Supabase.

## Global Constraints

- React Router v7 framework mode on Cloudflare Workers. **No `node:*` in `app/**`.** **A client component must NOT have any module-graph reference — even `import type` — to a `.server.ts` file** (it fails the build). Pure modules stay suffix-free (`worklist.ts`). A `import type` from a route module (`~/routes/dashboard`) IS erased and safe (this is how `MessageEntry`/`ActivityEntry` are shared) — so the roster TYPE the client needs is defined/exported in `dashboard.tsx`, never imported from `orgs.server.ts`.
- Tailwind v4 CSS-first; **static literal class strings only**. Thermal tokens: cool/warm/hot; copper sole accent; ink/panel/surface/border/text/muted.
- Supabase RLS via `is_org_member(org_id)`. **User client (from `requireUser`) for `memberships`/`customers` reads + the assignment write.** **Service client only for member emails** (`auth.users` is not user-client-readable) — the same own-org exception as connection status. The browser never touches the DB.
- `returnTo` on write routes validated by the shared `safeReturnTo` (`app/lib/return-to.ts`): accepts only an app-relative path (`/…`, not `//`). Reuse it; do not reimplement.
- Vitest against local Supabase; **per-test fresh orgs + globally-unique data**; **never** global truncation. Run via `npx vitest run`. Components verified by `npx tsc -b` + `npx react-router build`.
- Conventional Commits. Never commit secrets. Never `git add -A` or stage untracked dirs (`.idea/`, `nudgepay-app/scripts/`, `nudgepay-frontend/`, `nudgepay-backend/`). End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- All commands run from `nudgepay-app/`.

---

## File Structure

| Action | File | Responsibility |
| --- | --- | --- |
| Create | `supabase/migrations/0008_customer_owner.sql` | `customers.owner` column + index |
| Modify | `app/lib/orgs.server.ts` | `listOrgMembers` roster helper |
| Modify | `app/lib/worklist.ts` | `ownerId` on items, `my-work` view, optional `ownerLabels`/`currentUserId` |
| Create | `app/routes/api.assign.tsx` | RLS assign/unassign route |
| Modify | `app/routes.ts` | register `api/assign` |
| Modify | `app/routes/dashboard.tsx` | owner embed, roster, `buildDashboardData` args, loader data, `RosterMember` export |
| Modify | `app/components/DetailPanel.tsx` | Owner assign control |
| Modify | `app/components/WorkQueue.tsx` | `my-work` saved view |
| Create | `tests/orgs.test.ts` | `listOrgMembers` (DB-backed) |
| Modify | `tests/worklist.test.ts` | item owner + `my-work` view |
| Create | `tests/api-assign.test.ts` | RLS assignment (DB-backed) |
| Modify | `tests/dashboard-worklist.test.ts` | my-work composition |

---

## Task 1: customers.owner migration

**Files:**
- Create: `nudgepay-app/supabase/migrations/0008_customer_owner.sql`

**Interfaces:**
- Produces: a nullable `customers.owner uuid` FK → `auth.users(id)`, `on delete set null`; index `(org_id, owner)`.

- [ ] **Step 1: Write the migration**

Create `nudgepay-app/supabase/migrations/0008_customer_owner.sql`:

```sql
-- Per-customer ownership: assign an account to a team member. Nullable; an owner
-- who leaves the org has their assignments cleared (on delete set null). No RLS
-- change needed — customers access is already gated by is_org_member(org_id).
alter table customers
  add column owner uuid references auth.users(id) on delete set null;

create index customers_org_owner_idx on customers (org_id, owner);
```

- [ ] **Step 2: Apply the migration to local Supabase**

Run: `cd nudgepay-app && npx supabase migration up`
Expected: migration `0008_customer_owner` applies with no error.

- [ ] **Step 3: Verify the column exists**

Run:
```bash
cd nudgepay-app && node -e '
import("fs").then(async ({readFileSync})=>{
const env=Object.fromEntries(readFileSync(".env.test","utf8").split("\n").filter(Boolean).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const {createClient}=await import("@supabase/supabase-js");
const svc=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
const {data:o}=await svc.from("organizations").insert({name:"Owner Col Check "+Math.random()}).select("id").single();
const {data:c,error}=await svc.from("customers").insert({org_id:o.id,qbo_id:"oc-1",name:"X",owner:null}).select("owner").single();
console.log("owner column accepts null:", error?("ERROR "+error.message):"ok", c);
await svc.from("organizations").delete().eq("id",o.id);
});'
```
Expected: prints `owner column accepts null: ok { owner: null }`.

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/supabase/migrations/0008_customer_owner.sql
git commit -m "feat: add customers.owner column for per-account assignment"
```

---

## Task 2: listOrgMembers roster helper

**Files:**
- Modify: `nudgepay-app/app/lib/orgs.server.ts`
- Test: `nudgepay-app/tests/orgs.test.ts`

**Interfaces:**
- Produces: `OrgMember = { userId: string; email: string; label: string }`; `listOrgMembers(service: SupabaseClient, orgId: string): Promise<OrgMember[]>` — members of the org, `label` = email local-part, sorted by label.

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/orgs.test.ts`:

```ts
import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { listOrgMembers } from "../app/lib/orgs.server";

test("listOrgMembers returns the org roster with email-local-part labels", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Roster Org" }).select("id").single();
  const orgId = org!.id;
  const a = await makeUserClient("roster-alice@example.com");
  const b = await makeUserClient("roster-bob@example.com");
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: a.userId, role: "owner" },
    { org_id: orgId, user_id: b.userId, role: "member" },
  ]);

  const members = await listOrgMembers(svc, orgId);
  const byId = new Map(members.map((m) => [m.userId, m]));
  expect(members.length).toBe(2);
  expect(byId.get(a.userId)!.label).toBe("roster-alice");
  expect(byId.get(a.userId)!.email).toBe("roster-alice@example.com");
  expect(byId.get(b.userId)!.label).toBe("roster-bob");
  // sorted by label ascending
  expect(members.map((m) => m.label)).toEqual([...members.map((m) => m.label)].sort());
});

test("listOrgMembers returns empty for an org with no members", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Empty Roster Org" }).select("id").single();
  expect(await listOrgMembers(svc, org!.id)).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/orgs.test.ts`
Expected: FAIL — `listOrgMembers` is not exported.

- [ ] **Step 3: Implement `listOrgMembers`**

Append to `nudgepay-app/app/lib/orgs.server.ts`:

```ts
export type OrgMember = { userId: string; email: string; label: string };

// Roster of the org's members with display labels. Uses the SERVICE client
// because member emails live in auth.users, which the RLS user client cannot
// read (same own-org exception as connection status). label = email local-part.
export async function listOrgMembers(
  service: SupabaseClient,
  orgId: string,
): Promise<OrgMember[]> {
  const { data: rows, error } = await service
    .from("memberships").select("user_id").eq("org_id", orgId);
  if (error) throw error;
  const memberIds = new Set((rows ?? []).map((r) => r.user_id as string));
  if (memberIds.size === 0) return [];

  const { data: list, error: listErr } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const emailById = new Map(list.users.map((u) => [u.id, u.email ?? ""]));

  const members: OrgMember[] = [...memberIds].map((userId) => {
    const email = emailById.get(userId) ?? "";
    const label = email ? email.split("@")[0] : userId.slice(0, 8);
    return { userId, email, label };
  });
  members.sort((a, b) => a.label.localeCompare(b.label));
  return members;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/orgs.test.ts`
Expected: PASS (2 tests). (Local Supabase must be running, as the project's other DB suites require.)

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/orgs.server.ts nudgepay-app/tests/orgs.test.ts
git commit -m "feat: add listOrgMembers roster helper"
```

---

## Task 3: worklist owner + my-work view

**Files:**
- Modify: `nudgepay-app/app/lib/worklist.ts`
- Test: `nudgepay-app/tests/worklist.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CustomerInput.owner?: string | null`; `WorkItem.ownerId: string | null`; `ViewId` adds `"my-work"`; `buildWorkItems(invoices, customers, lastContacts, promiseSignals, today, ownerLabels?: Map<string,string>)` (new optional trailing arg, default empty map); `applyView(items, view, today, currentUserId?: string | null)` (new optional trailing arg, default null) with a `my-work` case. **Both new params are optional so the existing `buildDashboardData` caller in `dashboard.tsx` keeps compiling until Task 5 wires them.**

- [ ] **Step 1: Write the failing tests**

Append to `nudgepay-app/tests/worklist.test.ts`:

```ts
test("buildWorkItems resolves owner label from the map and threads ownerId", () => {
  const invoices = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 100, due_date: "2026-03-01" },
    { id: "i2", qbo_doc_number: "1002", customer_id: "c2", balance: 200, due_date: "2026-03-01" },
    { id: "i3", qbo_doc_number: "1003", customer_id: "c3", balance: 300, due_date: "2026-03-01" },
  ];
  const customers = [
    { id: "c1", name: "Acme", phone: null, email: null, owner: "u1" },
    { id: "c2", name: "Globex", phone: null, email: null, owner: null },
    { id: "c3", name: "Initech", phone: null, email: null, owner: "u-stale" },
  ];
  const labels = new Map([["u1", "diskin"]]);
  const items = buildWorkItems(invoices, customers, [], [], "2026-06-22", labels);
  const byId = new Map(items.map((i) => [i.invoiceId, i]));
  expect(byId.get("i1")!.ownerId).toBe("u1");
  expect(byId.get("i1")!.owner).toBe("diskin");
  expect(byId.get("i2")!.ownerId).toBe(null);
  expect(byId.get("i2")!.owner).toBe("Unassigned");
  expect(byId.get("i3")!.owner).toBe("Unknown"); // owner id not in the label map
  expect(byId.get("i1")!.searchText).toContain("diskin"); // owner is searchable
});

test("applyView my-work filters to the current user's accounts", () => {
  const invoices = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 100, due_date: "2026-03-01" },
    { id: "i2", qbo_doc_number: "1002", customer_id: "c2", balance: 200, due_date: "2026-03-01" },
  ];
  const customers = [
    { id: "c1", name: "Acme", phone: null, email: null, owner: "me" },
    { id: "c2", name: "Globex", phone: null, email: null, owner: "someone-else" },
  ];
  const items = buildWorkItems(invoices, customers, [], [], "2026-06-22", new Map());
  expect(applyView(items, "my-work", "2026-06-22", "me").map((i) => i.invoiceId)).toEqual(["i1"]);
  expect(applyView(items, "my-work", "2026-06-22", "nobody")).toEqual([]);
  expect(applyView(items, "my-work", "2026-06-22", null)).toEqual([]); // no current user → none
});
```

(Ensure `buildWorkItems` and `applyView` are imported at the top of the test file — they already are for the existing tests.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/worklist.test.ts`
Expected: FAIL — `ownerId` undefined / `buildWorkItems` rejects the 6th arg / no `my-work` case.

- [ ] **Step 3: Implement the worklist changes**

In `nudgepay-app/app/lib/worklist.ts`:

(a) Add `ownerId` to `WorkItem` (after `owner: string;`):

```ts
  owner: string;
  ownerId: string | null;
```

(b) Add `owner` to `CustomerInput`:

```ts
export type CustomerInput = { id: string; name: string; phone: string | null; email: string | null; owner?: string | null };
```

(c) Add the `my-work` view id:

```ts
export type ViewId = "all-open" | "30-plus" | "high-value" | "never-contacted" | "follow-ups-due" | "broken-promises" | "my-work";
```

(d) Change `buildWorkItems` signature to accept the label map:

```ts
export function buildWorkItems(
  invoices: InvoiceInput[], customers: CustomerInput[],
  lastContacts: LastContactInput[], promiseSignals: PromiseSignalInput[], today: string,
  ownerLabels: Map<string, string> = new Map(),
): WorkItem[] {
```

(e) Inside the `.map`, compute owner fields and set them. Replace the `owner: "Unassigned",` line, and update `searchText` to include the owner label. Add these locals near the top of the map body (after `const name = ...`):

```ts
    const ownerId = cust?.owner ?? null;
    const ownerLabel = ownerId ? (ownerLabels.get(ownerId) ?? "Unknown") : "Unassigned";
```

Then in the returned object, replace `owner: "Unassigned",` with:

```ts
      owner: ownerLabel,
      ownerId,
```

and change the `searchText` line to include the owner label:

```ts
      searchText: [name, inv.qbo_doc_number ?? "", cust?.phone ?? "", cust?.email ?? "", ownerLabel].join(" ").toLowerCase(),
```

(f) Add `currentUserId` to `applyView` and the `my-work` case:

```ts
export function applyView(items: WorkItem[], view: ViewId, today: string, currentUserId: string | null = null): WorkItem[] {
  if (view === "30-plus") return items.filter((i) => i.ageDays >= 30);
  if (view === "high-value") return items.filter((i) => i.balance >= HIGH_VALUE_THRESHOLD);
  if (view === "never-contacted") return items.filter((i) => i.lastContact === null);
  if (view === "follow-ups-due") return items.filter((i) => isFollowUpDue(i, today));
  if (view === "broken-promises") return items.filter((i) => isBrokenPromise(i, today));
  if (view === "my-work") return items.filter((i) => i.ownerId != null && i.ownerId === currentUserId);
  return items;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/worklist.test.ts`
Expected: PASS (existing + 2 new tests).

- [ ] **Step 5: Confirm dashboard.tsx still compiles (optional params keep it green)**

Run: `cd nudgepay-app && npx tsc -b`
Expected: no errors. (`buildDashboardData` still calls `buildWorkItems`/`applyView` without the new args — valid because they default.)

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/lib/worklist.ts nudgepay-app/tests/worklist.test.ts
git commit -m "feat: thread owner onto work items and add my-work view filter"
```

---

## Task 4: /api/assign route

**Files:**
- Create: `nudgepay-app/app/routes/api.assign.tsx`
- Modify: `nudgepay-app/app/routes.ts`
- Test: `nudgepay-app/tests/api-assign.test.ts`

**Interfaces:**
- Consumes: `safeReturnTo` from `../lib/return-to`.
- Produces: `POST /api/assign` — reads `customerId`, `ownerId` (`""` = unassign), `returnTo`; sets `customers.owner` after a cross-org customer guard and an org-membership guard on the target owner; redirects to the validated `returnTo`.

- [ ] **Step 1: Write the failing DB-backed test**

Create `nudgepay-app/tests/api-assign.test.ts`:

```ts
import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

// Mirrors the RLS + guard paths the /api/assign action relies on.
test("a member assigns and unassigns an own-org customer via RLS", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Assign Org A" }).select("id").single();
  const orgId = org!.id;
  const a = await makeUserClient("assign-a@example.com");
  const b = await makeUserClient("assign-b@example.com");
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: a.userId, role: "owner" },
    { org_id: orgId, user_id: b.userId, role: "member" },
  ]);
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "as-c1", name: "Assignable Co" }).select("id").single();

  // membership guard query (the route runs this before assigning)
  const { data: isMember } = await a.client.from("memberships")
    .select("user_id").eq("org_id", orgId).eq("user_id", b.userId).maybeSingle();
  expect(isMember?.user_id).toBe(b.userId);

  await a.client.from("customers").update({ owner: b.userId }).eq("id", cust!.id);
  let { data: after } = await svc.from("customers").select("owner").eq("id", cust!.id).single();
  expect(after!.owner).toBe(b.userId);

  await a.client.from("customers").update({ owner: null }).eq("id", cust!.id);
  ({ data: after } = await svc.from("customers").select("owner").eq("id", cust!.id).single());
  expect(after!.owner).toBe(null);
});

test("a member of another org cannot reassign the customer (RLS blocks)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Assign Org B" }).select("id").single();
  const orgId = org!.id;
  const owner = await makeUserClient("assign-owner@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "asb-c1", name: "Private Co", owner: owner.userId }).select("id").single();

  const outsider = await makeUserClient("assign-outsider@example.com"); // no membership in Org B
  await outsider.client.from("customers").update({ owner: outsider.userId }).eq("id", cust!.id);
  const { data: after } = await svc.from("customers").select("owner").eq("id", cust!.id).single();
  expect(after!.owner).toBe(owner.userId); // unchanged — RLS blocked it
});

test("the membership guard rejects a non-member target", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Assign Org C" }).select("id").single();
  const orgId = org!.id;
  const a = await makeUserClient("assign-c-a@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: a.userId, role: "owner" });
  const stranger = await makeUserClient("assign-c-stranger@example.com"); // not a member of Org C

  const { data: isMember } = await a.client.from("memberships")
    .select("user_id").eq("org_id", orgId).eq("user_id", stranger.userId).maybeSingle();
  expect(isMember).toBeNull(); // route would reject and not assign
});
```

- [ ] **Step 2: Run to verify it fails / passes-by-RLS**

Run: `cd nudgepay-app && npx vitest run tests/api-assign.test.ts`
Expected: PASS (3 tests). These exercise the RLS + guard query paths the route uses (the route action itself needs cookies, so — like `api-sms-consent.test.ts` — we validate the data-layer guarantees directly). If any assertion fails, the RLS policy or guard premise is wrong; stop and investigate.

- [ ] **Step 3: Create the route**

Create `nudgepay-app/app/routes/api.assign.tsx`:

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
  const customerId = typeof form.get("customerId") === "string" ? (form.get("customerId") as string) : "";
  const ownerRaw = form.get("ownerId");
  const ownerId = typeof ownerRaw === "string" && ownerRaw.length > 0 ? ownerRaw : null;
  if (!customerId) return redirect(returnTo, { headers });

  // Cross-org guard: the RLS user client only sees own-org customers.
  const { data: cust } = await supabase
    .from("customers").select("id").eq("id", customerId).maybeSingle();
  if (!cust) return redirect(returnTo, { headers });

  // Membership guard: never assign to a user outside the caller's org.
  if (ownerId) {
    const { data: member } = await supabase
      .from("memberships").select("user_id").eq("org_id", org.org_id).eq("user_id", ownerId).maybeSingle();
    if (!member) return redirect(returnTo, { headers });
  }

  await supabase.from("customers").update({ owner: ownerId }).eq("id", customerId);
  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
```

- [ ] **Step 4: Register the route**

In `nudgepay-app/app/routes.ts`, add to the `api/*` group (e.g. after `api/sms-consent`):

```ts
  route("api/assign", "routes/api.assign.tsx"),
```

- [ ] **Step 5: Type-check**

Run: `cd nudgepay-app && npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/routes/api.assign.tsx nudgepay-app/app/routes.ts nudgepay-app/tests/api-assign.test.ts
git commit -m "feat: add RLS-scoped /api/assign route with cross-org and membership guards"
```

---

## Task 5: Loader owner resolution + roster

**Files:**
- Modify: `nudgepay-app/app/routes/dashboard.tsx`
- Test: `nudgepay-app/tests/dashboard-worklist.test.ts`

**Interfaces:**
- Consumes: `listOrgMembers` (Task 2); `buildWorkItems`/`applyView` owner+my-work (Task 3).
- Produces (exported from `dashboard.tsx`): `RosterMember = { userId: string; email: string; label: string }`. `buildDashboardData` gains REQUIRED trailing params `ownerLabels: Map<string,string>` and `currentUserId: string | null`. Loader returns `roster: RosterMember[]` and `currentUserId: string`.

- [ ] **Step 1: Write/extend the failing test**

Append to `nudgepay-app/tests/dashboard-worklist.test.ts`:

```ts
test("buildDashboardData composes my-work items and count for the current user", () => {
  const invoices = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 100, due_date: "2026-03-01" },
    { id: "i2", qbo_doc_number: "1002", customer_id: "c2", balance: 200, due_date: "2026-03-01" },
  ];
  const customers = [
    { id: "c1", name: "Acme", phone: null, email: null, owner: "me" },
    { id: "c2", name: "Globex", phone: null, email: null, owner: "other" },
  ];
  const labels = new Map([["me", "diskin"], ["other", "morgan"]]);
  const data = buildDashboardData(invoices, customers, [], [],
    { view: "my-work", sort: "recommended", q: "", invoice: "i1" }, "2026-06-22", labels, "me");
  expect(data.items.map((i) => i.invoiceId)).toEqual(["i1"]);
  expect(data.viewCounts["my-work"]).toBe(1);
  expect(data.selected?.owner).toBe("diskin");
});
```

Note: the existing `buildDashboardData(...)` calls in this file pass 6 args; update each of them to pass the two new trailing args `new Map()` and `null` (so they keep compiling and exercise the unchanged behavior). Example: a call ending `..., TODAY)` becomes `..., TODAY, new Map(), null)`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/dashboard-worklist.test.ts`
Expected: FAIL — `buildDashboardData` does not accept the new args / `viewCounts["my-work"]` undefined.

- [ ] **Step 3: Update `buildDashboardData` and the loader**

In `nudgepay-app/app/routes/dashboard.tsx`:

(a) Add the `my-work` view to the params type and exports. The `DashboardParams.view` type comes from `ViewId` (already includes `my-work` after Task 3). Add the exported roster type near `MessageEntry`:

```ts
export type RosterMember = { userId: string; email: string; label: string };
```

(b) Change `buildDashboardData`'s signature and body:

```ts
export function buildDashboardData(
  invoices: InvoiceInput[],
  customers: CustomerInput[],
  lastContacts: LastContactInput[],
  promiseSignals: PromiseSignalInput[],
  params: DashboardParams,
  today: string,
  ownerLabels: Map<string, string>,
  currentUserId: string | null,
): DashboardData {
  const { view, sort, q, invoice } = params;

  const allItems = buildWorkItems(invoices, customers, lastContacts, promiseSignals, today, ownerLabels);

  const searchedItems =
    q.trim() === ""
      ? allItems
      : allItems.filter((i) => i.searchText.includes(q.toLowerCase()));

  const metrics = computeMetrics(searchedItems, today);

  const ALL_VIEWS: ViewId[] = ["all-open", "30-plus", "high-value", "never-contacted", "follow-ups-due", "broken-promises", "my-work"];
  const viewCounts = Object.fromEntries(
    ALL_VIEWS.map((v) => [v, applyView(searchedItems, v, today, currentUserId).length]),
  ) as Record<ViewId, number>;

  const viewFiltered = applyView(searchedItems, view, today, currentUserId);
  const items = sortItems(viewFiltered, sort);

  const selected =
    invoice != null
      ? (searchedItems.find((i) => i.invoiceId === invoice) ?? null)
      : null;

  return { items, metrics, viewCounts, selected };
}
```

(c) In the loader, add `owner` to the invoice→customers embed select and to `CustomerInput`. Change the embed:

```ts
      .select("id, qbo_doc_number, balance, due_date, customer_id, customers(name, phone, email, owner)")
```

Update the `InvoiceRow` type's `customers` shape to include `owner: string | null` and the `customerMap.set` to include `owner`:

```ts
        customerMap.set(r.customer_id, {
          id: r.customer_id,
          name: r.customers.name ?? "(unknown customer)",
          phone: r.customers.phone ?? null,
          email: r.customers.email ?? null,
          owner: r.customers.owner ?? null,
        });
```

(d) Add the `my-work` view to the loader's `VALID_VIEWS` array (param validation):

```ts
  const VALID_VIEWS: ViewId[] = ["all-open", "30-plus", "high-value", "never-contacted", "follow-ups-due", "broken-promises", "my-work"];
```

(There are two `VALID_VIEWS` arrays — the loader's param-validation one and the one inside `buildDashboardData` (now `ALL_VIEWS`). Update the loader's `VALID_VIEWS` too.)

(e) Build the roster once (the loader already has `const service = createSupabaseServiceClient(env)`), and call `buildDashboardData` with the new args. Inside the `if (connected)` block, before the `buildDashboardData(...)` call, **assign** the `roster` declared in (f) (do NOT redeclare with `const` — it is a `let` from (f)) and derive the label map:

```ts
    roster = await listOrgMembers(service, org.org_id);
    const ownerLabels = new Map(roster.map((m) => [m.userId, m.label]));
```

Change the `buildDashboardData(...)` call to pass the new args:

```ts
    dashboardData = buildDashboardData(
      invoicesInput,
      customersInput,
      lastContactsInput,
      promiseSignals,
      { view, sort, q, invoice, tab },
      today,
      ownerLabels,
      user.id,
    );
```

Import `listOrgMembers` at the top:

```ts
import { listOrgMembers, type OrgMember } from "../lib/orgs.server";
```

(`roster` is `OrgMember[]`, structurally identical to the exported `RosterMember`; the loader returns it as the `RosterMember[]` contract.)

(f) Declare `roster` before the `if (connected)` block so the not-connected branch still returns a value (it stays `[]`). Near where the other loader accumulators are declared (e.g. beside `let selectedActivity`), add:

```ts
  let roster: OrgMember[] = [];
```

The assignment `roster = await listOrgMembers(...)` happens inside `if (connected)` per step (e). `currentUserId` needs no separate declaration — the return object uses `user.id` directly.

(g) Add `roster` and `currentUserId` to the returned `data({ … })`:

```ts
      selectedActivity,
      selectedMessages,
      selectedConsent,
      selectedPhone,
      sms,
      roster,
      currentUserId: user.id,
      ...dashboardData,
```

- [ ] **Step 4: Type-check + run the dashboard test**

Run: `cd nudgepay-app && npx tsc -b && npx vitest run tests/dashboard-worklist.test.ts`
Expected: tsc clean; all dashboard-worklist tests pass (existing updated calls + the new my-work test).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/routes/dashboard.tsx nudgepay-app/tests/dashboard-worklist.test.ts
git commit -m "feat: loader resolves owner labels and exposes member roster"
```

---

## Task 6: DetailPanel assign control + WorkQueue view

**Files:**
- Modify: `nudgepay-app/app/components/DetailPanel.tsx`
- Modify: `nudgepay-app/app/routes/dashboard.tsx`
- Modify: `nudgepay-app/app/components/WorkQueue.tsx`

**Interfaces:**
- Consumes: `RosterMember` (type-only) from `~/routes/dashboard`; loader fields `roster`, `currentUserId`; `WorkItem.ownerId`.
- Produces: `DetailPanel` gains `roster: RosterMember[]`; the Overview "Owner" row becomes a `<select>` posting to `/api/assign`. WorkQueue `SAVED_VIEWS` gains `my-work`.

- [ ] **Step 1: Add the roster import and assign control to `DetailPanel.tsx`**

At the top of `nudgepay-app/app/components/DetailPanel.tsx`, extend the type-only dashboard import to include `RosterMember`:

```ts
import type { ActivityEntry, MessageEntry, RosterMember } from "~/routes/dashboard";
```

Add `roster` to `DetailPanel`'s props + type (alongside `messages`/`consent`/`phone`/`sms`):

```ts
  roster,
```
and in the type:
```ts
  roster: RosterMember[];
```

Replace the Owner `InfoRow` (currently `<InfoRow label="Owner" value={selected.owner || "Unassigned"} />`) with an assign control. Because the Owner row sits in the Overview grid, render it as a labelled cell matching `InfoRow`'s layout:

```tsx
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">
                Owner
              </span>
              <form method="post" action="/api/assign">
                <input type="hidden" name="customerId" value={selected.customerId ?? ""} />
                <input
                  type="hidden"
                  name="returnTo"
                  value={`/dashboard?${new URLSearchParams({ invoice: selected.invoiceId, tab: "overview", view, sort, ...(q ? { q } : {}) }).toString()}`}
                />
                <select
                  name="ownerId"
                  defaultValue={selected.ownerId ?? ""}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  aria-label="Assign owner"
                  className="w-full rounded-md border border-border bg-panel px-2 py-1 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                >
                  <option value="">Unassigned</option>
                  {roster.map((m) => (
                    <option key={m.userId} value={m.userId}>{m.label}</option>
                  ))}
                </select>
              </form>
            </div>
```

(Leave the other `InfoRow`s — Priority reason, Next action, Phone, Email, Open invoices — unchanged.)

- [ ] **Step 2: Pass `roster` into `DetailPanel` from `dashboard.tsx`**

In `nudgepay-app/app/routes/dashboard.tsx`, add `roster` to the `useLoaderData` destructure:

```ts
    selectedMessages,
    selectedConsent,
    roster,
    sms,
```

Pass it to the `<DetailPanel … />` call:

```tsx
                consent={selectedConsent}
                phone={selectedPhone}
                roster={roster}
                sms={sms}
```

- [ ] **Step 3: Add the my-work saved view to `WorkQueue.tsx`**

In `nudgepay-app/app/components/WorkQueue.tsx`, append to `SAVED_VIEWS`:

```ts
const SAVED_VIEWS: { id: ViewId; label: string }[] = [
  { id: "all-open",         label: "All open" },
  { id: "30-plus",          label: "30+ days" },
  { id: "high-value",       label: "High value" },
  { id: "never-contacted",  label: "Never contacted" },
  { id: "follow-ups-due",   label: "Follow-ups due" },
  { id: "broken-promises",  label: "Broken promises" },
  { id: "my-work",          label: "My work" },
];
```

- [ ] **Step 4: Type-check and build**

Run: `cd nudgepay-app && npx tsc -b && npx react-router build`
Expected: both succeed. (`RosterMember` is a type-only import from a route module — erased at build; no server code in the client bundle.)

- [ ] **Step 5: Run the full suite**

Run: `cd nudgepay-app && npx vitest run`
Expected: all suites pass (prior 127 + the new orgs, api-assign, and the worklist/dashboard additions).

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/components/DetailPanel.tsx nudgepay-app/app/routes/dashboard.tsx nudgepay-app/app/components/WorkQueue.tsx
git commit -m "feat: owner assign control in detail panel and my-work saved view"
```

---

## Verification summary (run after all tasks)

```bash
cd nudgepay-app
npx vitest run          # full suite green
npx tsc -b              # types clean
npx react-router build  # production build clean
```

Live Chrome pass: select an account → Overview → assign an owner from the dropdown (returns to the panel with the owner set, queue OWNER column updates) → switch to the "My work" view (shows your accounts) → unassign (back to "Unassigned").
