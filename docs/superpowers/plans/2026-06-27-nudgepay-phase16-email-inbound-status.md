# Phase 16 — Email inbound + delivery status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inbound email capture and Resend delivery-status tracking via one signed webhook, mirroring the Twilio inbound + status webhooks.

**Architecture:** A pure Svix verifier + a pure event mapper feed `webhooks.resend.tsx`, which dispatches to `updateEmailStatus` (status by `provider_message_id`, opt-out on hard bounce/complaint) or `recordInboundEmail` (sender-address match → inbound `email_messages` row), both added to `email-messaging.server.ts`.

**Tech Stack:** React Router v7 on Cloudflare Workers (fetch-only), Supabase + RLS, Vitest, Web Crypto (`crypto.subtle`, HMAC-SHA256).

## Global Constraints

- Depends on Phase 15: `email_messages`, `email-messaging.server.ts`, `customers.do_not_email`, `getEmailEnv`, `EmailDeps`.
- `RESEND_WEBHOOK_SECRET` is a platform env secret (`whsec_…`); never in UI/DB.
- Signature verification is mandatory before any processing; bad/missing/stale signature → 401, no DB writes.
- Ignored/unknown event types → 204 no-op (never 500 — avoids provider retry storms). DB processing errors → 500 (provider retries).
- Pure libs (`resend-webhook.server.ts` is `.server` but I/O-free; `email-events.ts` no `.server`, no I/O) — Web Crypto only, no `node:crypto`.
- All Phase 15 constraints remain: fail-loud reads on write paths, never `git add -A`, never commit secrets.
- Tests: per-test fresh orgs with `Math.random()` uniqueness; never global truncation.

---

### Task 1: `RESEND_WEBHOOK_SECRET` in `getEmailEnv`

**Files:**
- Modify: `nudgepay-app/app/lib/env.server.ts`

**Interfaces:**
- Produces: `EmailEnv.RESEND_WEBHOOK_SECRET: string` (required). Consumed by Task 4.

- [ ] **Step 1: Add the field** to `EmailEnv`, the required-keys loop, and the return object in `getEmailEnv`:

```ts
// in EmailEnv:
  RESEND_WEBHOOK_SECRET: string;
// in the required loop:
  for (const k of ["RESEND_API_KEY", "UNSUBSCRIBE_SECRET", "RESEND_WEBHOOK_SECRET"]) {
// in the return:
    RESEND_WEBHOOK_SECRET: e.RESEND_WEBHOOK_SECRET,
```

- [ ] **Step 2: Typecheck**

Run: `cd nudgepay-app && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add nudgepay-app/app/lib/env.server.ts
git commit -m "feat(email): add RESEND_WEBHOOK_SECRET to getEmailEnv"
```

---

### Task 2: Svix verifier `resend-webhook.server.ts`

**Files:**
- Create: `nudgepay-app/app/lib/resend-webhook.server.ts`
- Test: `nudgepay-app/test/resend-webhook.test.ts`

**Interfaces:**
- Produces: `async verifyResendSignature(secret, headers, rawBody, nowMs?): Promise<boolean>`. Consumed by Task 4.

> Read `app/lib/twilio-webhook.server.ts` first; reuse its `b64encode`/`timingSafeEqual` idioms and Web Crypto importKey pattern.

- [ ] **Step 1: Write the failing test** (sign a payload, verify round-trip)

```ts
import { describe, it, expect } from "vitest";
import { verifyResendSignature } from "../app/lib/resend-webhook.server";

// Build a valid signature the way Svix does, so the test is self-contained.
async function signSvix(secretB64: string, id: string, ts: string, body: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  let s = ""; for (const b of new Uint8Array(sig)) s += String.fromCharCode(b);
  return `v1,${btoa(s)}`;
}

const SECRET_B64 = btoa("super-secret-key-bytes");
const WHSEC = `whsec_${SECRET_B64}`;

describe("verifyResendSignature", () => {
  const id = "msg_1";
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_1" } });
  it("accepts a valid signature within the time window", async () => {
    const now = 1_700_000_000_000;
    const ts = String(Math.floor(now / 1000));
    const sig = await signSvix(SECRET_B64, id, ts, body);
    expect(await verifyResendSignature(WHSEC, { id, timestamp: ts, signature: sig }, body, now)).toBe(true);
  });
  it("rejects a tampered body", async () => {
    const now = 1_700_000_000_000;
    const ts = String(Math.floor(now / 1000));
    const sig = await signSvix(SECRET_B64, id, ts, body);
    expect(await verifyResendSignature(WHSEC, { id, timestamp: ts, signature: sig }, body + "x", now)).toBe(false);
  });
  it("rejects a stale timestamp", async () => {
    const now = 1_700_000_000_000;
    const ts = String(Math.floor((now - 10 * 60_000) / 1000));
    const sig = await signSvix(SECRET_B64, id, ts, body);
    expect(await verifyResendSignature(WHSEC, { id, timestamp: ts, signature: sig }, body, now)).toBe(false);
  });
  it("rejects a missing header", async () => {
    expect(await verifyResendSignature(WHSEC, { id: null, timestamp: "1", signature: "v1,x" }, body, 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd nudgepay-app && npx vitest run test/resend-webhook.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// Svix webhook signature verification (Resend). Signed content is
// `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256 with the base64-decoded
// secret (the part after "whsec_"). svix-signature is space-separated
// "v1,<b64sig>" entries; accept if any matches. Web Crypto only (no node:crypto).

