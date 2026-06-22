# NudgePay Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the new multi-tenant NudgePay app skeleton — React Router v7 on Cloudflare Workers + Supabase Postgres/Auth — with the org/membership data model, RLS enforced on every table, working email auth + onboarding + teammate invites, and the Chancey org seeded. No live data; dummy/seed only.

**Architecture:** One React Router v7 (framework mode) app deployed to a Cloudflare Worker serves public, auth, and authed routes plus server-side resource routes. Supabase provides identity (Auth/JWT) and data (Postgres with RLS). The browser only calls the app's own server loaders/actions; the Supabase service-role key lives only in Worker secrets. Tenancy is enforced in the database via RLS policies keyed to `org_id` membership.

**Tech Stack:** React Router v7, TypeScript, Vite, Cloudflare Workers (`wrangler`), Supabase (Postgres + Auth), `@supabase/ssr`, `@supabase/supabase-js`, Supabase CLI (local stack), Vitest.

## Global Constraints

- Language: **TypeScript** everywhere; no plain `.js` app code. `strict: true`.
- Runtime: **Cloudflare Workers** (`nodejs_compat` enabled). No Node-only APIs outside that flag.
- New app lives in **`nudgepay-app/`** at the workspace root. The existing `nudgepay-frontend/` and `nudgepay-backend/` are kept as read-only visual/logic reference and are NOT modified in this phase.
- **Service-role key never reaches the browser.** It is read only inside server modules (`*.server.ts`) from `env.SUPABASE_SERVICE_KEY`.
- **RLS is ON for every table from creation.** No table ships with RLS disabled.
- Every domain table carries `org_id uuid not null`. Tenancy rule: a row is accessible only to users who have a `memberships` row for that `org_id`.
- Domain rules carried from the spec: invoices display by `qbo_doc_number`; **due date** is the aging anchor.
- Team seed (one org "Chancey Heating & Cooling"): Brandy, Diskin, John, Kristi, Macy.
- Commit after every task with Conventional Commits (`feat:`, `test:`, `chore:`, `docs:`).
- Tests run against the **local Supabase stack** (`supabase start`); never against a cloud project.

---

## File Structure

```
nudgepay-app/
  package.json
  tsconfig.json
  vite.config.ts
  react-router.config.ts
  wrangler.toml                     # Cloudflare Worker config + nodejs_compat
  worker-configuration.d.ts         # generated Env types (wrangler types)
  app/
    root.tsx
    routes.ts                       # route table
    lib/
      env.server.ts                 # typed env accessor (server-only)
      supabase.server.ts            # user-scoped + service-role client factories
      session.server.ts             # requireSession / getOptionalUser / resolveOrg
    routes/
      _index.tsx                    # public landing
      privacy.tsx                   # /privacy (Intuit-required, real route)
      eula.tsx                      # /eula (Intuit-required, real route)
      signup.tsx
      login.tsx
      logout.tsx
      onboarding.tsx                # create org + owner membership
      invite.tsx                    # owner invites teammate by email
      accept.$token.tsx             # invitee accepts -> membership
      dashboard.tsx                 # placeholder authed page (shows org name)
  supabase/
    config.toml                     # supabase CLI config (from `supabase init`)
    migrations/
      0001_tenancy_schema.sql       # all tables
      0002_rls_policies.sql         # RLS + policies
      0003_invites.sql              # invites table + helper
    seed.sql                        # Chancey org + 5 members (local dev)
  tests/
    helpers.ts                      # test client factory (two users, two orgs)
    rls.test.ts                     # cross-org denial
    session.test.ts                 # auth guard behavior
    onboarding.test.ts              # org + membership creation
  vitest.config.ts
```

---

## Task 1: Scaffold the React Router v7 Cloudflare app

**Files:**
- Create: `nudgepay-app/` (whole RR7 Cloudflare template), then trim to TS.
- Modify: `nudgepay-app/wrangler.toml`, `nudgepay-app/tsconfig.json`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a buildable RR7 app at `nudgepay-app/` with `npm run build` and `npm run typecheck` passing; a Cloudflare `Env` type generated as `Cloudflare.Env` in `worker-configuration.d.ts`.

- [ ] **Step 1: Scaffold from the official Cloudflare template**

Run from the workspace root `C:/Users/dasbl/WebstormProjects/nudgepay`:

```bash
npx create-react-router@latest nudgepay-app --template remix-run/react-router-templates/cloudflare --no-install --no-git-init
```

Expected: a `nudgepay-app/` directory containing `app/`, `wrangler.*`, `vite.config.ts`, `react-router.config.ts`.

- [ ] **Step 2: Install dependencies and the Supabase libraries**

```bash
cd nudgepay-app
npm install
npm install @supabase/supabase-js @supabase/ssr
npm install -D vitest @cloudflare/workers-types wrangler supabase
```

- [ ] **Step 3: Normalize `wrangler.toml`**

Replace `nudgepay-app/wrangler.toml` (or `wrangler.jsonc` → delete it and use toml) with:

