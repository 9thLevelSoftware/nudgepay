# NudgePay Phase 2A — QBO OAuth & Connection Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org owner securely connect, refresh, and disconnect a QuickBooks Online company — with OAuth 2.0 hardened to Intuit's requirements (CSRF nonce, redirecting callback, encrypted token storage, working revoke) — all built behind a mockable QBO HTTP boundary so it is fully unit/integration-tested on the local Docker stack with NO live Intuit credentials.

**Architecture:** A thin, injectable QBO HTTP client (`qbo-client.server.ts`) isolates every call to Intuit so tests pass a mock `fetch`. AES-GCM (Web Crypto) encrypts refresh/access tokens at rest as base64 text in `qbo_connections`. A single-use `oauth_states` row carries the CSRF nonce + connecting `org_id` across the redirect. Routes are thin wrappers over tested server helpers; the live sandbox round-trip is a documented manual step for later.

**Tech Stack:** React Router v7 (Cloudflare Workers), TypeScript, Supabase (service-role client for privileged QBO writes), Web Crypto AES-GCM, Vitest. Builds on Phase 1 (merged to `main`).

## Global Constraints

- Language: TypeScript, `strict: true`. Work in `nudgepay-app/`.
- Runtime: Cloudflare Workers (`nodejs_compat`). Encryption uses the global `crypto.subtle` / `crypto.getRandomValues` Web Crypto API (works in Workers AND in Node 20+/vitest) — do NOT import `node:crypto`.
- **No live Intuit calls in code or tests.** Every QBO HTTP call goes through a function that accepts an injectable `fetchFn: typeof fetch`; tests pass a mock. Routes pass the real global `fetch`.
- Service-role client only, server-side, for all `qbo_connections` / `oauth_states` writes (these are privileged; same boundary as Phase 1). The encryption key and QBO secrets are read only in `*.server.ts` via the QBO env accessor — never shipped to the browser.
- Existing `getEnv` validates only `SUPABASE_*` and MUST stay that way (login/signup/etc. depend on it). QBO vars get a SEPARATE accessor `getQboEnv`.
- Tokens stored ENCRYPTED. Plaintext access/refresh tokens or realmId must never be written to Postgres or logs.
- Reuse Phase 1 conventions verbatim: `getEnv(context as any)`, `useActionData<typeof action>()` / `useLoaderData<typeof loader>()`, auth redirects carry `{ headers }`, `requireUser`/`resolveOrg` from `session.server.ts`, `createSupabaseServiceClient`/`createSupabaseUserClient` from `supabase.server.ts`.
- Owner-only: connecting/disconnecting QBO requires `resolveOrg(...).role === 'owner'`.
- Tests run against the local Supabase stack; suite must stay green via the existing `tests/global-setup.ts` (extend its truncation list to include `oauth_states`).
- Conventional Commits on a `phase2a-qbo-oauth` branch (NOT main).

## Phase 1 Interfaces This Builds On (verified against merged code)

- `app/lib/env.server.ts` → `getEnv(context)`, `type AppEnv = { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY }`.
- `app/lib/supabase.server.ts` → `createSupabaseServiceClient(env): SupabaseClient`, `createSupabaseUserClient(request, env): { supabase, headers }`.
- `app/lib/session.server.ts` → `requireUser(request, env): { supabase, headers, user }`, `resolveOrg(supabase, userId): { org_id, role } | null`.
- `app/lib/orgs.server.ts` → `createOrgForUser`, `acceptInvite` (pattern reference for service-client helpers + tests).
- `tests/helpers.ts` → `serviceClient()`, `makeUserClient(email)`; `tests/global-setup.ts` truncates tenant tables.
- Schema: `qbo_connections(org_id unique, realm_id text, access_token_enc, refresh_token_enc, token_expires_at, last_cdc_time, last_sync_at, status default 'disconnected')`; `customers`/`invoices` have `unique(org_id, qbo_id)`.
- QBO endpoints (from the prototype `nudgepay-backend/server.js`, reference): auth `https://appcenter.intuit.com/connect/oauth2`; token `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`; revoke `https://developer.api.intuit.com/v2/oauth2/tokens/revoke`; scope `com.intuit.quickbooks.accounting`.

---

## File Structure

```
nudgepay-app/
  app/lib/
    env.server.ts            # MODIFY: add getQboEnv + QboEnv type
    crypto.server.ts         # NEW: AES-GCM encrypt/decrypt (Web Crypto)
    qbo-client.server.ts     # NEW: token exchange/refresh/revoke (injectable fetch)
    qbo-connection.server.ts # NEW: store/load/refresh/disconnect connection (encrypts)
    oauth-state.server.ts    # NEW: createState / consumeState (single-use nonce)
  app/routes/
    api.qbo.connect.tsx      # NEW: owner-gated; create state; redirect to Intuit
    auth.qbo.callback.tsx    # NEW: verify state; exchange; store; redirect
    api.qbo.disconnect.tsx   # NEW: owner-gated; revoke + clear
    dashboard.tsx            # MODIFY: show QBO status + Connect/Disconnect
    routes.ts                # MODIFY: register the three new routes
  supabase/migrations/
    0004_qbo_oauth.sql       # NEW: oauth_states table; token cols bytea->text
  tests/
    global-setup.ts          # MODIFY: add oauth_states to truncation
    crypto.test.ts           # NEW
    qbo-client.test.ts       # NEW
    qbo-connection.test.ts   # NEW
    oauth-state.test.ts      # NEW
  .env.test                  # MODIFY (gitignored): add QBO_* + QBO_ENCRYPTION_KEY
  wrangler.toml              # MODIFY: add QBO_SANDBOX var + doc secret names
docs/superpowers/
  phase2a-live-sandbox-verification.md  # NEW: manual steps for real sandbox
```

