# Wave 1 — SMS / Twilio / TCPA

- **Auditor:** Wave 1 (Backend Architect + TCPA)
- **HEAD:** `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc`
- **App:** `nudgepay-app/`
- **Date:** 2026-08-20
- **Scope:** Outbound send, inbound STOP/START, consent, quiet hours, bulk, test SMS, webhooks, templates, phone matching. Product code was not modified.
- **Method:** Full read of `twilio-*.server.ts`, `sms-gate.ts`, `sms-templates.ts`, `quiet-hours.ts`, send/consent/test/bulk routes, `BulkSmsDrawer`, `MessageThreadPanel`, `SendTextMiniForm`, `channel-settings.ts`, `messaging_config` migrations, and the SMS test suite. Prior cards from `docs/codebase-audit-2026-07-13.md` (B4, B5, M23–M25, minors 9/27/28/29) were re-opened against this freeze.
- **Live evidence:** None in this wave (code-only). Items that need Twilio console / A2P / production webhook confirmation are marked under each card.

---

## Hunt checklist

| Hunt item | Result | Card |
|---|---|---|
| Shared operator sender (B4) | **Reconfirmed.** `resolveSender` returns env default; tenant `messaging_config.sender` is ignored; `save_sms_sender` is locked. | TEMP-SMS-001 |
| Unmatched inbound dropped including STOP (B5) | **Reconfirmed.** `orgIds.size === 1` or drop; unmatched is not stored; webhook still 200. | TEMP-SMS-002 |
| Gate order (do-not-text before consent) | **UI yes, server/bulk no.** `smsGateFor` is correct; `sendInvoiceText` and `partitionEligibility` check consent first. | TEMP-SMS-010 |
| Quiet hours on all send paths including test? | **Customer sends yes; test SMS no.** | TEMP-SMS-007 |
| STOP/START keywords | **Partial.** Exact-body CTIA opt-out/opt-in lists; no HELP/INFO; no prefix match. | TEMP-SMS-005, TEMP-SMS-011 |
| Phone norm 0033 | **Reconfirmed.** Last-10 digit match in JS + generated columns; national `00xx` / `0…` forms miss inbound STOP. | TEMP-SMS-006 |
| No rate limit / idempotency | **Reconfirmed.** No 429/backoff, no Twilio `Idempotency-Key`, no per-customer cap. | TEMP-SMS-008 |
| Test-message no consent no throttle | **Reconfirmed.** Bypasses consent, quiet hours, `sms_enabled`, ledger. | TEMP-SMS-007 |
| Default templates missing STOP language | **Reconfirmed.** None of the four starters, none appended at send. | TEMP-SMS-004 |
| Consent no provenance | **Reconfirmed.** Bare `sms_consent boolean`. | TEMP-SMS-003 |
| STOP one-click reversible | **Reconfirmed.** UI "Mark consented" + inbound START; STOP does not set `do_not_text`. | TEMP-SMS-003 |
| Bulk skip-reason omitting do-not-text | **Reconfirmed.** `skippedSummary` has no `do-not-text` bucket. | TEMP-SMS-012 |
| Focus path same server gates | **Yes.** `SendTextMiniForm` POSTs `/api/text/send` → `sendInvoiceText`. | (solid) |
| Signature timing-safe | **Yes.** HMAC-SHA1 + equal-length XOR loop; length mismatch returns early (signature length is not secret). | (solid) |

---

## Findings

