# NudgePay Phase 2B — QBO Sync & Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull a connected org's overdue invoices and their customers from QuickBooks Online into Postgres — via an initial/manual backfill, near-real-time webhooks, and a scheduled CDC catch-up — with every Intuit HTTP call behind an injectable `fetchFn` so the whole pipeline is unit/integration-tested on the local Docker stack with NO live Intuit credentials.

**Architecture:** A read-side QBO data-API client (`qbo-api.server.ts`, injectable `fetch`) is separate from the Phase 2A OAuth client. Pure mapper functions (`qbo-mappers.server.ts`) translate QBO payloads into our row shapes (due-date-anchored status, `Number.isNaN`-guarded money). A sync orchestrator (`qbo-sync.server.ts`) composes token acquisition + API reads + idempotent upserts keyed on `(org_id, qbo_id)`. Webhook signatures are HMAC-verified (`qbo-webhook.server.ts`); a thin `/webhooks/qbo` resource route maps `realmId → org` and applies single-entity changes; a `scheduled` Worker handler runs bounded CDC catch-up. The live sandbox round-trip stays a documented manual step.

**Tech Stack:** React Router v7 (Cloudflare Workers), TypeScript `strict`, Supabase (service-role client for privileged sync writes; user client for RLS-scoped dashboard reads), Web Crypto (HMAC-SHA256), Vitest. Builds on Phase 1 (Foundation) + Phase 2A (QBO OAuth), both merged to `main`.

## Global Constraints

- Language: TypeScript, `strict: true`. Work in `nudgepay-app/`. Branch `phase2b-qbo-sync` (NOT main). Conventional Commits.
- Runtime: Cloudflare Workers (`nodejs_compat`). All crypto uses the global Web Crypto API (`crypto.subtle`, `crypto.getRandomValues`) — works in Workers AND Node 20+/vitest. Do NOT import `node:crypto`.
- **No live Intuit calls in code or tests.** Every QBO HTTP call goes through a function taking an injectable `fetchFn: typeof fetch`; tests pass a mock; routes/cron pass the real global `fetch`.
- All `customers` / `invoices` / `qbo_connections` writes during sync go through the **service-role client** (privileged; same boundary as Phase 1/2A). Encryption key + QBO secrets are read only in `*.server.ts` via `getQboEnv` — never shipped to the browser. Dashboard invoice **reads** use the **user client** (RLS-scoped).
- **Idempotency:** every sync upsert is keyed `onConflict: "org_id,qbo_id"` and ALWAYS sets a non-null `qbo_id`. (Carry-forward from Phase 1: `unique(org_id, qbo_id)` permits multiple NULL `qbo_id` rows — sync must never insert a NULL `qbo_id`.)
- **Money safety:** parse `TotalAmt`/`Balance` with a `Number.isNaN` → `0` guard (carry-forward: honor at `getValidAccessToken`'s first caller, which is this phase).
- **Consent preservation:** customer upserts MUST NOT include `sms_consent` in the payload, so PostgREST `ON CONFLICT DO UPDATE` leaves any existing consent flag untouched.
- **Aging anchor:** invoice status/aging is anchored on **due date**, not invoice date (domain rule from the design spec §4).
- Reuse Phase 1/2A conventions verbatim: `getEnv(context as any)` / `getQboEnv(context as any)`, `requireUser`/`resolveOrg`, `createSupabaseServiceClient`/`createSupabaseUserClient`, auth redirects carry `{ headers }`, `useLoaderData<typeof loader>()`/`useActionData<typeof action>()`.
- Tests run against the local Supabase stack; suite stays green via `tests/global-setup.ts` (it already truncates `customers`, `invoices`, `qbo_connections`).

## Phase 2A Interfaces This Builds On (verified against merged code)

- `app/lib/env.server.ts` → `getQboEnv(context): QboEnv` where `QboEnv = { QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, QBO_ENCRYPTION_KEY, QBO_SANDBOX: boolean }`. (This phase adds one field — see Task 6.)
- `app/lib/qbo-connection.server.ts` → `getValidAccessToken(fetchFn, service, cfg, key, orgId): Promise<{ accessToken: string; realmId: string }>` (decrypts; refreshes + persists rotated refresh token when within 60s of expiry; throws if not connected). `getConnectionStatus(service, orgId): Promise<{ status, realmId } | null>`.
- `app/lib/qbo-client.server.ts` → `type QboHttpConfig = { clientId, clientSecret, redirectUri }`; `type QboTokens`. (Used here only to satisfy `getValidAccessToken`'s `cfg` param for token refresh.)
- `app/lib/crypto.server.ts` → `encryptSecret`/`decryptSecret` (unchanged this phase).
- `app/lib/session.server.ts` → `requireUser(request, env): { supabase, headers, user }`, `resolveOrg(supabase, userId): { org_id, role } | null`.
- `app/lib/supabase.server.ts` → `createSupabaseServiceClient(env)`, `createSupabaseUserClient(request, env)`.
- `tests/helpers.ts` → `serviceClient()`, `makeUserClient(email)`. `tests/global-setup.ts` truncates tenant tables (incl. `customers`, `invoices`, `qbo_connections`, `oauth_states`).
- `workers/app.ts` → default export `{ fetch }` (RR7 request handler). Extended with `scheduled` in Task 9.
- Schema (migration `0001`): `customers(org_id, qbo_id, name, email, phone, sms_consent default false, unique(org_id, qbo_id))`; `invoices(org_id, qbo_id, qbo_doc_number, customer_id FK->customers on delete set null, amount numeric, balance numeric, due_date date, invoice_date date, status default 'open', qbo_sync_at timestamptz, unique(org_id, qbo_id))`; `qbo_connections(org_id unique, realm_id text, last_cdc_time timestamptz, last_sync_at timestamptz, status)`.

## QBO REST contracts used (reference — confirm against Intuit docs at live-test time)

- **Query:** `GET {base}/v3/company/{realmId}/query?query={SQL}&minorversion=65` → `{ QueryResponse: { Invoice?: [...], Customer?: [...] }, time }`. Default page size is 100 → queries MUST append `STARTPOSITION 1 MAXRESULTS 1000` (Chancey carries 125–175 overdue invoices; 100 would silently truncate).
- **Read entity:** `GET {base}/v3/company/{realmId}/{entity}/{id}?minorversion=65` → `{ Invoice|Customer: {...}, time }`.
- **CDC:** `GET {base}/v3/company/{realmId}/cdc?entities=Invoice,Customer&changedSince={ISO8601}&minorversion=65` → `{ CDCResponse: [ { QueryResponse: [ { Invoice?: [...] }, { Customer?: [...] } ] } ] }`. Lookback max 30 days; ≤1000 objects per response.
- **Base URL:** sandbox `https://sandbox-quickbooks.api.intuit.com`, production `https://quickbooks.api.intuit.com`.
- **Webhook:** Intuit POSTs a JSON `{ eventNotifications: [ { realmId, dataChangeEvent: { entities: [ { name, id, operation, lastUpdated } ] } } ] }` body with header `intuit-signature` = base64(HMAC-SHA256(verifierToken, rawBody)).
- Invoice fields used: `Id`, `DocNumber`, `TotalAmt`, `Balance`, `DueDate` (YYYY-MM-DD), `TxnDate`, `CustomerRef.value`. Customer fields used: `Id`, `DisplayName`/`FullyQualifiedName`/`CompanyName`, `PrimaryEmailAddr.Address`, `PrimaryPhone.FreeFormNumber`.

---

## File Structure

```
nudgepay-app/
  app/lib/
    env.server.ts            # MODIFY (Task 6): add QBO_WEBHOOK_VERIFIER_TOKEN to QboEnv + getQboEnv
    qbo-api.server.ts        # NEW (Task 2): query / read-entity / cdc (injectable fetch) + base-url helper
    qbo-mappers.server.ts    # NEW (Task 3): pure QBO->row mappers, due-date status, NaN-guarded money
    qbo-sync.server.ts       # NEW (Tasks 4-5): backfill/refresh + single-entity + CDC orchestration
    qbo-webhook.server.ts    # NEW (Task 6): HMAC signature verify + payload parse
    qbo-cron.server.ts       # NEW (Task 9): runScheduledCdc(env) over all connected orgs
  app/routes/
    webhooks.qbo.tsx         # NEW (Task 7): signature-gated webhook resource route
    api.qbo.refresh.tsx      # NEW (Task 8): authed manual "Refresh from QuickBooks"
    dashboard.tsx            # MODIFY (Task 8): invoice list + Refresh button + last-sync
    routes.ts                # MODIFY (Tasks 7-8): register webhook + refresh routes
  supabase/migrations/
    0005_qbo_sync.sql        # NEW (Task 1): partial-unique index on qbo_connections(realm_id)
  workers/app.ts             # MODIFY (Task 9): add scheduled() handler
  wrangler.toml              # MODIFY (Task 9): [triggers] crons; doc verifier-token secret
  tests/
    helpers.ts               # MODIFY (Task 7): export TEST_ENV for route-level tests
    qbo-api.test.ts          # NEW (Task 2)
    qbo-mappers.test.ts      # NEW (Task 3)
    qbo-sync.test.ts         # NEW (Task 4)
    qbo-sync-cdc.test.ts     # NEW (Task 5)
    qbo-webhook.test.ts      # NEW (Task 6)
    webhooks-route.test.ts   # NEW (Task 7)
    qbo-cron.test.ts         # NEW (Task 9)
  .env.test                  # MODIFY (Task 6, gitignored): add QBO_WEBHOOK_VERIFIER_TOKEN
docs/superpowers/
  phase2b-live-sandbox-verification.md  # NEW (Task 10)
```

---

## Task 1: Migration — one-org-per-realm integrity for webhook routing

**Files:**
- Create: `nudgepay-app/supabase/migrations/0005_qbo_sync.sql`

**Interfaces:**
- Consumes: existing `qbo_connections(org_id unique, realm_id text, status)`.
- Produces: a partial-unique index guaranteeing at most one **connected** org per `realm_id`, so the webhook route's `realm_id → org` lookup is sound with `.maybeSingle()`.

- [ ] **Step 1: Write the migration**

Create `nudgepay-app/supabase/migrations/0005_qbo_sync.sql`:

```sql
-- A QBO company (realm) maps to exactly one org. Webhooks arrive keyed by
-- realmId; this lets the webhook route resolve the org with .maybeSingle().
-- Partial + nullable: many rows may have realm_id NULL (disconnected); only
-- non-null realm_ids must be unique. Two orgs cannot claim the same realm.
create unique index qbo_connections_realm_id_uniq
  on qbo_connections (realm_id)
  where realm_id is not null;
```

- [ ] **Step 2: Apply and verify the migration**

Run:
```bash
cd nudgepay-app && npx supabase db reset
```
Expected: applies `0001`–`0005` with no error.

Confirm the index exists:
```bash
npx supabase db query "select indexname from pg_indexes where tablename = 'qbo_connections' and indexname = 'qbo_connections_realm_id_uniq';"
```
Expected: one row, `qbo_connections_realm_id_uniq`.

- [ ] **Step 3: Confirm the suite still green after reset**

Run: `cd nudgepay-app && npx vitest run`
Expected: all existing Phase 1 + 2A tests pass (30+).

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/supabase/migrations/0005_qbo_sync.sql
git commit -m "feat: enforce one connected org per QBO realm for webhook routing"
```

---

## Task 2: QBO data-API client (query / read-entity / CDC)

**Files:**
- Create: `nudgepay-app/app/lib/qbo-api.server.ts`, `nudgepay-app/tests/qbo-api.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure HTTP wrapper).
- Produces:
  - `type QboApiConfig = { baseUrl: string }`
  - `qboApiBaseUrl(sandbox: boolean): string`
  - `qboQuery(fetchFn, api, accessToken, realmId, query, entityName): Promise<any[]>`
  - `qboReadEntity(fetchFn, api, accessToken, realmId, entityName, id): Promise<any | null>`
  - `type QboCdcResult = { invoices: any[]; customers: any[] }`
  - `qboCdc(fetchFn, api, accessToken, realmId, changedSinceIso): Promise<QboCdcResult>`

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/qbo-api.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import {
  qboApiBaseUrl, qboQuery, qboReadEntity, qboCdc,
} from "../app/lib/qbo-api.server";

const api = { baseUrl: "https://sandbox-quickbooks.api.intuit.com" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("qboApiBaseUrl switches between sandbox and production", () => {
  expect(qboApiBaseUrl(true)).toContain("sandbox-quickbooks");
  expect(qboApiBaseUrl(false)).toBe("https://quickbooks.api.intuit.com");
});

test("qboQuery hits the query endpoint with bearer auth and returns the entity array", async () => {
  const fetchFn = vi.fn(async () =>
    jsonResponse({ QueryResponse: { Invoice: [{ Id: "1" }, { Id: "2" }] } }));
  const rows = await qboQuery(fetchFn as any, api, "AT", "realm-9", "select * from Invoice", "Invoice");
  expect(rows.map((r) => r.Id)).toEqual(["1", "2"]);
  const [url, init] = fetchFn.mock.calls[0];
  expect(String(url)).toContain("/v3/company/realm-9/query?query=");
  expect(String(url)).toContain("minorversion=");
  expect((init as any).headers.Authorization).toBe("Bearer AT");
});

test("qboQuery returns [] when the entity key is absent", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ QueryResponse: {} }));
  expect(await qboQuery(fetchFn as any, api, "AT", "r", "select * from Customer", "Customer")).toEqual([]);
});