---

## Task 1: QBO env accessor + local secrets

**Files:**
- Modify: `nudgepay-app/app/lib/env.server.ts`
- Modify: `nudgepay-app/.env.test` (gitignored), `nudgepay-app/wrangler.toml`

**Interfaces:**
- Consumes: existing `getEnv`.
- Produces: `type QboEnv = { QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, QBO_ENCRYPTION_KEY, QBO_SANDBOX: boolean }` and `getQboEnv(context): QboEnv`. Existing `getEnv`/`AppEnv` UNCHANGED.

- [ ] **Step 1: Add the QBO env accessor**

Append to `nudgepay-app/app/lib/env.server.ts`:

```ts
export type QboEnv = {
  QBO_CLIENT_ID: string;
  QBO_CLIENT_SECRET: string;
  QBO_REDIRECT_URI: string;
  QBO_ENCRYPTION_KEY: string; // base64 of 32 random bytes (AES-256)
  QBO_SANDBOX: boolean;
};

export function getQboEnv(context: { cloudflare: { env: Record<string, string> } }): QboEnv {
  const e = context.cloudflare.env;
  const required = ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REDIRECT_URI", "QBO_ENCRYPTION_KEY"];
  for (const k of required) {
    if (!e[k]) throw new Error(`Missing required env var: ${k}`);
  }
  return {
    QBO_CLIENT_ID: e.QBO_CLIENT_ID,
    QBO_CLIENT_SECRET: e.QBO_CLIENT_SECRET,
    QBO_REDIRECT_URI: e.QBO_REDIRECT_URI,
    QBO_ENCRYPTION_KEY: e.QBO_ENCRYPTION_KEY,
    QBO_SANDBOX: e.QBO_SANDBOX !== "false", // default true
  };
}
```

- [ ] **Step 2: Generate an encryption key and add local env vars**

Generate a 32-byte base64 key:

```bash
openssl rand -base64 32
```

Append to `nudgepay-app/.env.test` (gitignored — for tests; dummy client creds are fine since QBO HTTP is mocked):

```
QBO_CLIENT_ID=test-client-id
QBO_CLIENT_SECRET=test-client-secret
QBO_REDIRECT_URI=http://localhost:5173/auth/qbo/callback
QBO_ENCRYPTION_KEY=<paste the openssl output>
QBO_SANDBOX=true
```

- [ ] **Step 3: Document the wrangler vars/secrets**

In `nudgepay-app/wrangler.toml`, under `[vars]` add the non-secret default and a comment listing the secrets to set via `wrangler secret put` for real local dev / deploy:

```toml
[vars]
SUPABASE_URL = "http://127.0.0.1:54321"
QBO_SANDBOX = "true"
# Secrets (wrangler secret put): SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY,
# QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, QBO_ENCRYPTION_KEY
```

- [ ] **Step 4: Verify typecheck**

Run: `cd nudgepay-app && npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/env.server.ts nudgepay-app/wrangler.toml
git commit -m "feat: add QBO env accessor (getQboEnv) and wrangler secret docs"
```
(`.env.test` is gitignored — not committed.)

---

## Task 2: Migration — oauth_states + token columns to text

**Files:**
- Create: `nudgepay-app/supabase/migrations/0004_qbo_oauth.sql`
- Modify: `nudgepay-app/tests/global-setup.ts`

**Interfaces:**
- Produces: `oauth_states(state pk, org_id fk, created_at, expires_at)` (RLS on, no policies → service-only); `qbo_connections.access_token_enc` / `refresh_token_enc` retyped to `text` (base64 ciphertext).

- [ ] **Step 1: Write the migration**

Create `nudgepay-app/supabase/migrations/0004_qbo_oauth.sql`:

```sql
-- Single-use CSRF nonce carrying the connecting org across the OAuth redirect.
create table oauth_states (
  state text primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
-- Transient + privileged: RLS on, no policies. Only the service role (which
-- bypasses RLS) reads/writes this table from server code.
alter table oauth_states enable row level security;

-- Store AES-GCM ciphertext as base64 text (supabase-js handles text cleanly;
-- bytea over PostgREST is error-prone). Columns are empty in all envs, so the
-- bytea->text change is safe.
alter table qbo_connections
  alter column access_token_enc type text using null,
  alter column refresh_token_enc type text using null;
```

- [ ] **Step 2: Add oauth_states to test cleanup**

In `nudgepay-app/tests/global-setup.ts`, add `oauth_states` to the list of tables the cleanup truncates/deletes (place it among the leaf tables, before `organizations`). Match the existing deletion style in that file.

- [ ] **Step 3: Apply and verify**

