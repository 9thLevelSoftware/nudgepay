# NudgePay Phase 3 — Twilio SMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an AR team member text a customer about a past-due invoice, see the customer's replies threaded into the invoice, track Twilio delivery status, and honor SMS consent + STOP/START opt-out — all behind an injectable Twilio HTTP boundary so the whole flow is unit/integration-tested on the local Docker stack with NO live Twilio calls; live verification against a Twilio trial is a documented manual step.

**Architecture:** A thin, injectable Twilio REST client (`twilio-client.server.ts`) isolates the Messages API so tests pass a mock `fetch`. Twilio webhook requests (inbound + status) are HMAC-SHA1 signature-verified (`twilio-webhook.server.ts`, Web Crypto). A messaging service layer (`twilio-messaging.server.ts`) composes consent guards, per-org sender resolution (Messaging Service SID preferred, plain `from` number fallback), Twilio sends, inbound phone→customer matching with opt-out handling, and status updates — all via the service-role client. Routes are thin wrappers: an authed send action, two signature-gated webhook resource routes, and a minimal per-invoice thread UI. Builds on Phase 1 (schema/auth/RLS) and Phase 2 (QBO sync), both merged to `main`.

**Tech Stack:** React Router v7 (Cloudflare Workers), TypeScript `strict`, Supabase (service-role client for privileged messaging writes; user client for RLS-scoped thread reads), Web Crypto (HMAC-SHA1 for Twilio signatures), Vitest. Twilio via raw REST (NOT the Twilio SDK — its HTTP client does not mock cleanly on Workers and adds weight).

## Global Constraints

