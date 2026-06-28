# Phase 15 — Email channel foundation (outbound) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the outbound transactional-email channel (Resend) end-to-end, mirroring the SMS stack: provider client, per-org enable + send gate, plain-text templates, `email_messages` thread, DetailPanel composer, and CAN-SPAM signed unsubscribe.

**Architecture:** Each SMS unit gets an email counterpart (`getEmailEnv`, `email-client.server`, `email-messaging.server`, `email-templates`, `email-settings`, `api.email.send`, `email_messages`). The Resend key is a platform env secret; the per-org switch is `email_config.email_enabled` (already exists, default false). Opt-out is `customers.do_not_email` set by a signed one-click unsubscribe link and a manual comm-prefs toggle.

**Tech Stack:** React Router v7 (framework mode) on Cloudflare Workers (fetch-only, no node SDKs), Supabase + RLS, Tailwind v4 (literal class strings), Vitest against local Supabase, Web Crypto (`crypto.subtle`).

## Global Constraints

- Email provider key is a platform-managed env secret (`RESEND_API_KEY`). No per-tenant credentials, no secret column in any tenant table.
- `UNSUBSCRIBE_SECRET` and `APP_PUBLIC_BASE_URL` are deploy-time env vars (set via `getEmailEnv`). Never exposed in UI/DB.
- Channel gate is server-enforced in `sendInvoiceEmail` (throws when `email_enabled = false`), never UI-only.
- Every Supabase read/insert on the send path uses fail-loud `if (error) throw error` — no swallowed errors that could bypass a gate (the Phase 14 PR #21 lesson).
- Email defaults **OFF**: absent `email_config` row ⇒ disabled (opposite of SMS, matching `email_config.email_enabled default false`).
- CAN-SPAM is opt-out: the gate checks `do_not_email` + contact-block only. There is NO `email_consent` record (unlike SMS/TCPA).
- Pure libs (`email-templates.ts`, `email-settings.ts`, `comm-prefs.ts`, `unsubscribe-token.ts`) have no I/O, no `node:*`, no `.server` suffix; safe in the client bundle.
- Tailwind: literal class strings only; reuse Phase-10 warm tokens (copper/cool/hot/ink, bg-surface/panel/paper, border-border, text-text/muted).
- Tests: per-test fresh orgs with `Math.random()` uniqueness; never global truncation.
- Never `git add -A` (untracked scratch under `nudgepay-app/.superpowers/` and demo scripts must not be committed). Never commit secrets.
- From-address must be on an operator-verified domain (app validates format only).

---

### Task 1: Migration `0021_email_outbound.sql`

**Files:**
- Create: `nudgepay-app/supabase/migrations/0021_email_outbound.sql`
- Test: `nudgepay-app/test/email-messages.rls.test.ts`

**Interfaces:**
- Produces: `customers.do_not_email boolean not null default false`; `email_messages` table (columns per spec §E); RLS `email_messages_member_read` (select/is_org_member) + `email_messages_owner_write` (all/is_org_owner). Consumed by Tasks 8, 10, 13, and Phase 16/17.

> Before writing, read `nudgepay-app/supabase/migrations/0001_tenancy_schema.sql` and replicate `text_messages`' exact column types, FK on-delete behavior, and RLS policy shape. The block below is the target; reconcile any mismatch in FK refs (`auth.users`, `gen_random_uuid()`) with how 0001 declares `text_messages`.

- [ ] **Step 1: Write the migration**

```sql
-- Phase 15 (subsystem #3a): outbound email channel.
--  * customers.do_not_email: CAN-SPAM per-customer opt-out. Email is now a
--    NudgePay channel (supersedes the 0017 "Email is not a NudgePay channel" note).
--  * email_messages: outbound (and, in #3b, inbound) email log. Mirrors
--    text_messages (0001) plus email-specific columns.
alter table customers add column do_not_email boolean not null default false;

create table email_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  case_id uuid references collection_cases(id) on delete set null,
  sent_by_user_id uuid references auth.users(id),
  direction text not null check (direction in ('outbound','inbound')),
  provider_message_id text,
  status text,
  error_code text,
  from_address text,
  to_address text,
  subject text,
  body text,
  created_at timestamptz not null default now()
);
alter table email_messages enable row level security;
create policy email_messages_member_read on email_messages
  for select using (is_org_member(org_id));
create policy email_messages_owner_write on email_messages
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));
create index email_messages_org_customer_idx on email_messages (org_id, customer_id, created_at);
```

- [ ] **Step 2: Write the failing RLS test**

Mirror an existing RLS test (e.g. the messaging/text_messages RLS test). Create two fresh orgs (unique slugs via `Math.random()`), insert an `email_messages` row in org A via the service client, assert a member of org A reads it via the user client and a member of org B reads zero rows. Also assert `customers.do_not_email` defaults to `false` on a freshly inserted customer.

```ts
import { describe, it, expect } from "vitest";
// ...reuse the project's test harness (fresh-org helper, service + user clients)...
describe("email_messages RLS + do_not_email default", () => {
  it("member reads own-org rows only; foreign org sees none", async () => {
    // insert email_messages in orgA via service client
    // assert userClientA select -> 1 row, userClientB select -> 0 rows
  });
  it("customers.do_not_email defaults false", async () => {
    // insert a customer; assert do_not_email === false
  });
});
```

- [ ] **Step 3: Apply migration locally**

Run: `cd nudgepay-app && npx supabase migration up` (or the project's migrate command from package.json).
Expected: migration `0021` applies; no errors.

- [ ] **Step 4: Run the test**

Run: `cd nudgepay-app && npx vitest run test/email-messages.rls.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/supabase/migrations/0021_email_outbound.sql nudgepay-app/test/email-messages.rls.test.ts
git commit -m "feat(email): add do_not_email + email_messages table (0021)"
```

---

### Task 2: `getEmailEnv` in `env.server.ts`

**Files:**
- Modify: `nudgepay-app/app/lib/env.server.ts`

**Interfaces:**
- Produces: `type EmailEnv = { RESEND_API_KEY: string; APP_PUBLIC_BASE_URL: string | null; UNSUBSCRIBE_SECRET: string }` and `getEmailEnv(context)`. Consumed by Tasks 9, 10.

- [ ] **Step 1: Add the type and function** (mirror `getTwilioEnv`, lines 48-73)

```ts
export type EmailEnv = {
  RESEND_API_KEY: string;
  APP_PUBLIC_BASE_URL: string | null; // public origin for unsubscribe links
  UNSUBSCRIBE_SECRET: string;
};

export function getEmailEnv(context: { cloudflare: { env: Record<string, string> } }): EmailEnv {
  const e = context.cloudflare.env;
  for (const k of ["RESEND_API_KEY", "UNSUBSCRIBE_SECRET"]) {
    if (!e[k]) throw new Error(`Missing required env var: ${k}`);
  }
  return {
    RESEND_API_KEY: e.RESEND_API_KEY,
    APP_PUBLIC_BASE_URL: e.APP_PUBLIC_BASE_URL || null,
    UNSUBSCRIBE_SECRET: e.UNSUBSCRIBE_SECRET,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd nudgepay-app && npx tsc --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 3: Add the vars to the local env example/config**

Add `RESEND_API_KEY`, `UNSUBSCRIBE_SECRET`, `APP_PUBLIC_BASE_URL` to `.dev.vars.example` (or whatever non-secret example file the repo uses; NEVER touch the gitignored real `.dev.vars`). If no example file exists, skip.

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/lib/env.server.ts
git commit -m "feat(email): add getEmailEnv for Resend + unsubscribe config"
```

---

### Task 3: Resend HTTP client `email-client.server.ts`

**Files:**
- Create: `nudgepay-app/app/lib/email-client.server.ts`
- Test: `nudgepay-app/test/email-client.test.ts`

**Interfaces:**
- Produces: `type EmailConfig = { apiKey: string }`; `type SendEmailArgs = { from: string; to: string; subject: string; text: string }`; `async sendEmail(fetchFn, cfg, args): Promise<{ id: string }>`. Consumed by Task 8.

- [ ] **Step 1: Write the failing test** (mock fetch; mirror `twilio-client.server` test if present)

```ts
import { describe, it, expect, vi } from "vitest";
import { sendEmail } from "../app/lib/email-client.server";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("sendEmail", () => {
  it("POSTs to Resend with bearer auth and returns the id", async () => {
    const f = mockFetch(200, { id: "re_123" });
    const res = await sendEmail(f as any, { apiKey: "key" },
      { from: "A <a@x.com>", to: "b@y.com", subject: "Hi", text: "body" });
    expect(res).toEqual({ id: "re_123" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init as any).method).toBe("POST");
    expect((init as any).headers.Authorization).toBe("Bearer key");
    expect(JSON.parse((init as any).body)).toEqual({ from: "A <a@x.com>", to: "b@y.com", subject: "Hi", text: "body" });
  });
  it("throws on non-2xx including the provider body", async () => {
    const f = mockFetch(422, { message: "domain not verified" });
    await expect(sendEmail(f as any, { apiKey: "k" },
      { from: "a@x.com", to: "b@y.com", subject: "s", text: "t" })).rejects.toThrow(/domain not verified/);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd nudgepay-app && npx vitest run test/email-client.test.ts`
Expected: FAIL ("sendEmail is not a function" / module not found).

- [ ] **Step 3: Implement**

```ts
// Resend REST client. Workers-friendly (fetch-only, no SDK). Fetch injected for
// testability, mirroring twilio-client.server.ts.

export type EmailConfig = { apiKey: string };
export type SendEmailArgs = { from: string; to: string; subject: string; text: string };

export async function sendEmail(
  fetchFn: typeof fetch, cfg: EmailConfig, args: SendEmailArgs,
): Promise<{ id: string }> {
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: args.from, to: args.to, subject: args.subject, text: args.text }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Resend send failed (${res.status}): ${text}`);
  }
  const json = text ? JSON.parse(text) : {};
  return { id: (json.id as string) ?? "" };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd nudgepay-app && npx vitest run test/email-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/email-client.server.ts nudgepay-app/test/email-client.test.ts