### [TEMP-SMS-001] All tenants share one operator-owned Twilio sender (B4)
- **Severity:** blocker
- **Bars:** P0-public
- **Area:** sms
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/lib/twilio-messaging.server.ts:42-52` (`resolveSender` returns `defaultSender` and documents that tenant overrides are ignored). `nudgepay-app/app/routes/api.org-settings.tsx:56-61` (`save_sms_sender` always redirects `sms_sender_locked`). `nudgepay-app/app/routes/api.text.send.tsx:10-13,41-46` and `nudgepay-app/app/routes/api.bulk-sms.tsx:14-17,75-81` both pass the Worker env sender. `nudgepay-app/app/lib/test-message.server.ts:31-32`. `nudgepay-app/app/components/SmsSettingsSection.tsx:67-85` (UI labels workspace sender "Inactive"). `nudgepay-app/wrangler.toml:43-45` (one `TWILIO_MESSAGING_SERVICE_SID` / `TWILIO_FROM_NUMBER` for the Worker). Tests: `nudgepay-app/tests/twilio-send.test.ts:37-42`, `nudgepay-app/tests/test-message.test.ts:52-70`.
- **Evidence (live):** Confirm whether production uses a Messaging Service (preferred) or a single From number, and whether A2P 10DLC brand/campaign is registered to the operator vs any tenant brand. Not verifiable from the repo.
- **User / legal impact:** Every org's dunning SMS comes from the same number. Public SaaS consequences: (1) A2P brand/campaign cannot be the tenant's; (2) one abusive tenant gets the shared number carrier-filtered for everyone; (3) inbound replies cannot be disambiguated by To-number, which is the root cause of TEMP-SMS-002. For a single managed tenant this is an acceptable operator-owned sender — hence P0-public, not P0-managed.
- **Fix recipe:** Provision per-org Twilio subaccounts or Messaging Services bound in a server-side inventory (`org_id → approved From / MG SID`). Make `resolveSender` read only that inventory. Until then keep the lock. Do not re-enable tenant-writable `messaging_config.sender`.
- **Do not:** Trust `messaging_config.sender` for outbound or inbound routing. That is the spoofing hole this lock was written to close.

### [TEMP-SMS-002] Inbound SMS, including STOP, is silently dropped when unmatched (B5)
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/lib/twilio-messaging.server.ts:156-177` (`resolveInboundOrgId` returns `null` unless exactly one org has outbound history for the last-10 of From, with `from_number_norm` null or equal to To). `:196-197` unmatched org → `{ matched: false, optOut: false }` with no insert. `:199-211` unmatched customer inside the org → same silent drop, **before** STOP/START at `:213-227`. `nudgepay-app/app/routes/webhooks.twilio.inbound.tsx:27-34` ignores the return value and always 200s empty TwiML. Tests that lock the drop in: `nudgepay-app/tests/twilio-inbound.test.ts:58-63` (unknown From stores nothing), `:111-125` (STOP to a To that is not the outbound From leaves `sms_consent` true), `:176-182` (stale tenant sender STOP dropped). Production sender is a Messaging Service (`wrangler.toml:43-44`); MG outbound stores `from_number: null` (`twilio-messaging.server.ts:144`), so routing collapses to "any org that ever texted this last-10". Two tenants texting the same phone → `orgIds.size !== 1` → STOP never applied. Amplifiers: PostgREST `max_rows = 1000` (`nudgepay-app/supabase/config.toml:18`) on the unbounded `customers` phone scan at `:205-211`; in-memory `.find()` first-match only; no unmatched-inbound table.
- **Evidence (live):** Confirm whether the production Messaging Service has Twilio Advanced Opt-Out enabled (carrier-level STOP would mask some of this, while START/HELP/ordinary replies would still be lost and `sms_consent` would stay stale). Confirm Chancey's customer-with-phone count vs the 1000-row cap.
- **User / legal impact:** A customer who texts STOP can keep receiving collection messages. TCPA statutory damages $500–$1,500 per text. This is not only a multi-tenant collision: a single-tenant STOP also drops when the reply phone last-10 does not match stored outbound `to_number` (QBO format, extension, different mobile, TEMP-SMS-006). The webhook 200 means Twilio will not retry and the operator has no queue of unmatched opt-outs.
- **Fix recipe:** (1) Persist unmatched inbound (From, To, Body, SID, received_at) before returning 200. (2) On STOP/START, apply the keyword to **every** customer whose last-10 matches, across every org that has outbound history to that number — or, with per-org senders (TEMP-SMS-001), route solely by To. (3) Paginate or SQL-filter the customer match (`phone_last10(phone) = fromNorm`) instead of loading the org. (4) Alert ops on unmatched STOP. (5) Return TwiML that confirms opt-out when the keyword matched.
- **Do not:** Treat Twilio Advanced Opt-Out as a substitute for writing `sms_consent=false`. The app will keep offering "Mark consented" and keep sending if Twilio ever allows it.