```toml
name = "nudgepay-app"
compatibility_date = "2025-06-01"
compatibility_flags = ["nodejs_compat"]
main = "./workers/app.ts"

[vars]
# Non-secret defaults only. Secrets set via `wrangler secret put`.
SUPABASE_URL = "http://127.0.0.1:54321"
```

(If the template's entry is at a different path, keep its `main`; only add `compatibility_flags`.)

- [ ] **Step 4: Enforce strict TypeScript**

In `nudgepay-app/tsconfig.json` ensure:

```json
{
  "compilerOptions": {
    "strict": true,
    "types": ["@cloudflare/workers-types", "vite/client"],
    "moduleResolution": "bundler"
  }
}
```

- [ ] **Step 5: Generate Worker env types and verify build**

```bash
npx wrangler types
npm run typecheck
npm run build
```

Expected: `worker-configuration.d.ts` is written; both commands exit 0.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/.gitignore nudgepay-app/package.json nudgepay-app/package-lock.json nudgepay-app/app nudgepay-app/*.ts nudgepay-app/*.toml nudgepay-app/*.json nudgepay-app/workers nudgepay-app/worker-configuration.d.ts
git commit -m "feat: scaffold React Router v7 Cloudflare Workers app (nudgepay-app)"
```

> Note: confirm `nudgepay-app/.gitignore` ignores `node_modules/` and `.wrangler/` before committing.

---

## Task 2: Initialize local Supabase stack

**Files:**
- Create: `nudgepay-app/supabase/config.toml` (via CLI)

**Interfaces:**
- Consumes: Task 1 app dir.
- Produces: a runnable local Supabase stack; `supabase status` prints local `API URL` (http://127.0.0.1:54321), `anon key`, and `service_role key` used by tests and dev.

- [ ] **Step 1: Initialize Supabase in the app**

```bash
cd nudgepay-app
npx supabase init
```

Expected: `supabase/config.toml` created.

- [ ] **Step 2: Start the local stack (requires Docker Desktop running)**

```bash
npx supabase start
```

Expected: prints `API URL`, `anon key`, `service_role key`, `DB URL`. Record these — local keys are deterministic per project.

- [ ] **Step 3: Capture local credentials for tests**

Create `nudgepay-app/.env.test` (this file is git-ignored — add it to `.gitignore`):

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<anon key from supabase status>
SUPABASE_SERVICE_KEY=<service_role key from supabase status>
```

- [ ] **Step 4: Ignore the env + supabase temp files**

Append to `nudgepay-app/.gitignore`:

```
.env*
supabase/.temp/
.wrangler/
```

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/supabase/config.toml nudgepay-app/.gitignore
git commit -m "chore: initialize local Supabase stack for nudgepay-app"
```

---

## Task 3: Tenancy schema migration

**Files:**
- Create: `nudgepay-app/supabase/migrations/0001_tenancy_schema.sql`

**Interfaces:**
- Consumes: Task 2 stack.
- Produces: tables `organizations`, `memberships`, `customers`, `invoices`, `contact_logs`, `text_messages`, `qbo_connections`, `messaging_config` — each (except `organizations`) with `org_id uuid not null references organizations(id)`. A SQL function `public.is_org_member(uuid) returns boolean` used by Task 4 policies.

- [ ] **Step 1: Write the schema migration**

Create `nudgepay-app/supabase/migrations/0001_tenancy_schema.sql`:

```sql
-- Tenancy root
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index on memberships (user_id);
create index on memberships (org_id);

-- Membership predicate reused by all RLS policies.
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid()
  );
$$;

create table customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  qbo_id text,
  name text not null,
  email text,
  phone text,
  sms_consent boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, qbo_id)
);
create index on customers (org_id);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  qbo_id text,
  qbo_doc_number text,
  customer_id uuid references customers(id) on delete set null,
  amount numeric(12,2) not null default 0,
  balance numeric(12,2) not null default 0,
  due_date date,
  invoice_date date,
  status text not null default 'open',
  qbo_sync_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, qbo_id)
);
create index on invoices (org_id);
create index on invoices (org_id, due_date);

create table contact_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  user_id uuid not null references auth.users(id),
  method text not null,
  outcome text,
  notes text,
  follow_up_at date,
  created_at timestamptz not null default now()
);
create index on contact_logs (org_id);

create table text_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete cascade,
  sent_by_user_id uuid references auth.users(id),
  direction text not null check (direction in ('outbound','inbound')),
  twilio_message_sid text,
  status text,
  error_code text,
  from_number text,
  to_number text,
  body text,
  created_at timestamptz not null default now()
);
create index on text_messages (org_id);

create table qbo_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references organizations(id) on delete cascade,
  realm_id text,
  access_token_enc bytea,
  refresh_token_enc bytea,
  token_expires_at timestamptz,
  last_cdc_time timestamptz,
  last_sync_at timestamptz,
  status text not null default 'disconnected',
  created_at timestamptz not null default now()
);

create table messaging_config (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references organizations(id) on delete cascade,
  messaging_service_sid text,
  sender text,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 2: Apply the migration to the local stack**

```bash
cd nudgepay-app
npx supabase db reset
```

Expected: migration applies with no error; output lists the new tables.

- [ ] **Step 3: Verify the tables exist**

```bash
npx supabase db reset && echo "select tablename from pg_tables where schemaname='public' order by 1;" | npx supabase db query 2>/dev/null || npx psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2-)" -c "\dt public.*"
```

Expected: lists `organizations, memberships, customers, invoices, contact_logs, text_messages, qbo_connections, messaging_config`.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/supabase/migrations/0001_tenancy_schema.sql
git commit -m "feat: add multi-tenant tenancy schema migration"
```

---

## Task 4: RLS policies (this is the load-bearing security task)

**Files:**
- Create: `nudgepay-app/supabase/migrations/0002_rls_policies.sql`
- Create: `nudgepay-app/tests/helpers.ts`
- Create: `nudgepay-app/tests/rls.test.ts`
- Create: `nudgepay-app/vitest.config.ts`

**Interfaces:**
- Consumes: Task 3 tables + `is_org_member()`.
- Produces: RLS enabled on all 8 tables with org-scoped policies; a reusable test helper `makeUserClient(email)` and `serviceClient()` exported from `tests/helpers.ts`.

- [ ] **Step 1: Write the failing RLS test**

Create `nudgepay-app/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", setupFiles: [], include: ["tests/**/*.test.ts"] },
});
```

Create `nudgepay-app/tests/helpers.ts`:

```ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.test", import.meta.url), "utf8")
    .split("\n").filter(Boolean).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)];
    })
) as Record<string, string>;

