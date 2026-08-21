# Wave 1 — Email / Resend / Unsubscribe / CAN-SPAM

- **Auditor:** Wave 1 (Legal Compliance Checker + backend)
- **HEAD:** `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc`
- **Scope:** `nudgepay-app/` email send path, Resend webhooks, unsubscribe/CAN-SPAM, team alerts
- **Product code edited:** none
- **Live evidence:** none (code-only; no production mailbox / Resend dashboard access)

Prior audit `docs/codebase-audit-2026-07-13.md` named B3, B6, B7, M22, minors 26/32/53. All reconfirmed at this HEAD. New findings: postal address unenforced, staff re-subscribe, missing opt-out provenance, privacy/EULA omit Resend, List-Unsubscribe POST would not honor RFC 8058 even if headers were added.

---

## Hunt checklist

| Hunt item | Result |
|---|---|
| B3 AccountProfile missing `do_not_email` + action writes false | **BUG** — TEMP-EMAIL-001 |
| HMAC GET vs POST | **SOLID** — GET confirms only; POST mutates. See solid list. |
| List-Unsubscribe headers | **BUG** — TEMP-EMAIL-005 |
| Postal address | **BUG** — TEMP-EMAIL-002 (UI says required; send path treats optional) |
| `from_address` impersonation | **BUG** — TEMP-EMAIL-003 |
| Inbound event names `inbound.email.received` vs `email.received` | **BUG** — TEMP-EMAIL-004 |
| `to` as array | **BUG** — TEMP-EMAIL-004 (`str(d.to)` empties arrays) |
| `reply_to` never set | **BUG** — TEMP-EMAIL-006 |
| `email.failed` / `email.suppressed` ignored | **BUG** — TEMP-EMAIL-007 |
| Team alerts gated on customer email env | **BUG** — TEMP-EMAIL-008 |
| Templates asking to reply | **BUG** — TEMP-EMAIL-006 (compounded by TEMP-EMAIL-004) |

---

## Findings