- Language: TypeScript, `strict: true`. Work in `nudgepay-app/`. Branch `phase3-twilio` (NOT main). Conventional Commits.
- Runtime: Cloudflare Workers (`nodejs_compat`). All crypto uses the global Web Crypto API (`crypto.subtle`, `crypto.getRandomValues`) — works in Workers AND Node 20+/vitest. Do NOT import `node:crypto` or any `node:*` module in app code.
- **No live Twilio calls in code or tests.** Every Twilio HTTP call goes through a function taking an injectable `fetchFn: typeof fetch`; tests pass mocks; routes pass the real global `fetch`.
- All `text_messages` / `customers.sms_consent` WRITES during send/inbound/status go through the **service-role client** (privileged; same boundary as QBO sync). Thread-view READS use the **user client** (RLS-scoped to the member's org via the existing `text_messages_all` policy).
- Twilio credentials are read only in `*.server.ts` via a SEPARATE `getTwilioEnv` accessor — never shipped to the browser. Existing `getEnv` (SUPABASE-only) and `getQboEnv` MUST stay unchanged.
- **Webhook signatures verified BEFORE any DB work.** Inbound + status routes verify `X-Twilio-Signature` and return 403 on failure before touching the database.
- **Consent gating:** never send to a customer whose `sms_consent` is false (or who has no phone). Inbound STOP-family keywords set `sms_consent=false`; START-family set it true; HELP does not change consent.
- **Sender resolution:** prefer a per-org `messaging_config.messaging_service_sid`; else per-org `messaging_config.sender`; else the env default (`TWILIO_MESSAGING_SERVICE_SID` preferred, else `TWILIO_FROM_NUMBER`). Trial accounts typically have only a `from` number — both paths must work.
- Reuse Phase 1/2 conventions verbatim: `requireUser`/`resolveOrg`, `createSupabaseServiceClient`/`createSupabaseUserClient`, auth redirects carry `{ headers }`, `getEnv(context as any)`, `useLoaderData<typeof loader>()`/`useActionData<typeof action>()`, resource routes (action/loader only, no default export).
- Tests run against the local Supabase stack; the suite stays green via `tests/global-setup.ts` (it already truncates `text_messages`, `messaging_config`, `customers`).

## Phase 1/2 Interfaces This Builds On (verified against merged code)

- `app/lib/env.server.ts` → `getEnv(context)` (SUPABASE only — DO NOT change), `getQboEnv(context)`. This phase ADDS `getTwilioEnv` (Task 1).
- `app/lib/session.server.ts` → `requireUser(request, env): { supabase, headers, user }`, `resolveOrg(supabase, userId): { org_id, role } | null`.
- `app/lib/supabase.server.ts` → `createSupabaseServiceClient(env)`, `createSupabaseUserClient(request, env)`.
- `tests/helpers.ts` → `serviceClient()`, `makeUserClient(email)`, `TEST_ENV` (parsed `.env.test` map, added in Phase 2B). `tests/global-setup.ts` truncates tenant tables.
- Schema (migration `0001`):
  - `customers(id, org_id, qbo_id, name, email, phone, sms_consent boolean not null default false, unique(org_id, qbo_id))`
  - `invoices(id, org_id, qbo_id, qbo_doc_number, customer_id FK->customers on delete set null, amount, balance, due_date, invoice_date, status, ...)`
  - `text_messages(id, org_id, invoice_id FK->invoices on delete cascade, sent_by_user_id FK->auth.users, direction text not null check in ('outbound','inbound'), twilio_message_sid text, status text, error_code text, from_number text, to_number text, body text, created_at)` — this phase ADDS `customer_id` (Task 2).
  - `messaging_config(id, org_id unique FK, messaging_service_sid text, sender text, created_at)`
- RLS (migration `0002`): `text_messages_all`, `messaging_config_all`, `customers_all` — full CRUD for org members; service role bypasses RLS.
- Twilio REST contracts (reference — confirm at live-trial time):
  - **Send:** `POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json`, Basic auth `AccountSid:AuthToken`, `application/x-www-form-urlencoded` body with `To`, `Body`, and EITHER `MessagingServiceSid` OR `From`, optional `StatusCallback`. Response JSON: `{ sid, status, ... }`.
  - **Inbound (Twilio → us):** `POST` form-encoded `From`, `To`, `Body`, `MessageSid`, etc. Reply with TwiML (empty `<Response></Response>`, `text/xml`).
  - **Status callback (Twilio → us):** `POST` form-encoded `MessageSid`, `MessageStatus`, `ErrorCode`.
  - **Signature:** `X-Twilio-Signature` = base64(HMAC-SHA1(AuthToken, URL + concat of POST params sorted by key as `key+value`)). The URL must be the exact public URL Twilio called.

---

## File Structure

```
nudgepay-app/
  app/lib/
    env.server.ts              # MODIFY (Task 1): add getTwilioEnv + TwilioEnv (getEnv/getQboEnv untouched)
    twilio-client.server.ts    # NEW (Task 3): sendSms (injectable fetch)
    twilio-webhook.server.ts   # NEW (Task 4): HMAC-SHA1 signature verify + form param parse
    twilio-messaging.server.ts # NEW (Tasks 5-6): sender resolution, sendInvoiceText, recordInboundMessage, updateMessageStatus, normalizePhone
  app/routes/
    api.text.send.tsx          # NEW (Task 7): authed send action
    webhooks.twilio.inbound.tsx# NEW (Task 8): signature-gated inbound (+opt-out)
    webhooks.twilio.status.tsx # NEW (Task 8): signature-gated status callback
    invoices.$id.tsx           # NEW (Task 9): per-invoice thread + send form + consent toggle
    dashboard.tsx              # MODIFY (Task 9): link each invoice row to its thread
    routes.ts                  # MODIFY (Tasks 7-9): register the four new routes
  supabase/migrations/
    0006_twilio_messaging.sql  # NEW (Task 2): text_messages.customer_id + thread indexes
  tests/
    twilio-client.test.ts      # NEW (Task 3)
    twilio-webhook.test.ts     # NEW (Task 4)
    twilio-send.test.ts        # NEW (Task 5)
    twilio-inbound.test.ts     # NEW (Task 6)
    twilio-routes.test.ts      # NEW (Task 8)
  .env.test                    # MODIFY (Task 1, gitignored): add TWILIO_* dummies
  wrangler.toml                # MODIFY (Task 1): document Twilio secrets
docs/superpowers/
  phase3-live-trial-verification.md  # NEW (Task 10)
```

---

## Task 1: Twilio env accessor + local secrets

**Files:**
- Modify: `nudgepay-app/app/lib/env.server.ts`
- Modify: `nudgepay-app/.env.test` (gitignored), `nudgepay-app/wrangler.toml`

**Interfaces:**
- Consumes: nothing.
- Produces: `type TwilioEnv = { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID: string | null, TWILIO_FROM_NUMBER: string | null, TWILIO_PUBLIC_BASE_URL: string | null }` and `getTwilioEnv(context): TwilioEnv`. Existing `getEnv`/`getQboEnv` UNCHANGED.

- [ ] **Step 1: Add the Twilio env accessor**

Append to `nudgepay-app/app/lib/env.server.ts`:

```ts
export type TwilioEnv = {
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_MESSAGING_SERVICE_SID: string | null; // production-preferred sender
  TWILIO_FROM_NUMBER: string | null;            // trial/fallback sender (E.164)
  TWILIO_PUBLIC_BASE_URL: string | null;        // public origin for webhook signature + StatusCallback
};

export function getTwilioEnv(context: { cloudflare: { env: Record<string, string> } }): TwilioEnv {
  const e = context.cloudflare.env;
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]) {
    if (!e[k]) throw new Error(`Missing required env var: ${k}`);
  }
  const messagingServiceSid = e.TWILIO_MESSAGING_SERVICE_SID || null;
  const fromNumber = e.TWILIO_FROM_NUMBER || null;
  if (!messagingServiceSid && !fromNumber) {
    throw new Error("Set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER");
  }
  return {
    TWILIO_ACCOUNT_SID: e.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: e.TWILIO_AUTH_TOKEN,
    TWILIO_MESSAGING_SERVICE_SID: messagingServiceSid,
    TWILIO_FROM_NUMBER: fromNumber,
    TWILIO_PUBLIC_BASE_URL: e.TWILIO_PUBLIC_BASE_URL || null,
  };
}
```

- [ ] **Step 2: Add local env vars**

Append to `nudgepay-app/.env.test` (gitignored — dummy values; Twilio HTTP is mocked in tests):

```
TWILIO_ACCOUNT_SID=ACtest00000000000000000000000000000
TWILIO_AUTH_TOKEN=test-auth-token
TWILIO_FROM_NUMBER=+15005550006
TWILIO_PUBLIC_BASE_URL=http://localhost:5173
```

- [ ] **Step 3: Document the wrangler secrets**

In `nudgepay-app/wrangler.toml`, extend the secrets comment:

```toml
# Secrets (wrangler secret put): SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY,
# QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, QBO_ENCRYPTION_KEY,
# QBO_WEBHOOK_VERIFIER_TOKEN,
# TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID (or TWILIO_FROM_NUMBER),
# TWILIO_PUBLIC_BASE_URL
```

- [ ] **Step 4: Verify typecheck**

Run: `cd nudgepay-app && npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/env.server.ts nudgepay-app/wrangler.toml
git commit -m "feat: add Twilio env accessor (getTwilioEnv) and document secrets"
```
(`.env.test` is gitignored — not committed.)

---

## Task 2: Migration — text_messages.customer_id + thread indexes

**Files:**
- Create: `nudgepay-app/supabase/migrations/0006_twilio_messaging.sql`

**Interfaces:**
- Produces: `text_messages.customer_id uuid references customers(id) on delete set null`; indexes `(org_id, invoice_id)` (thread view — honors a Phase 1 carry-forward), `(org_id, customer_id)`, and a partial index on `twilio_message_sid` (status-callback lookups).

- [ ] **Step 1: Write the migration**

Create `nudgepay-app/supabase/migrations/0006_twilio_messaging.sql`:

```sql
-- Link messages to a customer (not only an invoice) so inbound replies that
-- can't be tied to a specific invoice still thread to the right customer, and
-- STOP/HELP handling can resolve the sender.
alter table text_messages
  add column customer_id uuid references customers(id) on delete set null;

-- Thread view: messages for an invoice, and for a customer.
create index text_messages_org_invoice_idx on text_messages (org_id, invoice_id);
create index text_messages_org_customer_idx on text_messages (org_id, customer_id);

-- Status callbacks arrive keyed by the Twilio message SID.
create index text_messages_sid_idx on text_messages (twilio_message_sid)
  where twilio_message_sid is not null;
```

- [ ] **Step 2: Apply and verify the migration**

Run:
```bash
cd nudgepay-app && npx supabase db reset
```
Expected: applies `0001`–`0006` with no error.

Confirm the column exists:
```bash
npx supabase db query "select column_name from information_schema.columns where table_name='text_messages' and column_name='customer_id';"
```
Expected: one row, `customer_id`.

- [ ] **Step 3: Confirm the suite still green after reset**

Run: `cd nudgepay-app && npx vitest run`
Expected: all existing Phase 1 + 2 tests pass (57+).

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/supabase/migrations/0006_twilio_messaging.sql
git commit -m "feat: add text_messages.customer_id and thread/status indexes"
```

---

## Task 3: Twilio REST client (sendSms) — injectable fetch

**Files:**
- Create: `nudgepay-app/app/lib/twilio-client.server.ts`, `nudgepay-app/tests/twilio-client.test.ts`

**Interfaces:**
- Produces:
  - `type TwilioConfig = { accountSid: string; authToken: string }`
  - `type TwilioSender = { messagingServiceSid: string } | { from: string }`
  - `type TwilioSendResult = { sid: string; status: string }`
  - `sendSms(fetchFn, cfg, params: { to: string; body: string; sender: TwilioSender; statusCallback?: string | null }): Promise<TwilioSendResult>`

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/twilio-client.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { sendSms } from "../app/lib/twilio-client.server";

const cfg = { accountSid: "AC123", authToken: "tok" };

function jsonResponse(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("sendSms posts To/Body/From with Basic auth and parses sid+status", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM1", status: "queued" }));
  const res = await sendSms(fetchFn as any, cfg, {
    to: "+12295550101", body: "Hi", sender: { from: "+15005550006" },
  });
  expect(res).toEqual({ sid: "SM1", status: "queued" });
  const [url, init] = fetchFn.mock.calls[0];
  expect(String(url)).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
  expect((init as RequestInit).method).toBe("POST");
  const body = String((init as any).body);
  expect(body).toContain("To=%2B12295550101");
  expect(body).toContain("Body=Hi");
  expect(body).toContain("From=%2B15005550006");
  expect(body).not.toContain("MessagingServiceSid");
  expect((init as any).headers.Authorization).toBe("Basic " + btoa("AC123:tok"));
});

test("sendSms uses MessagingServiceSid when the sender is a messaging service", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM2", status: "accepted" }));
  await sendSms(fetchFn as any, cfg, {
    to: "+12295550101", body: "Yo", sender: { messagingServiceSid: "MG999" },
    statusCallback: "https://x/webhooks/twilio/status",
  });
  const body = String((fetchFn.mock.calls[0][1] as any).body);
  expect(body).toContain("MessagingServiceSid=MG999");
  expect(body).not.toContain("From=");
  expect(body).toContain("StatusCallback=https%3A%2F%2Fx%2Fwebhooks%2Ftwilio%2Fstatus");
});

test("sendSms throws on a non-2xx response", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ message: "bad" }, 400));
  await expect(sendSms(fetchFn as any, cfg, {
    to: "+1", body: "x", sender: { from: "+2" },
  })).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify it FAILS**

Run: `cd nudgepay-app && npx vitest run tests/twilio-client.test.ts`
Expected: FAIL (module/functions missing).

- [ ] **Step 3: Implement twilio-client.server.ts**

Create `nudgepay-app/app/lib/twilio-client.server.ts`:

```ts
// Thin, injectable Twilio Messages API client. Raw REST (no Twilio SDK).
// Tests pass a mock fetchFn; routes pass the global fetch. No node:* imports.

export type TwilioConfig = { accountSid: string; authToken: string };
export type TwilioSender = { messagingServiceSid: string } | { from: string };
export type TwilioSendResult = { sid: string; status: string };

export async function sendSms(
  fetchFn: typeof fetch,
  cfg: TwilioConfig,
  params: { to: string; body: string; sender: TwilioSender; statusCallback?: string | null },
): Promise<TwilioSendResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`;
  const form = new URLSearchParams();
  form.set("To", params.to);
  form.set("Body", params.body);
  if ("messagingServiceSid" in params.sender) {
    form.set("MessagingServiceSid", params.sender.messagingServiceSid);
  } else {
    form.set("From", params.sender.from);
  }
  if (params.statusCallback) form.set("StatusCallback", params.statusCallback);

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: "Basic " + btoa(`${cfg.accountSid}:${cfg.authToken}`),
    },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Twilio send failed: ${res.status}`);
  const data = (await res.json()) as { sid: string; status: string };
  return { sid: data.sid, status: data.status };
}
```

- [ ] **Step 4: Run to verify it PASSES + typecheck**

Run: `cd nudgepay-app && npx vitest run tests/twilio-client.test.ts && npm run typecheck`
Expected: all PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/twilio-client.server.ts nudgepay-app/tests/twilio-client.test.ts
git commit -m "feat: add injectable Twilio Messages REST client"
```