export const SUPABASE_URL = env.SUPABASE_URL;

export function serviceClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function makeUserClient(email: string, password = "test-pass-123") {
  const admin = serviceClient();
  // Create (idempotent) and confirm the user.
  const { data: created } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  const user = created?.user
    ?? (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === email)!;

  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  const { data: signedIn, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client: anon, userId: user.id, accessToken: signedIn.session!.access_token };
}
```

Create `nudgepay-app/tests/rls.test.ts`:

```ts
import { beforeAll, expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";

let orgA: string, orgB: string, userA: Awaited<ReturnType<typeof makeUserClient>>, userB: Awaited<ReturnType<typeof makeUserClient>>;

beforeAll(async () => {
  const svc = serviceClient();
  userA = await makeUserClient("a@example.com");
  userB = await makeUserClient("b@example.com");

  const { data: a } = await svc.from("organizations").insert({ name: "Org A" }).select().single();
  const { data: b } = await svc.from("organizations").insert({ name: "Org B" }).select().single();
  orgA = a!.id; orgB = b!.id;
  await svc.from("memberships").insert({ org_id: orgA, user_id: userA.userId, role: "owner" });
  await svc.from("memberships").insert({ org_id: orgB, user_id: userB.userId, role: "owner" });
  await svc.from("customers").insert({ org_id: orgA, name: "A-Customer" });
  await svc.from("customers").insert({ org_id: orgB, name: "B-Customer" });
});

test("user A sees only org A customers", async () => {
  const { data } = await userA.client.from("customers").select("name");
  expect(data?.map((r) => r.name)).toEqual(["A-Customer"]);
});

test("user A cannot read org B customers even when filtering by org B id", async () => {
  const { data } = await userA.client.from("customers").select("*").eq("org_id", orgB);
  expect(data).toEqual([]);
});

test("user A cannot insert a row into org B", async () => {
  const { error } = await userA.client.from("customers").insert({ org_id: orgB, name: "Sneaky" });
  expect(error).not.toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

```bash
cd nudgepay-app
npx vitest run tests/rls.test.ts
```

Expected: FAIL — without RLS, user A currently reads org B rows (no isolation), so the assertions fail.

- [ ] **Step 3: Write the RLS migration**

Create `nudgepay-app/supabase/migrations/0002_rls_policies.sql`:

```sql
-- Enable RLS everywhere.
alter table organizations   enable row level security;
alter table memberships     enable row level security;
alter table customers       enable row level security;
alter table invoices        enable row level security;
alter table contact_logs    enable row level security;
alter table text_messages   enable row level security;
alter table qbo_connections enable row level security;
alter table messaging_config enable row level security;

-- organizations: visible if the user is a member.
create policy org_select on organizations
  for select using (public.is_org_member(id));

-- memberships: a user sees membership rows for orgs they belong to.
create policy mem_select on memberships
  for select using (public.is_org_member(org_id));

-- Domain tables: full CRUD gated by membership of the row's org.
create policy customers_all on customers
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy invoices_all on invoices
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy contact_logs_all on contact_logs
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy text_messages_all on text_messages
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy qbo_connections_all on qbo_connections
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy messaging_config_all on messaging_config
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
```

- [ ] **Step 4: Apply and re-run the test to verify it PASSES**

```bash
cd nudgepay-app
npx supabase db reset
npx vitest run tests/rls.test.ts
```

Expected: `supabase db reset` reapplies both migrations; all three RLS tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/supabase/migrations/0002_rls_policies.sql nudgepay-app/tests/helpers.ts nudgepay-app/tests/rls.test.ts nudgepay-app/vitest.config.ts
git commit -m "feat: enforce org-scoped RLS on all tenant tables with cross-org denial tests"
```

---

## Task 5: Server-side env + Supabase client factories

**Files:**
- Create: `nudgepay-app/app/lib/env.server.ts`
- Create: `nudgepay-app/app/lib/supabase.server.ts`

**Interfaces:**
- Consumes: Cloudflare `Env` (from `worker-configuration.d.ts`).
- Produces:
  - `getEnv(context): AppEnv` where `AppEnv = { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_KEY: string }`.
  - `createSupabaseUserClient(request, env): { supabase, headers }` — cookie-bound, RLS-scoped.
  - `createSupabaseServiceClient(env): SupabaseClient` — service role, server-only.

- [ ] **Step 1: Write the typed env accessor**

Create `nudgepay-app/app/lib/env.server.ts`:

```ts
export type AppEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY: string;
};

// RR7 Cloudflare adapter exposes vars on context.cloudflare.env
export function getEnv(context: { cloudflare: { env: Record<string, string> } }): AppEnv {
  const e = context.cloudflare.env;
  for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY"]) {
    if (!e[k]) throw new Error(`Missing required env var: ${k}`);
  }
  return {
    SUPABASE_URL: e.SUPABASE_URL,
    SUPABASE_ANON_KEY: e.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY: e.SUPABASE_SERVICE_KEY,
  };
}
```

- [ ] **Step 2: Write the Supabase client factories**

Create `nudgepay-app/app/lib/supabase.server.ts`:

```ts
import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppEnv } from "./env.server";