test("qboReadEntity reads one entity by id and unwraps it", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ Invoice: { Id: "42", Balance: 10 } }));
  const inv = await qboReadEntity(fetchFn as any, api, "AT", "realm-1", "Invoice", "42");
  expect(inv.Id).toBe("42");
  expect(String(fetchFn.mock.calls[0][0])).toContain("/v3/company/realm-1/invoice/42");
});

test("qboReadEntity returns null when the entity is missing", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ time: "now" }));
  expect(await qboReadEntity(fetchFn as any, api, "AT", "r", "Customer", "99")).toBeNull();
});

test("qboCdc groups changed invoices and customers", async () => {
  const fetchFn = vi.fn(async () =>
    jsonResponse({ CDCResponse: [{ QueryResponse: [{ Invoice: [{ Id: "1" }] }, { Customer: [{ Id: "7" }] }] }] }));
  const out = await qboCdc(fetchFn as any, api, "AT", "realm-2", "2026-06-01T00:00:00Z");
  expect(out.invoices.map((i) => i.Id)).toEqual(["1"]);
  expect(out.customers.map((c) => c.Id)).toEqual(["7"]);
  expect(String(fetchFn.mock.calls[0][0])).toContain("/cdc?entities=Invoice,Customer&changedSince=");
});

test("qboQuery throws on a non-2xx response", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ Fault: {} }, 401));
  await expect(qboQuery(fetchFn as any, api, "AT", "r", "q", "Invoice")).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify it FAILS**

Run: `cd nudgepay-app && npx vitest run tests/qbo-api.test.ts`
Expected: FAIL (module/functions missing).

- [ ] **Step 3: Implement qbo-api.server.ts**

Create `nudgepay-app/app/lib/qbo-api.server.ts`:

```ts
// Read-side QBO Accounting API client. Separate from the OAuth client
// (qbo-client.server.ts). Every call takes an injectable fetchFn so tests
// pass a mock; routes/cron pass the global fetch. No live calls in tests.

export type QboApiConfig = { baseUrl: string };
export type QboCdcResult = { invoices: any[]; customers: any[] };

const MINOR_VERSION = "65";

export function qboApiBaseUrl(sandbox: boolean): string {
  return sandbox
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

async function getJson(fetchFn: typeof fetch, url: string, accessToken: string): Promise<any> {
  const res = await fetchFn(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`QBO API request failed: ${res.status}`);
  return res.json();
}

export async function qboQuery(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, query: string, entityName: "Invoice" | "Customer",
): Promise<any[]> {
  const url = `${api.baseUrl}/v3/company/${realmId}/query`
    + `?query=${encodeURIComponent(query)}&minorversion=${MINOR_VERSION}`;
  const data = await getJson(fetchFn, url, accessToken);
  return (data?.QueryResponse?.[entityName] ?? []) as any[];
}

export async function qboReadEntity(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, entityName: "Invoice" | "Customer", id: string,
): Promise<any | null> {
  const url = `${api.baseUrl}/v3/company/${realmId}/${entityName.toLowerCase()}/${id}`
    + `?minorversion=${MINOR_VERSION}`;
  const data = await getJson(fetchFn, url, accessToken);
  return data?.[entityName] ?? null;
}

export async function qboCdc(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, changedSinceIso: string,
): Promise<QboCdcResult> {
  const url = `${api.baseUrl}/v3/company/${realmId}/cdc`
    + `?entities=Invoice,Customer&changedSince=${encodeURIComponent(changedSinceIso)}`
    + `&minorversion=${MINOR_VERSION}`;
  const data = await getJson(fetchFn, url, accessToken);
  const groups = (data?.CDCResponse?.[0]?.QueryResponse ?? []) as any[];
  return {
    invoices: groups.flatMap((g) => g.Invoice ?? []),
    customers: groups.flatMap((g) => g.Customer ?? []),
  };
}
```

- [ ] **Step 4: Run to verify it PASSES + typecheck**

Run: `cd nudgepay-app && npx vitest run tests/qbo-api.test.ts && npm run typecheck`
Expected: all tests PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/qbo-api.server.ts nudgepay-app/tests/qbo-api.test.ts
git commit -m "feat: add injectable QBO data-API client (query/read/cdc)"
```

---

## Task 3: QBO → row mappers (pure, due-date status, NaN-guarded money)

**Files:**
- Create: `nudgepay-app/app/lib/qbo-mappers.server.ts`, `nudgepay-app/tests/qbo-mappers.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces:
  - `type CustomerUpsert = { org_id: string; qbo_id: string; name: string; email: string | null; phone: string | null }` (deliberately NO `sms_consent` — preserves existing consent on upsert).
  - `type InvoiceUpsert = { org_id: string; qbo_id: string; qbo_doc_number: string | null; customer_id: string | null; amount: number; balance: number; due_date: string | null; invoice_date: string | null; status: string; qbo_sync_at: string }`
  - `mapQboCustomer(c: any, orgId: string): CustomerUpsert`
  - `invoiceStatus(balance: number, dueDate: string | null, now: Date): string` → `'paid' | 'overdue' | 'open'`
  - `mapQboInvoice(inv: any, orgId: string, customerId: string | null, now?: Date): InvoiceUpsert`

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/qbo-mappers.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  mapQboCustomer, mapQboInvoice, invoiceStatus,
} from "../app/lib/qbo-mappers.server";