### [TEMP-EMAIL-001] Account-profile Save preferences silently re-subscribes unsubscribed customers
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/components/AccountProfile.tsx:29` (props omit `doNotEmail`); `nudgepay-app/app/components/AccountProfile.tsx:120-142` (form submits `preferred_channel`, `do_not_call`, `do_not_text` only — no `do_not_email` checkbox); `nudgepay-app/app/routes/accounts.$id.tsx:27-38` (`CustomerRow` has no `do_not_email`); `nudgepay-app/app/routes/accounts.$id.tsx:135-139` (SELECT omits `do_not_email`); `nudgepay-app/app/routes/api.comm-prefs.tsx:20-22` (`do_not_email: form.get("do_not_email") === "true"` → missing field writes `false`). Contrast: `nudgepay-app/app/components/CommPrefsDrawer.tsx:63-66` does include the checkbox. Parser test locks the wipe in: `nudgepay-app/tests/api-comm-prefs.test.ts:13-15` (form without `do_not_email` expects `do_not_email: false`).
- **Evidence (live):**
- **User / legal impact:** CAN-SPAM 16 CFR 316.5 requires honoring a recipient opt-out. A customer who used the tokenized `/unsubscribe` link (or whose address complained/hard-bounced) is re-subscribed the next time staff hits **Save preferences** on `/accounts/:id` while editing owner, preferred channel, or call/text flags. Subsequent collection mail is then a knowing send after opt-out. Dashboard CommPrefsDrawer is the only staff UI that can *see* the flag; the account page cannot even display it.
- **Fix recipe:** (1) Add a `do_not_email` checkbox to `AccountProfile` matching `CommPrefsDrawer` (value `"true"`, `defaultChecked={prefs.doNotEmail}`). (2) SELECT `do_not_email` in `accounts.$id.tsx` and put it on `CustomerRow` / `commPrefs`. (3) Harden `parseCommPrefsUpdate`: do not write `do_not_email: false` unless the form actually posted the field (hidden sentinel, or omit the column from the UPDATE). (4) After a token/complaint/bounce opt-out, require an explicit “customer requested re-subscribe” confirmation before clearing the flag (see TEMP-EMAIL-009).
- **Do not:** Add a hidden `do_not_email=false` sibling (same-named fields make `form.get()` return the first value — `CommPrefsDrawer.tsx:52-54` already documents this). Do not “fix” it only in the drawer.

### [TEMP-EMAIL-002] CAN-SPAM postal address is advertised as required then dropped on send
- **Severity:** major
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** open
- **Evidence (code):** UI copy: `nudgepay-app/app/components/EmailSettingsSection.tsx:85-95` (“Required by CAN-SPAM — appended to every email's footer”) with no `required` attribute on the textarea. Parser: `nudgepay-app/app/lib/email-settings.ts:30-38` accepts `email_enabled: true` with empty `postal_address`; test `nudgepay-app/tests/email-settings.test.ts:22-24` names this “optional”. Send path: `nudgepay-app/app/lib/email-messaging.server.ts:53-57` appends postal **only if** `trim()` is non-empty. Happy-path gate test seeds `email_config` with no postal (`nudgepay-app/tests/email-messaging.gate.test.ts:101-108`) and still sends. Migration comment claims the opposite: `nudgepay-app/supabase/migrations/0022_email_hardening.sql:6-8`. Company profile has no mailing-address fallback (`nudgepay-app/app/lib/org-profile.ts:6-18`).
- **Evidence (live):**
- **User / legal impact:** CAN-SPAM § 5(a)(3) / 16 CFR 316.4 requires a valid physical postal address (street or PO Box) on commercial mail. Collection dunning is at best mixed-purpose; the product’s own copy treats these as CAN-SPAM commercial. An owner can enable email, leave mailing address blank, and every outbound invoice email ships with only an unsubscribe URL. That is a per-message violation if a regulator treats the mail as commercial, and it contradicts the in-app legal claim.
- **Fix recipe:** Reject `save_email` when `email_enabled === true` and `postal_address` is empty. Refuse `sendInvoiceEmail` (and test-send if you ever add a footer there) when postal is empty. Add a non-null check + settings error code (`error=postal`). Keep appending the address on every customer-facing body.
- **Do not:** Rely on Resend or the From domain to stand in for a physical address. Do not put the address only on HTML and omit it from the text body (the send path is text-only).

### [TEMP-EMAIL-003] Per-org From is unverified free text on the operator’s shared Resend key
- **Severity:** blocker
- **Bars:** P0-public
- **Area:** email
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/lib/email-settings.ts:1-3,23-38` — RFC-lite regex only; comment: “domain verification is an operator concern”. `nudgepay-app/app/lib/email-client.server.ts:7-19` — every send uses one `RESEND_API_KEY`. `nudgepay-app/app/lib/email-messaging.server.ts:15-16,59-63` formats `from_name <from_address>` with no domain bind. `nudgepay-app/app/routes/api.org-settings.tsx:128-132` upserts whatever the owner typed. No unique index on `email_config.from_address` (`nudgepay-app/supabase/migrations/0020_channel_settings.sql:18-26`, `0022_email_hardening.sql`). Inbound matcher treats colliding From addresses as ambiguous and **drops** the mail (`nudgepay-app/app/lib/email-messaging.server.ts:147-150`).
- **Evidence (live):**
- **User / legal impact:** (1) A public tenant typing their own domain gets runtime Resend 422s (“domain not verified”) with no self-serve verify path — the channel cannot actually be turned on without operator work. (2) A tenant typing any domain the operator *has* verified (including another tenant’s) can send as that identity — cross-tenant From impersonation, CAN-SPAM header-accuracy violation, and brand abuse on the shared account. (3) Two orgs sharing a From also break inbound routing. For a single-tenant managed pilot this is operator process, not a runtime blocker; it is a public-launch blocker.
- **Fix recipe:** Bind each org to a Resend-verified domain (Domains API or operator-provisioned subdomain like `orgslug.send.nudgepay-ar.app`). Reject `from_address` whose domain is not in that org’s verified set. Unique-index `email_config.from_address` (normalized). Keep the shared API key only behind that bind; do not let tenants type arbitrary From.
- **Do not:** Trust the settings placeholder copy (“Must be on a domain you've verified with Resend”) as a control. Do not add a second Resend account per org without also isolating webhook secrets.

### [TEMP-EMAIL-004] Inbound email mapping cannot work against the live Resend API
- **Severity:** blocker
- **Bars:** P0-public
- **Area:** email
- **Status:** reconfirmed
- **Evidence (code):** Mapper listens for guessed types only: `nudgepay-app/app/lib/email-events.ts:40-45` (`inbound.email.received`, `email.inbound`; everything else including the real `email.received` → `{ kind: "ignore" }`). `str()` at `email-events.ts:19-21` returns `""` for non-strings. Resend’s inbound payload documents `type: "email.received"` and `data.to` as an **array** (https://resend.com/docs/webhooks/emails/received). Tests freeze the wrong name: `nudgepay-app/tests/email-events.test.ts:21-25`. Webhook then records inbound only on `mapped.kind === "inbound"` (`nudgepay-app/app/routes/webhooks.resend.tsx:29-30`). Even if the type were fixed: (a) `to: str(d.to)` becomes `""`, `recordInboundEmail` bails at `nudgepay-app/app/lib/email-messaging.server.ts:121-122`; (b) Resend inbound webhooks do **not** include body/html — only metadata; `data.text`/`data.html` are absent, so `body` would be empty unless the handler GETs `/emails/receiving/:id`. Unmatched inbound returns `{ matched: false }` and the webhook still 204s (`webhooks.resend.tsx:36`) — no operator record.
- **Evidence (live):**
- **User / legal impact:** The product UI is a two-way inbox (`/messages` “Needs reply”, `MessageThreadPanel`, default templates that say “reply”). Customer replies to dunning never land. Staff think the thread is empty and send again. Combined with TEMP-EMAIL-006 this is a closed loop: we *ask* them to reply, then drop the reply.
- **Fix recipe:** Map `email.received`. Coerce `to`/`from` from `string | string[]` (take `received_for` / first To). Fetch the received-email body from Resend’s receiving API using `data.email_id`. Log unmatched inbound (org-unknown To, unknown From) somewhere operators can see. Paginate `email_config` + customer scans (1,000-row cap will miss matches at scale).
- **Do not:** Ship `email.inbound` / `inbound.email.received` as the production event names. Do not treat a 204 on an ignored event as “inbound works” (the webhook tests only cover `email.delivered`).

### [TEMP-EMAIL-005] No List-Unsubscribe / one-click headers; POST handler could not honor them anyway
- **Severity:** major
- **Bars:** P0-public
- **Area:** compliance
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/lib/email-client.server.ts:5,10-19` — `SendEmailArgs` has no `headers`/`reply_to`; payload is `Record<string, string>` of `from/to/subject/text/html` only. Customer send: `nudgepay-app/app/lib/email-messaging.server.ts:61-63` (body URL only). Unsubscribe action reads **form** token, not query: `nudgepay-app/app/routes/unsubscribe.tsx:23-25`. RFC 8058 one-click POSTs to the List-Unsubscribe URL with body `List-Unsubscribe=One-Click` (token would be on the query string) and expects a blank 200/202, not an HTML confirm page. Gmail/Yahoo bulk-sender rules (and Resend’s own docs: https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails) require `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- **Evidence (live):**
- **User / legal impact:** CAN-SPAM is satisfied by a working body link (the footer URL) plus a confirm POST — that path is solid (see below). Gmail/Yahoo one-click Unsubscribe in the chrome will **not** appear. Past ~5k msgs/day to those providers, mail is spam-foldered. If headers are bolted on later without changing the action, Gmail’s POST will 200 a confirm page and **not** flip `do_not_email`.
- **Fix recipe:** Extend `sendEmail` with `headers` and `reply_to`. On customer mail set `List-Unsubscribe: <{unsubUrl}>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Teach `unsubscribe` action to accept token from query **or** form; on `List-Unsubscribe=One-Click` (or any POST with a valid token and no confirm intent) mutate immediately and return empty 200. Keep GET as the human confirm page.
- **Do not:** Point List-Unsubscribe at a URL that requires login. Do not put the one-click POST behind `requireSameOrigin` (mailbox POSTs have no app Origin). Do not treat the body URL as a substitute for the header at public scale.

### [TEMP-EMAIL-006] `reply_to` is never set; default templates tell customers to reply
- **Severity:** major
- **Bars:** P0-public
- **Area:** email
- **Status:** reconfirmed
- **Evidence (code):** Transport: `nudgepay-app/app/lib/email-client.server.ts:5` (no `reply_to` field); `nudgepay-app/app/lib/email-messaging.server.ts:61-63`; team alerts `nudgepay-app/app/lib/notifications.server.ts:102-107,258-263`; test mail `nudgepay-app/app/lib/test-message.server.ts:74-79`. Templates: `nudgepay-app/app/lib/email-templates.ts:20` (“reply with any questions and we'll be glad to help”); `email-templates.ts:26` (“or reply if there is anything we can help resolve”). No settings UI for inbound MX / receiving domain (`EmailSettingsSection.tsx` webhook field is delivery events only, lines 130-137).
- **Evidence (live):**
- **User / legal impact:** Reply-To defaults to From. If From is a send-only subdomain (normal Resend setup), customer replies bounce. If From is a real inbox not routed to Resend, replies never hit `/webhooks/resend` (and even if they did, TEMP-EMAIL-004 drops them). Recipients follow the template’s instruction and hear nothing; staff re-nudge. Not itself a CAN-SPAM element, but it is a collections-practice failure and it makes the “two-way email” surface dishonest.
- **Fix recipe:** Add `reply_to` on customer sends (org-configured inbox, or a Resend receiving address on the sending domain). Document MX/receiving setup next to From in settings. Change default template copy to a phone / payment-link CTA until inbound actually works. After TEMP-EMAIL-004, keep Reply-To aligned with the address `recordInboundEmail` matches on (`email_config.from_address`).
- **Do not:** Tell customers to reply while inbound is a no-op. Do not set Reply-To to a personal staff Gmail that inbound cannot attribute to an org.

### [TEMP-EMAIL-007] `email.failed` and `email.suppressed` are ignored; rows stay `sent`
- **Severity:** major
- **Bars:** P0-public
- **Area:** email
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/lib/email-events.ts:23-45` maps `sent/delivered/delivery_delayed/bounced/complained` plus the two guessed inbound names; `default` → ignore. Tests explicitly ignore unknown types (`nudgepay-app/tests/email-events.test.ts:26-29`) and never mention `email.failed` / `email.suppressed`. Outbound insert stamps `status: "sent"` immediately (`nudgepay-app/app/lib/email-messaging.server.ts:65-73`). Resend fires `email.failed` (quota, unverified domain, invalid recipient — https://resend.com/docs/webhooks/emails/failed) and `email.suppressed` (account suppression list). Both have `data.to` as an array and `data.email_id`.
- **Evidence (live):**
- **User / legal impact:** Async failures never update `email_messages`. UI shows “sent”. Settings “Delivery failures (7d)” under-counts. Hard-bounce composer warning (`isHardBounce` in `nudgepay-app/app/lib/labels.ts:57-61`) never trips on failed/suppressed. Staff keep mailing a dead or suppressed address. Suppression-list hits in particular should flip `do_not_email` (same as complaint/permanent bounce).
- **Fix recipe:** Map `email.failed` → status `failed` + `errorCode` from `data.failed.reason`. Map `email.suppressed` → status `suppressed`, `optOut: true`. Keep using `data.email_id` as `providerMessageId`.
- **Do not:** Collapse failed/suppressed into `bounced`. Do not 500 the webhook on unknown types (204-on-ignore is correct; just stop ignoring these two).

### [TEMP-EMAIL-008] Team alert emails are gated on the customer-facing email channel
- **Severity:** major
- **Bars:** P0-public
- **Area:** email
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/lib/notifications.server.ts:34-40` (`sendBrokenPromiseAlerts` returns if `!ecfg?.email_enabled || !ecfg.from_address`); same gate at `131-137` (`runDailyDigest`). UI admits it: `nudgepay-app/app/components/NotificationPrefsForm.tsx:22-25` (“Org email is disabled — alerts won't send until enabled.”). Cron still runs (`nudgepay-app/app/lib/digest-cron.server.ts:88-93`; `nudgepay-app/app/lib/qbo-cron.server.ts:23-30`) but the inner send no-ops. Alerts also reuse the customer From identity (same `from_address`), so enabling alerts means sending internal mail as `billing@customer-domain`.
- **Evidence (live):**
- **User / legal impact:** An org that is not ready to dunning-email customers (missing postal, unverified domain, legal hold on outbound) also cannot receive broken-promise alerts or the daily digest. The Product Overview promise of “get alerted” is then in-app only. Inverse: turning on customer email to get digests starts CAN-SPAM-covered mail without a separate decision.
- **Fix recipe:** Split channels. Team alerts should send from an operator address (e.g. `alerts@nudgepay-ar.app`) whenever `RESEND_API_KEY` + `APP_PUBLIC_BASE_URL` exist, independent of `email_config.email_enabled`. Keep customer From + postal + unsubscribe strictly on `sendInvoiceEmail`.
- **Do not:** Append the customer CAN-SPAM unsubscribe footer to team mail. Do not require `email_config.postal_address` for a digest to the staff.

### [TEMP-EMAIL-009] Staff can clear a legal email opt-out without an affirmative recipient request
- **Severity:** major
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/components/CommPrefsDrawer.tsx:63-66` — unchecked `do_not_email` submits nothing; action writes `false` (`api.comm-prefs.tsx:22`). Same action is reachable from the account page (TEMP-EMAIL-001). Unsubscribe success copy invites staff re-enable: `nudgepay-app/app/routes/unsubscribe.tsx:56` (“If this was a mistake, contact us and we'll re-enable email.”). Complaint/permanent-bounce opt-outs use the same boolean (`nudgepay-app/app/lib/email-messaging.server.ts:102-110`) with no source/timestamp. No `do_not_email_at` / `do_not_email_source` column (`0021_email_outbound.sql:6`).
- **Evidence (live):**
- **User / legal impact:** CAN-SPAM allows resuming commercial mail only after the recipient subsequently affirmatively opts in. A collections rep unchecking “Do not email” (or saving the account form) is not that request. Spam-complaint reversals are also a deliverability landmine on the shared Resend account. There is no audit trail to prove who reversed an opt-out or when the original opt-out occurred.
- **Fix recipe:** Persist source (`unsubscribe_token` | `complaint` | `permanent_bounce` | `staff` | `recipient_request`) and timestamp. If source is token/complaint/bounce, require a distinct “recipient asked to re-subscribe” intent (reason + actor) before clearing. Keep a ledger row. Do not let a generic prefs save clear a legal flag (ties to TEMP-EMAIL-001).
- **Do not:** Treat `do_not_email` as a casual preference interchangeable with `do_not_call`. Do not conflate it with TCPA `sms_consent` (the code correctly keeps those separate — keep that split).

### [TEMP-EMAIL-010] Privacy Policy and EULA omit the email channel, Resend, and CAN-SPAM
- **Severity:** major
- **Bars:** P0-public
- **Area:** compliance
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/routes/privacy.tsx:33-37` covers SMS/Twilio/TCPA only; `privacy.tsx:48-50` sub-processors are Intuit, Twilio, Supabase, Cloudflare — **no Resend**. No section on collection email, unsubscribe, or postal address. `nudgepay-app/app/routes/eula.tsx:18-22` makes the customer “solely responsible” for TCPA/A2P SMS consent and honoring opt-outs; it never names CAN-SPAM or email. Email is a live NudgePay channel (migration `0021_email_outbound.sql:2-3`).
- **Evidence (live):**
- **User / legal impact:** Intuit app-card / public-site privacy disclosure understates processing (recipient addresses, message bodies, Resend as sub-processor). EULA does not allocate CAN-SPAM responsibility to the tenant (accurate From, postal, honoring opt-outs) the way it does for SMS. That is a gap for app review and for operator vs tenant liability.
- **Fix recipe:** Add an email subsection (what is sent, Resend, unsubscribe, postal, retention of `email_messages`). List Resend on sub-processors. Mirror the SMS clause in the EULA for CAN-SPAM (tenant is sender of record for customer mail; must supply a valid From/postal and honor opt-outs). Bump effective dates.
- **Do not:** Copy Twilio/TCPA language onto email (opt-out vs prior-consent regimes differ — `comm-prefs.ts:6-7,54-57` already states this correctly).

### [TEMP-EMAIL-011] No send-side rate limit on the shared Resend account
- **Severity:** major
- **Bars:** P0-public
- **Area:** email
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/routes/api.email.send.tsx:8-42` — any authenticated org member, no ceiling, no idempotency key. `nudgepay-app/app/lib/email-client.server.ts:13-19` — raw POST, no 429 handling. Same transport used for alerts and test sends. Contrast: bulk SMS has `clampBatch` / `smsBatchLimit`; there is no bulk-email equivalent, but a tight loop on `/api/email/send` is enough.
- **Evidence (live):**
- **User / legal impact:** One abusive or buggy client burns the operator Resend quota (which then fires `email.failed` / `reached_daily_quota` — ignored, TEMP-EMAIL-007). Shared-account reputation hits every tenant. CAN-SPAM also prohibits sending after opt-out; a loop that races the prefs write can send after unsubscribe.
- **Fix recipe:** Per-org and per-customer rate limits on `sendInvoiceEmail` (e.g. 1 identical body/subject/invoice per N minutes; daily cap). Pass Resend `Idempotency-Key`. Surface 429s as `email=error`.
- **Do not:** Add bulk email until the single-send path is capped and opt-out is un-wipeable.

### [TEMP-EMAIL-012] Broken-promise alert failures are one-shot and never retried
- **Severity:** minor
- **Bars:** polish
- **Area:** email
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/lib/notifications.server.ts:101-117` — catch logs, no `notification_log` row, comment: “the promise transition is one-shot so a manual re-trigger or retry job would be needed.” Digest retries via `last_digest_date` reset (`digest-cron.server.ts:95-107`); broken-promise has no equivalent. Dedup key is `promise:{id}:{userId}` (`notifications.server.ts:92`).
- **Evidence (live):**
- **User / legal impact:** A transient Resend blip at evaluation time means the owner never gets the “broken promise” mail for that promise. In-app view still shows the case. Not a CAN-SPAM issue; it is a missed operational alert.
- **Fix recipe:** Insert a `pending`/`failed` ledger row and retry from cron, or re-invoke `sendBrokenPromiseAlerts` from digest for still-broken promises with no success row.
- **Do not:** Insert the success `notification_log` row before `sendEmail` returns (that would permanently suppress retries).

---

## What is solid

HMAC GET vs POST (the hunt item) is **not** a bug. RFC 8058-safe split is implemented and tested.

### Unsubscribe token (HMAC)
- `nudgepay-app/app/lib/unsubscribe-token.ts:1-3` — payload `{o, c}`, no expiry (opt-out links stay valid past CAN-SPAM’s 30-day minimum).
- `unsubscribe-token.ts:21-28` — Web Crypto HMAC-SHA-256.
- `unsubscribe-token.ts:30-35,50-51` — timing-safe compare; reject on length mismatch.
- `unsubscribe-token.ts:37-41` sign; `43-58` verify (malformed / bad JSON / non-string ids → null).
- Tests: `nudgepay-app/tests/unsubscribe-token.test.ts:6-20`.

### Unsubscribe route (GET confirm / POST mutate)
- `nudgepay-app/app/routes/unsubscribe.tsx:10-18` — GET verifies token, returns `{ valid, token, done: false }`, **no DB write**.
- `unsubscribe.tsx:21-36` — POST only; HMAC then `customers.do_not_email = true` scoped `.eq("org_id").eq("id")`; invalid token does not throw.
- `unsubscribe.tsx:45-66` — invalid / confirm / done UI; confirm form POSTs hidden token.
- `nudgepay-app/app/lib/env.server.ts:86-94` — `getUnsubscribeEnv` requires only `UNSUBSCRIBE_SECRET` so the public page keeps working if `RESEND_API_KEY` is absent.
- Route registration: `nudgepay-app/app/routes.ts:38`.
- Tests: `nudgepay-app/tests/unsubscribe.route.test.ts:40-56` (GET does not mutate), `58-71` (POST sets flag), `73-97` (works without send key), `99-111` (bad token leaves flag false).
- Public, no login — CAN-SPAM “easy Internet-based way.” No `requireSameOrigin` (correct for a mail-link POST).

### Customer send-path gating
- Org switch defaults **off**: `nudgepay-app/app/lib/email-settings.ts:1-3,14-16`; `email-messaging.server.ts:36-42` (absent row or `email_enabled !== true` throws; DB error is not swallowed).
- From required: `email-messaging.server.ts:42`.
- Customer email required: `email-messaging.server.ts:28-34`.
- Contact-block / legal hold: `email-messaging.server.ts:44-48` via `isContactBlocked`.
- Per-customer opt-out: `email-messaging.server.ts:49` (`do_not_email`).
- Eligibility helper: `nudgepay-app/app/lib/comm-prefs.ts:54-57` (`canSendEmail` is opt-out only — correct vs TCPA).
- UI gates (defense in depth, not the real control): `DetailPanel.tsx:381-392`; `message-inbox.ts:101-114`; `MessageThreadPanel.tsx:24-29,194,239-246`.
- `APP_PUBLIC_BASE_URL` required before send: `nudgepay-app/app/routes/api.email.send.tsx:21`.
- Auth + CSRF on send: `api.email.send.tsx:11` → `requireUser` → `csrf.server.ts`.
- Tests: `nudgepay-app/tests/email-messaging.gate.test.ts:46-97`.

### CAN-SPAM footer on every customer body
- Footer is **appended at send**, not stored in templates: `nudgepay-app/app/lib/email-templates.ts:4-5`; `email-messaging.server.ts:51-58`.
- Unsubscribe URL uses HMAC token: `email-messaging.server.ts:51-52,57`.
- Token alphabet is base64url (safe in query without encoding): `unsubscribe-token.ts:5-8`.
- Body + footer persisted on `email_messages`: `email-messaging.server.ts:77`.
- Test: `email-messaging.gate.test.ts:99-113`.

### Complaint / permanent-bounce → opt-out
- `nudgepay-app/app/lib/email-events.ts:32-39` — permanent/hard bounce `optOut: true`; transient delayed not opted out; `email.complained` `optOut: true`.
- `email-messaging.server.ts:91-111` — status update by `provider_message_id`; opt-out loops matched rows and sets `do_not_email` org-scoped.
- Empty provider id is a no-op: `email-messaging.server.ts:95`.
- Tests: `nudgepay-app/tests/email-events.test.ts:5-20`; `nudgepay-app/tests/email-inbound-status.test.ts:56-98`.
- Composer warning on last hard bounce: `nudgepay-app/app/lib/labels.ts:32-61`; used in `DetailPanel.tsx:377-379`, `MessageThreadPanel.tsx:84-86`.

### Resend webhook authentication
- `nudgepay-app/app/lib/resend-webhook.server.ts:1-4,21-52` — Svix `id.ts.body` HMAC-SHA-256, `whsec_` prefix, ±5 min skew, timing-safe, any `v1,` signature part.
- `nudgepay-app/app/routes/webhooks.resend.tsx:8-16` — 401 on bad signature; `21-22` 204 on signed-but-unparseable (no retry loop); `32-35` 500 only on processing errors.
- Tests: `nudgepay-app/tests/resend-webhook.test.ts:16-39`; `nudgepay-app/tests/webhooks-resend.test.ts:65-111`.

### Inbound tenancy (logic is right; live events never reach it — TEMP-EMAIL-004)
- Normalize `Name <addr>`: `email-messaging.server.ts:84-88`.
- Resolve org by **recipient** = org `from_address`, in-process compare (no ILIKE): `email-messaging.server.ts:138-151`.
- Customer lookup scoped to that org: `153-163`.
- Thread to last outbound invoice: `165-177` (fail-loud on read error).
- Idempotent on `provider_message_id` + unique index `23505`: `124-136,193-197`; `nudgepay-app/supabase/migrations/0022_email_hardening.sql:9-11`.
- Tests: `email-inbound-status.test.ts:100-250` (match, unmatched, cross-tenant, unknown To, idempotent replay, `%` not an ILIKE pattern).

### Email settings + schema
- Absent config = disabled: `email-settings.ts:14-16`; test `email-settings.test.ts:11-13`.
- Malformed From rejected: `email-settings.ts:23-37`; test `email-settings.test.ts:26-28`.
- Owner-only write: `api.org-settings.tsx:25-26,128-136`; RLS `0020_channel_settings.sql:27-31`.
- Distinct `email_saved=1` flash: `api.org-settings.tsx:134-136`.
- `do_not_email` default false: `0021_email_outbound.sql:6`; test `email-messages.rls.test.ts:59-75`.
- `email_messages` RLS member-read / owner-write: `0021_email_outbound.sql:25-29`; test `email-messages.rls.test.ts`.
- Dead `provider` column dropped: `0031_cleanup.sql:1-5`.
- QBO customer upsert does **not** touch `do_not_email`: `nudgepay-app/app/lib/qbo-mappers.server.ts:31-38`.

### Comm prefs model (except TEMP-EMAIL-001 / 009)
- Email is opt-out, not prior-consent: `nudgepay-app/app/lib/comm-prefs.ts:6-7,54-57`.
- `parseCommPrefsUpdate` never writes `sms_consent`: `api.comm-prefs.tsx:7-8,23`; test `api-comm-prefs.test.ts:24-26`.
- Org-scoped customer resolve (customerId → caseId → invoiceId): `api.comm-prefs.tsx:41-69`.
- Fail-loud on write error: `api.comm-prefs.tsx:73-75`.
- Drawer documents checkbox/get() pitfall correctly: `CommPrefsDrawer.tsx:52-54`.

### Team-alert content (transport/gating issues are TEMP-EMAIL-008 / 012)
- HTML escaped: `nudgepay-app/app/lib/notifications.ts:123-125`; test `tests/notifications.test.ts:23-32`.
- Prefs default on, explicit `false` opts out: `notifications.server.ts:86-87,230-231`.
- Dedup ledger: `notifications.server.ts:92-99,239-247`.
- Digest claim on `last_digest_date` + member-level dedupe: `digest-cron.server.ts:58-86`.
- `getEmailEnvOrNull` so cron/sync never 500 without secrets: `env.server.ts:68-84`; `digest-cron.server.ts:25-29`; `qbo-cron.server.ts:23-31`; `wrangler.toml:52`.

### Test / operator surfaces
- Test email is owner-only, goes to the signed-in owner, skips customer pipeline/ledger: `api.test-message.tsx:30-31,65-81`; `test-message.server.ts:50-80`.
- Webhook URL derived, not hardcoded: `nudgepay-app/app/lib/provider-status.ts:14-24`.
- Secrets via `wrangler secret put`, not source: `wrangler.toml:15,46-49`.

### Templates
- Token substitution only known keys: `email-templates.ts:42-47`; tests `email-templates.test.ts`.
- Starter copy has no hardcoded “Chancey”: `email-templates.test.ts:30-35`.
- Subject/body required at send: `api.email.send.tsx:18-20`.

---

## Out of scope / not bugs for this wave

- **HMAC GET vs POST:** implemented correctly; listed above.
- **Resend `to` as a string on *send*:** API accepts `string | string[]` (`email-client.server.ts:10`). Inbound `to`-as-array is the defect (TEMP-EMAIL-004).
- **Team-alert mail without CAN-SPAM footer:** transactional to staff; acceptable once From is an operator address (TEMP-EMAIL-008).
- **Test email without footer:** documented internal (`test-message.server.ts:56-57`).
- **`email.opened` / `email.clicked` ignored:** intentional (`email-events.ts:44-45`).
- **Quiet hours not applied to email:** SMS-only by design (`quiet-hours` is a messaging_config concern).
- **Email not counting as “last contact”:** product issue (prior M10), not CAN-SPAM.