export function createSupabaseUserClient(request: Request, env: AppEnv) {
  const headers = new Headers();
  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get("Cookie") ?? "");
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          headers.append("Set-Cookie", serializeCookieHeader(name, value, options));
        }
      },
    },
  });
  return { supabase, headers };
}

export function createSupabaseServiceClient(env: AppEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 3: Verify typecheck passes**

```bash
cd nudgepay-app
npm run typecheck
```

Expected: exit 0 (no type errors).

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/env.server.ts nudgepay-app/app/lib/supabase.server.ts
git commit -m "feat: add server env accessor and Supabase user/service client factories"
```

---

## Task 6: Session guard helpers

**Files:**
- Create: `nudgepay-app/app/lib/session.server.ts`
- Create: `nudgepay-app/tests/session.test.ts`

**Interfaces:**
- Consumes: Task 5 factories.
- Produces:
  - `getOptionalUser(request, env): Promise<{ supabase, headers, user: User | null }>`
  - `requireUser(request, env): Promise<{ supabase, headers, user: User }>` — throws `redirect("/login")` when unauthenticated.
  - `resolveOrg(supabase, userId): Promise<{ org_id: string; role: string } | null>` — the user's (first) org membership, or null if none (→ onboarding).

- [ ] **Step 1: Write the failing test for `resolveOrg`**

Create `nudgepay-app/tests/session.test.ts`:

```ts
import { expect, test, beforeAll } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";
import { resolveOrg } from "../app/lib/session.server";

let user: Awaited<ReturnType<typeof makeUserClient>>;
let orgId: string;

beforeAll(async () => {
  const svc = serviceClient();
  user = await makeUserClient("session-user@example.com");
  const { data: org } = await svc.from("organizations").insert({ name: "Session Org" }).select().single();
  orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });
});

test("resolveOrg returns the user's membership org and role", async () => {
  const result = await resolveOrg(user.client, user.userId);
  expect(result).toEqual({ org_id: orgId, role: "owner" });
});

test("resolveOrg returns null for a user with no membership", async () => {
  const orphan = await makeUserClient("orphan@example.com");
  const result = await resolveOrg(orphan.client, orphan.userId);
  expect(result).toBeNull();
});
```

- [ ] **Step 2: Run to verify it FAILS**

```bash
cd nudgepay-app
npx vitest run tests/session.test.ts
```

Expected: FAIL — `resolveOrg` is not exported yet (module not found / undefined).

- [ ] **Step 3: Implement the session helpers**

Create `nudgepay-app/app/lib/session.server.ts`:

```ts
import { redirect } from "react-router";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AppEnv } from "./env.server";
import { createSupabaseUserClient } from "./supabase.server";

export async function getOptionalUser(request: Request, env: AppEnv) {
  const { supabase, headers } = createSupabaseUserClient(request, env);
  const { data } = await supabase.auth.getUser();
  return { supabase, headers, user: data.user ?? null };
}

export async function requireUser(request: Request, env: AppEnv) {
  const { supabase, headers, user } = await getOptionalUser(request, env);
  if (!user) throw redirect("/login", { headers });
  return { supabase, headers, user: user as User };
}