---

## Task 4: Twilio webhook signature verification (HMAC-SHA1) + form parse

**Files:**
- Create: `nudgepay-app/app/lib/twilio-webhook.server.ts`, `nudgepay-app/tests/twilio-webhook.test.ts`

**Interfaces:**
- Produces:
  - `twilioSignatureBase(url: string, params: Record<string, string>): string`
  - `signTwilioRequest(authToken: string, url: string, params: Record<string, string>): Promise<string>`
  - `verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, header: string | null): Promise<boolean>`
  - `parseTwilioForm(rawBody: string): Record<string, string>`

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/twilio-webhook.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  twilioSignatureBase, signTwilioRequest, verifyTwilioSignature, parseTwilioForm,
} from "../app/lib/twilio-webhook.server";

const TOKEN = "test-auth-token";
const URL_ = "https://x.example/webhooks/twilio/inbound";

test("twilioSignatureBase appends params sorted by key as key+value after the url", () => {
  const base = twilioSignatureBase(URL_, { To: "+1", From: "+2", Body: "hi" });
  // sorted keys: Body, From, To
  expect(base).toBe(`${URL_}Bodyhi` + `From+2` + `To+1`);
});

test("verifyTwilioSignature accepts a signature the module itself produced", async () => {
  // Round-trip; the exact-algorithm-vs-Twilio match is confirmed in the live-trial doc.
  const params = { To: "+1", From: "+2", Body: "hi" };
  const sig = await signTwilioRequest(TOKEN, URL_, params);
  expect(await verifyTwilioSignature(TOKEN, URL_, params, sig)).toBe(true);
});

test("verifyTwilioSignature rejects tampered params, wrong token, and missing header", async () => {
  const params = { To: "+1", From: "+2", Body: "hi" };
  const sig = await signTwilioRequest(TOKEN, URL_, params);
  expect(await verifyTwilioSignature(TOKEN, URL_, { ...params, Body: "HI" }, sig)).toBe(false);
  expect(await verifyTwilioSignature("other", URL_, params, sig)).toBe(false);
  expect(await verifyTwilioSignature(TOKEN, URL_, params, null)).toBe(false);
});

test("parseTwilioForm decodes urlencoded body into a param map", () => {
  expect(parseTwilioForm("From=%2B12295550101&Body=Hello+there&MessageSid=SM9")).toEqual({
    From: "+12295550101", Body: "Hello there", MessageSid: "SM9",
  });
});
```

- [ ] **Step 2: Run to verify it FAILS**

Run: `cd nudgepay-app && npx vitest run tests/twilio-webhook.test.ts`
Expected: FAIL (module/functions missing).

- [ ] **Step 3: Implement twilio-webhook.server.ts**

Create `nudgepay-app/app/lib/twilio-webhook.server.ts`:

```ts
// Twilio webhook signature verification. Twilio signs (URL + POST params
// sorted by key, concatenated as key+value) with HMAC-SHA1 keyed by the
// account Auth Token, base64-encoded, sent as X-Twilio-Signature.
// Web Crypto (Workers + Node 20+/vitest). No node:crypto.

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function twilioSignatureBase(url: string, params: Record<string, string>): string {
  let base = url;
  for (const key of Object.keys(params).sort()) base += key + params[key];
  return base;
}

export async function signTwilioRequest(
  authToken: string, url: string, params: Record<string, string>,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(twilioSignatureBase(url, params)));
  return b64encode(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyTwilioSignature(
  authToken: string, url: string, params: Record<string, string>, header: string | null,
): Promise<boolean> {
  if (!header) return false;
  const expected = await signTwilioRequest(authToken, url, params);
  return timingSafeEqual(expected, header);
}

export function parseTwilioForm(rawBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(rawBody)) out[k] = v;
  return out;
}
```

- [ ] **Step 4: Run to verify it PASSES + typecheck**

Run: `cd nudgepay-app && npx vitest run tests/twilio-webhook.test.ts && npm run typecheck`
Expected: all PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/twilio-webhook.server.ts nudgepay-app/tests/twilio-webhook.test.ts
git commit -m "feat: add Twilio webhook HMAC-SHA1 signature verification + form parse"
```

---

## Task 5: Messaging layer — sender resolution + outbound send

**Files:**
- Create: `nudgepay-app/app/lib/twilio-messaging.server.ts`, `nudgepay-app/tests/twilio-send.test.ts`