### [TEMP-SMS-003] Consent has no provenance; STOP is one-click reversible (M23)
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** reconfirmed
- **Evidence (code):** Schema: `nudgepay-app/supabase/migrations/0001_tenancy_schema.sql:44` (`sms_consent boolean not null default false`) — no `consented_at`, `consented_by`, `consent_source`, IP, or evidence. STOP writes only `sms_consent: false` (`twilio-messaging.server.ts:215-220`) and does **not** set `do_not_text`. START writes `sms_consent: true` (`:221-226`). Any org member can toggle the legal bit via `nudgepay-app/app/routes/api.sms-consent.tsx:18,44-48` (`consent === "true"`). UI copy is the one-click resume: `DetailPanel.tsx:209-218` and `MessageThreadPanel.tsx:133-140` ("Mark consented" / "Revoke consent"). Design comments claim the opposite: `api.comm-prefs.tsx:7-9` and `comm-prefs.ts:5-6` say the legal record is "governed solely by STOP/START, never by a preferences write" — true for comm-prefs, false for this route. Members retain UPDATE on `customers` including `sms_consent` (`0032_security_hardening.sql:48-55,61-82` protects QBO source fields, not consent).
- **Evidence (live):**
- **User / legal impact:** After a customer texts STOP, the next agent screen is a copper "Mark consented" link. One click restores sending with no capture of who, when, or what the customer said. That is not prior express consent under TCPA. START from the handset *is* a valid re-opt-in; an agent click is not. `do_not_text` (preference) is a separate flag STOP never sets, so the hard "Customer opted out of texts" gate does not fire after STOP — only the soft "Mark consent to enable sending" gate does.
- **Fix recipe:** Add `sms_consent_at`, `sms_consent_source` (`inbound_start` \| `inbound_stop` \| `agent` \| `import`), `sms_consent_by`. Agent grant should require a recorded basis (written form, verbal with log, inbound START). After inbound STOP, either set `do_not_text=true` as well or disable "Mark consented" until a START arrives. Keep the existing "Revoke consent" path.
- **Do not:** Treat the boolean toggle as written consent. Do not let comm-prefs write `sms_consent` (already omitted — keep it that way).

### [TEMP-SMS-004] Default SMS templates have no STOP language; send path does not append it
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/lib/sms-templates.ts:26-46` — four starters; bodies end with `— {company}`; none contain STOP/HELP. `applyTemplate` (`:50-55`) only substitutes tokens. `sendInvoiceText` (`twilio-messaging.server.ts:131-133`) sends `args.body` unchanged. Template upsert validates length 1–2000 only (`message-templates.ts:81-82`), not opt-out language. Reset-to-defaults re-inserts these same four (`api.org-settings.tsx:163-178`). Tests assert uniqueness and no leftover tokens (`sms-templates.test.ts:27-38`) and never assert STOP copy.
- **Evidence (live):** A2P 10DLC campaign sample messages must include opt-out language. Confirm what was submitted to TCR / Twilio.
- **User / legal impact:** CTIA/A2P: every recurring or first message must tell the recipient how to opt out. Collections texts that omit "Reply STOP to opt out" fail campaign rules and weaken the TCPA defense. Free-typed composer bodies have the same gap.
- **Fix recipe:** Put `Reply STOP to opt out.` on every default template. Append it server-side in `sendSms` / `sendInvoiceText` if the body does not already contain a STOP instruction (so free-typed sends are covered). Reject template saves that strip it.
- **Do not:** Rely on agents to remember. Do not append twice if the template already has it.

### [TEMP-SMS-005] HELP/INFO are not implemented; privacy policy claims they are
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** open
- **Evidence (code):** Keyword lists at `twilio-messaging.server.ts:153-154` — STOP set and START set only. No `HELP` / `INFO`. Inbound TwiML is empty (`webhooks.twilio.inbound.tsx:34`). Privacy copy: `nudgepay-app/app/routes/privacy.tsx:36-37` ("honor STOP/HELP opt-out keywords, and operate in compliance with TCPA and A2P 10DLC"). EULA puts honoring opt-outs on the tenant (`eula.tsx:20-22`) while the product is the processor that must actually honor them.
- **Evidence (live):** If the Messaging Service has Twilio's default HELP auto-reply configured, carrier HELP may still work. App still records no inbound HELP and does not send org phone / company name. Confirm console "Advanced Opt-Out" / "Autopilot" settings.
- **User / legal impact:** CTIA requires HELP to return the program name and a customer-care contact. A privacy-policy statement that HELP is honored, while the code does nothing, is a false statement in a legally required notice.
- **Fix recipe:** On HELP/INFO (and HELP as the first token), respond via TwiML with `{company}` and `{phone}` from org profile. Handle this **before** the unmatched-org drop, or at least log it. Correct the privacy sentence until the code matches.
- **Do not:** Classify HELP as an opt-out (privacy.tsx currently lumps STOP/HELP as "opt-out keywords"). HELP is informational.

### [TEMP-SMS-006] Last-10 phone matching drops international / `00xx` forms (0033)
- **Severity:** major
- **Bars:** P0-managed
- **Area:** sms
- **Status:** open
- **Evidence (code):** JS: `twilio-messaging.server.ts:36-40` (`replace(/\D/g, "").slice(-10)`). SQL twin: `nudgepay-app/supabase/migrations/0033_text_message_phone_norm.sql:3-11` (`right(regexp_replace(..., '\D', '', 'g'), 10)`). Comment at `:36-37` admits US-only. QBO phones are stored as FreeFormNumber with no E.164 normalize (`qbo-mappers.server.ts:37`). Outbound `To` is that raw string (`twilio-messaging.server.ts:132`). Tests only cover US formatting (`twilio-send.test.ts:32-35`, inbound `(310) 555-0201` vs `+13105550201`).
- **Evidence (live):** Sample Chancey `customers.phone` values from QBO. If every live phone is US 10-digit / `+1`, this is dormant for P0-managed; it is still the inbound STOP matcher.
- **User / legal impact:** French `0033 6 12 34 56 78` last-10 = `3612345678`; national `06 12 34 56 78` last-10 = `0612345678`; inbound Twilio From `+33612345678` last-10 = `3612345678`. National vs E.164 → STOP unmatched (TEMP-SMS-002). `00` prefix vs `+` happens to last-10-match for 0033, but collides with unrelated US NANP numbers (e.g. 361-234-5678). UK `+44` last-10 looks like a US number. Extensions and short QBO strings (`length < 10` at `:168,200`) also drop STOP.
- **Fix recipe:** Normalize to E.164 on QBO upsert and on send. Match inbound on E.164, not last-10. Keep last-10 only as a US fallback behind a country-code check. Reject sends to unparseable numbers.
- **Do not:** Ship multi-country QBO orgs on last-10 equality.

### [TEMP-SMS-007] Test SMS bypasses consent, quiet hours, workspace toggle, throttle, and ledger
- **Severity:** major
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/lib/test-message.server.ts:1-4,22-38` (comment: "no customer pipeline, no consent gates, no ledger inserts"). `nudgepay-app/app/routes/api.test-message.tsx:39-59` — owner-only, `parseTestSmsDestination` then `sendTestSms`. No `sms_enabled` read, no `isWithinSendWindow`, no per-owner / per-destination cooldown, no check that `to` is not a customer. Destination: any E.164 / US 10-digit (`provider-status.ts:35-44`). Composer: `SmsSettingsSection.tsx:88-110` (arbitrary tel). Tests lock in "no StatusCallback / no ledger" (`test-message.test.ts:88-102`) and env-default sender (`:52-70`).
- **Evidence (live):**
- **User / legal impact:** An owner can SMS any phone, including a customer, at 2am, with no STOP footer, no consent, and no `text_messages` row — so a subsequent STOP cannot route (TEMP-SMS-002). Quiet-hours and `sms_enabled` are therefore not "all send paths". Owner-only reduces blast radius; it does not make the send TCPA-exempt.
- **Fix recipe:** Restrict test destination to the owner's own phone (stored on the user/org profile) or require it to *not* match any `customers.phone`. Enforce quiet hours and `sms_enabled`. Rate-limit to N/hour. Log to an ops table (not the customer ledger) or a clearly tagged `text_messages` row so inbound STOP can still resolve. Append STOP language.
- **Do not:** Use this path to "just quickly text" a customer.