export async function resolveOrg(
  supabase: SupabaseClient,
  userId: string
): Promise<{ org_id: string; role: string } | null> {
  const { data } = await supabase
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? { org_id: data.org_id as string, role: data.role as string } : null;
}
```

- [ ] **Step 4: Run to verify it PASSES**

```bash
cd nudgepay-app
npx vitest run tests/session.test.ts
```

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/session.server.ts nudgepay-app/tests/session.test.ts
git commit -m "feat: add session guard helpers (requireUser, resolveOrg) with tests"
```

---

## Task 7: Auth routes — signup, login, logout

**Files:**
- Create: `nudgepay-app/app/routes/signup.tsx`
- Create: `nudgepay-app/app/routes/login.tsx`
- Create: `nudgepay-app/app/routes/logout.tsx`
- Modify: `nudgepay-app/app/routes.ts` (register routes)

**Interfaces:**
- Consumes: Task 5 factories, Task 6 helpers.
- Produces: working email/password signup, login, logout that set/clear the Supabase auth cookie via the returned `headers`. After login with no org → redirect `/onboarding`; with org → `/dashboard`.

- [ ] **Step 1: Register the routes**

Edit `nudgepay-app/app/routes.ts` to include (using the template's route DSL):

```ts
import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("eula", "routes/eula.tsx"),
  route("signup", "routes/signup.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("onboarding", "routes/onboarding.tsx"),
  route("invite", "routes/invite.tsx"),
  route("accept/:token", "routes/accept.$token.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
] satisfies RouteConfig;
```

- [ ] **Step 2: Implement signup**

Create `nudgepay-app/app/routes/signup.tsx`:

```tsx
import { Form, redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseUserClient } from "../lib/supabase.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const form = await request.formData();
  const email = String(form.get("email"));
  const password = String(form.get("password"));
  const { supabase, headers } = createSupabaseUserClient(request, env);
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };
  return redirect("/onboarding", { headers });
}

export default function Signup({ actionData }: { actionData?: { error?: string } }) {
  return (
    <Form method="post" style={{ maxWidth: 360, margin: "64px auto", display: "grid", gap: 12 }}>
      <h1>Create your NudgePay account</h1>
      {actionData?.error && <p style={{ color: "#C0202A" }}>{actionData.error}</p>}
      <input name="email" type="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Password" required minLength={8} />
      <button type="submit">Sign up</button>
    </Form>
  );
}
```

- [ ] **Step 3: Implement login**

Create `nudgepay-app/app/routes/login.tsx`:

```tsx
import { Form, redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseUserClient } from "../lib/supabase.server";
import { resolveOrg } from "../lib/session.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const form = await request.formData();
  const email = String(form.get("email"));
  const password = String(form.get("password"));
  const { supabase, headers } = createSupabaseUserClient(request, env);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: error?.message ?? "Login failed" };
  const org = await resolveOrg(supabase, data.user.id);
  return redirect(org ? "/dashboard" : "/onboarding", { headers });
}

export default function Login({ actionData }: { actionData?: { error?: string } }) {
  return (
    <Form method="post" style={{ maxWidth: 360, margin: "64px auto", display: "grid", gap: 12 }}>
      <h1>Log in to NudgePay</h1>
      {actionData?.error && <p style={{ color: "#C0202A" }}>{actionData.error}</p>}
      <input name="email" type="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Password" required />
      <button type="submit">Log in</button>
    </Form>
  );
}
```

- [ ] **Step 4: Implement logout**

Create `nudgepay-app/app/routes/logout.tsx`:

```tsx
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseUserClient } from "../lib/supabase.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers } = createSupabaseUserClient(request, env);
  await supabase.auth.signOut();
  return redirect("/login", { headers });
}

export function loader() {
  return redirect("/login");
}
```

- [ ] **Step 5: Typecheck and build**

```bash
cd nudgepay-app
npm run typecheck && npm run build
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/routes.ts nudgepay-app/app/routes/signup.tsx nudgepay-app/app/routes/login.tsx nudgepay-app/app/routes/logout.tsx
git commit -m "feat: add email signup, login, and logout routes"
```

---

## Task 8: Onboarding — create org + owner membership

**Files:**
- Create: `nudgepay-app/app/routes/onboarding.tsx`
- Create: `nudgepay-app/app/lib/orgs.server.ts`
- Create: `nudgepay-app/tests/onboarding.test.ts`

**Interfaces:**
- Consumes: Task 5/6 helpers.
- Produces: `createOrgForUser(service, userId, name): Promise<string>` (returns new `org_id`, inserts org + owner membership atomically-enough via service client) in `app/lib/orgs.server.ts`; an `/onboarding` route that calls it and redirects to `/dashboard`.

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/onboarding.test.ts`:

```ts
import { expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";
import { createOrgForUser } from "../app/lib/orgs.server";

test("createOrgForUser creates an org and an owner membership", async () => {
  const svc = serviceClient();
  const user = await makeUserClient("onboard@example.com");
  const orgId = await createOrgForUser(svc, user.userId, "Acme AR");

  const { data: org } = await svc.from("organizations").select("name").eq("id", orgId).single();
  expect(org?.name).toBe("Acme AR");

  const { data: mem } = await svc.from("memberships")
    .select("role").eq("org_id", orgId).eq("user_id", user.userId).single();
  expect(mem?.role).toBe("owner");
});
```

- [ ] **Step 2: Run to verify it FAILS**

```bash
cd nudgepay-app
npx vitest run tests/onboarding.test.ts
```

Expected: FAIL — `createOrgForUser` not found.

- [ ] **Step 3: Implement the org helper**

Create `nudgepay-app/app/lib/orgs.server.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export async function createOrgForUser(
  service: SupabaseClient,
  userId: string,
  name: string
): Promise<string> {
  const { data: org, error: orgErr } = await service
    .from("organizations").insert({ name }).select("id").single();
  if (orgErr || !org) throw orgErr ?? new Error("org insert failed");

  const { error: memErr } = await service
    .from("memberships").insert({ org_id: org.id, user_id: userId, role: "owner" });
  if (memErr) {
    await service.from("organizations").delete().eq("id", org.id); // compensate
    throw memErr;
  }
  return org.id as string;
}
```

- [ ] **Step 4: Run to verify it PASSES**

```bash
cd nudgepay-app
npx vitest run tests/onboarding.test.ts
```

Expected: PASS.

- [ ] **Step 5: Implement the onboarding route**

Create `nudgepay-app/app/routes/onboarding.tsx`:

```tsx
import { Form, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createOrgForUser } from "../lib/orgs.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (org) throw redirect("/dashboard", { headers });
  return new Response(null, { headers });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { headers, user } = await requireUser(request, env);
  const form = await request.formData();
  const name = String(form.get("orgName")).trim();
  if (!name) return { error: "Organization name is required" };
  const service = createSupabaseServiceClient(env);
  await createOrgForUser(service, user.id, name);
  return redirect("/dashboard", { headers });
}

export default function Onboarding({ actionData }: { actionData?: { error?: string } }) {
  return (
    <Form method="post" style={{ maxWidth: 360, margin: "64px auto", display: "grid", gap: 12 }}>
      <h1>Name your organization</h1>
      {actionData?.error && <p style={{ color: "#C0202A" }}>{actionData.error}</p>}
      <input name="orgName" placeholder="e.g. Chancey Heating & Cooling" required />
      <button type="submit">Create organization</button>
    </Form>
  );
}
```

- [ ] **Step 6: Typecheck, build, run full test suite**

```bash
cd nudgepay-app
npm run typecheck && npm run build && npx vitest run
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/orgs.server.ts nudgepay-app/app/routes/onboarding.tsx nudgepay-app/tests/onboarding.test.ts
git commit -m "feat: add org onboarding (create org + owner membership)"
```

---

## Task 9: Teammate invites

**Files:**
- Create: `nudgepay-app/supabase/migrations/0003_invites.sql`
- Create: `nudgepay-app/app/routes/invite.tsx`
- Create: `nudgepay-app/app/routes/accept.$token.tsx`
- Modify: `nudgepay-app/tests/onboarding.test.ts` (add invite acceptance test)

**Interfaces:**
- Consumes: Task 8 org helper.
- Produces: `invites` table (`id, org_id, email, token, accepted_at`); an owner-only `/invite` action that creates an invite row; `/accept/:token` that, for a logged-in user, inserts a membership for the invited org.

- [ ] **Step 1: Write the invites migration**

Create `nudgepay-app/supabase/migrations/0003_invites.sql`:

```sql
create table invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index on invites (org_id);

alter table invites enable row level security;
create policy invites_select on invites
  for select using (public.is_org_member(org_id));
create policy invites_write on invites
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
```

- [ ] **Step 2: Write the failing acceptance test**

Append to `nudgepay-app/tests/onboarding.test.ts`:

```ts
import { acceptInvite } from "../app/lib/orgs.server";

test("acceptInvite adds the invited user to the org", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient("owner2@example.com");
  const orgId = await createOrgForUser(svc, owner.userId, "Invite Org");
  const { data: inv } = await svc.from("invites")
    .insert({ org_id: orgId, email: "invitee@example.com" }).select("token").single();

  const invitee = await makeUserClient("invitee@example.com");
  await acceptInvite(svc, inv!.token, invitee.userId);

  const { data: mem } = await svc.from("memberships")
    .select("role").eq("org_id", orgId).eq("user_id", invitee.userId).single();
  expect(mem?.role).toBe("member");
});
```

- [ ] **Step 3: Run to verify it FAILS**

```bash
cd nudgepay-app
npx supabase db reset
npx vitest run tests/onboarding.test.ts
```

Expected: FAIL — `acceptInvite` not found.

- [ ] **Step 4: Implement `acceptInvite`**

Append to `nudgepay-app/app/lib/orgs.server.ts`:

```ts
export async function acceptInvite(
  service: SupabaseClient,
  token: string,
  userId: string
): Promise<string> {
  const { data: inv, error } = await service
    .from("invites").select("id, org_id, accepted_at").eq("token", token).single();
  if (error || !inv) throw error ?? new Error("invite not found");
  if (inv.accepted_at) throw new Error("invite already accepted");

  const { error: memErr } = await service
    .from("memberships").insert({ org_id: inv.org_id, user_id: userId, role: "member" });
  if (memErr) throw memErr;

  await service.from("invites").update({ accepted_at: new Date().toISOString() }).eq("id", inv.id);
  return inv.org_id as string;
}
```

- [ ] **Step 5: Run to verify it PASSES**

```bash
cd nudgepay-app
npx vitest run tests/onboarding.test.ts
```

Expected: PASS.

- [ ] **Step 6: Implement the routes**

Create `nudgepay-app/app/routes/invite.tsx`:

```tsx
import { Form, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org || org.role !== "owner") return { error: "Only owners can invite" };
  const email = String((await request.formData()).get("email")).trim();
  if (!email) return { error: "Email required" };
  const service = createSupabaseServiceClient(env);
  const { data, error } = await service.from("invites")
    .insert({ org_id: org.org_id, email }).select("token").single();
  if (error) return { error: error.message };
  return { ok: true, link: `/accept/${data!.token}` };
}