```bash
cd nudgepay-app
npx supabase db reset
```
Expected: applies 0001–0004 with no error. Confirm `oauth_states` exists and `qbo_connections.access_token_enc` is type `text` (e.g. `npx supabase db query` selecting from `information_schema.columns` where table_name='qbo_connections').

- [ ] **Step 4: Confirm suite still green**

Run: `npx vitest run`
Expected: 9/9 still pass (global-setup change didn't break isolation).

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/supabase/migrations/0004_qbo_oauth.sql nudgepay-app/tests/global-setup.ts
git commit -m "feat: add oauth_states table and store QBO tokens as base64 text"
```

---

## Task 3: Token encryption (AES-GCM) — load-bearing security

**Files:**
- Create: `nudgepay-app/app/lib/crypto.server.ts`, `nudgepay-app/tests/crypto.test.ts`

**Interfaces:**
- Produces: `encryptSecret(plaintext: string, base64Key: string): Promise<string>` returning `v1:<ivB64>:<ctB64>`, and `decryptSecret(payload: string, base64Key: string): Promise<string>`.

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/crypto.test.ts`:

```ts
import { expect, test } from "vitest";
import { encryptSecret, decryptSecret } from "../app/lib/crypto.server";

// A fixed 32-byte (AES-256) base64 key for deterministic tests.
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

test("round-trips a secret", async () => {
  const ct = await encryptSecret("refresh-token-123", KEY);
  expect(ct).not.toContain("refresh-token-123"); // not plaintext
  expect(ct.startsWith("v1:")).toBe(true);
  expect(await decryptSecret(ct, KEY)).toBe("refresh-token-123");
});

test("two encryptions of the same plaintext differ (random IV)", async () => {
  const a = await encryptSecret("x", KEY);
  const b = await encryptSecret("x", KEY);
  expect(a).not.toBe(b);
});

test("decrypt with the wrong key fails", async () => {
  const ct = await encryptSecret("secret", KEY);
  const wrong = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
  await expect(decryptSecret(ct, wrong)).rejects.toThrow();
});

test("tampered ciphertext fails the auth tag", async () => {
  const ct = await encryptSecret("secret", KEY);
  const parts = ct.split(":");
  const flipped = parts[2].slice(0, -2) + (parts[2].endsWith("A") ? "B=" : "A=");
  await expect(decryptSecret(`v1:${parts[1]}:${flipped}`, KEY)).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify it FAILS**

Run: `cd nudgepay-app && npx vitest run tests/crypto.test.ts`
Expected: FAIL (module not found / functions undefined).

- [ ] **Step 3: Implement crypto.server.ts**

Create `nudgepay-app/app/lib/crypto.server.ts`:

```ts
// AES-256-GCM using the Web Crypto API (available in Cloudflare Workers and
// Node 20+/vitest via the global `crypto`). Do NOT import node:crypto.

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = b64decode(base64Key);
  if (raw.length !== 32) throw new Error("QBO_ENCRYPTION_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `v1:${b64encode(iv)}:${b64encode(new Uint8Array(ct))}`;
}

export async function decryptSecret(payload: string, base64Key: string): Promise<string> {
  const [version, ivB64, ctB64] = payload.split(":");
  if (version !== "v1") throw new Error("Unsupported ciphertext version");
  const key = await importKey(base64Key);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64decode(ivB64) },
    key,
    b64decode(ctB64),
  );
  return new TextDecoder().decode(pt);
}
```

- [ ] **Step 4: Run to verify it PASSES**

Run: `cd nudgepay-app && npx vitest run tests/crypto.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/crypto.server.ts nudgepay-app/tests/crypto.test.ts
git commit -m "feat: add AES-256-GCM token encryption helpers with tamper tests"
```

---

## Task 4: QBO HTTP client (injectable fetch)

**Files:**
- Create: `nudgepay-app/app/lib/qbo-client.server.ts`, `nudgepay-app/tests/qbo-client.test.ts`

**Interfaces:**
- Produces:
  - `type QboTokens = { accessToken: string; refreshToken: string; expiresIn: number }`
  - `type QboHttpConfig = { clientId: string; clientSecret: string; redirectUri: string }`
  - `buildAuthorizeUrl(cfg, state): string`
  - `exchangeCodeForTokens(fetchFn, cfg, code): Promise<QboTokens>`
  - `refreshTokens(fetchFn, cfg, refreshToken): Promise<QboTokens>`
  - `revokeToken(fetchFn, cfg, token): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/qbo-client.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import {
  buildAuthorizeUrl, exchangeCodeForTokens, refreshTokens, revokeToken,
} from "../app/lib/qbo-client.server";

const cfg = { clientId: "cid", clientSecret: "secret", redirectUri: "http://localhost:5173/auth/qbo/callback" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("buildAuthorizeUrl includes client_id, redirect_uri, scope, state, response_type", () => {
  const url = new URL(buildAuthorizeUrl(cfg, "nonce123"));
  expect(url.searchParams.get("client_id")).toBe("cid");
  expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
  expect(url.searchParams.get("state")).toBe("nonce123");
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("scope")).toContain("accounting");
});