**Interfaces:**
- Consumes: `sendSms`/`TwilioConfig`/`TwilioSender` (T3), service client.
- Produces:
  - `type MessagingDeps = { fetchFn: typeof fetch; service: SupabaseClient; twilio: TwilioConfig; defaultSender: TwilioSender; statusCallback?: string | null }`
  - `normalizePhone(s: string | null | undefined): string` — digits only, last 10.
  - `resolveSender(service, orgId, defaultSender): Promise<TwilioSender>` — per-org `messaging_config` overrides the env default.
  - `sendInvoiceText(deps, args: { orgId: string; invoiceId: string; userId: string; body: string }): Promise<{ id: string; sid: string; status: string }>` — loads invoice→customer, enforces phone + consent, resolves sender, sends, inserts an outbound `text_messages` row.

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/twilio-send.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { serviceClient } from "./helpers";
import { resolveSender, sendInvoiceText, normalizePhone, type MessagingDeps } from "../app/lib/twilio-messaging.server";

const svc = serviceClient();
const twilio = { accountSid: "AC1", authToken: "tok" };

async function seed(consent: boolean, phone: string | null) {
  const { data: org } = await svc.from("organizations").insert({ name: "SMS Org" }).select("id").single();
  const orgId = org!.id as string;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c1", name: "Acme", phone, sms_consent: consent }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "i1", qbo_doc_number: "1042", customer_id: cust!.id, balance: 100 }).select("id").single();
  return { orgId, customerId: cust!.id as string, invoiceId: inv!.id as string };
}

function jsonResponse(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function deps(fetchFn: any, defaultSender: any = { from: "+15005550006" }): MessagingDeps {
  return { fetchFn, service: svc, twilio, defaultSender, statusCallback: null };
}

test("normalizePhone reduces to the last 10 digits", () => {
  expect(normalizePhone("+1 (229) 555-0101")).toBe("2295550101");
  expect(normalizePhone(null)).toBe("");
});

test("resolveSender prefers messaging_config over the env default", async () => {
  const { orgId } = await seed(true, "+12295550101");
  // no messaging_config row -> env default
  expect(await resolveSender(svc, orgId, { from: "+1999" })).toEqual({ from: "+1999" });
  await svc.from("messaging_config").insert({ org_id: orgId, messaging_service_sid: "MG7" });
  expect(await resolveSender(svc, orgId, { from: "+1999" })).toEqual({ messagingServiceSid: "MG7" });
});

test("sendInvoiceText sends and inserts an outbound row when the customer consented", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550101");
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM10", status: "queued" }));
  const res = await sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId: "00000000-0000-0000-0000-000000000000", body: "Past due" });
  expect(res.sid).toBe("SM10");
  expect(fetchFn).toHaveBeenCalledOnce();
  const { data: msg } = await svc.from("text_messages").select("direction, twilio_message_sid, to_number, customer_id, invoice_id, body")
    .eq("twilio_message_sid", "SM10").single();
  expect(msg!.direction).toBe("outbound");
  expect(msg!.to_number).toBe("+12295550101");
  expect(msg!.customer_id).toBe(customerId);
  expect(msg!.invoice_id).toBe(invoiceId);
  expect(msg!.body).toBe("Past due");
});

test("sendInvoiceText refuses to send without consent (no Twilio call, no row)", async () => {
  const { orgId, invoiceId } = await seed(false, "+12295550101");
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId: "00000000-0000-0000-0000-000000000000", body: "x" }))
    .rejects.toThrow(/consent/i);
  expect(fetchFn).not.toHaveBeenCalled();
});

test("sendInvoiceText refuses when the customer has no phone", async () => {
  const { orgId, invoiceId } = await seed(true, null);
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId: "00000000-0000-0000-0000-000000000000", body: "x" }))
    .rejects.toThrow(/phone/i);
  expect(fetchFn).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it FAILS**

Run: `cd nudgepay-app && npx vitest run tests/twilio-send.test.ts`
Expected: FAIL (module/functions missing).

- [ ] **Step 3: Implement twilio-messaging.server.ts (send half)**

Create `nudgepay-app/app/lib/twilio-messaging.server.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSms, type TwilioConfig, type TwilioSender } from "./twilio-client.server";

export type MessagingDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;
  twilio: TwilioConfig;
  defaultSender: TwilioSender;
  statusCallback?: string | null;
};

// US-oriented: compare on the last 10 digits. (A normalized phone column is a
// future optimization if multi-country support is added.)
export function normalizePhone(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "").slice(-10);
}

export async function resolveSender(
  service: SupabaseClient, orgId: string, defaultSender: TwilioSender,
): Promise<TwilioSender> {
  const { data } = await service.from("messaging_config")
    .select("messaging_service_sid, sender").eq("org_id", orgId).maybeSingle();
  if (data?.messaging_service_sid) return { messagingServiceSid: data.messaging_service_sid as string };
  if (data?.sender) return { from: data.sender as string };
  return defaultSender;
}

export async function sendInvoiceText(
  deps: MessagingDeps,
  args: { orgId: string; invoiceId: string; userId: string; body: string },
): Promise<{ id: string; sid: string; status: string }> {
  const { data: inv, error: invErr } = await deps.service.from("invoices")
    .select("customer_id").eq("org_id", args.orgId).eq("id", args.invoiceId).maybeSingle();
  if (invErr) throw invErr;
  if (!inv?.customer_id) throw new Error("Invoice has no linked customer");

  const { data: cust, error: custErr } = await deps.service.from("customers")
    .select("id, phone, sms_consent").eq("id", inv.customer_id as string).maybeSingle();
  if (custErr) throw custErr;
  if (!cust?.phone) throw new Error("Customer has no phone number");
  if (!cust.sms_consent) throw new Error("Customer has not consented to SMS");

  const sender = await resolveSender(deps.service, args.orgId, deps.defaultSender);
  const result = await sendSms(deps.fetchFn, deps.twilio, {
    to: cust.phone as string, body: args.body, sender, statusCallback: deps.statusCallback ?? null,
  });

  const { data: row, error: insErr } = await deps.service.from("text_messages").insert({
    org_id: args.orgId,
    invoice_id: args.invoiceId,
    customer_id: cust.id as string,
    sent_by_user_id: args.userId,
    direction: "outbound",
    twilio_message_sid: result.sid,
    status: result.status,
    from_number: "from" in sender ? sender.from : null,
    to_number: cust.phone as string,
    body: args.body,
  }).select("id").single();
  if (insErr) throw insErr;

  return { id: row!.id as string, sid: result.sid, status: result.status };
}
```

- [ ] **Step 4: Run to verify it PASSES + typecheck**

Run: `cd nudgepay-app && npx vitest run tests/twilio-send.test.ts && npm run typecheck`
Expected: all PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/twilio-messaging.server.ts nudgepay-app/tests/twilio-send.test.ts
git commit -m "feat: add Twilio sender resolution and consent-gated invoice send"
```

---

## Task 6: Messaging layer — inbound matching/opt-out + status update

**Files:**
- Modify: `nudgepay-app/app/lib/twilio-messaging.server.ts`
- Create: `nudgepay-app/tests/twilio-inbound.test.ts`

**Interfaces:**
- Consumes: T5 helpers (`normalizePhone`), service client.
- Produces (append to `twilio-messaging.server.ts`):
  - `recordInboundMessage(service, args: { from: string; to: string; body: string; messageSid: string }): Promise<{ matched: boolean; optOut: boolean }>` — matches `from` → customer by normalized phone, applies STOP/START consent changes, threads to the customer's most recent outbound invoice, inserts an inbound row.
  - `updateMessageStatus(service, args: { messageSid: string; status: string; errorCode: string | null }): Promise<void>` — updates the row by `twilio_message_sid`.

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/twilio-inbound.test.ts`:

```ts
import { expect, test } from "vitest";
import { serviceClient } from "./helpers";
import { recordInboundMessage, updateMessageStatus } from "../app/lib/twilio-messaging.server";

const svc = serviceClient();

async function seedCustomerWithOutbound(phone: string, consent = true) {
  const { data: org } = await svc.from("organizations").insert({ name: "Inbound Org" }).select("id").single();
  const orgId = org!.id as string;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c1", name: "Acme", phone, sms_consent: consent }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "i1", customer_id: cust!.id, balance: 50 }).select("id").single();
  await svc.from("text_messages").insert({
    org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, direction: "outbound",
    twilio_message_sid: "SMout", to_number: phone, body: "ping",
  });
  return { orgId, customerId: cust!.id as string, invoiceId: inv!.id as string };
}

test("recordInboundMessage matches by phone and threads to the latest outbound invoice", async () => {
  const { customerId, invoiceId } = await seedCustomerWithOutbound("+12295550101");
  const out = await recordInboundMessage(svc, { from: "(229) 555-0101", to: "+15005550006", body: "ok thanks", messageSid: "SMin1" });
  expect(out).toEqual({ matched: true, optOut: false });
  const { data: msg } = await svc.from("text_messages").select("direction, customer_id, invoice_id, body")
    .eq("twilio_message_sid", "SMin1").single();
  expect(msg!.direction).toBe("inbound");
  expect(msg!.customer_id).toBe(customerId);
  expect(msg!.invoice_id).toBe(invoiceId);
  expect(msg!.body).toBe("ok thanks");
});

test("recordInboundMessage STOP flips sms_consent off", async () => {
  const { customerId } = await seedCustomerWithOutbound("+12295550102", true);
  const out = await recordInboundMessage(svc, { from: "+12295550102", to: "+15005550006", body: "STOP", messageSid: "SMin2" });
  expect(out.optOut).toBe(true);
  const { data: cust } = await svc.from("customers").select("sms_consent").eq("id", customerId).single();
  expect(cust!.sms_consent).toBe(false);
});

test("recordInboundMessage START re-enables sms_consent", async () => {
  const { customerId } = await seedCustomerWithOutbound("+12295550103", false);
  await recordInboundMessage(svc, { from: "+12295550103", to: "+15005550006", body: "START", messageSid: "SMin3" });
  const { data: cust } = await svc.from("customers").select("sms_consent").eq("id", customerId).single();
  expect(cust!.sms_consent).toBe(true);
});

test("recordInboundMessage returns matched:false for an unknown number (stores nothing)", async () => {
  const out = await recordInboundMessage(svc, { from: "+19999999999", to: "+15005550006", body: "hello", messageSid: "SMin4" });
  expect(out).toEqual({ matched: false, optOut: false });
  const { data } = await svc.from("text_messages").select("id").eq("twilio_message_sid", "SMin4");
  expect(data!.length).toBe(0);
});

test("updateMessageStatus updates status and error_code by sid", async () => {
  await seedCustomerWithOutbound("+12295550104");
  await updateMessageStatus(svc, { messageSid: "SMout", status: "delivered", errorCode: null });
  const { data } = await svc.from("text_messages").select("status, error_code").eq("twilio_message_sid", "SMout").single();
  expect(data!.status).toBe("delivered");
  expect(data!.error_code).toBeNull();
});
```

- [ ] **Step 2: Run to verify it FAILS**

Run: `cd nudgepay-app && npx vitest run tests/twilio-inbound.test.ts`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Append inbound + status handlers to twilio-messaging.server.ts**

Append to the end of `nudgepay-app/app/lib/twilio-messaging.server.ts`:

```ts
const STOP_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
const START_KEYWORDS = ["START", "YES", "UNSTOP"];

export async function recordInboundMessage(
  service: SupabaseClient,
  args: { from: string; to: string; body: string; messageSid: string },
): Promise<{ matched: boolean; optOut: boolean }> {
  const fromNorm = normalizePhone(args.from);
  if (fromNorm.length < 10) return { matched: false, optOut: false };

  // Match the sender to a customer by normalized phone. At Chancey scale this
  // in-memory match is fine; a normalized column would scale it later.
  const { data: candidates, error: candErr } = await service.from("customers")
    .select("id, org_id, phone").not("phone", "is", null);
  if (candErr) throw candErr;
  const match = (candidates ?? []).find((c) => normalizePhone(c.phone as string) === fromNorm);
  if (!match) return { matched: false, optOut: false };

  const keyword = args.body.trim().toUpperCase();
  const optOut = STOP_KEYWORDS.includes(keyword);
  if (optOut) {
    await service.from("customers").update({ sms_consent: false }).eq("id", match.id as string);
  } else if (START_KEYWORDS.includes(keyword)) {
    await service.from("customers").update({ sms_consent: true }).eq("id", match.id as string);
  }

  // Thread to the customer's most recent outbound invoice, if any.
  const { data: lastOut } = await service.from("text_messages")
    .select("invoice_id").eq("customer_id", match.id as string).eq("direction", "outbound")
    .not("invoice_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();

  const { error: insErr } = await service.from("text_messages").insert({
    org_id: match.org_id as string,
    customer_id: match.id as string,
    invoice_id: (lastOut?.invoice_id as string) ?? null,
    direction: "inbound",
    twilio_message_sid: args.messageSid,
    from_number: args.from,
    to_number: args.to,
    body: args.body,
  });
  if (insErr) throw insErr;

  return { matched: true, optOut };
}

export async function updateMessageStatus(
  service: SupabaseClient,
  args: { messageSid: string; status: string; errorCode: string | null },
): Promise<void> {
  const { error } = await service.from("text_messages")
    .update({ status: args.status, error_code: args.errorCode })
    .eq("twilio_message_sid", args.messageSid);
  if (error) throw error;
}
```

- [ ] **Step 4: Run to verify it PASSES + typecheck**

Run: `cd nudgepay-app && npx vitest run tests/twilio-inbound.test.ts && npm run typecheck`
Expected: all PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/lib/twilio-messaging.server.ts nudgepay-app/tests/twilio-inbound.test.ts
git commit -m "feat: add Twilio inbound matching/opt-out and delivery status update"
```

---

## Task 7: Send route `/api/text/send`

**Files:**
- Create: `nudgepay-app/app/routes/api.text.send.tsx`
- Modify: `nudgepay-app/app/routes.ts`

**Interfaces:**
- Consumes: `requireUser`/`resolveOrg`, `getEnv`/`getTwilioEnv`, `createSupabaseServiceClient`, `sendInvoiceText`/`MessagingDeps`.
- Produces: POST `/api/text/send` → authed member → send → redirect `/invoices/:invoiceId?sms=sent` (or `?sms=noconsent` / `?sms=error`).

- [ ] **Step 1: Register the route**

In `nudgepay-app/app/routes.ts`, add inside the array:

```ts
  route("api/text/send", "routes/api.text.send.tsx"),