export default function Invite({ actionData }: { actionData?: { error?: string; ok?: boolean; link?: string } }) {
  return (
    <Form method="post" style={{ maxWidth: 420, margin: "64px auto", display: "grid", gap: 12 }}>
      <h1>Invite a teammate</h1>
      {actionData?.error && <p style={{ color: "#C0202A" }}>{actionData.error}</p>}
      {actionData?.ok && <p>Invite link: <code>{actionData.link}</code></p>}
      <input name="email" type="email" placeholder="teammate@company.com" required />
      <button type="submit">Send invite</button>
    </Form>
  );
}
```

Create `nudgepay-app/app/routes/accept.$token.tsx`:

```tsx
import { redirect, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser } from "../lib/session.server";
import { acceptInvite } from "../lib/orgs.server";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { headers, user } = await requireUser(request, env);
  const service = createSupabaseServiceClient(env);
  await acceptInvite(service, String(params.token), user.id);
  return redirect("/dashboard", { headers });
}
```

- [ ] **Step 7: Typecheck, build, full suite**

```bash
cd nudgepay-app
npm run typecheck && npm run build && npx supabase db reset && npx vitest run
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/supabase/migrations/0003_invites.sql nudgepay-app/app/routes/invite.tsx nudgepay-app/app/routes/accept.$token.tsx nudgepay-app/app/lib/orgs.server.ts nudgepay-app/tests/onboarding.test.ts
git commit -m "feat: add teammate invite + accept flow"
```

---

## Task 10: Public/legal pages, authed dashboard, Chancey seed

**Files:**
- Create: `nudgepay-app/app/routes/_index.tsx`
- Create: `nudgepay-app/app/routes/privacy.tsx`
- Create: `nudgepay-app/app/routes/eula.tsx`
- Create: `nudgepay-app/app/routes/dashboard.tsx`
- Create: `nudgepay-app/supabase/seed.sql`

**Interfaces:**
- Consumes: Tasks 5–8 helpers.
- Produces: a public landing + real `/privacy` and `/eula` routes (Intuit-required, no 404); an authed `/dashboard` that shows the user's org name (proving the end-to-end auth + RLS path); a `seed.sql` creating the Chancey org with 5 members for local dev.

- [ ] **Step 1: Landing + legal routes**

Create `nudgepay-app/app/routes/_index.tsx`:

```tsx
import { Link } from "react-router";
export default function Index() {
  return (
    <main style={{ maxWidth: 640, margin: "64px auto", fontFamily: "sans-serif" }}>
      <h1>NudgePay</h1>
      <p>AR collections for QuickBooks users.</p>
      <p><Link to="/signup">Sign up</Link> · <Link to="/login">Log in</Link></p>
      <p style={{ marginTop: 40, fontSize: 12 }}>
        <Link to="/privacy">Privacy Policy</Link> · <Link to="/eula">EULA</Link>
      </p>
    </main>
  );
}
```

Create `nudgepay-app/app/routes/privacy.tsx`:

```tsx
export default function Privacy() {
  return (
    <main style={{ maxWidth: 720, margin: "48px auto", fontFamily: "sans-serif" }}>
      <h1>NudgePay Privacy Policy</h1>
      <p>Last updated: 2026-06-22.</p>
      <p>NudgePay connects to your QuickBooks Online account to display overdue
        invoices and help your team manage collections. We store invoice,
        customer, contact-log, and message data on your behalf, encrypted in
        transit and at rest. QuickBooks OAuth tokens are encrypted at rest and
        are never exposed to the browser. We do not sell your data.</p>
      <p>To disconnect QuickBooks and delete stored tokens, use the Disconnect
        action in the app. Contact: support@nudgepay-ar.app.</p>
    </main>
  );
}
```

Create `nudgepay-app/app/routes/eula.tsx`:

```tsx
export default function Eula() {
  return (
    <main style={{ maxWidth: 720, margin: "48px auto", fontFamily: "sans-serif" }}>
      <h1>NudgePay End User License Agreement</h1>
      <p>Last updated: 2026-06-22.</p>
      <p>By using NudgePay you agree to use it solely for managing your own
        business's accounts-receivable collections, in compliance with
        applicable law including TCPA/A2P messaging rules. The software is
        provided as-is during private beta. Either party may terminate access
        at any time; on termination, QuickBooks tokens are revoked and removed.</p>
    </main>
  );
}
```

- [ ] **Step 2: Authed dashboard placeholder**

Create `nudgepay-app/app/routes/dashboard.tsx`:

```tsx
import { Form, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { redirect } from "react-router";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });
  const { data: orgRow } = await supabase
    .from("organizations").select("name").eq("id", org.org_id).single();
  return Response.json({ orgName: orgRow?.name ?? "(unknown)", email: user.email, role: org.role }, { headers });
}

