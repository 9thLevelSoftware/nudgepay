# NudgePay Phase 16 — Email inbound + delivery status — Design

**Date:** 2026-06-27
**Status:** Approved (design)
**Subsystem:** #3b of the Phase 13 email initiative (#3a outbound → **#3b inbound/status** → #3c Messages-tab wiring)
**Depends on:** Phase 15 (#3a) — `email_messages`, `email-messaging.server.ts`, `customers.do_not_email`, `getEmailEnv`.

## Summary

Close the email loop with **inbound capture** and **delivery-status tracking**, mirroring the Twilio inbound + status webhooks. Resend posts signed webhook events; a single endpoint verifies the Svix signature, then:
- **Status events** (`email.sent`/`delivered`/`bounced`/`delivery_delayed`/`complained`) update the matching outbound `email_messages` row by `provider_message_id`.
- **Hard bounce / complaint** additionally sets `customers.do_not_email = true` (deliverability hygiene + CAN-SPAM complaint handling).
- **Inbound events** (a customer replies to a Resend-received address) insert an inbound `email_messages` row, matched to a customer by sender address and threaded to the last outbound invoice + active case — exactly mirroring `recordInboundMessage`.

The DetailPanel Email tab (built in #3a) already renders inbound-capable bubbles and status, so inbound replies and delivery states surface there immediately. The cross-customer `/messages` inbox wiring remains #3c.

**Out of scope (deferred):**
- `/messages` inbox email integration → #3c.
- `open`/`click` tracking events — recorded as no-ops (we do not store engagement analytics in #3b; the handler must not error on them).
- Threading replies by `In-Reply-To`/`References` headers — #3b threads by sender-address match like SMS; header-based threading is a later optimization.

## Decisions

1. **Signature scheme: Svix** (Resend's webhook signer). Verify `svix-id`, `svix-timestamp`, `svix-signature` headers with the `RESEND_WEBHOOK_SECRET` (a `whsec_…` secret). Reject (401) on bad signature or stale timestamp.
2. **One endpoint, branch on event `type`.** `routes/webhooks.resend.tsx` handles both status and inbound events (Resend can deliver both to one endpoint; if the operator configures separate inbound vs event endpoints, the same route serves both — it branches on payload `type`).
3. **Bounce/complaint → opt-out.** A hard bounce (`email.bounced` with a permanent bounce type) or `email.complained` sets `do_not_email = true`. A soft/transient bounce (`delivery_delayed`) only updates status.
4. **Inbound matching: by sender email**, normalized lowercase/trimmed, exactly mirroring `recordInboundMessage`'s phone match. No customer match ⇒ ignored (logged), 200 returned so the provider does not retry forever.

## Architecture

| Concern | Twilio (existing) | Resend email (#3b) |
| --- | --- | --- |
| Signature verify (pure) | `twilio-webhook.server.ts` (`verifyTwilioSignature`) | `resend-webhook.server.ts` (`verifyResendSignature`) (new) |
| Status route | `webhooks.twilio.status.tsx` | `webhooks.resend.tsx` (status branch) (new) |
| Inbound route | `webhooks.twilio.inbound.tsx` | `webhooks.resend.tsx` (inbound branch) (new) |
| Status updater | `updateMessageStatus` | `updateEmailStatus` (new, in `email-messaging.server.ts`) |
| Inbound recorder | `recordInboundMessage` | `recordInboundEmail` (new, in `email-messaging.server.ts`) |
| Webhook secret | `TWILIO_AUTH_TOKEN` | `RESEND_WEBHOOK_SECRET` (new env) |

### A. Env

`getEmailEnv` (from #3a) gains `RESEND_WEBHOOK_SECRET: string` (required). Operator sets it from the Resend webhook endpoint's signing secret.

### B. Signature verification — `resend-webhook.server.ts` (pure)

Svix verification, Web Crypto only (mirrors `twilio-webhook.server.ts`):

```ts
export async function verifyResendSignature(
  secret: string,           // "whsec_<base64>" — strip prefix, base64-decode to key bytes
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
): Promise<boolean>;
```

- Signed content = `${svix_id}.${svix_timestamp}.${rawBody}`.
- HMAC-SHA256 with the base64-decoded secret (the part after `whsec_`).
- `svix-signature` is space-separated `v1,<b64sig>` entries; accept if any matches (timing-safe).
- Reject if any header missing, or if `|now - timestamp| > 5min` (replay guard). `now` comes in as a parameter (keeps the function pure/testable; the route passes `Date.now()`).

### C. Status + inbound handlers — extend `email-messaging.server.ts`

```ts
// Map a provider delivery event to the outbound row by provider_message_id.
export async function updateEmailStatus(
  service: SupabaseClient,
  args: { providerMessageId: string; status: string; errorCode: string | null; optOut: boolean },
): Promise<void>;
// Updates email_messages.status/error_code where provider_message_id matches.
// When optOut, also sets customers.do_not_email = true for the row's customer.

// Record an inbound reply, matched to a customer by sender email.
export async function recordInboundEmail(
  service: SupabaseClient,
  args: { from: string; to: string; subject: string; body: string; providerMessageId: string },
): Promise<{ matched: boolean }>;
// Mirrors recordInboundMessage: normalize sender email, match a customer,
// thread to last outbound invoice + active case, insert inbound email_messages row.
```

`updateEmailStatus` fail-loud on DB error. `recordInboundEmail` returns `{matched:false}` (no throw) when no customer matches, so the route returns 200.

### D. Event mapping — `email-events.ts` (pure)

A pure mapper isolates Resend's event taxonomy from the DB layer (testable without I/O):

```ts
export type ResendEvent = { type: string; data: Record<string, unknown> };
export type MappedStatus = {
  kind: "status";
  providerMessageId: string;
  status: string;       // normalized: "sent"|"delivered"|"bounced"|"delayed"|"complained"
  errorCode: string | null;
  optOut: boolean;      // true for permanent bounce or complaint
};
export type MappedInbound = {
  kind: "inbound";
  from: string; to: string; subject: string; body: string; providerMessageId: string;
};
export type MappedEvent = MappedStatus | MappedInbound | { kind: "ignore" };

export function mapResendEvent(evt: ResendEvent): MappedEvent;
```

- `email.sent`→status sent; `email.delivered`→delivered; `email.delivery_delayed`→delayed (no opt-out); `email.bounced`→bounced (opt-out iff bounce type is permanent/hard); `email.complained`→complained (opt-out true); inbound type (e.g. `inbound.email.received` / `email.inbound`) → inbound; `email.opened`/`email.clicked`/unknown → ignore.
- Provider message id is read from `data.email_id` (status) — confirm the exact field name against Resend's current payload at implementation time and pin it in the test fixture.

### E. Webhook route — `webhooks.resend.tsx`

```tsx
export async function action({ request, context }) {
  const emailEnv = getEmailEnv(context);
  const raw = await request.text();
  const ok = await verifyResendSignature(emailEnv.RESEND_WEBHOOK_SECRET, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  }, raw);
  if (!ok) return new Response("invalid signature", { status: 401 });

  const mapped = mapResendEvent(JSON.parse(raw));
  const service = createSupabaseServiceClient(getEnv(context));
  try {
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

(Mirrors `webhooks.twilio.status.tsx`: verify → parse → dispatch → fail-loud-with-500-on-processing-error so the provider retries.)

## Data flow

- **Status:** Resend sends `email.delivered` → route verifies Svix sig → `mapResendEvent` → `updateEmailStatus` sets `email_messages.status='delivered'` for that `provider_message_id`. On `email.bounced`(permanent)/`email.complained` it also flips `customers.do_not_email=true`, so future `sendInvoiceEmail` calls throw "opted out".
- **Inbound:** Customer replies → Resend posts inbound event → route verifies → `recordInboundEmail` matches the sender email to a customer, threads to the last outbound invoice + active case, inserts an inbound row → it appears in the DetailPanel Email thread.

## Error handling

- Bad/missing Svix headers or stale timestamp → 401, no processing.
- Unknown/ignored event types → 204, no-op (never 500 — avoids provider retry storms).
- Unmatched inbound sender → 200/204, logged, no row.
- DB errors during processing → 500 so Resend retries; status/inbound writes are fail-loud.

## Testing

**Pure unit:**
- `resend-webhook.test.ts` — sign a payload with a known `whsec_` secret, verify true; tampered body/sig/timestamp → false; stale timestamp → false; missing header → false.
- `email-events.test.ts` — each Resend event type maps correctly; permanent bounce → optOut true, transient → false; complaint → optOut true; opened/clicked/unknown → ignore; provider id extracted.

**DB-backed (fresh org):**
- `updateEmailStatus` — updates the matching outbound row's status/error_code; `optOut:true` flips `customers.do_not_email`; nonexistent `provider_message_id` is a safe no-op.
- `recordInboundEmail` — matches a customer by sender email, inserts an inbound row threaded to the last outbound invoice + active case; unmatched sender → `{matched:false}`, no row.
- `webhooks.resend` action — valid-signature status event updates the row; invalid signature → 401, no DB change; inbound event inserts a row.

## Security constraints (carried forward)

- `RESEND_WEBHOOK_SECRET` is a platform env secret; never in UI/DB.
- Signature verification is mandatory before any processing (no unauthenticated writes).
- Replay guard via timestamp window.
- All carried #3a constraints (platform-managed keys, no secret columns, fail-loud reads, never `git add -A`, never commit secrets) remain in force.

## File inventory

**New:**
- `app/lib/resend-webhook.server.ts` (+ test)
- `app/lib/email-events.ts` (+ test)
- `app/routes/webhooks.resend.tsx` (+ test)

**Modified:**
- `app/lib/env.server.ts` — add `RESEND_WEBHOOK_SECRET` to `EmailEnv`/`getEmailEnv`.
- `app/lib/email-messaging.server.ts` — add `updateEmailStatus`, `recordInboundEmail`.