```

- [ ] **Step 2: Implement the send route**

Create `nudgepay-app/app/routes/api.text.send.tsx`:

```tsx
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getTwilioEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { sendInvoiceText, type MessagingDeps } from "../lib/twilio-messaging.server";
import type { TwilioSender } from "../lib/twilio-client.server";

function envSender(t: { TWILIO_MESSAGING_SERVICE_SID: string | null; TWILIO_FROM_NUMBER: string | null }): TwilioSender {
  if (t.TWILIO_MESSAGING_SERVICE_SID) return { messagingServiceSid: t.TWILIO_MESSAGING_SERVICE_SID };
  return { from: t.TWILIO_FROM_NUMBER as string }; // getTwilioEnv guarantees one of the two
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const twilio = getTwilioEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return redirect("/onboarding", { headers });

  const form = await request.formData();
  const raw = form.get("invoiceId");
  const invoiceId = typeof raw === "string" ? raw : "";
  const bodyRaw = form.get("body");
  const body = typeof bodyRaw === "string" ? bodyRaw.trim() : "";
  if (!invoiceId || !body) return redirect("/dashboard?sms=error", { headers });

  const service = createSupabaseServiceClient(env);
  const statusCallback = twilio.TWILIO_PUBLIC_BASE_URL
    ? `${twilio.TWILIO_PUBLIC_BASE_URL}/webhooks/twilio/status` : null;
  const deps: MessagingDeps = {
    fetchFn: fetch,
    service,
    twilio: { accountSid: twilio.TWILIO_ACCOUNT_SID, authToken: twilio.TWILIO_AUTH_TOKEN },
    defaultSender: envSender(twilio),
    statusCallback,
  };
  try {
    await sendInvoiceText(deps, { orgId: org.org_id, invoiceId, userId: user.id, body });
    return redirect(`/invoices/${invoiceId}?sms=sent`, { headers });
  } catch (err) {
    const reason = err instanceof Error && /consent/i.test(err.message) ? "noconsent" : "error";
    return redirect(`/invoices/${invoiceId}?sms=${reason}`, { headers });
  }
}

export function loader() {
  return redirect("/dashboard");
}
```

- [ ] **Step 3: Verify typecheck + build**

Run: `cd nudgepay-app && npm run typecheck && npm run build`
Expected: exit 0 (route registered, file exists).

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/routes/api.text.send.tsx nudgepay-app/app/routes.ts
git commit -m "feat: add authed /api/text/send route"
```

---

## Task 8: Twilio webhook routes (inbound + status), signature-gated

**Files:**
- Create: `nudgepay-app/app/routes/webhooks.twilio.inbound.tsx`, `nudgepay-app/app/routes/webhooks.twilio.status.tsx`
- Modify: `nudgepay-app/app/routes.ts`
- Create: `nudgepay-app/tests/twilio-routes.test.ts`

**Interfaces:**
- Consumes: `getEnv`/`getTwilioEnv`, `createSupabaseServiceClient`, `verifyTwilioSignature`/`parseTwilioForm` (T4), `recordInboundMessage`/`updateMessageStatus` (T6).
- Produces:
  - POST `/webhooks/twilio/inbound` → verify signature (403 on fail) → `recordInboundMessage` → 200 TwiML `<Response></Response>`.
  - POST `/webhooks/twilio/status` → verify signature (403 on fail) → `updateMessageStatus` → 204.

- [ ] **Step 1: Register the routes**

In `nudgepay-app/app/routes.ts`, add:

```ts
  route("webhooks/twilio/inbound", "routes/webhooks.twilio.inbound.tsx"),
  route("webhooks/twilio/status", "routes/webhooks.twilio.status.tsx"),
```

- [ ] **Step 2: Implement a shared URL helper inline + the inbound route**

Create `nudgepay-app/app/routes/webhooks.twilio.inbound.tsx`:

```tsx
import type { ActionFunctionArgs } from "react-router";
import { getEnv, getTwilioEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { verifyTwilioSignature, parseTwilioForm } from "../lib/twilio-webhook.server";
import { recordInboundMessage } from "../lib/twilio-messaging.server";

// Twilio signs the exact public URL it called. Behind a tunnel/Workers the
// internal request.url may differ, so prefer the configured public origin.
function publicUrl(twilioPublicBaseUrl: string | null, request: Request, path: string): string {
  return twilioPublicBaseUrl ? `${twilioPublicBaseUrl}${path}` : request.url;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const twilio = getTwilioEnv(context as any);
  const rawBody = await request.text();
  const params = parseTwilioForm(rawBody);
  const url = publicUrl(twilio.TWILIO_PUBLIC_BASE_URL, request, "/webhooks/twilio/inbound");

  const ok = await verifyTwilioSignature(
    twilio.TWILIO_AUTH_TOKEN, url, params, request.headers.get("X-Twilio-Signature"),
  );
  if (!ok) return new Response("invalid signature", { status: 403 });

  try {
    const env = getEnv(context as any);
    const service = createSupabaseServiceClient(env);
    await recordInboundMessage(service, {
      from: params.From ?? "", to: params.To ?? "", body: params.Body ?? "", messageSid: params.MessageSid ?? "",
    });
  } catch (err) {
    console.error("Twilio inbound processing failed", err);
    return new Response("processing error", { status: 500 });
  }
  return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
}
```

- [ ] **Step 3: Implement the status route**

Create `nudgepay-app/app/routes/webhooks.twilio.status.tsx`:

```tsx
import type { ActionFunctionArgs } from "react-router";
import { getEnv, getTwilioEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { verifyTwilioSignature, parseTwilioForm } from "../lib/twilio-webhook.server";
import { updateMessageStatus } from "../lib/twilio-messaging.server";

function publicUrl(twilioPublicBaseUrl: string | null, request: Request, path: string): string {
  return twilioPublicBaseUrl ? `${twilioPublicBaseUrl}${path}` : request.url;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const twilio = getTwilioEnv(context as any);
  const rawBody = await request.text();
  const params = parseTwilioForm(rawBody);
  const url = publicUrl(twilio.TWILIO_PUBLIC_BASE_URL, request, "/webhooks/twilio/status");

  const ok = await verifyTwilioSignature(
    twilio.TWILIO_AUTH_TOKEN, url, params, request.headers.get("X-Twilio-Signature"),
  );
  if (!ok) return new Response("invalid signature", { status: 403 });

  try {
    const env = getEnv(context as any);
    const service = createSupabaseServiceClient(env);
    await updateMessageStatus(service, {
      messageSid: params.MessageSid ?? "", status: params.MessageStatus ?? "", errorCode: params.ErrorCode ?? null,
    });
  } catch (err) {
    console.error("Twilio status processing failed", err);
    return new Response("processing error", { status: 500 });
  }
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Write the route security tests**

Create `nudgepay-app/tests/twilio-routes.test.ts`:

```ts
import { expect, test } from "vitest";
import { TEST_ENV } from "./helpers";
import { action as inboundAction } from "../app/routes/webhooks.twilio.inbound";
import { action as statusAction } from "../app/routes/webhooks.twilio.status";