const NOW = new Date("2026-06-22T12:00:00Z");

test("mapQboCustomer pulls name/email/phone and omits sms_consent", () => {
  const row = mapQboCustomer({
    Id: "5", DisplayName: "Acme HVAC",
    PrimaryEmailAddr: { Address: "ar@acme.test" },
    PrimaryPhone: { FreeFormNumber: "229-555-0101" },
  }, "org-1");
  expect(row).toEqual({
    org_id: "org-1", qbo_id: "5", name: "Acme HVAC",
    email: "ar@acme.test", phone: "229-555-0101",
  });
  expect("sms_consent" in row).toBe(false); // upsert must not clobber consent
});

test("mapQboCustomer falls back when optional fields are missing", () => {
  const row = mapQboCustomer({ Id: 9, FullyQualifiedName: "Fallback Co" }, "org-1");
  expect(row.qbo_id).toBe("9"); // coerced to string
  expect(row.name).toBe("Fallback Co");
  expect(row.email).toBeNull();
  expect(row.phone).toBeNull();
});

test("invoiceStatus: paid when balance <= 0, overdue when past due, else open", () => {
  expect(invoiceStatus(0, "2026-01-01", NOW)).toBe("paid");
  expect(invoiceStatus(100, "2026-06-01", NOW)).toBe("overdue"); // due before now
  expect(invoiceStatus(100, "2026-12-01", NOW)).toBe("open");    // due after now
  expect(invoiceStatus(100, null, NOW)).toBe("open");            // no due date
});

test("mapQboInvoice maps money with NaN guard and anchors status on due date", () => {
  const row = mapQboInvoice({
    Id: "77", DocNumber: "1042", TotalAmt: "350.50", Balance: "120.00",
    DueDate: "2026-06-01", TxnDate: "2026-05-01", CustomerRef: { value: "5" },
  }, "org-1", "cust-uuid", NOW);
  expect(row.qbo_id).toBe("77");
  expect(row.qbo_doc_number).toBe("1042");
  expect(row.amount).toBe(350.5);
  expect(row.balance).toBe(120);
  expect(row.due_date).toBe("2026-06-01");
  expect(row.invoice_date).toBe("2026-05-01");
  expect(row.customer_id).toBe("cust-uuid");
  expect(row.status).toBe("overdue");
  expect(row.qbo_sync_at).toBe(NOW.toISOString());
});

test("mapQboInvoice coerces unparseable money to 0 (never NaN into numeric column)", () => {
  const row = mapQboInvoice({ Id: "1", TotalAmt: "n/a", Balance: undefined }, "org-1", null, NOW);
  expect(row.amount).toBe(0);
  expect(row.balance).toBe(0);
  expect(row.customer_id).toBeNull();
  expect(row.qbo_doc_number).toBeNull();
  expect(row.due_date).toBeNull();
});
```

- [ ] **Step 2: Run to verify it FAILS**

Run: `cd nudgepay-app && npx vitest run tests/qbo-mappers.test.ts`
Expected: FAIL (module/functions missing).

- [ ] **Step 3: Implement qbo-mappers.server.ts**

Create `nudgepay-app/app/lib/qbo-mappers.server.ts`:

```ts
// Pure translation from QBO API payloads to our row shapes. No I/O.
// Money is NaN-guarded (never write NaN into a numeric column). Invoice
// status is anchored on DUE DATE per the domain rules.