test("exchangeCodeForTokens posts auth code and parses tokens", async () => {
  const fetchFn = vi.fn(async () =>
    jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600 }));
  const tokens = await exchangeCodeForTokens(fetchFn as any, cfg, "auth-code");
  expect(tokens).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
  const [, init] = fetchFn.mock.calls[0];
  expect((init as RequestInit).method).toBe("POST");
  expect(String((init as any).body)).toContain("grant_type=authorization_code");
  expect(String((init as any).body)).toContain("auth-code");
  expect((init as any).headers.Authorization).toMatch(/^Basic /);
});

test("refreshTokens sends grant_type=refresh_token and parses rotated tokens", async () => {
  const fetchFn = vi.fn(async () =>
    jsonResponse({ access_token: "at2", refresh_token: "rt2", expires_in: 3600 }));
  const tokens = await refreshTokens(fetchFn as any, cfg, "old-rt");
  expect(tokens.refreshToken).toBe("rt2");
  expect(String((fetchFn.mock.calls[0][1] as any).body)).toContain("grant_type=refresh_token");
});

test("exchangeCodeForTokens throws on non-200", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ error: "invalid_grant" }, 400));
  await expect(exchangeCodeForTokens(fetchFn as any, cfg, "bad")).rejects.toThrow();
});