const FIVE_MIN_MS = 5 * 60_000;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export async function verifyResendSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const tsSec = Number(timestamp);
  if (!Number.isFinite(tsSec)) return false;
  if (Math.abs(nowMs - tsSec * 1000) > FIVE_MIN_MS) return false;

  const secretB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  const expected = b64encode(new Uint8Array(sig));

  for (const part of signature.split(" ")) {
    const comma = part.indexOf(",");
    const value = comma >= 0 ? part.slice(comma + 1) : part;
    if (timingSafeEqual(expected, value)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd nudgepay-app && npx vitest run test/resend-webhook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/resend-webhook.server.ts nudgepay-app/test/resend-webhook.test.ts
git commit -m "feat(email): Svix webhook signature verification"
```

---

### Task 3: Event mapper `email-events.ts`

**Files:**
- Create: `nudgepay-app/app/lib/email-events.ts`
- Test: `nudgepay-app/test/email-events.test.ts`

**Interfaces:**
- Produces: `ResendEvent`, `MappedEvent` (`MappedStatus | MappedInbound | {kind:"ignore"}`), `mapResendEvent(evt): MappedEvent`. Consumed by Task 4.

> Pin field names against Resend's current webhook payloads at implementation time. The fixtures below encode the assumptions (`data.email_id` for status; inbound type `inbound.email.received`); adjust both fixtures AND the mapper together if the live payload differs.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mapResendEvent } from "../app/lib/email-events";

describe("mapResendEvent", () => {
  it("maps delivered", () => {
    expect(mapResendEvent({ type: "email.delivered", data: { email_id: "re_1" } }))
      .toMatchObject({ kind: "status", providerMessageId: "re_1", status: "delivered", optOut: false });
  });
  it("maps a permanent bounce to opt-out", () => {
    expect(mapResendEvent({ type: "email.bounced", data: { email_id: "re_2", bounce: { type: "Permanent" } } }))
      .toMatchObject({ kind: "status", status: "bounced", optOut: true });
  });
  it("maps a transient bounce without opt-out", () => {
    expect(mapResendEvent({ type: "email.delivery_delayed", data: { email_id: "re_3" } }))
      .toMatchObject({ kind: "status", status: "delayed", optOut: false });
  });
  it("maps a complaint to opt-out", () => {
    expect(mapResendEvent({ type: "email.complained", data: { email_id: "re_4" } }))
      .toMatchObject({ kind: "status", status: "complained", optOut: true });
  });
  it("maps inbound", () => {
    expect(mapResendEvent({ type: "inbound.email.received", data: {
      from: "C <c@x.com>", to: "billing@us.com", subject: "Re: invoice", text: "ok", email_id: "in_1" } }))
      .toMatchObject({ kind: "inbound", from: "C <c@x.com>", subject: "Re: invoice", body: "ok" });
  });
  it("ignores opened/clicked/unknown", () => {
    expect(mapResendEvent({ type: "email.opened", data: {} }).kind).toBe("ignore");
    expect(mapResendEvent({ type: "something.else", data: {} }).kind).toBe("ignore");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd nudgepay-app && npx vitest run test/email-events.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// Pure mapper: Resend webhook event -> normalized DB intent. Isolates Resend's
// taxonomy from the data layer. No I/O.

export type ResendEvent = { type: string; data: Record<string, any> };

export type MappedStatus = {
  kind: "status";
  providerMessageId: string;
  status: string;       // "sent"|"delivered"|"bounced"|"delayed"|"complained"
  errorCode: string | null;
  optOut: boolean;
};
export type MappedInbound = {
  kind: "inbound";
  from: string; to: string; subject: string; body: string; providerMessageId: string;
};
export type MappedEvent = MappedStatus | MappedInbound | { kind: "ignore" };

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function mapResendEvent(evt: ResendEvent): MappedEvent {
  const d = evt.data ?? {};
  switch (evt.type) {
    case "email.sent":
      return { kind: "status", providerMessageId: str(d.email_id), status: "sent", errorCode: null, optOut: false };
    case "email.delivered":
      return { kind: "status", providerMessageId: str(d.email_id), status: "delivered", errorCode: null, optOut: false };
    case "email.delivery_delayed":
      return { kind: "status", providerMessageId: str(d.email_id), status: "delayed", errorCode: null, optOut: false };
    case "email.bounced": {
      const bounceType = str(d.bounce?.type).toLowerCase();
      const permanent = bounceType === "permanent" || bounceType === "hard";
      return { kind: "status", providerMessageId: str(d.email_id), status: "bounced",
        errorCode: bounceType || "bounce", optOut: permanent };
    }
    case "email.complained":
      return { kind: "status", providerMessageId: str(d.email_id), status: "complained", errorCode: "complaint", optOut: true };
    case "inbound.email.received":
    case "email.inbound":
      return { kind: "inbound", from: str(d.from), to: str(d.to), subject: str(d.subject),
        body: str(d.text) || str(d.html), providerMessageId: str(d.email_id) };
    default:
      return { kind: "ignore" };
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd nudgepay-app && npx vitest run test/email-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/email-events.ts nudgepay-app/test/email-events.test.ts
git commit -m "feat(email): Resend event mapper"
```

---

### Task 4: `updateEmailStatus` + `recordInboundEmail`

**Files:**
- Modify: `nudgepay-app/app/lib/email-messaging.server.ts`
- Test: `nudgepay-app/test/email-inbound-status.test.ts`

**Interfaces:**
- Consumes: `email_messages`, `customers.do_not_email` (Phase 15).
- Produces: `async updateEmailStatus(service, {providerMessageId, status, errorCode, optOut})`; `async recordInboundEmail(service, {from,to,subject,body,providerMessageId}): Promise<{matched:boolean}>`. Consumed by Task 5.

> Read `recordInboundMessage`/`activeCaseId`/`normalizePhone` in `twilio-messaging.server.ts` and mirror the structure: normalize the match key, match a customer, thread to last outbound invoice + active case, fail-loud on DB errors.

- [ ] **Step 1: Write the failing DB test**

```ts
import { describe, it, expect } from "vitest";
import { updateEmailStatus, recordInboundEmail } from "../app/lib/email-messaging.server";
// fresh org + customer (with email) + an outbound email_messages row (provider_message_id="re_1") via service client

describe("email inbound + status", () => {
  it("updateEmailStatus updates the matching outbound row", async () => {
    await updateEmailStatus(service, { providerMessageId: "re_1", status: "delivered", errorCode: null, optOut: false });
    // assert the row's status === "delivered"
  });
  it("optOut flips customers.do_not_email", async () => {
    await updateEmailStatus(service, { providerMessageId: "re_1", status: "complained", errorCode: "complaint", optOut: true });
    // assert the customer's do_not_email === true
  });
  it("nonexistent provider id is a safe no-op", async () => {
    await expect(updateEmailStatus(service, { providerMessageId: "nope", status: "delivered", errorCode: null, optOut: false }))
      .resolves.toBeUndefined();
  });
  it("recordInboundEmail matches by sender email + threads", async () => {
    const r = await recordInboundEmail(service, { from: "Cust <cust@x.com>", to: "billing@us.com", subject: "Re", body: "ok", providerMessageId: "in_1" });
    expect(r.matched).toBe(true);
    // assert one inbound email_messages row for that customer, invoice_id = last outbound invoice
  });
  it("unmatched sender => no row", async () => {
    const r = await recordInboundEmail(service, { from: "stranger@nowhere.com", to: "billing@us.com", subject: "x", body: "y", providerMessageId: "in_2" });
    expect(r.matched).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd nudgepay-app && npx vitest run test/email-inbound-status.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** (append to `email-messaging.server.ts`)

```ts
import { activeCaseId } from "./twilio-messaging.server";

// Extract a bare email address from a "Name <addr>" or bare string; lowercase+trim.
export function normalizeEmail(s: string | null | undefined): string {
  const raw = (s ?? "").trim();
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

export async function updateEmailStatus(
  service: SupabaseClient,
  args: { providerMessageId: string; status: string; errorCode: string | null; optOut: boolean },
): Promise<void> {
  if (!args.providerMessageId) return;
  const { data: rows, error } = await service.from("email_messages")
    .update({ status: args.status, error_code: args.errorCode })
    .eq("provider_message_id", args.providerMessageId)
    .select("customer_id, org_id");
  if (error) throw error;
  if (!args.optOut) return;
  for (const r of rows ?? []) {
    if (!r.customer_id) continue;
    const { error: upErr } = await service.from("customers")
      .update({ do_not_email: true }).eq("id", r.customer_id as string);
    if (upErr) throw upErr;
  }
}

export async function recordInboundEmail(
  service: SupabaseClient,
  args: { from: string; to: string; subject: string; body: string; providerMessageId: string },
): Promise<{ matched: boolean }> {
  const fromNorm = normalizeEmail(args.from);
  if (!fromNorm) return { matched: false };

  const { data: candidates, error: candErr } = await service.from("customers")
    .select("id, org_id, email").not("email", "is", null);
  if (candErr) throw candErr;
  const match = (candidates ?? []).find((c) => normalizeEmail(c.email as string) === fromNorm);
  if (!match) return { matched: false };

  const { data: lastOut } = await service.from("email_messages")
    .select("invoice_id").eq("customer_id", match.id as string).eq("direction", "outbound")
    .not("invoice_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();

  const caseId = await activeCaseId(service, match.org_id as string, match.id as string);

  const { error: insErr } = await service.from("email_messages").insert({
    org_id: match.org_id as string,
    customer_id: match.id as string,
    case_id: caseId,
    invoice_id: (lastOut?.invoice_id as string) ?? null,
    direction: "inbound",
    provider_message_id: args.providerMessageId,
    from_address: args.from,
    to_address: args.to,
    subject: args.subject,
    body: args.body,
  });
  if (insErr) throw insErr;

  return { matched: true };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd nudgepay-app && npx vitest run test/email-inbound-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/email-messaging.server.ts nudgepay-app/test/email-inbound-status.test.ts
git commit -m "feat(email): updateEmailStatus + recordInboundEmail"
```

---

### Task 5: Webhook route `webhooks.resend.tsx`

**Files:**
- Create: `nudgepay-app/app/routes/webhooks.resend.tsx`
- Test: `nudgepay-app/test/webhooks-resend.test.ts`

**Interfaces:**
- Consumes: `getEmailEnv`/`getEnv` (env), `verifyResendSignature` (Task 2), `mapResendEvent` (Task 3), `updateEmailStatus`/`recordInboundEmail` (Task 4).

> Mirror `webhooks.twilio.status.tsx`: verify → parse → dispatch → fail-loud 500 on processing error.

- [ ] **Step 1: Write the failing action test**

```ts
import { describe, it, expect } from "vitest";
import { action } from "../app/routes/webhooks.resend";
// build a fake context with cloudflare.env including RESEND_WEBHOOK_SECRET; sign a status event like Task 2's helper

describe("webhooks.resend", () => {
  it("valid status event updates the row (204)", async () => {
    // fresh org + outbound row provider_message_id=re_1; sign email.delivered; assert 204 + row status delivered
  });
  it("invalid signature => 401, no DB change", async () => {
    const res = await action({ request: new Request("https://x/webhooks/resend", { method: "POST", body: "{}", headers: {} }), context, params: {} } as any);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd nudgepay-app && npx vitest run test/webhooks-resend.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import type { ActionFunctionArgs } from "react-router";
import { getEnv, getEmailEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { verifyResendSignature } from "../lib/resend-webhook.server";
import { mapResendEvent } from "../lib/email-events";
import { updateEmailStatus, recordInboundEmail } from "../lib/email-messaging.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const emailEnv = getEmailEnv(context as any);
  const raw = await request.text();
  const ok = await verifyResendSignature(emailEnv.RESEND_WEBHOOK_SECRET, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  }, raw);
  if (!ok) return new Response("invalid signature", { status: 401 });

  let mapped;
  try {
    mapped = mapResendEvent(JSON.parse(raw));
  } catch {
    return new Response(null, { status: 204 }); // unparseable but signed: ack, don't retry-loop
  }

  try {
    const service = createSupabaseServiceClient(getEnv(context as any));
    if (mapped.kind === "status") {
      await updateEmailStatus(service, mapped);
    } else if (mapped.kind === "inbound") {
      await recordInboundEmail(service, mapped);
    }
  } catch (err) {
    console.error("Resend webhook processing failed", err);
    return new Response("processing error", { status: 500 });
  }
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run, verify pass + full suite + build**

Run: `cd nudgepay-app && npx vitest run test/webhooks-resend.test.ts && npx vitest run && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/routes/webhooks.resend.tsx nudgepay-app/test/webhooks-resend.test.ts
git commit -m "feat(email): Resend webhook endpoint (status + inbound)"
```

---

## Self-Review notes

- **Spec coverage:** §A→T1, §B→T2, §C→T4, §D→T3, §E→T5. All covered.
- **Type consistency:** `MappedStatus`/`MappedInbound` (T3) are passed directly into `updateEmailStatus`/`recordInboundEmail` (T4) — the mapper's output shape must structurally satisfy those function args (it does: `{providerMessageId,status,errorCode,optOut}` and `{from,to,subject,body,providerMessageId}`).
- **Field-name risk:** Resend payload field names (`data.email_id`, `data.bounce.type`, inbound `type`) are pinned in T3's fixtures; the implementer must verify against live Resend docs and update fixtures + mapper together.
- **`customers.email` dependency:** `recordInboundEmail` matches on `customers.email` — confirmed present (`0001` line 42).