### [TEMP-SMS-008] No rate limit, send-frequency cap, or send idempotency (M24 / minor 29)
- **Severity:** major
- **Bars:** P0-managed
- **Area:** sms
- **Status:** reconfirmed
- **Evidence (code):** `api.text.send.tsx:15-54` — auth + org + `sendInvoiceText`; no idempotency key, no duplicate-body window, no per-customer cooldown. `sendSms` (`twilio-client.server.ts:8-36`) does not send Twilio's `Idempotency-Key` header; double-click = two Messages API POSTs = two SIDs = two customer texts. Bulk: `runBulkSms` (`bulk-send.server.ts:87-99`) fires sequentially with no delay or 429 handling; `sendSms` throws `Twilio send failed: ${status}` with no body/error code (`twilio-client.server.ts:33`). Batch cap is only `smsBatchLimit` / `MAX_BATCH` (`bulk.ts:7,68-73`) — a size cap, not a rate cap. Outbound `twilio_message_sid` is not unique (unique index is inbound-only, `0032_security_hardening.sql:102-106`). Focus submit button disables only while `fetcher.state !== "idle"` (`SendTextMiniForm.tsx:176-178`); a second tab is unconstrained.
- **Evidence (live):**
- **User / legal impact:** Two clicks = two dunning SMS. A member looping `/api/text/send` can bombard one consented customer and, on the shared sender (TEMP-SMS-001), exhaust the operator number's 10DLC throughput / get it filtered. Twilio 21610 (unsubscribed) surfaces as a generic "error" (`sms-send-reason.ts:14` falls through); the agent retries.
- **Fix recipe:** Send Twilio `Idempotency-Key` derived from `(orgId, invoiceId, body-hash, time-bucket)`. Reject a second outbound to the same customer inside a configurable window. Parse Twilio error 21610 into `optout` and flip `sms_consent`. Backoff on 429. Keep the batch-size clamp.
- **Do not:** Add client-only debounce and call it done.