function ctx() {
  return { cloudflare: { env: TEST_ENV } } as any;
}

test("inbound webhook rejects a bad signature with 403 before any DB work", async () => {
  const request = new Request("http://localhost/webhooks/twilio/inbound", {
    method: "POST",
    headers: { "X-Twilio-Signature": "wrong", "Content-Type": "application/x-www-form-urlencoded" },
    body: "From=%2B12295550101&Body=hi&MessageSid=SMx",
  });
  const res = await inboundAction({ request, context: ctx(), params: {} } as any);
  expect(res.status).toBe(403);
});

test("inbound webhook rejects a missing signature header with 403", async () => {
  const request = new Request("http://localhost/webhooks/twilio/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "From=%2B1&Body=hi",
  });
  const res = await inboundAction({ request, context: ctx(), params: {} } as any);
  expect(res.status).toBe(403);
});

test("status webhook rejects a bad signature with 403", async () => {
  const request = new Request("http://localhost/webhooks/twilio/status", {
    method: "POST",
    headers: { "X-Twilio-Signature": "wrong", "Content-Type": "application/x-www-form-urlencoded" },
    body: "MessageSid=SMx&MessageStatus=delivered",
  });
  const res = await statusAction({ request, context: ctx(), params: {} } as any);
  expect(res.status).toBe(403);
});
```

- [ ] **Step 5: Run tests + typecheck + build**

Run: `cd nudgepay-app && npx vitest run tests/twilio-routes.test.ts && npm run typecheck && npm run build`
Expected: 3 tests PASS; typecheck exit 0; build succeeds.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/routes/webhooks.twilio.inbound.tsx nudgepay-app/app/routes/webhooks.twilio.status.tsx nudgepay-app/app/routes.ts nudgepay-app/tests/twilio-routes.test.ts
git commit -m "feat: add signature-gated Twilio inbound + status webhook routes"
```

---

## Task 9: Per-invoice thread UI + dashboard link

**Files:**
- Create: `nudgepay-app/app/routes/invoices.$id.tsx`
- Modify: `nudgepay-app/app/routes.ts`, `nudgepay-app/app/routes/dashboard.tsx`

**Interfaces:**
- Consumes: `requireUser`/`resolveOrg`, `getEnv`. Reads via the USER client (RLS).
- Produces: GET `/invoices/:id` → loader returns the invoice, its customer (name/phone/consent), and the message thread (ordered by `created_at`); component renders the thread, a send form (posts to `/api/text/send`), a consent toggle (posts to itself), and the `?sms=` notice. The action toggles `customers.sms_consent`. Dashboard invoice rows link to `/invoices/:id`.

- [ ] **Step 1: Register the route**

In `nudgepay-app/app/routes.ts`, add:

```ts
  route("invoices/:id", "routes/invoices.$id.tsx"),
```

- [ ] **Step 2: Implement the thread route**

Create `nudgepay-app/app/routes/invoices.$id.tsx`:

```tsx
import { Form, useLoaderData, redirect, data, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";

type Message = {
  id: string;
  direction: string;
  body: string | null;
  status: string | null;
  created_at: string;
};

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });
  const invoiceId = params.id as string;

  const { data: inv } = await supabase
    .from("invoices")
    .select("id, qbo_doc_number, balance, due_date, status, customer_id, customers(name, phone, sms_consent)")
    .eq("org_id", org.org_id).eq("id", invoiceId).maybeSingle();
  if (!inv) throw redirect("/dashboard", { headers });

  const { data: messages } = await supabase
    .from("text_messages")
    .select("id, direction, body, status, created_at")
    .eq("org_id", org.org_id).eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true });

  const customer = (inv as any).customers as { name: string | null; phone: string | null; sms_consent: boolean } | null;
  const url = new URL(request.url);
  return data(
    {
      invoiceId,
      docNumber: (inv as any).qbo_doc_number as string | null,
      balance: (inv as any).balance as number | null,
      customerName: customer?.name ?? null,
      customerPhone: customer?.phone ?? null,
      consent: customer?.sms_consent ?? false,
      messages: (messages as unknown as Message[]) ?? [],
      sms: url.searchParams.get("sms"),
    },
    { headers },
  );
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return redirect("/onboarding", { headers });
  const invoiceId = params.id as string;

  // Consent toggle: a member attests the customer consented (or revokes it).
  const form = await request.formData();
  const consent = form.get("consent") === "true";
  const { data: inv } = await supabase
    .from("invoices").select("customer_id").eq("org_id", org.org_id).eq("id", invoiceId).maybeSingle();
  if (inv?.customer_id) {
    await supabase.from("customers").update({ sms_consent: consent }).eq("id", inv.customer_id as string);
  }
  return redirect(`/invoices/${invoiceId}`, { headers });
}

export default function InvoiceThread() {
  const { invoiceId, docNumber, balance, customerName, customerPhone, consent, messages, sms } =
    useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 640, margin: "48px auto", fontFamily: "sans-serif" }}>
      <p><a href="/dashboard">&larr; Dashboard</a></p>
      <h1>Invoice {docNumber ?? invoiceId}</h1>
      <p>{customerName ?? "(no customer)"} {customerPhone ? `· ${customerPhone}` : ""}
        {balance != null ? ` · Balance $${Number(balance).toFixed(2)}` : ""}</p>

      {sms === "sent" && <p>Text sent.</p>}
      {sms === "noconsent" && <p>Not sent — customer has not consented to SMS.</p>}
      {sms === "error" && <p>Could not send the text.</p>}

      <p>SMS consent: <strong>{consent ? "yes" : "no"}</strong>{" "}
        <Form method="post" style={{ display: "inline" }}>
          <input type="hidden" name="consent" value={consent ? "false" : "true"} />
          <button type="submit">{consent ? "Revoke consent" : "Mark consented"}</button>
        </Form>
      </p>

      <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, minHeight: 80 }}>
        {messages.length === 0 ? (
          <p>No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} style={{ textAlign: m.direction === "outbound" ? "right" : "left", margin: "6px 0" }}>
              <span style={{
                display: "inline-block", padding: "6px 10px", borderRadius: 12,
                background: m.direction === "outbound" ? "#0b5cff" : "#eee",
                color: m.direction === "outbound" ? "#fff" : "#000",
              }}>{m.body}</span>
              <div style={{ fontSize: 11, color: "#888" }}>
                {m.direction}{m.status ? ` · ${m.status}` : ""}
              </div>
            </div>
          ))
        )}
      </section>

      <Form method="post" action="/api/text/send" style={{ marginTop: 12 }}>
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <textarea name="body" rows={3} style={{ width: "100%" }} placeholder="Type a message…" required />
        <button type="submit" disabled={!consent}>Send text</button>
        {!consent && <span style={{ marginLeft: 8, color: "#888" }}>Mark consent to enable sending.</span>}
      </Form>
    </main>
  );
}
```

- [ ] **Step 3: Link dashboard invoice rows to the thread**

In `nudgepay-app/app/routes/dashboard.tsx`, in the invoice table body, make the invoice-number cell a link. Change the cell that renders `{inv.qbo_doc_number ?? "—"}` to:

```tsx
<td><a href={`/invoices/${inv.id}`}>{inv.qbo_doc_number ?? inv.id}</a></td>
```