test("revokeToken posts the token and resolves on 200", async () => {
  const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
  await revokeToken(fetchFn as any, cfg, "rt");
  expect(fetchFn).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run to verify it FAILS**

Run: `cd nudgepay-app && npx vitest run tests/qbo-client.test.ts`
Expected: FAIL (module/functions missing).

- [ ] **Step 3: Implement qbo-client.server.ts**

Create `nudgepay-app/app/lib/qbo-client.server.ts`:

```ts
const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const SCOPE = "com.intuit.quickbooks.accounting";

export type QboTokens = { accessToken: string; refreshToken: string; expiresIn: number };
export type QboHttpConfig = { clientId: string; clientSecret: string; redirectUri: string };

function basicAuth(cfg: QboHttpConfig): string {
  return "Basic " + btoa(`${cfg.clientId}:${cfg.clientSecret}`);
}

export function buildAuthorizeUrl(cfg: QboHttpConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    scope: SCOPE,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function postForTokens(
  fetchFn: typeof fetch, cfg: QboHttpConfig, body: URLSearchParams,
): Promise<QboTokens> {
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: basicAuth(cfg),
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`QBO token request failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

export function exchangeCodeForTokens(fetchFn: typeof fetch, cfg: QboHttpConfig, code: string) {
  return postForTokens(fetchFn, cfg, new URLSearchParams({
    grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri,
  }));
}

export function refreshTokens(fetchFn: typeof fetch, cfg: QboHttpConfig, refreshToken: string) {
  return postForTokens(fetchFn, cfg, new URLSearchParams({
    grant_type: "refresh_token", refresh_token: refreshToken,
  }));
}

export async function revokeToken(fetchFn: typeof fetch, cfg: QboHttpConfig, token: string): Promise<void> {
  const res = await fetchFn(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: basicAuth(cfg) },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(`QBO revoke failed: ${res.status}`);
}
```

- [ ] **Step 4: Run to verify it PASSES**

Run: `cd nudgepay-app && npx vitest run tests/qbo-client.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/qbo-client.server.ts nudgepay-app/tests/qbo-client.test.ts
git commit -m "feat: add injectable QBO OAuth client (authorize/exchange/refresh/revoke)"
```

---

## Task 5: Connection store/refresh/disconnect

**Files:**
- Create: `nudgepay-app/app/lib/qbo-connection.server.ts`, `nudgepay-app/tests/qbo-connection.test.ts`

**Interfaces:**
- Consumes: Task 3 crypto, Task 4 client, `createSupabaseServiceClient`, `QboEnv`.
- Produces:
  - `storeConnection(service, key, orgId, realmId, tokens): Promise<void>` — encrypts tokens, upserts `qbo_connections` (onConflict `org_id`), status `'connected'`.
  - `getConnectionStatus(service, orgId): Promise<{ status: string; realmId: string | null } | null>` — for the dashboard.
  - `getValidAccessToken(fetchFn, service, cfg, key, orgId): Promise<{ accessToken: string; realmId: string }>` — decrypts; if `token_expires_at` within 60s, refreshes via `refreshTokens`, persists the rotated refresh token + new expiry, returns fresh access token. Throws if not connected.
  - `disconnectConnection(fetchFn, service, cfg, key, orgId): Promise<void>` — decrypts refresh token, calls `revokeToken` (best-effort: swallow revoke HTTP failure but still clear), nulls tokens + sets status `'disconnected'`.

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/qbo-connection.test.ts`:

```ts
import { expect, test, vi, beforeEach } from "vitest";
import { serviceClient } from "./helpers";
import { decryptSecret } from "../app/lib/crypto.server";
import {
  storeConnection, getConnectionStatus, getValidAccessToken, disconnectConnection,
} from "../app/lib/qbo-connection.server";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const cfg = { clientId: "cid", clientSecret: "secret", redirectUri: "http://x/cb" };
const svc = serviceClient();

async function freshOrg(): Promise<string> {
  const { data } = await svc.from("organizations").insert({ name: "QBO Org" }).select("id").single();
  return data!.id as string;
}

test("storeConnection encrypts tokens at rest (no plaintext in DB)", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-1", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  const { data } = await svc.from("qbo_connections")
    .select("status, realm_id, access_token_enc, refresh_token_enc").eq("org_id", org).single();
  expect(data!.status).toBe("connected");
  expect(data!.realm_id).toBe("realm-1");
  expect(data!.refresh_token_enc).not.toContain("RT");
  expect(await decryptSecret(data!.access_token_enc, KEY)).toBe("AT");
  expect(await decryptSecret(data!.refresh_token_enc, KEY)).toBe("RT");
});

test("getValidAccessToken refreshes + persists rotated refresh token when expired", async () => {
  const org = await freshOrg();
  // Store already-expired token by passing negative expiry via a direct store then patch.
  await storeConnection(svc, KEY, org, "realm-2", { accessToken: "old", refreshToken: "oldRT", expiresIn: 3600 });
  await svc.from("qbo_connections").update({ token_expires_at: new Date(Date.now() - 1000).toISOString() }).eq("org_id", org);

  const fetchFn = vi.fn(async () =>
    new Response(JSON.stringify({ access_token: "newAT", refresh_token: "newRT", expires_in: 3600 }),
      { status: 200, headers: { "Content-Type": "application/json" } }));

  const { accessToken, realmId } = await getValidAccessToken(fetchFn as any, svc, cfg, KEY, org);
  expect(accessToken).toBe("newAT");
  expect(realmId).toBe("realm-2");
  // rotated refresh token persisted, encrypted
  const { data } = await svc.from("qbo_connections").select("refresh_token_enc").eq("org_id", org).single();
  expect(await decryptSecret(data!.refresh_token_enc, KEY)).toBe("newRT");
});

test("getValidAccessToken does NOT refresh when token is still valid", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-3", { accessToken: "validAT", refreshToken: "RT", expiresIn: 3600 });
  const fetchFn = vi.fn();
  const { accessToken } = await getValidAccessToken(fetchFn as any, svc, cfg, KEY, org);
  expect(accessToken).toBe("validAT");
  expect(fetchFn).not.toHaveBeenCalled();
});

test("disconnectConnection revokes and clears the row", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-4", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
  await disconnectConnection(fetchFn as any, svc, cfg, KEY, org);
  expect(fetchFn).toHaveBeenCalledOnce();
  const { data } = await svc.from("qbo_connections").select("status, access_token_enc").eq("org_id", org).single();
  expect(data!.status).toBe("disconnected");
  expect(data!.access_token_enc).toBeNull();
});
```

- [ ] **Step 2: Run to verify it FAILS**

Run: `cd nudgepay-app && npx vitest run tests/qbo-connection.test.ts`
Expected: FAIL (module/functions missing).

- [ ] **Step 3: Implement qbo-connection.server.ts**

Create `nudgepay-app/app/lib/qbo-connection.server.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptSecret, decryptSecret } from "./crypto.server";
import { refreshTokens, revokeToken, type QboHttpConfig, type QboTokens } from "./qbo-client.server";

export async function storeConnection(
  service: SupabaseClient, key: string, orgId: string, realmId: string, tokens: QboTokens,
): Promise<void> {
  const access_token_enc = await encryptSecret(tokens.accessToken, key);
  const refresh_token_enc = await encryptSecret(tokens.refreshToken, key);
  const token_expires_at = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
  const { error } = await service.from("qbo_connections").upsert({
    org_id: orgId, realm_id: realmId, access_token_enc, refresh_token_enc,
    token_expires_at, status: "connected",
  }, { onConflict: "org_id" });
  if (error) throw error;
}

export async function getConnectionStatus(
  service: SupabaseClient, orgId: string,
): Promise<{ status: string; realmId: string | null } | null> {
  const { data } = await service.from("qbo_connections")
    .select("status, realm_id").eq("org_id", orgId).maybeSingle();
  return data ? { status: data.status as string, realmId: (data.realm_id as string) ?? null } : null;
}

export async function getValidAccessToken(
  fetchFn: typeof fetch, service: SupabaseClient, cfg: QboHttpConfig, key: string, orgId: string,
): Promise<{ accessToken: string; realmId: string }> {
  const { data, error } = await service.from("qbo_connections")
    .select("realm_id, access_token_enc, refresh_token_enc, token_expires_at, status")
    .eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "connected" || !data.refresh_token_enc) {
    throw new Error("QBO not connected for this organization");
  }
  const realmId = data.realm_id as string;
  const expiresAt = new Date(data.token_expires_at as string).getTime();
  if (expiresAt > Date.now() + 60_000) {
    return { accessToken: await decryptSecret(data.access_token_enc as string, key), realmId };
  }
  // Refresh: tokens rotate — persist the new refresh token.
  const refreshToken = await decryptSecret(data.refresh_token_enc as string, key);
  const tokens = await refreshTokens(fetchFn, cfg, refreshToken);
  await storeConnection(service, key, orgId, realmId, tokens);
  return { accessToken: tokens.accessToken, realmId };
}

export async function disconnectConnection(
  fetchFn: typeof fetch, service: SupabaseClient, cfg: QboHttpConfig, key: string, orgId: string,
): Promise<void> {
  const { data } = await service.from("qbo_connections")
    .select("refresh_token_enc").eq("org_id", orgId).maybeSingle();
  if (data?.refresh_token_enc) {
    try {
      await revokeToken(fetchFn, cfg, await decryptSecret(data.refresh_token_enc as string, key));
    } catch {
      // Best-effort revoke: clear local tokens even if Intuit revoke errors.
    }
  }
  const { error } = await service.from("qbo_connections").update({
    access_token_enc: null, refresh_token_enc: null, token_expires_at: null,
    realm_id: null, status: "disconnected",
  }).eq("org_id", orgId);
  if (error) throw error;
}
```

- [ ] **Step 4: Run to verify it PASSES**

Run: `cd nudgepay-app && npx vitest run tests/qbo-connection.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/qbo-connection.server.ts nudgepay-app/tests/qbo-connection.test.ts
git commit -m "feat: add QBO connection store/refresh/disconnect with encrypted tokens"
```

---

## Task 6: OAuth state (single-use CSRF nonce)

**Files:**
- Create: `nudgepay-app/app/lib/oauth-state.server.ts`, `nudgepay-app/tests/oauth-state.test.ts`

**Interfaces:**
- Produces:
  - `createOAuthState(service, orgId, ttlSeconds = 600): Promise<string>` — random URL-safe nonce, inserts `oauth_states` row, returns the nonce.
  - `consumeOAuthState(service, state): Promise<string>` — looks up; if missing or expired throws; DELETES the row (single-use); returns `org_id`.

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/oauth-state.test.ts`:

```ts
import { expect, test } from "vitest";
import { serviceClient } from "./helpers";
import { createOAuthState, consumeOAuthState } from "../app/lib/oauth-state.server";

const svc = serviceClient();
async function freshOrg(): Promise<string> {
  const { data } = await svc.from("organizations").insert({ name: "State Org" }).select("id").single();
  return data!.id as string;
}

test("create then consume returns the org and is single-use", async () => {
  const org = await freshOrg();
  const state = await createOAuthState(svc, org);
  expect(state.length).toBeGreaterThan(16);
  expect(await consumeOAuthState(svc, state)).toBe(org);
  // second consume fails (row deleted) — prevents replay
  await expect(consumeOAuthState(svc, state)).rejects.toThrow();
});

test("unknown state is rejected", async () => {
  await expect(consumeOAuthState(svc, "does-not-exist")).rejects.toThrow();
});

test("expired state is rejected", async () => {
  const org = await freshOrg();
  const state = await createOAuthState(svc, org, -1); // already expired
  await expect(consumeOAuthState(svc, state)).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify it FAILS**

Run: `cd nudgepay-app && npx vitest run tests/oauth-state.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement oauth-state.server.ts**

Create `nudgepay-app/app/lib/oauth-state.server.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export async function createOAuthState(
  service: SupabaseClient, orgId: string, ttlSeconds = 600,
): Promise<string> {
  const state = randomState();
  const expires_at = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const { error } = await service.from("oauth_states").insert({ state, org_id: orgId, expires_at });
  if (error) throw error;
  return state;
}

export async function consumeOAuthState(service: SupabaseClient, state: string): Promise<string> {
  const { data, error } = await service.from("oauth_states")
    .select("org_id, expires_at").eq("state", state).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Invalid OAuth state");
  // single-use: delete regardless of expiry outcome
  await service.from("oauth_states").delete().eq("state", state);
  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    throw new Error("Expired OAuth state");
  }
  return data.org_id as string;
}
```

- [ ] **Step 4: Run to verify it PASSES**

Run: `cd nudgepay-app && npx vitest run tests/oauth-state.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/oauth-state.server.ts nudgepay-app/tests/oauth-state.test.ts
git commit -m "feat: add single-use OAuth state nonce with expiry + replay protection"
```

---

## Task 7: Connect route (`/api/qbo/connect`)

**Files:**
- Create: `nudgepay-app/app/routes/api.qbo.connect.tsx`
- Modify: `nudgepay-app/app/routes.ts`

**Interfaces:**
- Consumes: `requireUser`, `resolveOrg`, `getQboEnv`, `createSupabaseServiceClient`, `createOAuthState`, `buildAuthorizeUrl`.
- Produces: POST `/api/qbo/connect` → owner-gated → creates state → 302 to Intuit authorize URL.

- [ ] **Step 1: Register the route**

In `nudgepay-app/app/routes.ts`, add inside the array:

```ts
  route("api/qbo/connect", "routes/api.qbo.connect.tsx"),
  route("auth/qbo/callback", "routes/auth.qbo.callback.tsx"),
  route("api/qbo/disconnect", "routes/api.qbo.disconnect.tsx"),
```

(Register all three now; their files are created in Tasks 7–9. If you run `npm run build` before Tasks 8–9 exist it will fail — so build-verify this task AFTER creating all three files, or register each route in its own task. Recommended: add only the `connect` line here, add the others in Tasks 8/9.)

For THIS task add only:

```ts
  route("api/qbo/connect", "routes/api.qbo.connect.tsx"),
```

- [ ] **Step 2: Implement the connect route**

Create `nudgepay-app/app/routes/api.qbo.connect.tsx`:

```tsx
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getQboEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createOAuthState } from "../lib/oauth-state.server";
import { buildAuthorizeUrl } from "../lib/qbo-client.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const qbo = getQboEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org || org.role !== "owner") {
    return redirect("/dashboard?qbo=forbidden", { headers });
  }
  const service = createSupabaseServiceClient(env);
  const state = await createOAuthState(service, org.org_id);
  const url = buildAuthorizeUrl(
    { clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI },
    state,
  );
  return redirect(url, { headers });
}