### [TEMP-SMS-009] Quiet hours use org timezone, not the called party's (minor 28); test path skips them
- **Severity:** major
- **Bars:** P0-public
- **Area:** compliance
- **Status:** reconfirmed
- **Evidence (code):** Window math: `quiet-hours.ts:41-48` via `hourInTz` on the org IANA zone. Loaded from `org_settings.timezone` (`twilio-messaging.server.ts:24-33,107-114`). Default 8–21 (`quiet-hours.ts:13-14`) matches TCPA 8am–9pm **if** that zone is the recipient's. Customers have no timezone/area-code TZ. UI banners on dashboard/messages/focus/bulk (`case-queue.server.ts:274`, `messages.tsx:242`, `DetailPanel.tsx:249-255`, `SendTextMiniForm.tsx:133-136`, `BulkSmsDrawer.tsx:101-104`) — buttons stay enabled "in case this page is stale"; server still blocks. Customer send paths that **do** enforce: `sendInvoiceText` and bulk pre-check (`api.bulk-sms.tsx:60-71`) plus defense-in-depth (`bulk-send.test.ts:124-139`). Path that does **not**: test SMS (TEMP-SMS-007).
- **Evidence (live):** Chancey customer geography. If all recipients are in the org zone, P0-managed is acceptable; public multi-state is not.
- **User / legal impact:** 47 CFR §64.1200(c)(1) is local time of the **called party**. An NY org texting a Hawaii customer at 9am Eastern is 3am Hawaii.
- **Fix recipe:** Derive recipient TZ from NANP area code (or stored TZ) and gate on that. Keep org TZ as fallback. Do not widen the default past 8–21. Apply the same window to test SMS.
- **Do not:** Offer an all-day `0–24` window in settings without a TCPA warning (`parseQuietHoursUpdate` currently allows it, `channel-settings.ts:87-94`).

### [TEMP-SMS-010] Server and bulk evaluate consent before do-not-text; UI does the reverse
- **Severity:** minor
- **Bars:** polish
- **Area:** sms
- **Status:** open
- **Evidence (code):** Documented UI order: `sms-gate.ts:14-16,33-40` ("DoNotText MUST precede !consent") with tests `sms-gate.test.ts:30-34,64-67`. Inbox matches UI: `message-inbox.ts:82-97`. Server: `twilio-messaging.server.ts:116` then `:127` (consent, then `do_not_text`). Bulk: `bulk.ts:33-42` (`no-consent` before `do-not-text`) with a test that locks the wrong order in (`bulk.test.ts:84-88`). `smsSendReason` therefore reports `noconsent` when both flags are set (`sms-send-reason.ts:13-14`).
- **Evidence (live):**
- **User / legal impact:** Does not by itself send a blocked text — both flags still block. After STOP (consent false, `do_not_text` still false) this order is invisible. When both flags are set, flash copy says "has not consented" instead of "opted out", and bulk skip counts hide in the no-consent bucket (TEMP-SMS-012). Agents can still see "Mark consented" because that control is not gated on `doNotText` (`DetailPanel.tsx:193-221`).
- **Fix recipe:** Reorder `sendInvoiceText` and `partitionEligibility` to: workspace off → contact-block → do-not-text → consent → phone/invoice. Hide or disable "Mark consented" while `do_not_text` is true.
- **Do not:** "Fix" this only in the UI; the server reason codes are what Focus toasts and `?sms=` banners show.

### [TEMP-SMS-011] STOP/START match the entire body only; no confirmation TwiML
- **Severity:** major
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** open
- **Evidence (code):** `twilio-messaging.server.ts:213` `args.body.trim().toUpperCase()` then `STOP_KEYWORDS.includes(keyword)`. Lists (`:153-154`) are the CTIA sets: STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT and START/YES/UNSTOP. `"STOP PLEASE"`, `"STOP\nThanks"`, `"please stop"` as a sentence, and `"STOP."` do not match. No TwiML `<Message>` confirmation (`webhooks.twilio.inbound.tsx:34`). Tests only send exact `"STOP"` / `"START"` (`twilio-inbound.test.ts:43-56`).
- **Evidence (live):** Carrier STOP is often the whole body; some users add punctuation. Twilio Advanced Opt-Out would catch those at the number — unconfirmed.
- **User / legal impact:** A customer who texts "STOP PLEASE" is not opted out in-app and may still be texted (unless Twilio blocks). No confirmation SMS from NudgePay.
- **Fix recipe:** Treat the first token (strip punctuation) as the keyword. On STOP, reply TwiML "You are unsubscribed from {company} texts. Reply START to resume." Apply STOP even when org/customer match fails (pair with TEMP-SMS-002 unmatched ledger).
- **Do not:** Require the body to equal the keyword exactly.