git commit -m "feat(email): Resend HTTP client (sendEmail)"
```

---

### Task 4: Signed unsubscribe token `unsubscribe-token.ts`

**Files:**
- Create: `nudgepay-app/app/lib/unsubscribe-token.ts`
- Test: `nudgepay-app/test/unsubscribe-token.test.ts`

**Interfaces:**
- Produces: `async signUnsubscribeToken(secret, orgId, customerId): Promise<string>`; `async verifyUnsubscribeToken(secret, token): Promise<{ orgId: string; customerId: string } | null>`. Consumed by Tasks 8, 10.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../app/lib/unsubscribe-token";

const SECRET = "test-secret";
describe("unsubscribe token", () => {
  it("round-trips org+customer", async () => {
    const t = await signUnsubscribeToken(SECRET, "org-1", "cust-1");
    expect(await verifyUnsubscribeToken(SECRET, t)).toEqual({ orgId: "org-1", customerId: "cust-1" });
  });
  it("rejects a tampered token", async () => {
    const t = await signUnsubscribeToken(SECRET, "org-1", "cust-1");
    expect(await verifyUnsubscribeToken(SECRET, t + "x")).toBeNull();
  });
  it("rejects a wrong secret", async () => {
    const t = await signUnsubscribeToken(SECRET, "org-1", "cust-1");
    expect(await verifyUnsubscribeToken("other", t)).toBeNull();
  });
  it("returns null on malformed input", async () => {
    expect(await verifyUnsubscribeToken(SECRET, "garbage")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd nudgepay-app && npx vitest run test/unsubscribe-token.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (Web Crypto HMAC-SHA256, base64url payload + sig)

```ts
// HMAC-signed unsubscribe token: base64url(payload) + "." + base64url(hmac).
// payload = JSON {o: orgId, c: customerId}. No expiry (opt-out links must keep
// working). Web Crypto only (Workers + vitest), no node:crypto.