export type CustomerUpsert = {
  org_id: string;
  qbo_id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

export type InvoiceUpsert = {
  org_id: string;
  qbo_id: string;
  qbo_doc_number: string | null;
  customer_id: string | null;
  amount: number;
  balance: number;
  due_date: string | null;
  invoice_date: string | null;
  status: string;
  qbo_sync_at: string;
};

function money(v: unknown): number {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

export function mapQboCustomer(c: any, orgId: string): CustomerUpsert {
  return {
    org_id: orgId,
    qbo_id: String(c.Id),
    name: c.DisplayName ?? c.FullyQualifiedName ?? c.CompanyName ?? "(unnamed)",
    email: c.PrimaryEmailAddr?.Address ?? null,
    phone: c.PrimaryPhone?.FreeFormNumber ?? null,
  };
}

export function invoiceStatus(balance: number, dueDate: string | null, now: Date): string {
  if (balance <= 0) return "paid";
  if (dueDate && new Date(`${dueDate}T00:00:00Z`).getTime() < now.getTime()) return "overdue";
  return "open";
}

export function mapQboInvoice(
  inv: any, orgId: string, customerId: string | null, now: Date = new Date(),
): InvoiceUpsert {
  const balance = money(inv.Balance);
  const due_date = inv.DueDate ?? null;
  return {
    org_id: orgId,
    qbo_id: String(inv.Id),
    qbo_doc_number: inv.DocNumber ?? null,
    customer_id: customerId,
    amount: money(inv.TotalAmt),
    balance,
    due_date,
    invoice_date: inv.TxnDate ?? null,
    status: invoiceStatus(balance, due_date, now),
    qbo_sync_at: now.toISOString(),
  };
}
```

- [ ] **Step 4: Run to verify it PASSES + typecheck**

Run: `cd nudgepay-app && npx vitest run tests/qbo-mappers.test.ts && npm run typecheck`
Expected: all PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/qbo-mappers.server.ts nudgepay-app/tests/qbo-mappers.test.ts
git commit -m "feat: add pure QBO->row mappers (due-date status, NaN-guarded money)"
```

---

## Task 4: Sync core — upsert helpers + backfill/manual refresh

**Files:**
- Create: `nudgepay-app/app/lib/qbo-sync.server.ts`, `nudgepay-app/tests/qbo-sync.test.ts`

**Interfaces:**
- Consumes: `getValidAccessToken` (2A), `qboQuery` (T2), `mapQboCustomer`/`mapQboInvoice` (T3), `QboHttpConfig` (2A), `QboApiConfig` (T2).
- Produces:
  - `type SyncDeps = { fetchFn: typeof fetch; service: SupabaseClient; cfg: QboHttpConfig; api: QboApiConfig; key: string }`
  - `syncOverdueInvoices(deps: SyncDeps, orgId: string): Promise<{ customers: number; invoices: number; truncated: boolean }>`
  - (internal, exported for Task 5 reuse) `upsertCustomers`, `upsertInvoices`, `customerIdMap` — see code.

This task is the FIRST caller of `getValidAccessToken`; it honors the carry-forward by always writing a non-null `qbo_id` and NaN-guarded money (via the T3 mappers).

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/qbo-sync.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { serviceClient } from "./helpers";
import { storeConnection } from "../app/lib/qbo-connection.server";
import { syncOverdueInvoices, type SyncDeps } from "../app/lib/qbo-sync.server";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const cfg = { clientId: "cid", clientSecret: "secret", redirectUri: "http://x/cb" };
const api = { baseUrl: "https://sandbox-quickbooks.api.intuit.com" };
const svc = serviceClient();

async function freshOrg(): Promise<string> {
  const { data } = await svc.from("organizations").insert({ name: "Sync Org" }).select("id").single();
  return data!.id as string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Routes QBO query calls by the entity named in the (encoded) query string.
function qboMock(invoices: any[], customers: any[]) {
  return vi.fn(async (url: string) => {
    const decoded = decodeURIComponent(String(url));
    if (decoded.includes("from Invoice")) return jsonResponse({ QueryResponse: { Invoice: invoices } });
    if (decoded.includes("from Customer")) return jsonResponse({ QueryResponse: { Customer: customers } });
    throw new Error(`unexpected url ${decoded}`);
  });
}

function deps(fetchFn: any): SyncDeps {
  return { fetchFn, service: svc, cfg, api, key: KEY };
}

test("syncOverdueInvoices upserts customers then invoices with resolved FK", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-sync-1", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });

  const fetchFn = qboMock(
    [{ Id: "100", DocNumber: "1042", TotalAmt: "350.50", Balance: "120.00", DueDate: "2026-01-01", TxnDate: "2025-12-01", CustomerRef: { value: "5" } }],
    [{ Id: "5", DisplayName: "Acme HVAC", PrimaryEmailAddr: { Address: "ar@acme.test" } }],
  );
  const result = await syncOverdueInvoices(deps(fetchFn), org);
  expect(result).toEqual({ customers: 1, invoices: 1, truncated: false });

  const { data: cust } = await svc.from("customers").select("id, name").eq("org_id", org).eq("qbo_id", "5").single();
  expect(cust!.name).toBe("Acme HVAC");

  const { data: inv } = await svc.from("invoices")
    .select("qbo_doc_number, balance, status, customer_id, qbo_id").eq("org_id", org).eq("qbo_id", "100").single();
  expect(inv!.qbo_doc_number).toBe("1042");
  expect(Number(inv!.balance)).toBe(120);
  expect(inv!.status).toBe("overdue");
  expect(inv!.customer_id).toBe(cust!.id);
});

test("syncOverdueInvoices is idempotent (second run updates, does not duplicate)", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-sync-2", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  const invoices = [{ Id: "200", DocNumber: "9", TotalAmt: "10", Balance: "10", DueDate: "2026-01-01", CustomerRef: { value: "8" } }];
  const customers = [{ Id: "8", DisplayName: "Repeat Co" }];

  await syncOverdueInvoices(deps(qboMock(invoices, customers)), org);
  // second run with a changed balance
  invoices[0].Balance = "4";
  await syncOverdueInvoices(deps(qboMock(invoices, customers)), org);

  const { data } = await svc.from("invoices").select("balance").eq("org_id", org).eq("qbo_id", "200");
  expect(data!.length).toBe(1);                 // no duplicate row
  expect(Number(data![0].balance)).toBe(4);     // updated in place
});

test("syncOverdueInvoices stamps last_sync_at on the connection", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-sync-3", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  await syncOverdueInvoices(deps(qboMock([], [])), org);
  const { data } = await svc.from("qbo_connections").select("last_sync_at").eq("org_id", org).single();
  expect(data!.last_sync_at).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it FAILS**

Run: `cd nudgepay-app && npx vitest run tests/qbo-sync.test.ts`
Expected: FAIL (module/functions missing).

- [ ] **Step 3: Implement qbo-sync.server.ts (backfill core)**

Create `nudgepay-app/app/lib/qbo-sync.server.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "./qbo-connection.server";
import { qboQuery, type QboApiConfig } from "./qbo-api.server";
import {
  mapQboCustomer, mapQboInvoice,
  type CustomerUpsert, type InvoiceUpsert,
} from "./qbo-mappers.server";
import type { QboHttpConfig } from "./qbo-client.server";

export type SyncDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;
  cfg: QboHttpConfig;   // for token refresh inside getValidAccessToken
  api: QboApiConfig;    // data API base url
  key: string;          // AES key for token decrypt
};

// QBO query page cap. Chancey carries 125-175 overdue invoices; CDC caps at
// 1000. A single page of 1000 covers this org; >1000 is flagged (truncated).
export const QUERY_LIMIT = 1000;

export async function upsertCustomers(service: SupabaseClient, rows: CustomerUpsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await service.from("customers").upsert(rows, { onConflict: "org_id,qbo_id" });
  if (error) throw error;
}

export async function upsertInvoices(service: SupabaseClient, rows: InvoiceUpsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await service.from("invoices").upsert(rows, { onConflict: "org_id,qbo_id" });
  if (error) throw error;
}

// Resolve QBO customer ids -> our customer UUIDs for an org (covers both
// just-upserted and pre-existing customers).
export async function customerIdMap(
  service: SupabaseClient, orgId: string, qboCustomerIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(qboCustomerIds.filter(Boolean))];
  if (ids.length === 0) return map;
  const { data, error } = await service.from("customers")
    .select("id, qbo_id").eq("org_id", orgId).in("qbo_id", ids);
  if (error) throw error;
  for (const row of data ?? []) map.set(row.qbo_id as string, row.id as string);
  return map;
}

export async function syncOverdueInvoices(
  deps: SyncDeps, orgId: string,
): Promise<{ customers: number; invoices: number; truncated: boolean }> {
  const { accessToken, realmId } = await getValidAccessToken(
    deps.fetchFn, deps.service, deps.cfg, deps.key, orgId,
  );
  const today = new Date().toISOString().slice(0, 10);
  const invoices = await qboQuery(
    deps.fetchFn, deps.api, accessToken, realmId,
    `select * from Invoice where Balance > '0' and DueDate < '${today}' startposition 1 maxresults ${QUERY_LIMIT}`,
    "Invoice",
  );

  const custIds = invoices.map((i) => i?.CustomerRef?.value).filter(Boolean).map(String);
  let customerRows: CustomerUpsert[] = [];
  const uniqueCustIds = [...new Set(custIds)];
  if (uniqueCustIds.length > 0) {
    const idList = uniqueCustIds.map((id) => `'${id}'`).join(",");
    const customers = await qboQuery(
      deps.fetchFn, deps.api, accessToken, realmId,
      `select * from Customer where Id in (${idList}) startposition 1 maxresults ${QUERY_LIMIT}`,
      "Customer",
    );
    customerRows = customers.map((c) => mapQboCustomer(c, orgId));
  }
  await upsertCustomers(deps.service, customerRows);

  const idMap = await customerIdMap(deps.service, orgId, custIds);
  const now = new Date();
  const invoiceRows = invoices.map((inv) =>
    mapQboInvoice(inv, orgId, idMap.get(String(inv?.CustomerRef?.value)) ?? null, now),
  );
  await upsertInvoices(deps.service, invoiceRows);

  const { error } = await deps.service.from("qbo_connections")
    .update({ last_sync_at: now.toISOString() }).eq("org_id", orgId);
  if (error) throw error;

  return {
    customers: customerRows.length,
    invoices: invoiceRows.length,
    truncated: invoices.length >= QUERY_LIMIT,
  };
}
```

- [ ] **Step 4: Run to verify it PASSES + typecheck**

Run: `cd nudgepay-app && npx vitest run tests/qbo-sync.test.ts && npm run typecheck`
Expected: all 3 tests PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/qbo-sync.server.ts nudgepay-app/tests/qbo-sync.test.ts
git commit -m "feat: add QBO overdue-invoice backfill/refresh sync (idempotent upserts)"
```

---

## Task 5: Single-entity webhook apply + CDC catch-up

**Files:**
- Modify: `nudgepay-app/app/lib/qbo-sync.server.ts`
- Create: `nudgepay-app/tests/qbo-sync-cdc.test.ts`

**Interfaces:**
- Consumes: T4 helpers (`upsertCustomers`, `upsertInvoices`, `customerIdMap`, `SyncDeps`), `qboReadEntity`/`qboCdc` (T2), mappers (T3).
- Produces (append to `qbo-sync.server.ts`):
  - `applyCustomerWebhook(deps: SyncDeps, orgId: string, qboCustomerId: string): Promise<void>`
  - `applyInvoiceWebhook(deps: SyncDeps, orgId: string, qboInvoiceId: string): Promise<void>`
  - `runCdcCatchup(deps: SyncDeps, orgId: string): Promise<{ customers: number; invoices: number }>`

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/qbo-sync-cdc.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { serviceClient } from "./helpers";
import { storeConnection } from "../app/lib/qbo-connection.server";
import {
  applyInvoiceWebhook, applyCustomerWebhook, runCdcCatchup, type SyncDeps,
} from "../app/lib/qbo-sync.server";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const cfg = { clientId: "cid", clientSecret: "secret", redirectUri: "http://x/cb" };
const api = { baseUrl: "https://sandbox-quickbooks.api.intuit.com" };
const svc = serviceClient();

async function freshOrg(): Promise<string> {
  const { data } = await svc.from("organizations").insert({ name: "CDC Org" }).select("id").single();
  return data!.id as string;
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function deps(fetchFn: any): SyncDeps {
  return { fetchFn, service: svc, cfg, api, key: KEY };
}

test("applyInvoiceWebhook reads invoice + customer and upserts both", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-w1", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });

  const fetchFn = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/invoice/300")) return jsonResponse({ Invoice: { Id: "300", DocNumber: "55", TotalAmt: "90", Balance: "90", DueDate: "2026-01-01", CustomerRef: { value: "12" } } });
    if (u.includes("/customer/12")) return jsonResponse({ Customer: { Id: "12", DisplayName: "Webhook Co" } });
    throw new Error(`unexpected ${u}`);
  });

  await applyInvoiceWebhook(deps(fetchFn), org, "300");

  const { data: cust } = await svc.from("customers").select("id, name").eq("org_id", org).eq("qbo_id", "12").single();
  expect(cust!.name).toBe("Webhook Co");
  const { data: inv } = await svc.from("invoices").select("status, customer_id").eq("org_id", org).eq("qbo_id", "300").single();
  expect(inv!.status).toBe("overdue");
  expect(inv!.customer_id).toBe(cust!.id);
});

test("applyCustomerWebhook upserts the single customer", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-w2", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  const fetchFn = vi.fn(async () => jsonResponse({ Customer: { Id: "20", DisplayName: "Solo Cust", PrimaryPhone: { FreeFormNumber: "229-555-0199" } } }));
  await applyCustomerWebhook(deps(fetchFn), org, "20");
  const { data } = await svc.from("customers").select("name, phone").eq("org_id", org).eq("qbo_id", "20").single();
  expect(data!.name).toBe("Solo Cust");
  expect(data!.phone).toBe("229-555-0199");
});

test("runCdcCatchup upserts changed entities and advances last_cdc_time", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-w3", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });

  const fetchFn = vi.fn(async (url: string) => {
    if (String(url).includes("/cdc?")) {
      return jsonResponse({ CDCResponse: [{ QueryResponse: [
        { Invoice: [{ Id: "400", DocNumber: "70", TotalAmt: "5", Balance: "0", DueDate: "2026-01-01", CustomerRef: { value: "30" } }] },
        { Customer: [{ Id: "30", DisplayName: "CDC Cust" }] },
      ] }] });
    }
    throw new Error(`unexpected ${url}`);
  });

  const result = await runCdcCatchup(deps(fetchFn), org);
  expect(result).toEqual({ customers: 1, invoices: 1 });

  const { data: inv } = await svc.from("invoices").select("status, customer_id").eq("org_id", org).eq("qbo_id", "400").single();
  expect(inv!.status).toBe("paid"); // balance 0
  const { data: cust } = await svc.from("customers").select("id").eq("org_id", org).eq("qbo_id", "30").single();
  expect(inv!.customer_id).toBe(cust!.id);

  const { data: conn } = await svc.from("qbo_connections").select("last_cdc_time").eq("org_id", org).single();
  expect(conn!.last_cdc_time).not.toBeNull();

  // changedSince should be present in the CDC URL
  expect(String(fetchFn.mock.calls[0][0])).toContain("changedSince=");
});
```

- [ ] **Step 2: Run to verify it FAILS**

Run: `cd nudgepay-app && npx vitest run tests/qbo-sync-cdc.test.ts`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Append the handlers to qbo-sync.server.ts**

Add these imports at the top of `nudgepay-app/app/lib/qbo-sync.server.ts` (extend the existing `qbo-api.server` import):

```ts
import { qboQuery, qboReadEntity, qboCdc, type QboApiConfig } from "./qbo-api.server";
```

Append to the end of `nudgepay-app/app/lib/qbo-sync.server.ts`:

```ts
// --- Webhook single-entity apply --------------------------------------------

export async function applyCustomerWebhook(
  deps: SyncDeps, orgId: string, qboCustomerId: string,
): Promise<void> {
  const { accessToken, realmId } = await getValidAccessToken(
    deps.fetchFn, deps.service, deps.cfg, deps.key, orgId,
  );
  const c = await qboReadEntity(deps.fetchFn, deps.api, accessToken, realmId, "Customer", qboCustomerId);
  if (!c) return; // deleted/unreadable — nothing to upsert
  await upsertCustomers(deps.service, [mapQboCustomer(c, orgId)]);
}

export async function applyInvoiceWebhook(
  deps: SyncDeps, orgId: string, qboInvoiceId: string,
): Promise<void> {
  const { accessToken, realmId } = await getValidAccessToken(
    deps.fetchFn, deps.service, deps.cfg, deps.key, orgId,
  );
  const inv = await qboReadEntity(deps.fetchFn, deps.api, accessToken, realmId, "Invoice", qboInvoiceId);
  if (!inv) return;

  // Ensure the invoice's customer exists locally so the FK resolves.
  const qboCustomerId = inv?.CustomerRef?.value ? String(inv.CustomerRef.value) : null;
  let customerId: string | null = null;
  if (qboCustomerId) {
    const c = await qboReadEntity(deps.fetchFn, deps.api, accessToken, realmId, "Customer", qboCustomerId);
    if (c) await upsertCustomers(deps.service, [mapQboCustomer(c, orgId)]);
    const idMap = await customerIdMap(deps.service, orgId, [qboCustomerId]);
    customerId = idMap.get(qboCustomerId) ?? null;
  }
  await upsertInvoices(deps.service, [mapQboInvoice(inv, orgId, customerId, new Date())]);
}

// --- CDC catch-up -----------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runCdcCatchup(
  deps: SyncDeps, orgId: string,
): Promise<{ customers: number; invoices: number }> {
  const { accessToken, realmId } = await getValidAccessToken(
    deps.fetchFn, deps.service, deps.cfg, deps.key, orgId,
  );
  const { data: conn } = await deps.service.from("qbo_connections")
    .select("last_cdc_time").eq("org_id", orgId).maybeSingle();

  // Default to a 7-day window on first run; never request beyond CDC's 30-day
  // lookback limit.
  const sinceMs = conn?.last_cdc_time
    ? new Date(conn.last_cdc_time as string).getTime()
    : Date.now() - 7 * DAY_MS;
  const minMs = Date.now() - 30 * DAY_MS;
  const changedSince = new Date(Math.max(sinceMs, minMs)).toISOString();

  const { invoices, customers } = await qboCdc(deps.fetchFn, deps.api, accessToken, realmId, changedSince);

  const customerRows = customers.map((c) => mapQboCustomer(c, orgId));
  await upsertCustomers(deps.service, customerRows);

  const custIds = invoices.map((i) => i?.CustomerRef?.value).filter(Boolean).map(String);
  const idMap = await customerIdMap(deps.service, orgId, custIds);
  const now = new Date();
  const invoiceRows = invoices.map((inv) =>
    mapQboInvoice(inv, orgId, idMap.get(String(inv?.CustomerRef?.value)) ?? null, now),
  );
  await upsertInvoices(deps.service, invoiceRows);

  const { error } = await deps.service.from("qbo_connections")
    .update({ last_cdc_time: now.toISOString(), last_sync_at: now.toISOString() })
    .eq("org_id", orgId);
  if (error) throw error;

  return { customers: customerRows.length, invoices: invoiceRows.length };
}
```

- [ ] **Step 4: Run to verify it PASSES + typecheck**

Run: `cd nudgepay-app && npx vitest run tests/qbo-sync-cdc.test.ts && npm run typecheck`
Expected: all 3 tests PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/qbo-sync.server.ts nudgepay-app/tests/qbo-sync-cdc.test.ts
git commit -m "feat: add webhook single-entity apply and bounded CDC catch-up"
```

---

## Task 6: Webhook signature verification + payload parse (+ verifier-token env)

**Files:**
- Create: `nudgepay-app/app/lib/qbo-webhook.server.ts`, `nudgepay-app/tests/qbo-webhook.test.ts`
- Modify: `nudgepay-app/app/lib/env.server.ts`, `nudgepay-app/.env.test` (gitignored), `nudgepay-app/wrangler.toml`

**Interfaces:**
- Produces:
  - `signQboPayload(rawBody: string, verifierToken: string): Promise<string>` — base64(HMAC-SHA256).
  - `verifyQboSignature(rawBody: string, signatureHeader: string | null, verifierToken: string): Promise<boolean>` — constant-time compare.
  - `type QboWebhookEntity = { realmId: string; entityName: string; id: string; operation: string }`
  - `parseQboWebhook(rawBody: string): QboWebhookEntity[]`
  - `getQboEnv` gains required `QBO_WEBHOOK_VERIFIER_TOKEN`.

- [ ] **Step 1: Add the verifier token to the env accessor**

In `nudgepay-app/app/lib/env.server.ts`, add the field to `QboEnv` and `getQboEnv`:

```ts
export type QboEnv = {
  QBO_CLIENT_ID: string;
  QBO_CLIENT_SECRET: string;
  QBO_REDIRECT_URI: string;
  QBO_ENCRYPTION_KEY: string; // base64 of 32 random bytes (AES-256)
  QBO_WEBHOOK_VERIFIER_TOKEN: string; // Intuit webhook verifier token
  QBO_SANDBOX: boolean;
};

export function getQboEnv(context: { cloudflare: { env: Record<string, string> } }): QboEnv {
  const e = context.cloudflare.env;
  const required = [
    "QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REDIRECT_URI",
    "QBO_ENCRYPTION_KEY", "QBO_WEBHOOK_VERIFIER_TOKEN",
  ];
  for (const k of required) {
    if (!e[k]) throw new Error(`Missing required env var: ${k}`);
  }
  return {
    QBO_CLIENT_ID: e.QBO_CLIENT_ID,
    QBO_CLIENT_SECRET: e.QBO_CLIENT_SECRET,
    QBO_REDIRECT_URI: e.QBO_REDIRECT_URI,
    QBO_ENCRYPTION_KEY: e.QBO_ENCRYPTION_KEY,
    QBO_WEBHOOK_VERIFIER_TOKEN: e.QBO_WEBHOOK_VERIFIER_TOKEN,
    QBO_SANDBOX: e.QBO_SANDBOX !== "false", // default true
  };
}
```

- [ ] **Step 2: Add the local env var + document the secret**

Append to `nudgepay-app/.env.test` (gitignored — a dummy token is fine; webhook HTTP is exercised via the module's own signing helper):

```
QBO_WEBHOOK_VERIFIER_TOKEN=test-verifier-token
```

In `nudgepay-app/wrangler.toml`, extend the secrets comment so the new secret is documented:

```toml
# Secrets (wrangler secret put): SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY,
# QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, QBO_ENCRYPTION_KEY,
# QBO_WEBHOOK_VERIFIER_TOKEN
```

- [ ] **Step 3: Write the failing tests**

Create `nudgepay-app/tests/qbo-webhook.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  signQboPayload, verifyQboSignature, parseQboWebhook,
} from "../app/lib/qbo-webhook.server";

const TOKEN = "test-verifier-token";

test("verifyQboSignature accepts a signature the module itself produced", async () => {
  // Round-trip: HMAC-SHA256(token, body) base64 == intuit-signature header.
  // (The exact algorithm vs Intuit is confirmed in the live-sandbox doc.)
  const body = JSON.stringify({ eventNotifications: [] });
  const sig = await signQboPayload(body, TOKEN);
  expect(await verifyQboSignature(body, sig, TOKEN)).toBe(true);
});

test("verifyQboSignature rejects a tampered body", async () => {
  const body = JSON.stringify({ eventNotifications: [{ realmId: "1" }] });
  const sig = await signQboPayload(body, TOKEN);
  expect(await verifyQboSignature(body + "x", sig, TOKEN)).toBe(false);
});

test("verifyQboSignature rejects the wrong token", async () => {
  const body = "payload";
  const sig = await signQboPayload(body, TOKEN);
  expect(await verifyQboSignature(body, sig, "other-token")).toBe(false);
});

test("verifyQboSignature rejects a missing header", async () => {
  expect(await verifyQboSignature("body", null, TOKEN)).toBe(false);
});

test("parseQboWebhook flattens entities across event notifications", () => {
  const body = JSON.stringify({
    eventNotifications: [
      { realmId: "9130", dataChangeEvent: { entities: [
        { name: "Invoice", id: "100", operation: "Update" },
        { name: "Customer", id: "5", operation: "Create" },
      ] } },
      { realmId: "9131", dataChangeEvent: { entities: [
        { name: "Invoice", id: "200", operation: "Delete" },
      ] } },
    ],
  });
  const out = parseQboWebhook(body);
  expect(out).toEqual([
    { realmId: "9130", entityName: "Invoice", id: "100", operation: "Update" },
    { realmId: "9130", entityName: "Customer", id: "5", operation: "Create" },
    { realmId: "9131", entityName: "Invoice", id: "200", operation: "Delete" },
  ]);
});

test("parseQboWebhook returns [] for malformed JSON", () => {
  expect(parseQboWebhook("{not json")).toEqual([]);
});
```

- [ ] **Step 4: Run to verify it FAILS**

Run: `cd nudgepay-app && npx vitest run tests/qbo-webhook.test.ts`
Expected: FAIL (module/functions missing).

- [ ] **Step 5: Implement qbo-webhook.server.ts**

Create `nudgepay-app/app/lib/qbo-webhook.server.ts`:

```ts
// QBO webhook signature verification + payload parsing.
// Intuit signs the raw request body with HMAC-SHA256 (key = the app's webhook
// verifier token) and sends base64(signature) in the `intuit-signature` header.
// Uses Web Crypto (Workers + Node 20+/vitest). No node:crypto.

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export async function signQboPayload(rawBody: string, verifierToken: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(verifierToken),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return b64encode(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyQboSignature(
  rawBody: string, signatureHeader: string | null, verifierToken: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const expected = await signQboPayload(rawBody, verifierToken);
  return timingSafeEqual(expected, signatureHeader);
}

export type QboWebhookEntity = {
  realmId: string;
  entityName: string;
  id: string;
  operation: string;
};

export function parseQboWebhook(rawBody: string): QboWebhookEntity[] {
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return [];
  }
  const out: QboWebhookEntity[] = [];
  for (const n of payload?.eventNotifications ?? []) {
    const realmId = String(n.realmId);
    for (const e of n?.dataChangeEvent?.entities ?? []) {
      out.push({
        realmId,
        entityName: String(e.name),
        id: String(e.id),
        operation: String(e.operation),
      });
    }
  }
  return out;
}
```

- [ ] **Step 6: Run to verify it PASSES + typecheck**

Run: `cd nudgepay-app && npx vitest run tests/qbo-webhook.test.ts && npm run typecheck`
Expected: all 6 tests PASS; typecheck exit 0.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/qbo-webhook.server.ts nudgepay-app/tests/qbo-webhook.test.ts nudgepay-app/app/lib/env.server.ts nudgepay-app/wrangler.toml
git commit -m "feat: add QBO webhook HMAC verification, payload parsing, verifier-token env"
```
(`.env.test` is gitignored — not committed.)

---

## Task 7: Webhook route `/webhooks/qbo`

**Files:**
- Create: `nudgepay-app/app/routes/webhooks.qbo.tsx`
- Modify: `nudgepay-app/app/routes.ts`, `nudgepay-app/tests/helpers.ts`
- Create: `nudgepay-app/tests/webhooks-route.test.ts`

**Interfaces:**
- Consumes: `verifyQboSignature`/`parseQboWebhook` (T6), `qboApiBaseUrl` (T2), `applyInvoiceWebhook`/`applyCustomerWebhook`/`SyncDeps` (T4/T5), `getEnv`/`getQboEnv`, `createSupabaseServiceClient`.
- Produces: POST `/webhooks/qbo` → verify signature (401 on failure, BEFORE any processing) → resolve `realmId → connected org` → apply each changed Invoice/Customer → 200. Processing error → 500 (Intuit retries; upserts are idempotent so retry is safe).

- [ ] **Step 1: Export the test env loader from helpers**

In `nudgepay-app/tests/helpers.ts`, export the parsed env map so route-level tests can build a `context`. Add after the existing `env` definition (the `const env = Object.fromEntries(...)` block):

```ts
export const TEST_ENV = env;
```

- [ ] **Step 2: Register the route**

In `nudgepay-app/app/routes.ts`, add inside the array (resource route — no default export):

```ts
  route("webhooks/qbo", "routes/webhooks.qbo.tsx"),
```

- [ ] **Step 3: Implement the webhook route**

Create `nudgepay-app/app/routes/webhooks.qbo.tsx`:

```tsx
import type { ActionFunctionArgs } from "react-router";
import { getEnv, getQboEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { verifyQboSignature, parseQboWebhook } from "../lib/qbo-webhook.server";
import { qboApiBaseUrl } from "../lib/qbo-api.server";
import {
  applyInvoiceWebhook, applyCustomerWebhook, type SyncDeps,
} from "../lib/qbo-sync.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const qbo = getQboEnv(context as any);
  const rawBody = await request.text();

  // Verify BEFORE touching the DB or QBO. Bad/absent signature => 401.
  const ok = await verifyQboSignature(
    rawBody, request.headers.get("intuit-signature"), qbo.QBO_WEBHOOK_VERIFIER_TOKEN,
  );
  if (!ok) return new Response("invalid signature", { status: 401 });

  const env = getEnv(context as any);
  const service = createSupabaseServiceClient(env);
  const deps: SyncDeps = {
    fetchFn: fetch,
    service,
    cfg: { clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI },
    api: { baseUrl: qboApiBaseUrl(qbo.QBO_SANDBOX) },
    key: qbo.QBO_ENCRYPTION_KEY,
  };

  try {
    for (const ev of parseQboWebhook(rawBody)) {
      const { data: conn } = await service.from("qbo_connections")
        .select("org_id").eq("realm_id", ev.realmId).eq("status", "connected").maybeSingle();
      if (!conn) continue; // unknown/disconnected realm — ignore
      const orgId = conn.org_id as string;
      if (ev.entityName === "Invoice") await applyInvoiceWebhook(deps, orgId, ev.id);
      else if (ev.entityName === "Customer") await applyCustomerWebhook(deps, orgId, ev.id);
      // other entity types are ignored in this phase
    }
  } catch {
    // Idempotent upserts make Intuit's retry safe.
    return new Response("processing error", { status: 500 });
  }
  return new Response("ok", { status: 200 });
}
```

- [ ] **Step 4: Write the route security test**

Create `nudgepay-app/tests/webhooks-route.test.ts`:

```ts
import { expect, test } from "vitest";
import { TEST_ENV } from "./helpers";
import { action } from "../app/routes/webhooks.qbo";

function ctx() {
  return { cloudflare: { env: TEST_ENV } } as any;
}

test("rejects a request with a bad signature (401) before any processing", async () => {
  const request = new Request("http://localhost/webhooks/qbo", {
    method: "POST",
    headers: { "intuit-signature": "not-a-valid-signature" },
    body: JSON.stringify({ eventNotifications: [] }),
  });
  const res = await action({ request, context: ctx(), params: {} } as any);
  expect(res.status).toBe(401);
});

test("rejects a request with no signature header (401)", async () => {
  const request = new Request("http://localhost/webhooks/qbo", {
    method: "POST",
    body: JSON.stringify({ eventNotifications: [] }),
  });
  const res = await action({ request, context: ctx(), params: {} } as any);
  expect(res.status).toBe(401);
});
```

- [ ] **Step 5: Run tests + typecheck + build**

Run: `cd nudgepay-app && npx vitest run tests/webhooks-route.test.ts && npm run typecheck && npm run build`
Expected: both tests PASS; typecheck exit 0; build succeeds (route file exists).

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/routes/webhooks.qbo.tsx nudgepay-app/app/routes.ts nudgepay-app/tests/helpers.ts nudgepay-app/tests/webhooks-route.test.ts
git commit -m "feat: add signature-gated /webhooks/qbo route with realm->org routing"
```

---

## Task 8: Manual "Refresh from QuickBooks" route + dashboard invoice list

**Files:**
- Create: `nudgepay-app/app/routes/api.qbo.refresh.tsx`
- Modify: `nudgepay-app/app/routes.ts`, `nudgepay-app/app/routes/dashboard.tsx`

**Interfaces:**
- Consumes: `requireUser`/`resolveOrg`, `getEnv`/`getQboEnv`, `qboApiBaseUrl` (T2), `syncOverdueInvoices`/`SyncDeps` (T4).
- Produces: POST `/api/qbo/refresh` (any org member) → run `syncOverdueInvoices` → redirect `/dashboard?sync=ok` (or `?sync=error`). Dashboard loader additionally returns the org's invoices (RLS-scoped user-client read), `lastSyncAt`, and the `?sync=` notice; component renders an invoice table + a Refresh button when connected.

- [ ] **Step 1: Register the route**

In `nudgepay-app/app/routes.ts`, add:

```ts
  route("api/qbo/refresh", "routes/api.qbo.refresh.tsx"),
```

- [ ] **Step 2: Implement the refresh route**

Create `nudgepay-app/app/routes/api.qbo.refresh.tsx`:

```tsx
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getQboEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { qboApiBaseUrl } from "../lib/qbo-api.server";
import { syncOverdueInvoices, type SyncDeps } from "../lib/qbo-sync.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const qbo = getQboEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return redirect("/onboarding", { headers });

  const service = createSupabaseServiceClient(env);
  const deps: SyncDeps = {
    fetchFn: fetch,
    service,
    cfg: { clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI },
    api: { baseUrl: qboApiBaseUrl(qbo.QBO_SANDBOX) },
    key: qbo.QBO_ENCRYPTION_KEY,
  };
  try {
    await syncOverdueInvoices(deps, org.org_id);
    return redirect("/dashboard?sync=ok", { headers });
  } catch {
    // e.g. QBO not connected, or a transient API error.
    return redirect("/dashboard?sync=error", { headers });
  }
}

export function loader() {
  return redirect("/dashboard");
}
```

- [ ] **Step 3: Wire the dashboard loader + component**

Replace `nudgepay-app/app/routes/dashboard.tsx` with:

```tsx
import { Form, useLoaderData, redirect, data, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";

type InvoiceRow = {
  id: string;
  qbo_doc_number: string | null;
  balance: number | null;
  due_date: string | null;
  status: string | null;
  customers: { name: string | null } | null;
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const { data: orgRow } = await supabase
    .from("organizations").select("name").eq("id", org.org_id).single();

  const service = createSupabaseServiceClient(env);
  const conn = await getConnectionStatus(service, org.org_id);
  const connected = conn?.status === "connected";

  let invoices: InvoiceRow[] = [];
  let lastSyncAt: string | null = null;
  if (connected) {
    const { data: connMeta } = await service.from("qbo_connections")
      .select("last_sync_at").eq("org_id", org.org_id).maybeSingle();
    lastSyncAt = (connMeta?.last_sync_at as string) ?? null;
    // RLS-scoped read via the USER client (membership-gated).
    const { data: inv } = await supabase
      .from("invoices")
      .select("id, qbo_doc_number, balance, due_date, status, customers(name)")
      .eq("org_id", org.org_id)
      .order("due_date", { ascending: true });
    invoices = (inv as unknown as InvoiceRow[]) ?? [];
  }

  const url = new URL(request.url);
  return data(
    {
      orgName: orgRow?.name ?? "(unknown)",
      email: user.email,
      role: org.role,
      qboConnected: connected,
      isOwner: org.role === "owner",
      notice: url.searchParams.get("qbo"),
      sync: url.searchParams.get("sync"),
      lastSyncAt,
      invoices,
    },
    { headers },
  );
}

export default function Dashboard() {
  const {
    orgName, email, role, qboConnected, isOwner, notice, sync, lastSyncAt, invoices,
  } = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 860, margin: "48px auto", fontFamily: "sans-serif" }}>
      <h1>{orgName}</h1>
      <p>Signed in as {email} ({role}).</p>
      <Form method="post" action="/logout"><button type="submit">Log out</button></Form>

      {notice && <p>QuickBooks: {notice}</p>}
      {sync && <p>Sync: {sync === "ok" ? "completed" : "failed"}</p>}

      <section>
        <h2>QuickBooks</h2>
        {qboConnected ? (
          <>
            <p>Status: Connected{lastSyncAt ? ` — last sync ${new Date(lastSyncAt).toLocaleString()}` : ""}</p>
            <Form method="post" action="/api/qbo/refresh">
              <button type="submit">Refresh from QuickBooks</button>
            </Form>
            {isOwner && (
              <Form method="post" action="/api/qbo/disconnect">
                <button type="submit">Disconnect QuickBooks</button>
              </Form>
            )}
          </>
        ) : (
          <>
            <p>Status: Not connected</p>
            {isOwner ? (
              <Form method="post" action="/api/qbo/connect">
                <button type="submit">Connect QuickBooks</button>
              </Form>
            ) : (
              <p>Ask an owner to connect QuickBooks.</p>
            )}
          </>
        )}
      </section>

      {qboConnected && (
        <section>
          <h2>Past-due invoices ({invoices.length})</h2>
          {invoices.length === 0 ? (
            <p>No invoices synced yet. Use “Refresh from QuickBooks”.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Invoice</th>
                  <th style={{ textAlign: "left" }}>Customer</th>
                  <th style={{ textAlign: "right" }}>Balance</th>
                  <th style={{ textAlign: "left" }}>Due</th>
                  <th style={{ textAlign: "left" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.qbo_doc_number ?? "—"}</td>
                    <td>{inv.customers?.name ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      {inv.balance != null ? `$${Number(inv.balance).toFixed(2)}` : "—"}
                    </td>
                    <td>{inv.due_date ?? "—"}</td>
                    <td>{inv.status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Verify typecheck + build + full suite**

Run: `cd nudgepay-app && npm run typecheck && npm run build && npx vitest run`
Expected: all exit 0 / green (every prior suite still passes).

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/routes/api.qbo.refresh.tsx nudgepay-app/app/routes.ts nudgepay-app/app/routes/dashboard.tsx
git commit -m "feat: add manual QBO refresh route and dashboard past-due invoice list"
```

---

## Task 9: CDC cron — scheduled Worker handler

**Files:**
- Create: `nudgepay-app/app/lib/qbo-cron.server.ts`, `nudgepay-app/tests/qbo-cron.test.ts`
- Modify: `nudgepay-app/workers/app.ts`, `nudgepay-app/wrangler.toml`

**Interfaces:**
- Consumes: `getEnv`/`getQboEnv`, `qboApiBaseUrl` (T2), `runCdcCatchup`/`SyncDeps` (T5), `createSupabaseServiceClient`.
- Produces:
  - `runScheduledCdc(cfEnv: Record<string, string>): Promise<{ orgs: number }>` — runs CDC catch-up for every connected org; a per-org failure is isolated (logged-and-skipped) so one bad org never aborts the batch.
  - A `scheduled` handler in `workers/app.ts` that calls it via `ctx.waitUntil`.
  - A `[triggers] crons` schedule in `wrangler.toml` (every 30 min, within the design's 15–30 min window and CDC's 30-day lookback).

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/qbo-cron.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { serviceClient, TEST_ENV } from "./helpers";
import { storeConnection } from "../app/lib/qbo-connection.server";
import { runScheduledCdc } from "../app/lib/qbo-cron.server";

const KEY = TEST_ENV.QBO_ENCRYPTION_KEY;
const svc = serviceClient();

async function freshOrg(): Promise<string> {
  const { data } = await svc.from("organizations").insert({ name: "Cron Org" }).select("id").single();
  return data!.id as string;
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("runScheduledCdc runs CDC for each connected org and ingests changes", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-cron-1", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });

  const fetchFn = vi.fn(async (url: string) => {
    if (String(url).includes("/cdc?")) {
      return jsonResponse({ CDCResponse: [{ QueryResponse: [
        { Invoice: [{ Id: "900", DocNumber: "1", TotalAmt: "5", Balance: "5", DueDate: "2026-01-01", CustomerRef: { value: "50" } }] },
        { Customer: [{ Id: "50", DisplayName: "Cron Cust" }] },
      ] }] });
    }
    throw new Error(`unexpected ${url}`);
  });
  const orig = globalThis.fetch;
  globalThis.fetch = fetchFn as any;
  try {
    const result = await runScheduledCdc(TEST_ENV);
    expect(result.orgs).toBeGreaterThanOrEqual(1);
  } finally {
    globalThis.fetch = orig;
  }

  const { data: inv } = await svc.from("invoices").select("status").eq("org_id", org).eq("qbo_id", "900").single();
  expect(inv!.status).toBe("overdue");
});
```

Note: `runScheduledCdc` builds its `SyncDeps` with the global `fetch` (it has no injectable seam — it is the top of the cron call stack), so the test swaps `globalThis.fetch` for the duration. All lower layers remain injectable.

- [ ] **Step 2: Run to verify it FAILS**

Run: `cd nudgepay-app && npx vitest run tests/qbo-cron.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement qbo-cron.server.ts**

Create `nudgepay-app/app/lib/qbo-cron.server.ts`:

```ts
// Scheduled CDC catch-up across all connected orgs. Invoked from the Worker's
// `scheduled` handler. Uses the global fetch (top of the call stack); all
// lower layers stay injectable for tests.
import { getEnv, getQboEnv } from "./env.server";
import { createSupabaseServiceClient } from "./supabase.server";
import { qboApiBaseUrl } from "./qbo-api.server";
import { runCdcCatchup, type SyncDeps } from "./qbo-sync.server";

export async function runScheduledCdc(
  cfEnv: Record<string, string>,
): Promise<{ orgs: number }> {
  const context = { cloudflare: { env: cfEnv } } as any;
  const env = getEnv(context);
  const qbo = getQboEnv(context);
  const service = createSupabaseServiceClient(env);

  const { data: conns, error } = await service.from("qbo_connections")
    .select("org_id").eq("status", "connected");
  if (error) throw error;

  const deps: SyncDeps = {
    fetchFn: fetch,
    service,
    cfg: { clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI },
    api: { baseUrl: qboApiBaseUrl(qbo.QBO_SANDBOX) },
    key: qbo.QBO_ENCRYPTION_KEY,
  };

  for (const c of conns ?? []) {
    try {
      await runCdcCatchup(deps, c.org_id as string);
    } catch (err) {
      // Isolate per-org failures so one bad connection doesn't abort the batch.
      console.error(`CDC catch-up failed for org ${c.org_id}`);
    }
  }
  return { orgs: (conns ?? []).length };
}
```

- [ ] **Step 4: Add the scheduled handler to the Worker**

Replace `nudgepay-app/workers/app.ts` with:

```ts
import { createRequestHandler } from "react-router";
import { runScheduledCdc } from "../app/lib/qbo-cron.server";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

export default {
	fetch(request, env, ctx) {
		return requestHandler(request, {
			cloudflare: { env, ctx },
		});
	},
	scheduled(_controller, env, ctx) {
		// Bounded CDC catch-up for all connected orgs.
		ctx.waitUntil(runScheduledCdc(env as unknown as Record<string, string>));
	},
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 5: Add the cron trigger to wrangler.toml**

In `nudgepay-app/wrangler.toml`, append:

```toml
[triggers]
# CDC catch-up every 30 min (design §6: 15-30 min; within CDC's 30-day lookback).
crons = ["*/30 * * * *"]
```

- [ ] **Step 6: Run test + typecheck + build**

Run: `cd nudgepay-app && npx vitest run tests/qbo-cron.test.ts && npm run typecheck && npm run build`
Expected: test PASSES; typecheck exit 0; build succeeds.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/qbo-cron.server.ts nudgepay-app/tests/qbo-cron.test.ts nudgepay-app/workers/app.ts nudgepay-app/wrangler.toml
git commit -m "feat: add scheduled CDC catch-up cron over all connected orgs"
```

---

## Task 10: Live-sandbox verification doc (sync + webhooks + CDC)

**Files:**
- Create: `docs/superpowers/phase2b-live-sandbox-verification.md`

**Interfaces:** docs only — no code.

- [ ] **Step 1: Write the manual verification guide**

Create `docs/superpowers/phase2b-live-sandbox-verification.md` documenting the steps to verify sync end-to-end against a real Intuit **sandbox** WHEN credentials are available (deferred per the "mock QBO now" posture). Cover exactly:

1. **Prereqs:** complete Phase 2A live-sandbox connect first (`docs/superpowers/phase2a-live-sandbox-verification.md`); the org must be `status=connected` in `qbo_connections`. A public HTTPS tunnel (`cloudflared`/`ngrok`) or the deployed Workers URL is required — Intuit cannot reach `localhost` for webhooks.
2. **Backfill / manual refresh:** in the sandbox company, create a few invoices with `Balance > 0` and a `DueDate` in the past. Log in as a member → dashboard → **Refresh from QuickBooks** → confirm redirect `/dashboard?sync=ok`, the past-due table populates, `qbo_connections.last_sync_at` is set, and `invoices.qbo_id`/`customer_id` are populated (no NULL `qbo_id`).
3. **Idempotency:** click Refresh again → row counts unchanged; edit an invoice balance in QBO, Refresh → the existing row updates in place (no duplicate).
4. **Webhooks:** in the Intuit Developer portal, set the webhook endpoint to `https://<host>/webhooks/qbo`, subscribe to `Invoice` + `Customer`, and copy the **Webhook Verifier Token** into `QBO_WEBHOOK_VERIFIER_TOKEN` (`wrangler secret put` / `.dev.vars`). Change an invoice in the sandbox → confirm a near-real-time upsert and that a request with a wrong `intuit-signature` returns 401.
5. **CDC cron:** trigger the schedule locally with `npx wrangler dev --test-scheduled` then `curl "http://localhost:8787/__scheduled?cron=*/30+*+*+*+*"`; confirm changed entities since `last_cdc_time` are ingested and `last_cdc_time` advances. Note CDC's 30-day lookback / 1000-object limits.
6. **Minor-version note:** the client pins `minorversion=65`; confirm it against the current Intuit Accounting API docs and bump if Intuit deprecates it.

- [ ] **Step 2: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add docs/superpowers/phase2b-live-sandbox-verification.md
git commit -m "docs: add Phase 2B live QBO sync/webhook/CDC verification guide"
```

---

## Phase 2B Definition of Done

- `npm run typecheck`, `npm run build`, and `npx vitest run` all pass (no manual reset needed).
- Initial/manual backfill (`syncOverdueInvoices`) pulls overdue invoices + their customers, idempotently, with resolved FKs and `last_sync_at` stamped — proven by `qbo-sync.test.ts`.
- Webhook single-entity apply + bounded CDC catch-up upsert changed entities and advance `last_cdc_time` — proven by `qbo-sync-cdc.test.ts`.
- Webhook route rejects bad/absent signatures with 401 before any processing — proven by `webhooks-route.test.ts`; helpers verified by `qbo-webhook.test.ts`.
- Every sync upsert sets a non-null `qbo_id` and money is NaN-guarded (carry-forwards honored).
- Dashboard shows the synced past-due invoice list (RLS-scoped read) + a Refresh button + last-sync time.
- CDC cron handler runs catch-up for all connected orgs, isolating per-org failures — proven by `qbo-cron.test.ts`; `[triggers] crons` registered.
- Live sandbox sync/webhook/CDC documented as the deferred manual step.

## Out of Scope (later phases / explicit deferrals)

- **GCM AAD binding** of token ciphertext to field/record (Phase 2A "future v2" minor). Not required for sync correctness and not an Intuit requirement (encryption-at-rest is already satisfied). Recommend a dedicated crypto-hardening pass; deferred here to keep this phase's blast radius on sync. **Flag for the human at the pre-flight review.**
- **Pagination beyond 1000 objects** per query/CDC response. Chancey carries 125–175 invoices (well under the cap); `syncOverdueInvoices` returns `truncated: true` if a page hits the limit so it is never a silent cap. Multi-page paging is deferred until a tenant needs it.
- **Twilio SMS** (send/inbound/status, consent/opt-out) — Phase 3.
- **Live Intuit production credentials + app-assessment submission** — Phase 4.
- **Deletes:** webhook `Delete` operations are currently ignored (we upsert on Create/Update). Soft-deleting/marking invoices removed in QBO is deferred; flag if Chancey needs voided-invoice cleanup.

---

## Self-Review (author)

- **Spec coverage (design §6 "Sync strategy"):** webhooks → `/webhooks/qbo` signature-verified (T6/T7) ✓; CDC on a Cloudflare Cron Trigger using `last_cdc_time` with 30-day/1000 limits (T5/T9) ✓; manual "Refresh from QuickBooks" hitting real per-org sync (T8) ✓; initial overdue-invoice backfill (T4) ✓; idempotent upserts keyed on `qbo_id` (T4/T5) ✓. Error handling (design §9): verify→fast-2xx→process, idempotent redelivery, token-expiry refresh via 2A `getValidAccessToken` ✓.
- **Placeholder scan:** none — every code/SQL/test/doc step is complete and concrete.
- **Type consistency:** `SyncDeps` defined in T4 and consumed unchanged in T5/T7/T8/T9; `QboApiConfig` (T2) used in `SyncDeps.api` and all route/cron deps; `CustomerUpsert`/`InvoiceUpsert` (T3) returned by mappers and accepted by `upsertCustomers`/`upsertInvoices` (T4); `QboWebhookEntity` (T6) consumed by the webhook route (T7); `getQboEnv` gains `QBO_WEBHOOK_VERIFIER_TOKEN` (T6) consumed by T7/T9; mapper/sync/api signatures match every test call site.
- **Known risks to verify at execution:** (1) the Supabase FK-embed `customers(name)` returns an object (many-to-one) — typed as `{ name } | null` and cast in the loader; if PostgREST returns an array under some relationship inference, adjust the render to `inv.customers?.[0]?.name`. (2) `runScheduledCdc` uses the global `fetch` (no injectable seam at the cron top) — the cron test swaps `globalThis.fetch`; this is the one place a test touches the global. (3) Adding `QBO_WEBHOOK_VERIFIER_TOKEN` as *required* in `getQboEnv` means the existing connect/disconnect/callback routes now also require it at runtime — `.env.test` and the wrangler secret docs are updated so this is satisfied in every environment.
- **Pre-flight note for the executor:** the GCM-AAD deferral (Out of Scope) is the one item that conflicts with a literal reading of the Phase 2A carry-forward ("add … GCM AAD binding when `getValidAccessToken` gets its first caller"). Per subagent-driven-development's plan-conflict rule, surface this to the human at pre-flight: honor the NaN-guard now (done in T3) and defer AAD to a crypto-hardening pass, or fold AAD into this phase.