### [TEMP-SMS-012] Bulk skip summary omits the do-not-text bucket
- **Severity:** minor
- **Bars:** polish
- **Area:** sms
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/components/BulkSmsDrawer.tsx:10-18` counts `no-phone`, `no-consent`, `do-not-contact` only. `SkipReason` includes `"do-not-text"` (`bulk.ts:9`). Combined with TEMP-SMS-010, a consented+opted-out customer is skipped as `do-not-text` and then **invisible** in the summary: `{n} skipped ()`. Dual-flag customers hide under no-consent (`bulk.test.ts:84-88`). Server still skips them (`bulk-send.server.ts:84` → `sendInvoiceText`).
- **Evidence (live):**
- **User / legal impact:** Operator thinks the skip math is wrong and may force-send. Not a bypass — eligibility is re-checked on POST (`BulkSmsDrawer.tsx:151`).
- **Fix recipe:** Add a `do-not-text` part to `skippedSummary`. Align skip order with `smsGateFor`.
- **Do not:** Drop `do-not-text` from `partitionEligibility` to make the summary add up.

### [TEMP-SMS-013] SMS ledger is member-writable; send-then-insert can orphan a live Twilio message
- **Severity:** major
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** open
- **Evidence (code):** RLS `text_messages_all` FOR ALL on membership (`0002_rls_policies.sql:33-34`); 0032 did not retighten this table (it did invoices/customers/QBO). Any member can UPDATE/DELETE delivery status, STOP threads, and bodies via the user client. Send order: Twilio POST then insert (`twilio-messaging.server.ts:131-148`). If insert fails, the customer already has the SMS, there is no SID in `text_messages`, and inbound STOP routing (which keys off outbound history, `:169-173`) cannot see it.
- **Evidence (live):**
- **User / legal impact:** The TCPA/A2P record of who was texted and who opted out is not append-only. An orphaned send is also an unmatched STOP waiting to happen (TEMP-SMS-002).
- **Fix recipe:** Member SELECT-only on `text_messages`; inserts through service role / owner. Consider inserting a `queued` row first (or Twilio's `Idempotency-Key` + a follow-up write). Never delete inbound STOP rows.
- **Do not:** Leave FOR ALL on the compliance table because "the anon key isn't in the browser."

### [TEMP-SMS-014] Detail-panel consent toggle still requires an invoice
- **Severity:** minor
- **Bars:** polish
- **Area:** sms
- **Status:** reconfirmed
- **Evidence (code):** `DetailPanel.tsx:209-212` posts `invoiceId={repInvoiceId ?? ""}` and no `customerId`. Empty invoice → `api.sms-consent.tsx:42` redirects `sms=error`. Messages tab was fixed (`MessageThreadPanel.tsx:133-136` sends both). Previous audit minor 10 is therefore half-fixed.
- **Evidence (live):**
- **User / legal impact:** Invoice-less case: agent clicks "Mark consented", lands on a generic error, and may believe consent flipped.
- **Fix recipe:** Pass `customerId` from the case on the detail-panel form (same as Messages).
- **Do not:** Infer customer from an empty invoice id.

---

## What is solid (file:line)

Outbound customer pipeline is one function. `sendInvoiceText` is the only customer send path (`twilio-messaging.server.ts:81-151`). Callers: `api.text.send.tsx:49` (dashboard + Messages + Focus `respond=json`) and `bulk-send.server.ts:90-95`. `sendSms` is otherwise used only by `sendTestSms`.

**Focus uses the same server gates.** `SendTextMiniForm.tsx:35-43` runs `smsGateFor` (hard + soft both block the form, `:96-99,127-130`). Submit is `fetcher.Form` → `/api/text/send` with `respond=json` (`:172-175`) → `sendInvoiceText`. Soft gates cannot be cleared in Focus (no inline consent) — that is stricter than the detail panel, not looser. Quiet-hours banner is advisory (`:133-136`); server still throws (`smsSendReason` → `quiet`).

**UI gate order (do-not-text before consent).** `sms-gate.ts:14-16,33-40`; tests `sms-gate.test.ts:30-34,64-67`. Inbox clone: `message-inbox.ts:82-97` + `canSendSms` (`comm-prefs.ts:49-52`).

**Workspace SMS off.** `sendInvoiceText` `:98-105` (DB error not swallowed; `sms_enabled === false` throws). Bulk pre-check `api.bulk-sms.tsx:51-58`. UI: `sms-gate.ts:27-29`, `SmsSettingsSection.tsx:41-65`. Absent `messaging_config` row = enabled (`channel-settings.ts:9-13`). Owner-only toggle: `api.org-settings.tsx:46-54` + RLS `0020_channel_settings.sql:12-16`. Tests: `twilio-send.test.ts:148-166`, `messaging-config-rls.test.ts`.

**Consent required on customer sends; default false.** `0001_tenancy_schema.sql:44`; throw at `twilio-messaging.server.ts:116`; test `twilio-send.test.ts:59-65`. QBO upsert cannot clobber it (`qbo-mappers.server.ts:31-38`; `qbo-mappers.test.ts` "omits sms_consent"). `parseCommPrefsUpdate` deliberately omits the column (`api.comm-prefs.tsx:7-9,24-25`; `api-comm-prefs.test.ts:24-25`).

**Do-not-text and legal hold block sends.** `twilio-messaging.server.ts:118-127` (contact-block queried before `do_not_text` so the reason is the legal hold). Tests: `twilio-send.test.ts:93-134`. Exceptions that block: `exceptions.ts:31-32,48-50` (`do_not_contact`, `legal_agency`). Non-blocking exceptions still send (`twilio-send.test.ts:136-146`).

**Quiet hours on customer sends, DST-aware, same-day window.** Defaults 8–21 (`quiet-hours.ts:13-21,29-35`). `[start, end)` (`:41-48`). Org override + prefetch for bulk (`twilio-messaging.server.ts:107-114`; `api.bulk-sms.tsx:60-81`). DB CHECK start < end (`channel-settings.ts:69-71,87-94`). `hourInTz` uses IANA + h23 (`tz.ts:46-52`). Tests: `quiet-hours.test.ts` (boundaries, spring-forward, fall-back), `twilio-send.test.ts:172-232`, `bulk-send.test.ts:124-139`.

**Org-scoped send / no cross-tenant invoice.** `sendInvoiceText` loads invoice `.eq("org_id", args.orgId)` (`:85-88`). Bulk cases `.eq("org_id", args.orgId)` (`bulk-send.server.ts:32-33`); foreign case ids send nothing (`bulk-send.test.ts:80-88`). Consent/comm-prefs updates are org-scoped + RLS (`api.sms-consent.tsx:26-48`; `api.comm-prefs.tsx:41-72`). CSRF: `requireUser` → `requireSameOrigin` (`session.server.ts:13-27`; `csrf.server.ts:16-28`). Webhooks do not go through `requireUser` (correct).

**Tenant sender spoofing is locked.** `resolveSender` `:42-52`; `save_sms_sender` locked (`api.org-settings.tsx:56-61`); settings copy (`SmsSettingsSection.tsx:67-85`). Tests `twilio-send.test.ts:37-42`, `test-message.test.ts:52-70`.

**Twilio request signature is HMAC-SHA1 and timing-safe.** `twilio-webhook.server.ts:12-16` (URL + sorted key+value, Twilio spec), `:18-27` (HMAC-SHA1), `:29-34` (XOR loop; unequal length → false), `:36-42` (`verifyTwilioSignature` rejects missing header). Both webhook routes verify before DB (`webhooks.twilio.inbound.tsx:19-22`, `webhooks.twilio.status.tsx:17-20`). Tests: `twilio-webhook.test.ts:9-28`, `twilio-routes.test.ts:10-38`. Public URL override so Workers `request.url` cannot break the signature (`inbound.tsx:7-10,17`; `status.tsx:7-15`). `TWILIO_PUBLIC_BASE_URL` is required for StatusCallback (`api.text.send.tsx:39-40`).

**Inbound replay is idempotent.** Early SID check (`twilio-messaging.server.ts:184-194`) + unique index `text_messages_inbound_twilio_sid_key` (`0032_security_hardening.sql:91-106`) + `23505` handler (`:253-256`). Test: `twilio-inbound.test.ts:257-267`.

**STOP/START keyword sets (exact body) are the CTIA lists.** `twilio-messaging.server.ts:153-154,213-227`. STOP flips consent off, START on. Tests: `twilio-inbound.test.ts:43-56`. Routing prefers outbound ledger over stale `messaging_config.sender` (`:160-177`; tests `:156-188,231-254`). Duplicate customer phones across orgs with **distinct** From numbers resolve to the To-matched org (`:85-108` in the inbound test file). Phone last-10 handles US punctuation (`twilio-send.test.ts:32-35`; inbound `(310) 555-0201`). Generated `to_number_norm` / `from_number_norm` + index (`0033_text_message_phone_norm.sql:13-22`). Status callbacks update by SID (`twilio-messaging.server.ts:261-268`; `webhooks.twilio.status.tsx:25-27`).

**Bulk eligibility and caps.** `partitionEligibility` skips blocked / no-phone / no-consent / do-not-text (`bulk.ts:35-46`). `clampBatch` shared client/server (`:68-73`; `api.bulk-sms.tsx:46`; `BulkSmsDrawer.tsx:68`). Confirm copy says eligibility is re-checked (`BulkSmsDrawer.tsx:151`). Partial Twilio failure does not abort siblings (`bulk-send.server.ts:97-99`; `bulk-send.test.ts:67-77`). `sms_enabled` and quiet hours fast-fail the whole batch (`api.bulk-sms.tsx:51-71`).

**Env / secrets.** `getTwilioEnv` requires account SID + token and one of MG SID / From (`env.server.ts:141-157`). `getTwilioEnvOrNull` for settings/test so missing secrets do not 500 (`:109-124`; `api.test-message.tsx:43-44`). Secrets are wrangler-only (`wrangler.toml:10-14,41-45`). `sendSms` uses Basic auth, injectable `fetchFn` (`twilio-client.server.ts:24-32`). Test destination parser rejects empty/junk (`provider-status.ts:27-44`).

**Case linkage.** Outbound stamps `case_id` from the open case (`twilio-messaging.server.ts:123-139`; tests `twilio-send.test.ts:75-91`). Inbound does the same (`:240-245`; `twilio-inbound.test.ts:73-83`). Open-case read errors are not swallowed (`:61-63,72-74`).

**Owner-only test SMS and channel settings.** `api.test-message.tsx:30-31`; `api.org-settings.tsx:25-26`. Test SMS is not a customer-composer bypass for members.

**Templates are pure and token-safe.** `sms-templates.ts:1-4,49-55` (unknown `{tokens}` left intact). Org tokens filled on bulk (`bulk-send.server.ts:29-42,94`). Template upsert caps body at 2000 (`message-templates.ts:81-82`).

**Webhook URLs for the operator.** `deriveWebhookUrls` (`provider-status.ts:14-24`) displayed in settings (`SmsSettingsSection.tsx:113-123`).

---

## Send-path matrix

| Path | Consent | do_not_text | contact-block | sms_enabled | quiet hours | STOP footer | Rate / idempotency | Ledger |
|---|---|---|---|---|---|---|---|---|
| `POST /api/text/send` (detail, messages, Focus) | yes | yes (after consent) | yes | yes | yes | no | no | yes, after Twilio |
| `POST /api/bulk-sms` → `runBulkSms` → `sendInvoiceText` | yes | yes (after consent) | yes | yes (pre + send) | yes (pre + send) | no | batch size only | yes, per send |
| `POST /api/test-message` `test_sms` | **no** | **no** | **no** | **no** | **no** | **no** | **no** | **no** |
| Twilio inbound STOP | writes `sms_consent=false` only if matched | not written | n/a | n/a | n/a | n/a | inbound SID unique | only if matched |

---

## Keyword / matching notes (as implemented)

- STOP family (exact trimmed uppercase body): `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT` — `twilio-messaging.server.ts:153`.
- START family: `START`, `YES`, `UNSTOP` — `:154`.
- Missing: `HELP`, `INFO`, first-token / punctuation-tolerant match, TwiML auto-reply.
- Inbound match key: last 10 digits of From against `text_messages.to_number_norm` plus From-number null-or-equal To — **not** `messaging_config.sender`.
- Unmatched: no row, no consent write, HTTP 200.

---

## Live / ops evidence still required

1. Twilio Advanced Opt-Out / default HELP auto-reply on the production Messaging Service.
2. A2P 10DLC brand + campaign (operator vs tenant) and whether sample messages included STOP language.
3. Production `TWILIO_MESSAGING_SERVICE_SID` vs `TWILIO_FROM_NUMBER`.
4. Chancey `customers.phone` shape (US 10-digit vs `00xx` / national) and count of rows with a phone (vs `max_rows = 1000`).
5. Whether any real unmatched STOP has already been dropped (no table to query — that is the bug).