function b64urlFromBytes(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlFromString(s: string): string {
  return b64urlFromBytes(new TextEncoder().encode(s));
}
function stringFromB64url(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64urlFromBytes(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signUnsubscribeToken(secret: string, orgId: string, customerId: string): Promise<string> {
  const payload = b64urlFromString(JSON.stringify({ o: orgId, c: customerId }));
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyUnsubscribeToken(
  secret: string, token: string,
): Promise<{ orgId: string; customerId: string } | null> {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const obj = JSON.parse(stringFromB64url(payload));
    if (typeof obj.o !== "string" || typeof obj.c !== "string") return null;
    return { orgId: obj.o, customerId: obj.c };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd nudgepay-app && npx vitest run test/unsubscribe-token.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/unsubscribe-token.ts nudgepay-app/test/unsubscribe-token.test.ts
git commit -m "feat(email): signed unsubscribe token (HMAC)"
```

---

### Task 5: Plain-text templates `email-templates.ts`

**Files:**
- Create: `nudgepay-app/app/lib/email-templates.ts`
- Test: `nudgepay-app/test/email-templates.test.ts`

**Interfaces:**
- Consumes: `TemplateVars` from `sms-templates.ts`.
- Produces: `type EmailTemplate = { id: string; label: string; subject: string; body: string }`; `EMAIL_TEMPLATES: EmailTemplate[]`; `applyEmailTemplate(text, vars): string`. Consumed by Task 14.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { EMAIL_TEMPLATES, applyEmailTemplate } from "../app/lib/email-templates";

describe("email templates", () => {
  it("substitutes known tokens in subject and body", () => {
    const out = applyEmailTemplate("Hi {customer}, invoice {invoice} for {balance} due {dueDate}",
      { customer: "Acme", invoice: "1001", balance: "$50.00", dueDate: "Jun 1" });
    expect(out).toBe("Hi Acme, invoice 1001 for $50.00 due Jun 1");
  });
  it("leaves unknown tokens untouched", () => {
    expect(applyEmailTemplate("{customer} {unknown}", { customer: "A", invoice: "", balance: "", dueDate: "" }))
      .toBe("A {unknown}");
  });
  it("every starter template has a non-empty subject and body", () => {
    expect(EMAIL_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const t of EMAIL_TEMPLATES) {
      expect(t.subject.trim()).not.toBe("");
      expect(t.body.trim()).not.toBe("");
    }
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd nudgepay-app && npx vitest run test/email-templates.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** (mirror `sms-templates.ts`; subject+body; reuse the `{token}` regex)

```ts
// Pure module (no I/O, no node:*, no secrets) — safe in client bundle and server.
// Plain-text email templates. {customer} {invoice} {balance} {dueDate} are filled
// from the selected account. The unsubscribe footer is appended by the send path,
// NOT stored here, so it is always present even on free-typed bodies.

import type { TemplateVars } from "./sms-templates";

export type EmailTemplate = { id: string; label: string; subject: string; body: string };

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: "friendly-reminder",
    label: "Friendly reminder",
    subject: "Reminder: invoice {invoice} from Chancey Heating & Cooling",
    body: "Hi {customer},\n\nThis is a friendly reminder that invoice {invoice} for {balance} was due {dueDate}. If you have already sent payment, thank you — please disregard this note. Otherwise, reply with any questions and we'll be glad to help.\n\nThank you,\nChancey Heating & Cooling",
  },
  {
    id: "past-due",
    label: "Past due",
    subject: "Past due: invoice {invoice}",
    body: "Hi {customer},\n\nInvoice {invoice} for {balance} is now past due as of {dueDate}. Please let us know when we can expect payment, or reply if there is anything we can help resolve.\n\nThank you,\nChancey Heating & Cooling",
  },
  {
    id: "final-notice",
    label: "Final notice",
    subject: "Final notice: invoice {invoice}",
    body: "{customer},\n\nInvoice {invoice} for {balance} remains unpaid and is now seriously past due. Please contact us promptly to arrange payment and avoid further action.\n\nChancey Heating & Cooling",
  },
  {
    id: "payment-received",
    label: "Payment received",
    subject: "Payment received — thank you",
    body: "Thanks {customer}!\n\nWe've received payment for invoice {invoice}. We appreciate your business.\n\nChancey Heating & Cooling",
  },
];

// Replace only the known tokens; leave any other {token} untouched.
export function applyEmailTemplate(text: string, vars: TemplateVars): string {
  return text.replace(
    /\{(customer|invoice|balance|dueDate)\}/g,
    (_m, key: keyof TemplateVars) => vars[key],
  );
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd nudgepay-app && npx vitest run test/email-templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/email-templates.ts nudgepay-app/test/email-templates.test.ts
git commit -m "feat(email): plain-text email templates"
```

---

### Task 6: Extend `comm-prefs.ts` with the email channel

**Files:**
- Modify: `nudgepay-app/app/lib/comm-prefs.ts`
- Test: `nudgepay-app/test/comm-prefs.test.ts` (extend, or create if absent)

**Interfaces:**
- Produces: `CHANNELS` includes `"email"`; `CommPrefs.doNotEmail: boolean`; `CommPrefsRow.do_not_email?`; `canSendEmail(prefs): boolean`. Consumed by Tasks 11, 15, and Phase 17.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolveCommPrefs, canSendEmail, channelBlocked, CHANNELS } from "../app/lib/comm-prefs";

describe("comm-prefs email channel", () => {
  it("includes email in CHANNELS", () => {
    expect(CHANNELS).toContain("email");
  });
  it("resolves do_not_email", () => {
    expect(resolveCommPrefs({ do_not_email: true }).doNotEmail).toBe(true);
    expect(resolveCommPrefs(null).doNotEmail).toBe(false);
  });
  it("canSendEmail is true unless opted out (no consent term)", () => {
    expect(canSendEmail(resolveCommPrefs({ do_not_email: false }))).toBe(true);
    expect(canSendEmail(resolveCommPrefs({ do_not_email: true }))).toBe(false);
  });
  it("channelBlocked handles email", () => {
    expect(channelBlocked(resolveCommPrefs({ do_not_email: true }), "email")).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd nudgepay-app && npx vitest run test/comm-prefs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the edits to `comm-prefs.ts`:

- Update the header comment: email IS now a NudgePay channel.
- `export const CHANNELS = ["call", "text", "email"] as const;`
- `isChannel`: `return v === "call" || v === "text" || v === "email";`
- `CommPrefs` add `doNotEmail: boolean;`; `DEFAULT_COMM_PREFS` add `doNotEmail: false,`.
- `CommPrefsRow` add `do_not_email?: boolean | null;`.
- `resolveCommPrefs` add `doNotEmail: Boolean(row.do_not_email),`.
- Add:
```ts
// Single source of truth for email eligibility: not opted out. CAN-SPAM is
// opt-out, so (unlike canSendSms) there is no positive-consent term.
export function canSendEmail(prefs: CommPrefs): boolean {
  return !prefs.doNotEmail;
}
```
- `channelBlocked` switch add `case "email": return prefs.doNotEmail;`.

- [ ] **Step 4: Run, verify pass**

Run: `cd nudgepay-app && npx vitest run test/comm-prefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/comm-prefs.ts nudgepay-app/test/comm-prefs.test.ts
git commit -m "feat(email): add email channel + do_not_email to comm-prefs"
```

---

### Task 7: Email settings deriver `email-settings.ts`

**Files:**
- Create: `nudgepay-app/app/lib/email-settings.ts`
- Test: `nudgepay-app/test/email-settings.test.ts`

**Interfaces:**
- Produces: `type EmailSettings = { emailEnabled: boolean; fromAddress: string; fromName: string }`; `resolveEmailSettings(row): EmailSettings`; `parseEmailSettingsUpdate(form): { ok: true; value: { email_enabled: boolean; from_address: string; from_name: string } } | { ok: false; error: string }`. Consumed by Tasks 11, 12, 13.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolveEmailSettings, parseEmailSettingsUpdate } from "../app/lib/email-settings";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("email settings", () => {
  it("defaults: absent row => disabled, empty strings", () => {
    expect(resolveEmailSettings(null)).toEqual({ emailEnabled: false, fromAddress: "", fromName: "" });
  });
  it("resolves a row", () => {
    expect(resolveEmailSettings({ email_enabled: true, from_address: "a@x.com", from_name: "A" }))
      .toEqual({ emailEnabled: true, fromAddress: "a@x.com", fromName: "A" });
  });
  it("accepts a valid from address", () => {
    const r = parseEmailSettingsUpdate(fd({ email_enabled: "true", from_address: "billing@x.com", from_name: "Chancey" }));
    expect(r).toEqual({ ok: true, value: { email_enabled: true, from_address: "billing@x.com", from_name: "Chancey" } });
  });
  it("rejects a malformed from address", () => {
    const r = parseEmailSettingsUpdate(fd({ email_enabled: "true", from_address: "not-an-email", from_name: "" }));
    expect(r.ok).toBe(false);
  });
  it("allows empty from address when disabled", () => {
    const r = parseEmailSettingsUpdate(fd({ email_enabled: "false", from_address: "", from_name: "" }));
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd nudgepay-app && npx vitest run test/email-settings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** (mirror `channel-settings.ts`)

```ts
// Pure module — no I/O, no .server. Per-org email config derivation + form
// parsing, mirroring channel-settings.ts. Absent row => disabled (email defaults
// OFF). Address is format-validated; domain verification is an operator concern.

export type EmailSettings = { emailEnabled: boolean; fromAddress: string; fromName: string };

export type EmailConfigRow = {
  email_enabled?: boolean | null;
  from_address?: string | null;
  from_name?: string | null;
};

export function resolveEmailSettings(row: EmailConfigRow | null | undefined): EmailSettings {
  return {
    emailEnabled: Boolean(row?.email_enabled),
    fromAddress: (row?.from_address ?? "").trim(),
    fromName: (row?.from_name ?? "").trim(),
  };
}

// Conservative RFC-5322-lite check: non-empty local + "@" + dotted domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailSettingsUpdate =
  | { ok: true; value: { email_enabled: boolean; from_address: string; from_name: string } }
  | { ok: false; error: string };

export function parseEmailSettingsUpdate(form: FormData): EmailSettingsUpdate {
  const email_enabled = form.get("email_enabled") === "true";
  const from_address = (typeof form.get("from_address") === "string" ? (form.get("from_address") as string) : "").trim();
  const from_name = (typeof form.get("from_name") === "string" ? (form.get("from_name") as string) : "").trim();
  if (from_address !== "" && !EMAIL_RE.test(from_address)) {
    return { ok: false, error: "address" };
  }
  return { ok: true, value: { email_enabled, from_address, from_name } };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd nudgepay-app && npx vitest run test/email-settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/email-settings.ts nudgepay-app/test/email-settings.test.ts
git commit -m "feat(email): email-settings deriver + validation"
```

---

### Task 8: Send orchestration + gate `email-messaging.server.ts`

**Files:**
- Create: `nudgepay-app/app/lib/email-messaging.server.ts`
- Test: `nudgepay-app/test/email-messaging.gate.test.ts`

**Interfaces:**
- Consumes: `sendEmail`/`EmailConfig` (Task 3); `signUnsubscribeToken` (Task 4); `isContactBlocked`/`ExceptionState` from `exceptions`.
- Produces: `type EmailDeps`; `async sendInvoiceEmail(deps, args): Promise<{ id: string; providerMessageId: string }>`. Consumed by Tasks 9.

> Read `app/lib/twilio-messaging.server.ts` (`sendInvoiceText`, `activeCaseForSend`) first and mirror its structure and fail-loud error handling exactly.

- [ ] **Step 1: Write the failing gate-matrix test** (DB-backed, mocked fetch)

```ts
import { describe, it, expect, vi } from "vitest";
import { sendInvoiceEmail } from "../app/lib/email-messaging.server";
// reuse the project's fresh-org helper + service client

function deps(fetchFn: any) {
  return {
    fetchFn,
    service: /* service client */ undefined as any,
    email: { apiKey: "k" },
    unsubscribeBaseUrl: "https://app.example.com",
    unsubscribeSecret: "secret",
  };
}

describe("sendInvoiceEmail gate matrix", () => {
  it("throws + no provider call + no row when email disabled (absent config)", async () => {
    const f = vi.fn();
    // org with email_config absent, customer with email
    await expect(sendInvoiceEmail(deps(f), { orgId, invoiceId, userId, subject: "s", body: "b" }))
      .rejects.toThrow(/disabled/i);
    expect(f).not.toHaveBeenCalled();
    // assert 0 email_messages rows
  });
  it("throws when customer has no email", async () => { /* ... */ });
  it("throws when do_not_email", async () => { /* ... */ });
  it("throws when contact-blocked", async () => { /* ... */ });
  it("happy path: provider called once, one outbound row, footer appended", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
    // email_config enabled + from_address set, customer with email, not opted out
    const res = await sendInvoiceEmail(deps(f), { orgId, invoiceId, userId, subject: "Hi", body: "Pay up" });
    expect(res.providerMessageId).toBe("re_1");
    expect(f).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((f.mock.calls[0][1] as any).body);
    expect(sent.text).toMatch(/unsubscribe/i);
    // assert exactly one outbound email_messages row, body includes footer
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd nudgepay-app && npx vitest run test/email-messaging.gate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, type EmailConfig } from "./email-client.server";
import { signUnsubscribeToken } from "./unsubscribe-token";
import { activeCaseForSend } from "./twilio-messaging.server";
import { isContactBlocked } from "./exceptions";

export type EmailDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;
  email: EmailConfig;
  unsubscribeBaseUrl: string; // APP_PUBLIC_BASE_URL (non-null at call site)
  unsubscribeSecret: string;
};

function formatSender(fromAddress: string, fromName: string): string {
  return fromName ? `${fromName} <${fromAddress}>` : fromAddress;
}

export async function sendInvoiceEmail(
  deps: EmailDeps,
  args: { orgId: string; invoiceId: string; userId: string; subject: string; body: string },
): Promise<{ id: string; providerMessageId: string }> {
  const { data: inv, error: invErr } = await deps.service.from("invoices")
    .select("customer_id").eq("org_id", args.orgId).eq("id", args.invoiceId).maybeSingle();
  if (invErr) throw invErr;
  if (!inv?.customer_id) throw new Error("Invoice has no linked customer");

  const { data: cust, error: custErr } = await deps.service.from("customers")
    .select("id, email, do_not_email").eq("id", inv.customer_id as string).maybeSingle();
  if (custErr) throw custErr;
  if (!cust?.email) throw new Error("Customer has no email address");

  // Org-level email switch. Absent row => DISABLED (email defaults off). Fail loud
  // on DB error so a silent null cannot bypass the gate (Phase 14 PR #21 lesson).
  const { data: ec, error: ecErr } = await deps.service.from("email_config")
    .select("email_enabled, from_address, from_name").eq("org_id", args.orgId).maybeSingle();
  if (ecErr) throw ecErr;
  if (!ec || ec.email_enabled !== true) throw new Error("Email disabled for this workspace");
  if (!ec.from_address) throw new Error("No from address configured");

  // Contact-block (case legal hold) dominates the per-customer opt-out, mirroring SMS.
  const activeCase = await activeCaseForSend(deps.service, args.orgId, cust.id as string);
  if (isContactBlocked(activeCase.exceptionReason)) {
    throw new Error(`Contact blocked: ${activeCase.exceptionReason}`);
  }
  if (cust.do_not_email) throw new Error("Customer has opted out of email");

  const token = await signUnsubscribeToken(deps.unsubscribeSecret, args.orgId, cust.id as string);
  const unsubUrl = `${deps.unsubscribeBaseUrl}/unsubscribe?token=${token}`;
  const bodyWithFooter = `${args.body}\n\n—\nTo stop receiving these emails, unsubscribe: ${unsubUrl}`;
  const from = formatSender(ec.from_address as string, (ec.from_name as string | null) ?? "");

  const result = await sendEmail(deps.fetchFn, deps.email, {
    from, to: cust.email as string, subject: args.subject, text: bodyWithFooter,
  });

  const { data: row, error: insErr } = await deps.service.from("email_messages").insert({
    org_id: args.orgId,
    invoice_id: args.invoiceId,
    customer_id: cust.id as string,
    case_id: activeCase.id,
    sent_by_user_id: args.userId,
    direction: "outbound",
    provider_message_id: result.id,
    status: "sent",
    from_address: ec.from_address as string,
    to_address: cust.email as string,
    subject: args.subject,
    body: bodyWithFooter,
  }).select("id").single();
  if (insErr) throw insErr;

  return { id: row!.id as string, providerMessageId: result.id };
}
```

> Note: `customers.email` exists (`0001_tenancy_schema.sql` line 42, `email text`) — the gate reads it directly; no schema change needed.

- [ ] **Step 4: Run, verify pass**

Run: `cd nudgepay-app && npx vitest run test/email-messaging.gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/email-messaging.server.ts nudgepay-app/test/email-messaging.gate.test.ts
git commit -m "feat(email): sendInvoiceEmail gate + outbound record"
```

---

### Task 9: Send route `api.email.send.tsx` + `withEmail` helper

**Files:**
- Create: `nudgepay-app/app/routes/api.email.send.tsx`
- Modify: `nudgepay-app/app/lib/return-to.ts`

**Interfaces:**
- Consumes: `getEmailEnv` (Task 2), `sendInvoiceEmail`/`EmailDeps` (Task 8).
- Produces: `withEmail(returnTo, code)`; route `/api/email/send`. Consumed by Tasks 13, 14, and Phase 17.

- [ ] **Step 1: Add `withEmail` to `return-to.ts`**

```ts
// Append an email-result code onto an already-validated return path.
export function withEmail(returnTo: string, code: string): string {
  const sep = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${sep}email=${code}`;
}
```

- [ ] **Step 2: Implement the route** (mirror `api.text.send.tsx`)

```tsx
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getEmailEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { sendInvoiceEmail, type EmailDeps } from "../lib/email-messaging.server";
import { safeReturnTo, withEmail } from "../lib/return-to";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const emailEnv = getEmailEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const invoiceId = typeof form.get("invoiceId") === "string" ? (form.get("invoiceId") as string) : "";
  const subject = typeof form.get("subject") === "string" ? (form.get("subject") as string).trim() : "";
  const body = typeof form.get("body") === "string" ? (form.get("body") as string).trim() : "";
  if (!invoiceId || !subject || !body) return redirect(withEmail(returnTo, "error"), { headers });
  if (!emailEnv.APP_PUBLIC_BASE_URL) return redirect(withEmail(returnTo, "error"), { headers });

  const service = createSupabaseServiceClient(env);
  const deps: EmailDeps = {
    fetchFn: fetch,
    service,
    email: { apiKey: emailEnv.RESEND_API_KEY },
    unsubscribeBaseUrl: emailEnv.APP_PUBLIC_BASE_URL,
    unsubscribeSecret: emailEnv.UNSUBSCRIBE_SECRET,
  };
  try {
    await sendInvoiceEmail(deps, { orgId: org.org_id, invoiceId, userId: user.id, subject, body });
    return redirect(withEmail(returnTo, "sent"), { headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    const reason = /disabled/i.test(msg) ? "disabled"
      : /blocked/i.test(msg) ? "blocked"
      : /opted out/i.test(msg) ? "optout"
      : "error";
    return redirect(withEmail(returnTo, reason), { headers });
  }
}

export function loader() {
  return redirect("/dashboard");
}
```

- [ ] **Step 3: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build`
Expected: PASS (route registered, no type errors).

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/routes/api.email.send.tsx nudgepay-app/app/lib/return-to.ts
git commit -m "feat(email): /api/email/send route + withEmail helper"
```

---

### Task 10: Public unsubscribe route `unsubscribe.tsx`

**Files:**
- Create: `nudgepay-app/app/routes/unsubscribe.tsx`
- Test: `nudgepay-app/test/unsubscribe.route.test.ts`

**Interfaces:**
- Consumes: `getEmailEnv` (Task 2), `verifyUnsubscribeToken` (Task 4).

- [ ] **Step 1: Write the failing test** (DB-backed loader)

```ts
import { describe, it, expect } from "vitest";
import { loader } from "../app/routes/unsubscribe";
import { signUnsubscribeToken } from "../app/lib/unsubscribe-token";
// fresh org + customer via service client; build a fake context with cloudflare.env

describe("unsubscribe route", () => {
  it("valid token sets do_not_email", async () => {
    const token = await signUnsubscribeToken("secret", orgId, customerId);
    await loader({ request: new Request(`https://x/unsubscribe?token=${token}`), context, params: {} } as any);
    // assert customers.do_not_email === true
  });
  it("invalid token leaves do_not_email unchanged and does not throw", async () => {
    await loader({ request: new Request("https://x/unsubscribe?token=bad"), context, params: {} } as any);
    // assert do_not_email still false
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd nudgepay-app && npx vitest run test/unsubscribe.route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** (public, no auth; loader performs idempotent opt-out)

```tsx
import { useLoaderData, data, type LoaderFunctionArgs } from "react-router";
import { getEnv, getEmailEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { verifyUnsubscribeToken } from "../lib/unsubscribe-token";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const emailEnv = getEmailEnv(context as any);
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const parsed = await verifyUnsubscribeToken(emailEnv.UNSUBSCRIBE_SECRET, token);
  if (!parsed) return data({ ok: false });

  const env = getEnv(context as any);
  const service = createSupabaseServiceClient(env);
  // Idempotent opt-out scoped to the token's org + customer.
  const { error } = await service.from("customers")
    .update({ do_not_email: true })
    .eq("org_id", parsed.orgId).eq("id", parsed.customerId);
  if (error) return data({ ok: false });
  return data({ ok: true });
}

export default function Unsubscribe() {
  const d = useLoaderData<typeof loader>();
  return (
    <main className="min-h-screen flex items-center justify-center bg-surface p-6">
      <div className="max-w-md rounded-lg border border-border bg-panel p-6 text-center">
        {d.ok ? (
          <>
            <h1 className="text-lg font-semibold text-text">You're unsubscribed</h1>
            <p className="mt-2 text-sm text-muted">You will no longer receive collection emails from us. If this was a mistake, contact us and we'll re-enable email.</p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-text">Link invalid or expired</h1>
            <p className="mt-2 text-sm text-muted">We couldn't process this unsubscribe link. Please contact us directly to update your preferences.</p>
          </>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd nudgepay-app && npx vitest run test/unsubscribe.route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/routes/unsubscribe.tsx nudgepay-app/test/unsubscribe.route.test.ts
git commit -m "feat(email): public signed unsubscribe route"
```

---

### Task 11: `save_email` intent + comm-prefs `do_not_email` parse

**Files:**
- Modify: `nudgepay-app/app/routes/api.org-settings.tsx`
- Modify: `nudgepay-app/app/routes/api.comm-prefs.tsx`
- Test: `nudgepay-app/test/save-email.action.test.ts`

**Interfaces:**
- Consumes: `parseEmailSettingsUpdate` (Task 7), `parseCommPrefsUpdate` extension.

- [ ] **Step 1: Write the failing action test**

```ts
import { describe, it, expect } from "vitest";
import { action } from "../app/routes/api.org-settings";
// owner session + fresh org; post intent=save_email

describe("save_email", () => {
  it("owner writes email_config", async () => {
    // post email_enabled=true, from_address=billing@x.com, from_name=Chancey
    // assert email_config row persisted; redirect ?saved=1
  });
  it("rejects a malformed from address with ?error=email", async () => {
    // post from_address=bad; assert redirect Location includes error=email; no write
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd nudgepay-app && npx vitest run test/save-email.action.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the `save_email` branch** to `api.org-settings.tsx` (after `save_channels`):

```ts
import { parseEmailSettingsUpdate } from "../lib/email-settings";
// ...
  if (intent === "save_email") {
    const parsed = parseEmailSettingsUpdate(form);
    if (!parsed.ok) return redirect(flag(returnTo, "error", "email"), { headers });
    const { error } = await supabase.from("email_config")
      .upsert({ org_id: org.org_id, ...parsed.value }, { onConflict: "org_id" });
    if (error) return redirect(flag(returnTo, "error", "save"), { headers });
    return redirect(flag(returnTo, "saved", "1"), { headers });
  }
```

- [ ] **Step 4: Extend `parseCommPrefsUpdate`** in `api.comm-prefs.tsx`:

Add to the returned object and its type: `do_not_email: form.get("do_not_email") === "true",`.

- [ ] **Step 5: Run, verify pass + typecheck**

Run: `cd nudgepay-app && npx vitest run test/save-email.action.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/routes/api.org-settings.tsx nudgepay-app/app/routes/api.comm-prefs.tsx nudgepay-app/test/save-email.action.test.ts
git commit -m "feat(email): save_email intent + comm-prefs do_not_email"
```

---

### Task 12: Settings — writable email panel

**Files:**
- Modify: `nudgepay-app/app/routes/settings.tsx`

**Interfaces:**
- Consumes: `resolveEmailSettings` (Task 7), `save_email` intent (Task 11).

> Read `settings.tsx`'s existing SMS toggle panel (Phase 14) and the existing read-only email section, and mirror the SMS panel's owner-gated form structure, warm-token styling, and `?saved=1`/`?error=` banner handling.

- [ ] **Step 1: Load email config in the loader**

Add a `email_config` read (user client) → `resolveEmailSettings(...)`, return `emailSettings` in the loader data.

- [ ] **Step 2: Render the owner-editable panel**

A `<form method="post" action="/api/org-settings">` with hidden `intent=save_email` and `returnTo=/settings`, an **Enable email** checkbox (`name="email_enabled" value="true"`), a **From address** `<input type="email" name="from_address">` with a helper note "Must be on a domain you've verified with Resend (SPF/DKIM)", and a **From name** `<input name="from_name">`. Members see read-only text (mirror the SMS panel's owner gate). Surface `?error=email` as "Enter a valid from address".

- [ ] **Step 3: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/routes/settings.tsx
git commit -m "feat(email): writable email config panel in Settings"
```

---

### Task 13: Dashboard loader — email thread + gate threading

**Files:**
- Modify: `nudgepay-app/app/routes/dashboard.tsx`

**Interfaces:**
- Consumes: `resolveEmailSettings` (Task 7).
- Produces: `emailEnabled` + per-case `emailMessages` + customer `email`/`do_not_email` in loader data → DetailPanel props. Consumed by Task 14.

> Mirror exactly how Phase 14 threaded `smsEnabled` and how the dashboard loads the per-case SMS thread for the DetailPanel.

- [ ] **Step 1: Load `email_config` → `emailEnabled`** (user client), parallel to `messaging_config`/`smsEnabled`.

- [ ] **Step 2: Load the selected case's `email_messages`** thread (user client, org-scoped) and the customer's `email` + `do_not_email`, shaped into the props the DetailPanel email tab consumes (reuse a `MessageEntry`-like shape; subject included).

- [ ] **Step 3: Pass `emailEnabled`, `emailMessages`, `customerEmail`, `doNotEmail` to `DetailPanel`.**

- [ ] **Step 4: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/routes/dashboard.tsx
git commit -m "feat(email): load email thread + gate into dashboard DetailPanel"
```

---

### Task 14: DetailPanel — Email tab + composer

**Files:**
- Modify: `nudgepay-app/app/components/DetailPanel.tsx`

**Interfaces:**
- Consumes: `EMAIL_TEMPLATES`/`applyEmailTemplate` (Task 5), `emailEnabled`/`emailMessages`/`customerEmail`/`doNotEmail` props (Task 13), `/api/email/send` (Task 9).

> Read the existing SMS `MessagesTab` in `DetailPanel.tsx` and mirror it: thread bubbles, template picker, composer, and the disabled-with-reason gating.

- [ ] **Step 1: Add an "Email" tab** to the tab set (Overview / Timeline / Messages / Email).

- [ ] **Step 2: Render the email thread** (`emailMessages`): subject + body bubbles, outbound/inbound styling (do not assume only outbound — inbound arrives in Phase 16).

- [ ] **Step 3: Render the composer**: a `<form method="post" action="/api/email/send">` with hidden `invoiceId` + `returnTo`, a template `<select>` (fills subject+body from `EMAIL_TEMPLATES` via `applyEmailTemplate` and the existing template vars), a **subject** input, a **body** textarea, and a Send button.

- [ ] **Step 4: Disabled-with-reason gating** (derive a reason string, mirror SMS): email disabled for workspace (`!emailEnabled`) / no customer email / `doNotEmail` / contact-blocked. Show the reason; disable the composer (not merely hide).

- [ ] **Step 5: Surface `?email=` result codes** (sent/disabled/optout/blocked/error) as a banner, mirroring the SMS `?sms=` handling.

- [ ] **Step 6: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/components/DetailPanel.tsx
git commit -m "feat(email): DetailPanel Email tab + composer"
```

---

### Task 15: CommPrefsDrawer — "Do not email" checkbox

**Files:**
- Modify: `nudgepay-app/app/components/CommPrefsDrawer.tsx`

**Interfaces:**
- Consumes: `do_not_email` parse (Task 11), `CommPrefs.doNotEmail` (Task 6).

> Read the existing do-not-call / do-not-text checkboxes in `CommPrefsDrawer.tsx` and add a third identical "Do not email" checkbox (`name="do_not_email" value="true"`), bound to `prefs.doNotEmail`.

- [ ] **Step 1: Add the checkbox** alongside do-not-call / do-not-text.

- [ ] **Step 2: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run: `cd nudgepay-app && npx vitest run`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/components/CommPrefsDrawer.tsx
git commit -m "feat(email): manual do-not-email toggle in comm-prefs drawer"
```

---

## Self-Review notes

- **Spec coverage:** §A→T2, §B→T3, §C→T8, §D→T4+T10, §E→T1, §F→T6+T11+T15, §G→T5, §H→T9, §I→T7+T11+T12, §J→T13+T14, §K→spec doc. All covered.
- **`customers.email`:** confirmed present (`0001` line 42) — gate in Task 8 reads it; no migration change.
- **Type consistency:** `EmailConfig` (T3) used in `EmailDeps` (T8) and route (T9); `EmailSettings`/`parseEmailSettingsUpdate` (T7) used in T11/T12/T13; `withEmail` (T9) used in T9 route and T14 banner.
- **RLS shape (T1):** must match `text_messages` after reading 0001 — do not guess member-write vs owner-write; replicate.
```