export default function Dashboard() {
  const { orgName, email, role } = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 720, margin: "48px auto", fontFamily: "sans-serif" }}>
      <h1>{orgName}</h1>
      <p>Signed in as {email} ({role}).</p>
      <p>Invoice list arrives in Phase 2 (QBO sync).</p>
      <Form method="post" action="/logout"><button type="submit">Log out</button></Form>
    </main>
  );
}
```

- [ ] **Step 3: Chancey seed for local dev**

Create `nudgepay-app/supabase/seed.sql`:

```sql
-- Local-dev seed: Chancey org + 5 members. Uses fixed emails for predictable login.
do $$
declare
  v_org uuid;
  v_user uuid;
  v_email text;
  v_names text[] := array['brandy','diskin','john','kristi','macy'];
begin
  insert into organizations (name) values ('Chancey Heating & Cooling') returning id into v_org;
  foreach v_email in array v_names loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
            v_email || '@chancey.test', crypt('password123', gen_salt('bf')), now(), now(), now())
    returning id into v_user;
    insert into memberships (org_id, user_id, role)
    values (v_org, v_user, case when v_email = 'diskin' then 'owner' else 'member' end);
  end loop;
end $$;
```

- [ ] **Step 4: Apply seed and verify the dashboard path manually**

```bash
cd nudgepay-app
npx supabase db reset   # applies migrations + seed.sql
npm run typecheck && npm run build
```

Expected: reset reports seed applied; build clean. (Manual smoke: `npm run dev`, log in as `diskin@chancey.test` / `password123`, confirm `/dashboard` shows "Chancey Heating & Cooling".)

- [ ] **Step 5: Run the full test suite one final time**

```bash
cd nudgepay-app
npx supabase db reset && npx vitest run
```

Expected: all RLS, session, and onboarding/invite tests PASS.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/routes/_index.tsx nudgepay-app/app/routes/privacy.tsx nudgepay-app/app/routes/eula.tsx nudgepay-app/app/routes/dashboard.tsx nudgepay-app/supabase/seed.sql
git commit -m "feat: add landing, privacy/EULA, authed dashboard, and Chancey dev seed"
```