// No loader/component: this is a POST-only action endpoint.
export function loader() {
  return redirect("/dashboard");
}
```

- [ ] **Step 3: Verify typecheck + build**

Run: `cd nudgepay-app && npm run typecheck && npm run build`
Expected: exit 0 (only `connect` is registered, its file exists).

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/routes/api.qbo.connect.tsx nudgepay-app/app/routes.ts
git commit -m "feat: add owner-gated /api/qbo/connect route that starts OAuth"
```

---

## Task 8: Callback route (`/auth/qbo/callback`)

**Files:**
- Create: `nudgepay-app/app/routes/auth.qbo.callback.tsx`
- Modify: `nudgepay-app/app/routes.ts`

**Interfaces:**
- Consumes: `consumeOAuthState`, `exchangeCodeForTokens`, `storeConnection`, `getQboEnv`.
- Produces: GET `/auth/qbo/callback?code&realmId&state` → verify state → exchange code → encrypt+store → redirect `/dashboard?qbo=connected`. On any failure, redirect `/dashboard?qbo=error` (NEVER render tokens/HTML).

- [ ] **Step 1: Register the route**

Add to `nudgepay-app/app/routes.ts`:

```ts
  route("auth/qbo/callback", "routes/auth.qbo.callback.tsx"),
```

