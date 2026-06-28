# NudgePay Phase 15 — Email channel foundation (outbound) — Design

**Date:** 2026-06-27
**Status:** Approved (design)
**Subsystem:** #3a of the Phase 13 email initiative (#3a outbound → #3b inbound/status → #3c Messages-tab wiring)

## Summary

Stand up the **outbound** transactional-email channel for NudgePay, mirroring the
established SMS architecture (Twilio) end-to-end: a platform-managed provider
(Resend), a per-org enable switch with a server-enforced send gate, plain-text
templates, an `email_messages` thread model, a per-case email composer in the
dashboard DetailPanel, and CAN-SPAM-compliant opt-out via a signed one-click
unsubscribe link.

**Out of scope (deferred):**
- **#3b** — inbound email capture, delivery/bounce/complaint status webhooks
  (this slice records only the initial send status returned by the provider).
- **#3c** — wiring email threads into the cross-customer `/messages` inbox
  (`message-inbox.ts` reserves `channel:"sms"` for this).
- Rich HTML / template editor — bodies are plain text only.
- Per-tenant provider credentials (bring-your-own) — the Resend key is a
  platform-managed deploy-time env secret, exactly like the Twilio credentials.

## Decisions (locked)

1. **Provider: Resend.** REST `POST https://api.resend.com/emails`, Workers-friendly
   (fetch-only, no SDK). API key is a deploy-time env secret (`RESEND_API_KEY`).
2. **From-address: editable in Settings** by an owner (format-validated), plus a
   from-name. A verified-domain note tells the operator the address must live on
   a domain authenticated with Resend (SPF/DKIM/DMARC).
3. **Consent model: opt-out / CAN-SPAM.** No opt-in required (unlike SMS/TCPA).
   A `customers.do_not_email` flag gates sending; a signed one-click unsubscribe
   link sets it; an unsubscribe footer is appended to every outbound email.
4. **Body: plain text.** A pure `email-templates.ts` (subject + body), mirroring
   `sms-templates.ts`. The unsubscribe footer is appended at send time, not
   stored in templates.

## Architecture

The SMS stack is the template. Each SMS unit gets an email counterpart:

| Concern | SMS (existing) | Email (#3a) |
| --- | --- | --- |
| Provider env | `getTwilioEnv` | `getEmailEnv` (new) |
| Provider HTTP client | `twilio-client.server.ts` (`sendSms`) | `email-client.server.ts` (`sendEmail`) (new) |
| Send orchestration + gate | `twilio-messaging.server.ts` (`sendInvoiceText`) | `email-messaging.server.ts` (`sendInvoiceEmail`) (new) |
| Per-org switch | `messaging_config.sms_enabled` | `email_config.email_enabled` (exists) |
| Templates (pure) | `sms-templates.ts` | `email-templates.ts` (new) |
| Send route | `api.text.send.tsx` | `api.email.send.tsx` (new) |
| Thread table | `text_messages` | `email_messages` (new) |
| Opt-out flag | `do_not_text` (+ `sms_consent`) | `do_not_email` (new, no consent record) |
| DetailPanel surface | Messages tab | Email tab (new) |
| Settings panel | SMS toggle (Phase 14) | Email enable + from-address/from-name (new) |

### A. Provider credentials & env

New `getEmailEnv(context)` in `env.server.ts`, mirroring `getTwilioEnv`:

```ts
export type EmailEnv = {
  RESEND_API_KEY: string;            // required
  APP_PUBLIC_BASE_URL: string | null; // public origin for unsubscribe links
  UNSUBSCRIBE_SECRET: string;        // required — HMAC key for unsubscribe tokens
};
```

- `RESEND_API_KEY` and `UNSUBSCRIBE_SECRET` are required (throw if missing,
  like `TWILIO_ACCOUNT_SID`).
- `APP_PUBLIC_BASE_URL` is the public origin for absolute unsubscribe URLs. It
  is a new, provider-neutral var (the existing public origin is named
  `TWILIO_PUBLIC_BASE_URL`; we do not overload it). Nullable: if unset, the send
  path throws a clear error before sending, so we never email a relative or
  broken unsubscribe link.
- All three are deploy-time secrets/config set by the operator. None are exposed
  in tenant UI or stored in the database.

### B. Provider HTTP client — `email-client.server.ts`

Pure-ish, fetch-injected, single responsibility (one HTTP call):

```ts
export type EmailConfig = { apiKey: string };
export type SendEmailArgs = {
  from: string;     // "Name <addr@domain>" or bare address
  to: string;
  subject: string;
  text: string;     // plain-text body (footer already appended by caller)
};
export async function sendEmail(
  fetchFn: typeof fetch, cfg: EmailConfig, args: SendEmailArgs,
): Promise<{ id: string }>;
```

- `POST https://api.resend.com/emails` with `Authorization: Bearer <apiKey>`,
  JSON `{ from, to, subject, text }`.
- On non-2xx, throw an Error including the provider's error body (so the route's
  catch can map it to a result code).