Keep the rest of the dashboard exactly as-is (the loader already selects `id`).

- [ ] **Step 4: Verify typecheck + build + full suite**

Run: `cd nudgepay-app && npm run typecheck && npm run build && npx vitest run`
Expected: all exit 0 / green.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add nudgepay-app/app/routes/invoices.\$id.tsx nudgepay-app/app/routes.ts nudgepay-app/app/routes/dashboard.tsx
git commit -m "feat: add per-invoice SMS thread UI with consent toggle and dashboard link"
```

---

## Task 10: Live-trial verification doc

**Files:**
- Create: `docs/superpowers/phase3-live-trial-verification.md`

**Interfaces:** docs only — no code.

- [ ] **Step 1: Write the manual verification guide**

Create `docs/superpowers/phase3-live-trial-verification.md` documenting how to verify the SMS flow against a real Twilio TRIAL account WHEN ready (deferred per the "mock now" posture). Cover exactly:

1. **Trial prereqs & limits:** a Twilio trial can only send to **verified** phone numbers (verify your own number in Console → Phone Numbers → Verified Caller IDs); trial messages are prefixed "Sent from your Twilio trial account"; US A2P 10DLC registration under Chancey's brand is the production gate and should be **started now** (long lead time) — trial-to-verified-number testing does not need it.
2. **Secrets/tunnel:** set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and EITHER `TWILIO_MESSAGING_SERVICE_SID` OR `TWILIO_FROM_NUMBER` (the trial number, E.164) via `wrangler secret put` or `.dev.vars`. Set `TWILIO_PUBLIC_BASE_URL` to your public HTTPS tunnel origin (`cloudflared`/`ngrok`) or the deployed Workers origin — this value MUST match what Twilio calls, because the webhook signature is computed over the exact URL.
3. **Outbound:** seed/sync a customer whose `phone` is your verified number, open its invoice thread at `/invoices/:id`, click **Mark consented**, type a message, **Send text** → confirm the SMS arrives, an outbound `text_messages` row is written with the `twilio_message_sid` and an initial `status`.
4. **Status callback:** in Console, confirm `StatusCallback` points at `{TWILIO_PUBLIC_BASE_URL}/webhooks/twilio/status`; confirm the row's `status` advances (`queued`→`sent`→`delivered`) and `error_code` populates on failures. Verify a request with a wrong `X-Twilio-Signature` returns 403.
5. **Inbound + opt-out:** point the trial number's "A message comes in" webhook at `{TWILIO_PUBLIC_BASE_URL}/webhooks/twilio/inbound`. Reply from your phone → confirm an inbound row threads to the invoice. Text **STOP** → confirm `customers.sms_consent` flips to false (and the thread's Send button disables); text **START** → confirm it re-enables.
6. **Messaging Service (production path):** when moving off trial, create a Messaging Service, enable **Advanced Opt-Out**, register the A2P campaign, and set `TWILIO_MESSAGING_SERVICE_SID` (or per-org `messaging_config.messaging_service_sid`) — the send path switches with no code change.

- [ ] **Step 2: Commit**

```bash
cd "C:/Users/dasbl/WebstormProjects/nudgepay"
git add docs/superpowers/phase3-live-trial-verification.md
git commit -m "docs: add Phase 3 live Twilio trial verification guide"
```

---

## Phase 3 Definition of Done

- `npm run typecheck`, `npm run build`, and `npx vitest run` all pass (no manual reset needed).
- Outbound send is consent- and phone-gated, resolves the per-org/env sender (Messaging Service preferred, `from` fallback), calls Twilio behind an injectable fetch, and writes an outbound `text_messages` row — proven by `twilio-send.test.ts`.
- Inbound replies match the customer by phone, thread to the latest outbound invoice, honor STOP/START consent changes, and store an inbound row; unknown numbers store nothing — proven by `twilio-inbound.test.ts`.
- Delivery-status callbacks update the row by SID — proven by `twilio-inbound.test.ts`.
- Both webhook routes reject bad/absent `X-Twilio-Signature` with 403 before any DB work — proven by `twilio-routes.test.ts`; signature helpers proven by `twilio-webhook.test.ts`.
- The per-invoice thread UI shows messages, a consent toggle, and a send form (disabled without consent).
- Live trial verification documented as the deferred manual step; A2P 10DLC flagged to start now.

## Out of Scope (later phases / explicit deferrals)

- **Per-tenant Twilio senders** beyond reading `messaging_config` (schema-ready; no admin UI to set a tenant's Messaging Service — Phase 5/admin).
- **A2P 10DLC registration** itself (external Twilio/console process; flagged to start now).
- **Message templates / scheduled / bulk send** — Phase 3 sends ad-hoc per-invoice texts only.
- **Full iMessage-style UI polish** and porting the prototype's rich thread view — Phase 5 (UI cutover).
- **Multi-country phone normalization** — `normalizePhone` is US-last-10; a normalized phone column is the future fix if needed.
- **Inbound media (MMS)** — text bodies only.

---

## Self-Review (author)

- **Spec coverage (design §7 "Twilio SMS Integration"):** Messaging Service via `messaging_config` with `from`-number fallback (T1/T5) ✓; `POST /api/text/send` authed, writes a `text_messages` row (T5/T7) ✓; `POST /webhooks/twilio/inbound` signature-verified, matched to invoice/customer thread (T4/T6/T8) ✓; `POST /webhooks/twilio/status` updates the row (T6/T8) ✓; consent + STOP/HELP opt-out (T6, plus Messaging Service Advanced Opt-Out noted for production in T10) ✓; `text_messages` columns `twilio_message_sid`/`direction`/`status`/`error_code`/`from_number`/`to_number`/`sent_by_user_id`/`org_id` all written (exist since Phase 1; `customer_id` added T2) ✓; A2P 10DLC registration flagged to start now (T10) ✓.
- **Placeholder scan:** none — every code/SQL/test/doc step is complete and concrete.
- **Type consistency:** `TwilioConfig`/`TwilioSender`/`TwilioSendResult` (T3) consumed unchanged by `MessagingDeps`/`sendInvoiceText` (T5) and the send route (T7); `MessagingDeps` (T5) used by T7; `recordInboundMessage`/`updateMessageStatus` (T6) consumed by the webhook routes (T8); `verifyTwilioSignature`/`parseTwilioForm` (T4) consumed by T8; `getTwilioEnv`/`TwilioEnv` (T1) consumed by T7/T8; every helper signature matches its test call sites.
- **Known risks to verify at execution:** (1) the `customers(name, phone, sms_consent)` FK embed in the thread loader returns an object (many-to-one) — typed/cast as such; if PostgREST infers an array, switch to `inv.customers?.[0]`. (2) The webhook signature URL must equal the URL Twilio called — the routes prefer `TWILIO_PUBLIC_BASE_URL`; the live-trial doc calls this out as the #1 cause of 403s. (3) `getTwilioEnv` requires at least one sender; `.env.test` sets `TWILIO_FROM_NUMBER` so route tests construct a valid env. (4) inbound matching scans all customers with phones (O(n)) — fine at Chancey scale; noted for a future normalized column. (5) consent capture is a manual member attestation toggle in this phase (no double-opt-in flow) — acceptable for a 5-person internal AR tool; revisit if self-serve consent is needed.