- [ ] **Step 2: Implement the callback (redirect-only, no HTML)**

Create `nudgepay-app/app/routes/auth.qbo.callback.tsx`:

```tsx
import { redirect, type LoaderFunctionArgs } from "react-router";
import { getEnv, getQboEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { consumeOAuthState } from "../lib/oauth-state.server";
import { exchangeCodeForTokens } from "../lib/qbo-client.server";
import { storeConnection } from "../lib/qbo-connection.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const qbo = getQboEnv(context as any);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError || !code || !realmId || !state) {
    return redirect("/dashboard?qbo=error");
  }
  const cfg = {
    clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI,
  };
  try {
    const service = createSupabaseServiceClient(env);
    const orgId = await consumeOAuthState(service, state); // throws on invalid/expired/replay
    const tokens = await exchangeCodeForTokens(fetch, cfg, code);
    await storeConnection(service, qbo.QBO_ENCRYPTION_KEY, orgId, realmId, tokens);
    return redirect("/dashboard?qbo=connected");
  } catch {
    return redirect("/dashboard?qbo=error");
  }
}
```

- [ ] **Step 3: Verify typecheck + build**

Run: `cd nudgepay-app && npm run typecheck && npm run build`
Expected: exit 0.

- [ ] **Step 4: Confirm full suite still green**

Run: `cd nudgepay-app && npx vitest run`
Expected: all green (crypto + qbo-client + qbo-connection + oauth-state + Phase 1 suites). The callback logic is covered by its constituent helper tests (state, exchange, store).

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/routes/auth.qbo.callback.tsx nudgepay-app/app/routes.ts
git commit -m "feat: add redirecting QBO OAuth callback (state verify, token store, no HTML)"
```

---

## Task 9: Disconnect route + dashboard QBO UI

**Files:**
- Create: `nudgepay-app/app/routes/api.qbo.disconnect.tsx`
- Modify: `nudgepay-app/app/routes.ts`, `nudgepay-app/app/routes/dashboard.tsx`

**Interfaces:**
- Consumes: `disconnectConnection`, `getConnectionStatus`, `getQboEnv`.
- Produces: POST `/api/qbo/disconnect` (owner-gated) → revoke + clear → `/dashboard?qbo=disconnected`. Dashboard loader returns QBO status; UI shows Connected/Not-connected with a Connect or Disconnect form, plus a banner reflecting `?qbo=` outcome.

- [ ] **Step 1: Register the route**

Add to `nudgepay-app/app/routes.ts`:

```ts
  route("api/qbo/disconnect", "routes/api.qbo.disconnect.tsx"),
```

- [ ] **Step 2: Implement disconnect**

Create `nudgepay-app/app/routes/api.qbo.disconnect.tsx`:

```tsx
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getQboEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { disconnectConnection } from "../lib/qbo-connection.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const qbo = getQboEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org || org.role !== "owner") return redirect("/dashboard?qbo=forbidden", { headers });
  const service = createSupabaseServiceClient(env);
  const cfg = {
    clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI,
  };
  await disconnectConnection(fetch, service, cfg, qbo.QBO_ENCRYPTION_KEY, org.org_id);
  return redirect("/dashboard?qbo=disconnected", { headers });
}

export function loader() {
  return redirect("/dashboard");
}
```

- [ ] **Step 3: Wire the dashboard**

Modify `nudgepay-app/app/routes/dashboard.tsx` so the loader also returns QBO status and the `?qbo=` outcome, and the component renders it. The loader already has `requireUser` + `resolveOrg`; add a `getConnectionStatus` read using the SERVICE client (status is org-level connection metadata) and pass `qboStatus` + `notice` (from `new URL(request.url).searchParams.get("qbo")`) into the response. Render:

```tsx
// add imports
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { Form } from "react-router";