- Returns `{ id }` from Resend's response (stored as `provider_message_id`).
- Unit-testable with a mocked `fetchFn`, exactly like `twilio-client.server.ts`.

### C. Send orchestration & gate — `email-messaging.server.ts`

```ts
export type EmailDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;   // service client (send path), like MessagingDeps
  email: EmailConfig;        // { apiKey }
  unsubscribeBaseUrl: string; // APP_PUBLIC_BASE_URL (non-null at call site)
  unsubscribeSecret: string;  // UNSUBSCRIBE_SECRET
};

export async function sendInvoiceEmail(
  deps: EmailDeps,
  args: { orgId: string; invoiceId: string; userId: string; subject: string; body: string },
): Promise<{ id: string; providerMessageId: string }>;
```

**Gate order (mirrors `sendInvoiceText`, fail-loud `if (err) throw err` on every read):**
1. Load invoice → must have `customer_id` (else "Invoice has no linked customer").
2. Load customer → must have a non-empty `email` (else "Customer has no email address").
3. Load `email_config.email_enabled` for the org. **Absent row ⇒ disabled**
   (email defaults OFF — opposite of SMS, matching the `email_config.email_enabled
   default false` migration). If disabled, throw "Email disabled for this workspace".
   Do not swallow the DB error (mirror the Phase 14 PR #21 `mcErr` hardening).
4. Resolve the active case; if `isContactBlocked(exception_reason)` → throw
   "Contact blocked: …" (case-level legal hold dominates, same precedence as SMS).
5. If `customer.do_not_email` → throw "Customer has opted out of email".
6. Build the unsubscribe URL (signed token, §D), append the footer to `body`,
   resolve the sender from `email_config.from_address`/`from_name` (fall back to
   nothing → throw "No from address configured" if absent), call `sendEmail`,
   then insert the outbound `email_messages` row (`direction:"outbound"`,
   `provider_message_id`, `status` from provider, `from_address`, `to_address`,
   `subject`, `body` **with footer**). Fail loud on insert error.

There is **no `email_consent`** — CAN-SPAM is opt-out, so the gate checks only
`do_not_email` and the contact-block, never a positive consent record.

### D. Compliance — signed unsubscribe

Pure `unsubscribe-token.ts` (no I/O, testable):

```ts
// HMAC-SHA256 over `${orgId}:${customerId}` using UNSUBSCRIBE_SECRET.
export async function signUnsubscribeToken(secret: string, orgId: string, customerId: string): Promise<string>;
export async function verifyUnsubscribeToken(secret: string, token: string): Promise<{ orgId: string; customerId: string } | null>;
```

- Token encodes `orgId` + `customerId` + signature (e.g. base64url
  `orgId.customerId.hmac`). Uses Web Crypto (`crypto.subtle.sign`), available on
  Workers. No expiry (an unsubscribe link should work indefinitely — CAN-SPAM
  requires opt-out to remain honorable for 30+ days and there is no harm in
  longer). Constant-time-ish compare via recomputed HMAC equality.
- Footer (appended to every outbound body), plain text:
  `\n\n—\nTo stop receiving these emails, unsubscribe: <APP_PUBLIC_BASE_URL>/unsubscribe?token=<token>`
- Public route `routes/unsubscribe.tsx` (no auth):
  - `loader` verifies the token; invalid → render a neutral "link is invalid or
    expired" page (200, no leak).
  - Valid → set `customers.do_not_email = true` via the **service client**
    scoped to the token's `orgId`+`customerId`, render a confirmation page.
    (A loader performing a write is acceptable here: it is an idempotent
    opt-out triggered by a one-click link; email clients may prefetch, and
    setting `do_not_email = true` repeatedly is harmless and the desired
    outcome either way.)

### E. Storage — migration `0021_email_outbound.sql`

```sql
-- Per-customer email opt-out (CAN-SPAM). Email is now a NudgePay channel.
alter table customers add column do_not_email boolean not null default false;

-- Outbound (and, in #3b, inbound) email log. Mirrors text_messages + email fields.
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
```

- RLS mirrors `text_messages`' member-read; writes happen via the service client
  on the send path, but the owner-write policy keeps RLS coherent with the rest
  of the Phase 14 config tables. (Confirm `text_messages`' exact policy shape at
  implementation time and match it; if `text_messages` is member-write, match
  that instead — the plan task must read 0001 and replicate, not guess.)
- Column types/refs and the `direction` check exactly mirror `text_messages`
  (0001) plus the email-specific columns (`provider_message_id`, `from_address`,
  `to_address`, `subject`). `case_id`/`customer_id` mirror the later text_messages
  additions.
- `email_config` is **unchanged** — its `email_enabled`/`from_address`/
  `from_name`/`provider` columns already exist from 0020. (The 0020 `updated_at`
  note about a `set_updated_at` trigger remains deferred; not needed for #3a.)

### F. Per-customer email preferences — extend `comm-prefs.ts`

Email is now a real channel, so the pure prefs module gains it:

- `CHANNELS` → `["call", "text", "email"]`; `isChannel` accepts `"email"`.
- `CommPrefs` gains `doNotEmail: boolean`; `DEFAULT_COMM_PREFS.doNotEmail = false`;
  `CommPrefsRow` gains `do_not_email?: boolean | null`; `resolveCommPrefs` maps it.
- New `canSendEmail(prefs): boolean` = `!prefs.doNotEmail` (no consent term —
  unlike `canSendSms`). `channelBlocked` handles the `"email"` case.
- `parseCommPrefsUpdate` (in `api.comm-prefs.tsx`) adds
  `do_not_email: form.get("do_not_email") === "true"`.
- `CommPrefsDrawer` adds a "Do not email" checkbox alongside the existing
  do-not-call / do-not-text toggles. This is the **manual** opt-out path; the
  unsubscribe link is the **automated** path. Both set the same column.

### G. Templates — `email-templates.ts` (pure)

Mirror `sms-templates.ts`, but each template carries a **subject and body**:

```ts
export type EmailTemplate = { id: string; label: string; subject: string; body: string };
// Same TemplateVars ({customer, invoice, balance, dueDate}).
export const EMAIL_TEMPLATES: EmailTemplate[];
export function applyEmailTemplate(text: string, vars: TemplateVars): string; // reuses the {token} regex
```

- Starter set parallels the SMS set (friendly-reminder, past-due, final-notice,
  payment-received) with email-appropriate subjects and slightly longer bodies.
- Pure, no I/O, safe in the client bundle. The unsubscribe footer is **not** in
  the template — it is appended by the send path so it is always present even on
  free-typed bodies.

### H. Send route — `api.email.send.tsx`

Mirror `api.text.send.tsx`:

- Owner/member? The composer posts subject+body+invoiceId+returnTo. The route
  uses the **service client** for the send path (like `api.text.send`), gated by
  `sendInvoiceEmail`'s checks; org membership is established via `requireUser` +
  `resolveOrg`.
- Build `EmailDeps` from `getEmailEnv`. If `APP_PUBLIC_BASE_URL` is null, redirect
  with an error code (cannot build unsubscribe link).
- `try { sendInvoiceEmail(...) } catch` maps the message to a result code via a
  new `withEmail(returnTo, code)` helper in `return-to.ts`:
  `sent | disabled | optout | blocked | error` (regex on the thrown message,
  same shape as `api.text.send`'s mapping).

### I. Settings — writable email config

- `settings.tsx`: the existing read-only Email section becomes an owner-editable
  panel: an **Enable email** toggle, a **From address** text input (HTML5 email
  validation + a "must be on a Resend-verified domain" helper note), and a
  **From name** input. Members see it read-only (mirrors the Phase 14 SMS panel).
- New pure `email-settings.ts`: `resolveEmailSettings(row)` →
  `{ emailEnabled, fromAddress, fromName }` (absent row ⇒ disabled, empty
  strings) and `parseEmailSettingsUpdate(form)` →
  `{ email_enabled, from_address, from_name }` with **format validation** of the
  address (return a discriminated `{ ok } | { ok:false, error }` so the action
  can flag a bad address rather than persisting it). Mirrors `channel-settings.ts`.
- New `save_email` intent in `api.org-settings.tsx` (owner-gated, user client /
  RLS), parallel to `save_channels`: upsert `email_config` on `org_id`. On a
  validation failure, redirect `?error=email`. On success `?saved=1`.

### J. DetailPanel — Email tab

- Add an **Email** tab to the DetailPanel tab set (Overview / Timeline /
  Messages / Email), mirroring the SMS Messages tab structure:
  - Thread of `email_messages` rows for the case/customer (subject + body
    bubbles, outbound/inbound styling — inbound reserved for #3b but the
    rendering should not assume only outbound).
  - A composer: template picker (`EMAIL_TEMPLATES`, fills subject+body), subject
    field, body textarea, send button posting to `/api/email/send`.
  - **Disabled-with-reason** states (mirror SMS): email disabled for workspace /
    no customer email / `do_not_email` / contact-blocked. The reason string is
    derived and shown; the composer is gated, not merely hidden.
- Gated by an `emailEnabled` prop threaded from the dashboard loader (which reads
  `email_config.email_enabled`), parallel to the Phase 14 `smsEnabled` threading.
  The dashboard loader also loads the per-case `email_messages` thread + the
  customer's `email`/`do_not_email` for the gate.

### K. Operator runbook (documentation, not code)

The spec's deploy notes must state the operator prerequisites:
- Create a Resend account, verify the sending **domain** (SPF/DKIM, ideally
  DMARC) in Resend's dashboard.
- Set `RESEND_API_KEY`, `UNSUBSCRIBE_SECRET` (32+ random bytes), and
  `APP_PUBLIC_BASE_URL` as Worker secrets/vars (`wrangler secret put` / env).
- In Settings, enable email and set the From address to an address **on the
  verified domain**. Sending from an unverified domain will be rejected by
  Resend.

## Data flow (happy path, single send)

1. Operator enables email in Settings, sets From address (`save_email` →
   `email_config`).
2. User opens an account's DetailPanel → Email tab → picks a template → Send.
3. `POST /api/email/send` (subject, body, invoiceId) → `sendInvoiceEmail`:
   invoice→customer→email-enabled→not-blocked→not-opted-out → sign unsubscribe
   token → append footer → `sendEmail` (Resend) → insert `email_messages`
   (outbound).
4. Redirect back with `?email=sent`; the Email tab shows the new outbound bubble.
5. Recipient clicks unsubscribe → `/unsubscribe?token=…` verifies → sets
   `do_not_email = true` → future sends to that customer throw "opted out".

## Error handling

- Every Supabase read/insert on the send path: `if (error) throw error` — no
  swallowed errors that could bypass a gate (the Phase 14 PR #21 lesson).
- Provider non-2xx: `sendEmail` throws with the provider body; the route maps to
  `?email=error` and records nothing (no half-written row).
- Missing `APP_PUBLIC_BASE_URL`/secret: `getEmailEnv` throws (config) or the
  route redirects `?email=error` before sending — never email a broken
  unsubscribe link.
- Invalid unsubscribe token: neutral 200 page, no information leak, no write.

## Testing

**Pure unit (vitest, no DB):**
- `email-templates.test.ts` — token substitution, all starter templates present,
  subjects non-empty.
- `unsubscribe-token.test.ts` — sign→verify round-trip; tampered token → null;
  wrong-secret → null; foreign token cannot decode to another customer.
- `comm-prefs.test.ts` (extend) — `canSendEmail`, `channelBlocked('email')`,
  `resolveCommPrefs` maps `do_not_email`.
- `email-settings.test.ts` — `parseEmailSettingsUpdate` accepts a valid address,
  rejects a malformed one; `resolveEmailSettings` defaults.
- `email-client.server.test.ts` — mocked `fetch`: correct URL/headers/JSON;
  2xx → `{ id }`; non-2xx → throws with body.

**DB-backed (vitest against local Supabase, per-test fresh org):**
- `email_messages` RLS: member can read own-org rows, cannot read another org's.
- `customers.do_not_email` default false; update persists.
- `email_config` owner-write / member-read (already covered by Phase 14 pattern;
  add an email-specific assertion if not).
- `sendInvoiceEmail` gate matrix with a mocked `fetchFn`: disabled / no-email /
  opted-out / contact-blocked each → **no provider call, no row inserted**;
  happy path → provider called once, one outbound row with footer appended.
- `save_email` action: owner can write, validation rejects a bad address.
- `unsubscribe` route loader: valid token sets `do_not_email = true`; invalid
  token leaves it unchanged and renders the neutral page.

**Build/typecheck:** components (DetailPanel Email tab, Settings panel,
CommPrefsDrawer) verified via `tsc` + the production build (no DOM test harness
in this project).

## Security constraints (carried from prior phases — preserve verbatim)

- Email provider key is a **platform-managed env secret** (`RESEND_API_KEY`); no
  per-tenant bring-your-own credentials, no secret column in any tenant table.
- From-address must be on an **operator-verified domain** (documented
  prerequisite; the app validates format only, not domain ownership).
- Never commit secrets (`.env.test` / `.dev.vars` stay gitignored). Never
  `git add -A` (untracked scratch under `nudgepay-app/.superpowers/` and demo
  scripts must not be committed).
- Channel gate is **server-enforced** (`sendInvoiceEmail` throws when
  `email_enabled = false`), never UI-only — matching the SMS gate.

## File inventory

**New:**
- `supabase/migrations/0021_email_outbound.sql`
- `app/lib/email-client.server.ts`
- `app/lib/email-messaging.server.ts`
- `app/lib/email-templates.ts`
- `app/lib/email-settings.ts`
- `app/lib/unsubscribe-token.ts`
- `app/routes/api.email.send.tsx`
- `app/routes/unsubscribe.tsx`
- Tests for each pure/DB unit above.

**Modified:**
- `app/lib/env.server.ts` — add `getEmailEnv` / `EmailEnv`.
- `app/lib/comm-prefs.ts` — add `email` channel + `doNotEmail` + `canSendEmail`.
- `app/lib/return-to.ts` — add `withEmail`.
- `app/routes/api.org-settings.tsx` — add `save_email` intent.
- `app/routes/api.comm-prefs.tsx` — parse `do_not_email`.
- `app/routes/settings.tsx` — writable email panel.
- `app/routes/dashboard.tsx` — load email thread + gate; thread `emailEnabled`.
- `app/components/DetailPanel.tsx` — Email tab + composer.
- `app/components/CommPrefsDrawer.tsx` — "Do not email" checkbox.
```