---

## Phase 1 Definition of Done

- `npm run typecheck`, `npm run build`, and `npx vitest run` all pass.
- A user can sign up → create an org → log in → see the authed dashboard.
- An owner can invite a teammate; the invitee accepting gains org membership.
- RLS denies cross-org reads, filtered reads, and inserts (proven by `rls.test.ts`).
- `/privacy` and `/eula` return real pages (Intuit prerequisite).
- Chancey org + 5 members seeded for local dev. **No live QBO/Twilio data.**

## What This Phase Deliberately Does NOT Do (next phases)

- **Phase 2 (QBO):** OAuth hardening (CSRF nonce, redirecting callback), AES-GCM token encryption into `qbo_connections`, webhook + CDC sync, real "Refresh from QuickBooks".
- **Phase 3 (Twilio):** `/api/text/send`, inbound + status webhooks, consent/opt-out, A2P 10DLC.
- **Phase 4 (Intuit):** app details, compliance questionnaire, production credentials, real Chancey connect.
- **Phase 5 (Cutover):** retire Netlify + Railway, port the full prototype dashboard UI into typed components, final security review.

---

## Self-Review Notes (author)

- **Spec coverage (Phase 1 scope):** RR7+Workers skeleton (T1), Supabase Auth (T7), multi-tenant schema (T3), RLS day-one (T4), org/membership model (T3/T8), invites (T9), per-user attribution groundwork (`contact_logs.user_id` in T3), legal pages (T10), Chancey seed (T10). QBO/Twilio/Intuit-submission items are intentionally deferred and listed above.
- **Placeholders:** none — every code/SQL step contains full content.
- **Type consistency:** `createOrgForUser` and `acceptInvite` signatures in `orgs.server.ts` match their test call sites (T8/T9); `resolveOrg` return shape `{ org_id, role }` is consistent across `login`, `onboarding`, `dashboard`, and `invite`; `getEnv`/`AppEnv` keys match `wrangler.toml` vars and `.env.test`.
- **Known risk to verify at execution:** the RR7 Cloudflare template's exact load-context shape (`context.cloudflare.env`) and route-config DSL can vary by template version — Task 1 Step 5 / Task 7 Step 1 confirm the generated shapes before later tasks rely on them.