// inside loader, after resolving org + orgName:
const service = createSupabaseServiceClient(env);
const conn = await getConnectionStatus(service, org.org_id);
const notice = new URL(request.url).searchParams.get("qbo");
// include in the returned data(): { ...existing, qboConnected: conn?.status === "connected", isOwner: org.role === "owner", notice }

// in the component, below the org header:
{notice && <p>QuickBooks: {notice}</p>}
<section>
  <h2>QuickBooks</h2>
  {qboConnected ? (
    <>
      <p>Status: Connected</p>
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
```

Keep the existing dashboard content (org name, email, role, logout). Use `useLoaderData<typeof loader>()` for the new fields.

- [ ] **Step 4: Verify typecheck + build + full suite**

Run: `cd nudgepay-app && npm run typecheck && npm run build && npx vitest run`
Expected: all exit 0 / green.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/routes/api.qbo.disconnect.tsx nudgepay-app/app/routes/dashboard.tsx nudgepay-app/app/routes.ts
git commit -m "feat: add QBO disconnect route and dashboard connect/disconnect UI"
```

---

## Task 10: Live-sandbox verification doc

**Files:**
- Create: `docs/superpowers/phase2a-live-sandbox-verification.md`

**Interfaces:** docs only — no code.

- [ ] **Step 1: Write the manual verification guide**

Create `docs/superpowers/phase2a-live-sandbox-verification.md` documenting the steps to verify the flow against a real Intuit sandbox WHEN credentials are available (deferred per the "mock QBO now" decision):

1. In the Intuit Developer portal, create/open the app; copy the **sandbox** Client ID + Secret.
2. Register the redirect URI exactly as `QBO_REDIRECT_URI` (e.g. the deployed Workers URL `/auth/qbo/callback`; for local, run `npx wrangler dev` and use a tunnel — Intuit requires a reachable HTTPS redirect; localhost is allowed for some sandbox flows but a `cloudflared`/`ngrok` HTTPS tunnel is the reliable path).
3. Set real secrets: `wrangler secret put QBO_CLIENT_ID` (and SECRET, REDIRECT_URI, ENCRYPTION_KEY), or `.dev.vars` for `wrangler dev`.
4. Log in as an org owner → dashboard → **Connect QuickBooks** → complete Intuit consent with the sandbox company → confirm redirect to `/dashboard?qbo=connected` and a `qbo_connections` row with `status=connected` and NON-plaintext `*_token_enc`.
5. Verify **disconnect** revokes (Intuit returns 200) and clears the row.
6. Note: webhook + CDC live testing is Phase 2B and also needs a public tunnel.

- [ ] **Step 2: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add docs/superpowers/phase2a-live-sandbox-verification.md
git commit -m "docs: add Phase 2A live QBO sandbox verification guide"
```

---

## Phase 2A Definition of Done

- `npm run typecheck`, `npm run build`, and `npx vitest run` all pass (no manual reset needed).
- Tokens encrypted at rest (AES-GCM), proven by `qbo-connection.test.ts` asserting no plaintext + decrypt round-trip.
- OAuth state is single-use with expiry + replay rejection (`oauth-state.test.ts`).
- Token refresh persists the rotated refresh token; disconnect revokes (best-effort) and clears.
- Callback redirects (never renders HTML/tokens).
- Owner-only connect/disconnect; dashboard shows status + buttons.
- Live sandbox connection documented as the deferred manual step.

## Out of Scope (Phase 2B and later)

- Invoice/customer **sync** (initial backfill, manual "Refresh from QuickBooks", QBO query) — Phase 2B.
- **Webhooks** (`/webhooks/qbo`, signature verification) and **CDC** cron catch-up — Phase 2B.
- Carry-forward from Phase 1 to honor in 2B sync: `unique(org_id, qbo_id)` permits multiple NULL `qbo_id` rows — sync upserts must always set `qbo_id`.
- Live Intuit production credentials + Intuit app-assessment submission — Phase 4.

---

## Self-Review (author)

- **Spec coverage:** OAuth hardening (CSRF nonce T6, redirecting callback T8, encrypted tokens T3/T5, revoke/disconnect T5/T9) maps to the design spec §6 "OAuth hardening." Sync/webhooks/CDC are explicitly Phase 2B (design §6 "Sync strategy"), correctly deferred here.
- **Placeholders:** none — every code/SQL/test step is complete.
- **Type consistency:** `QboTokens`/`QboHttpConfig` defined in T4 and consumed unchanged in T5/T7/T8/T9; `getQboEnv`/`QboEnv` (T1) keys match `.env.test` and every route's usage; `storeConnection`/`getValidAccessToken`/`disconnectConnection`/`getConnectionStatus` signatures match their test call sites and route callers; `createOAuthState`/`consumeOAuthState` match T7/T8.
- **Known risks to verify at execution:** (1) supabase-js writing `null` to the retyped `text` token columns on disconnect — covered by the disconnect test asserting `access_token_enc` is null; (2) base64 key length validation (must be 32 bytes) — the crypto module throws and `.env.test` must hold a real 32-byte key; (3) registering all three routes at once would break the build before their files exist — the plan registers each route in its own task (T7/T8/T9).
