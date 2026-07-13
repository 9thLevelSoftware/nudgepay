# NudgePay Codebase Audit — 13 July 2026

Full codebase mapping and public-release readiness audit of `nudgepay-app`
(React Router 7 SSR on Cloudflare Workers, Supabase Postgres + Auth + RLS,
QuickBooks Online sync, Twilio SMS, Resend email). This supersedes the
requirements-focused [gap analysis of 2 July 2026](gap-analysis-2026-07-02.md);
that document compared the code against stakeholder briefs, this one asks a
different question: **can this app be released to the public as a fully
functional AR-collections product, with nothing missing or non-functional?**

**Method.** Thirteen scoped audit passes (auth/onboarding, dashboard/focus,
accounts/promises, messages/reports/settings, QBO integration, SMS/email
machinery, pure domain logic, API security, schema/migrations, release ops,
accessibility/responsiveness, cross-cutting UX flows, and a follow-up on every
item in the 2 July gap analysis) plus a structural mapping pass, run as
independent parallel reviews and de-duplicated. Every **blocker** below, and
the highest-impact majors, were then re-verified line-by-line in a second,
adversarial pass (one blocker was materially refined as a result — see B8).
Majors and minors carry file:line evidence from the original pass; a small
number of majors were independently re-checked where noted.

**Objective signals.** `npm run typecheck` ✅ passes. `npm run build` ✅
passes (SSR worker bundle ~1.1 MB). `npm test` ✖ cannot run from a fresh
clone: it hard-requires an uncommitted `.env.test` plus a running local
Supabase (Docker) — see M29. No CI exists to run it either — see M27.

---

## Executive summary

| Severity | Count | Meaning |
|---|---|---|
| 🟥 Blocker | 12 | Broken/missing functionality a public user hits, legal/compliance exposure, or data-integrity risk |
| 🟧 Major | 34 | Degraded core experience, partially implemented feature, or missing table-stakes SaaS capability |
| 🟨 Minor | 61 | Polish, hygiene, docs drift |

**Verdict: not releasable to the general public today.** The core collections
workflow (queue → contact → promise → payment validation → SMS/email) is
genuinely built, well-factored, and heavily tested at the domain layer — this
is not a prototype. But the codebase is still shaped like what it was built
as: a managed deployment for one known customer. Five themes make that
concrete:

1. **Single-tenant assumptions are load-bearing.** All tenants share one
   operator-owned Twilio sender by explicit design (B4); per-org email
   senders are free-text and unverifiable self-serve (B6); QBO query caps
   are sized in-code to one pilot customer ("Chancey carries 125–175 overdue
   invoices", M18); every Supabase read silently truncates at 1,000 rows
   (B1, B2); the sync cron iterates all orgs serially in one Worker
   invocation (M21).
2. **The first-run experience fails.** After connecting QuickBooks, nothing
   syncs automatically and the one existing backfill is hidden behind a
   "Sync now" button in Settings while the user is redirected to an empty
   dashboard whose `?qbo=connected`/`?qbo=error` outcome is never rendered
   (B8, M17). A brand-new public user's first five minutes end in a blank
   queue with no explanation.
3. **Account lifecycle is incomplete.** No password reset (B0), no
   email-confirmation landing (M1), invites don't actually email (M2), no
   member removal or role change ever (M4), no change-password/email or
   account deletion (M5), and multi-org membership silently traps users in
   their oldest org (M3).
4. **Messaging compliance has real holes despite strong plumbing.** Inbound
   SMS — including STOP revocations — is silently dropped whenever the
   sender's phone can't be matched to exactly one org and customer (B5);
   saving preferences from the account profile silently resets a customer's
   CAN-SPAM email unsubscribe (B3); consent is a one-click boolean with no
   provenance and STOP is one-click reversible (M23); default SMS templates
   carry no "Reply STOP to opt out" language (minor 27).
5. **Production operations don't exist yet.** The production Supabase URL and
   the Netlify compliance redirects are literal placeholders (B10, B11), the
   Intuit production checklist is entirely open (M30), and there is no CI,
   no error monitoring, and no analytics (M27, M28).

None of this diminishes what is there: multi-tenant RLS on every table,
encrypted QBO token storage, signed webhooks on all three providers,
server-enforced quiet hours and consent gates on every send path, a real
promise state machine with payment-validated broken-promise detection, and a
polished keyboard-driven UI. The final section proposes a staged path that
separates "safe for a managed pilot" (near-term) from "safe for the public"
(the real bar this audit measures against).

---

## Codebase map

### Feature areas

| Area | Status | Key files |
|---|---|---|
| Auth & session (signup/login/logout) | complete | `app/routes/signup.tsx`, `app/routes/login.tsx`, `app/lib/session.server.ts`, `app/lib/auth-flow.server.ts` |
| Onboarding & team invites | partial | `app/routes/onboarding.tsx`, `app/routes/invite.tsx`, `app/routes/accept.$token.tsx`, `app/lib/orgs.server.ts` |
| QBO OAuth connection lifecycle | complete | `app/routes/api.qbo.connect.tsx`, `app/routes/auth.qbo.callback.tsx`, `app/routes/api.qbo.disconnect.tsx`, `app/lib/oauth-state.server.ts`, `app/lib/qbo-connection.server.ts` |
| QBO sync (manual, webhook CDC, cron catch-up, payments) | complete | `app/lib/qbo-sync.server.ts`, `app/routes/webhooks.qbo.tsx`, `app/lib/qbo-cron.server.ts`, `app/routes/api.qbo.refresh.tsx`, `app/lib/sync-errors.server.ts` |
| Collection cases & dashboard work queue | complete | `app/routes/dashboard.tsx`, `app/lib/cases.ts`, `app/lib/case-queue.server.ts`, `app/lib/case-lifecycle.server.ts`, `app/components/WorkQueue.tsx` |
| Focus mode | complete | `app/routes/focus.tsx`, `app/lib/focus-queue.ts`, `app/lib/focus-session.ts`, `app/components/focus/FocusCard.tsx` |
| Promises (promise-to-pay loop) | complete | `app/routes/promises.tsx`, `app/lib/promise-create.server.ts`, `app/lib/promise-evaluation.server.ts`, `app/lib/promise-ledger.ts`, `app/routes/api.promises.cancel.tsx` |
| Two-way SMS (Twilio, STOP/START compliance, quiet hours) | complete | `app/lib/twilio-messaging.server.ts`, `app/routes/webhooks.twilio.inbound.tsx`, `app/routes/webhooks.twilio.status.tsx`, `app/routes/api.text.send.tsx`, `app/lib/quiet-hours.ts` |
| Email channel (Resend outbound/inbound, unsubscribe, CAN-SPAM) | complete | `app/lib/email-messaging.server.ts`, `app/routes/api.email.send.tsx`, `app/routes/webhooks.resend.tsx`, `app/routes/unsubscribe.tsx`, `app/lib/unsubscribe-token.ts` |
| Messages inbox (unified SMS+email threads) | complete | `app/routes/messages.tsx`, `app/lib/message-inbox.ts`, `app/components/MessageThreadPanel.tsx` |
| Bulk actions (bulk assign + bulk SMS) | complete | `app/routes/api.bulk-sms.tsx`, `app/routes/api.bulk-assign.tsx`, `app/lib/bulk-send.server.ts`, `app/lib/bulk.ts`, `app/components/BulkSmsDrawer.tsx` |
| Late fees | display-only | `app/lib/late-fees.ts`, `app/components/LateFeesForm.tsx`, `supabase/migrations/0023_late_fees.sql` |
| Reports (owner-only team report) | complete | `app/routes/reports.tsx`, `app/lib/reports.ts` |
| Notifications & daily digest (broken-promise alerts, digest cron, prefs) | complete | `app/lib/notifications.server.ts`, `app/lib/digest-cron.server.ts`, `app/routes/api.notification-prefs.tsx`, `app/components/NotificationPrefsForm.tsx` |
| Settings & org configuration (profile, rules, thresholds, knobs, quiet hours, holidays, channels, templates, test messages) | complete | `app/routes/settings.tsx`, `app/routes/api.org-settings.tsx`, `app/lib/org-config.server.ts`, `app/routes/api.test-message.tsx`, `app/lib/message-templates.ts` |
| Accounts directory & profile (owner assignment, comm prefs, notes, presence/collision) | complete | `app/routes/accounts.tsx`, `app/routes/accounts.$id.tsx`, `app/lib/presence.server.ts`, `app/lib/collision.ts`, `app/routes/api.account-notes.tsx` |

### Pages (18)

| Route | Purpose |
|---|---|
| `/` | Public marketing landing page with links to signup/login |
| `/signup` | Account creation via Supabase Auth (email/password), with returnTo support |
| `/login` | Login via Supabase Auth; redirects to dashboard or onboarding based on org membership |
| `/logout` | POST action signs out and redirects to /login; GET loader redirects to /login |
| `/onboarding` | First-run org creation for a signed-in user without a membership (createOrgForUser) |
| `/invite` | Owner-only teammate invite; inserts invites row and displays the /accept/:token link (no email is sent — the owner copies the link manually) |
| `/accept/:token` | Invite acceptance: validates token, joins the signed-in user to the org as member (acceptInvite) |
| `/dashboard` | Main collections workspace: KPI band, triage strip, prioritized case work queue with views/sorts, case detail panel with timeline/collision warnings, log-contact and comm-prefs drawers, coming-due list, bulk action bar |
| `/focus` | Focus Mode: full-screen, dark, keyboard-driven one-case-at-a-time triage deck (Why now, log call, send text, snooze, skip) with session progress and presence heartbeat |
| `/accounts` | Customer directory: metrics, filters/sorts, per-account standing, owner assignment, quick panel |
| `/accounts/:id` | Single account profile: contact info, comm prefs, invoices, unified timeline (logs + SMS + email), NudgePay-only notes, standing, owner assignment |
| `/promises` | Promise-to-pay ledger: tabs (open/due soon/kept/broken...), metrics, sorting, quick panel with cancel action |
| `/messages` | Unified two-channel (SMS + email) message inbox: thread list with tabs/filters, metrics, thread panel with reply composer, template picker, quiet-hours and consent gating |
| `/reports` | Owner-only team report over 7/30/90-day ranges: per-member activity, promises made/kept/broken, cases opened, current workload distribution |
| `/settings` | Settings hub with 5 tabs (Workspace, Integrations, Channels, Templates, Collections): company profile, member roster + display name, QBO connect/disconnect/refresh + sync errors, Twilio/Resend provider status + webhook URLs + test messages, SMS/email channel toggles, template editor, collections rules, late fees, priority thresholds, workflow knobs, quiet hours, digest schedule, notification prefs, holidays |
| `/privacy` | Static privacy policy (QBO data use, SMS/email, retention) — effective July 1 2026 |
| `/eula` | Static End User License Agreement (notes TCPA/A2P responsibility; text still says 'private beta') |
| `/unsubscribe` | CAN-SPAM email opt-out landing: GET verifies HMAC token and renders confirm form; POST sets customers.do_not_email (RFC 8058-safe against link prefetchers) |

### API + webhook routes (25)

| Route | Purpose |
|---|---|
| `POST /api/contact-logs` | Log a contact (call/text/email/other) with outcome/notes/follow-up; optionally creates a promise (createPromiseForLog) and advances the case next step (applyNextStep) |
| `POST /api/sms-consent` | Toggle a customer's sms_consent flag from the UI (manual consent recording) |
| `POST /api/comm-prefs` | Update per-customer communication preferences: preferred_channel plus do_not_call/do_not_text/do_not_email (deliberately never touches sms_consent) |
| `POST /api/org-settings` | Owner-only multi-intent settings writer: collections rules, holidays add/remove, late fees, priority thresholds, workflow knobs, quiet hours, channel toggles, email config, company profile, template upsert/delete |
| `POST /api/assign` | Assign/unassign a single customer's account owner (customers.owner) |
| `POST /api/bulk-assign` | Bulk-assign an owner across a selection of cases (batch-size clamped by org workflow config) |
| `POST /api/priority-override` | Set or clear a manual priority override (critical/high/medium/low + reason) on a collection case |
| `POST /api/sync-errors/dismiss` | Manually dismiss (resolve) a recorded QBO sync error |
| `POST /api/presence/heartbeat` | 20s presence heartbeat upsert into case_presence; best-effort, never surfaces errors |
| `POST /api/promises/cancel` | Cancel a pending promise and recompute the case next step |
| `POST /api/qbo/connect` | Owner-only start of QBO OAuth: creates single-use oauth_states nonce and redirects to Intuit authorize URL |
| `POST+GET /api/qbo/disconnect` | POST: owner-gated in-app disconnect (revokes token, clears connection). GET loader: Intuit-initiated disconnect landing page (no session required) |
| `POST /api/qbo/refresh` | Manual 'Sync now': syncOverdueInvoices full pull + case reconciliation + promise evaluation + broken-promise alerts + sync-error record/resolve |
| `GET /auth/qbo/callback` | QBO OAuth redirect handler: consumes state nonce (CSRF/replay-safe), exchanges code for tokens, stores AES-GCM-encrypted tokens in qbo_connections |
| `POST /webhooks/qbo` | Intuit CDC webhook: HMAC signature verified, then applies invoice/customer/payment change events per realm, evaluates promises, sends broken-promise alerts, records/resolves sync errors |
| `POST /api/text/send` | Send a single SMS for an invoice via Twilio (consent, do-not-text, quiet-hours and channel-enabled gated); records text_messages row with case linkage |
| `POST /api/email/send` | Send a single email for an invoice via Resend (do_not_email gated, CAN-SPAM footer + unsubscribe link); records email_messages row |
| `POST /api/account-notes` | Save NudgePay-only customer notes (customers.notes, never synced to QBO) |
| `POST /api/bulk-sms` | Bulk SMS to selected open cases: eligibility partition (consent/phone/opt-out/exception), per-case template render, sequential send with per-send ledger rows; quiet-hours gated |
| `POST /webhooks/twilio/inbound` | Twilio inbound SMS webhook (signature verified against public URL): threads reply to customer/case, handles STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT and START/YES/UNSTOP consent keywords |
| `POST /webhooks/twilio/status` | Twilio delivery status callback (signature verified): updates text_messages.status/error_code by message SID |
| `POST /webhooks/resend` | Resend/svix-signed email events webhook: outbound delivery status updates and inbound email recording (idempotent on provider_message_id) |
| `POST /api/profile` | Update the signed-in user's display name (auth user metadata) |
| `POST /api/notification-prefs` | Self-only upsert of per-user alert preferences (broken-promise email, daily digest email) via RLS user client |
| `POST /api/test-message` | Owner-only provider verification: sends a real test SMS or test email to a supplied destination, bypassing the customer pipeline/ledger; never 500s on missing env |

### Background work

| Job | Trigger | Purpose |
|---|---|---|
| Worker fetch handler | every HTTP request | All HTTP traffic served through the React Router SSR request handler with cloudflare env/ctx in AppLoadContext (lines 20-24) |
| CDC catch-up cron (runScheduledCdc) | cron "*/30 * * * *" (wrangler.toml line 20; dispatched by the else-branch of workers/app.ts scheduled handler line 33) | Every 30 minutes: for every org with status='connected' in qbo_connections, run bounded QBO CDC catch-up (runCdcCatchup) — pulls changed invoices/customers/payments since last_cdc_time, reconciles cases, evaluates promises, sends broken-promise alert emails when email env present, records/auto-resolves sync_errors per org (per-org try/catch so one org's failure doesn't block others) |
| Daily digest cron (runScheduledDigest) | cron "0 * * * *" (wrangler.toml line 20; matched explicitly in workers/app.ts line 27 `if (controller.cron === "0 * * * *")`) | Hourly gate: for each connected org, compares org-local hour (org_settings.timezone) against digest_hour_local and last_digest_date, and sends the daily digest email (runDailyDigest in notifications.server.ts) at most once per org-local calendar day to opted-in members; skips entirely (with warning) when email env is not configured |

### Database (23 tables)

| Table | Migration | RLS | Purpose |
|---|---|---|---|
| `organizations` | 0001_tenancy_schema.sql (line 6) | yes | Tenancy root: org id + name |
| `memberships` | 0001_tenancy_schema.sql (line 12) | yes | User-to-org membership with role ('owner'/'member'); basis of is_org_member/is_org_owner RLS predicates |
| `customers` | 0001_tenancy_schema.sql (line 37) | yes | QBO-synced customers; later gains owner (0008), preferred_channel/do_not_call/do_not_text (0017), notes (0019), do_not_email (0021); holds sms_consent legal record |
| `invoices` | 0001_tenancy_schema.sql (line 50) | yes | QBO-synced invoices: amount, balance, due_date, status, qbo_sync_at |
| `contact_logs` | 0001_tenancy_schema.sql (line 68) | yes | Logged contact attempts (method/outcome/notes/follow_up_at); gains promised_amount/promised_date (0007) and case_id (0009) |
| `text_messages` | 0001_tenancy_schema.sql (line 82) | yes | Two-way SMS ledger (direction, Twilio SID, status, error_code, body); gains customer_id (0006), case_id (0009), phone_last10 normalization (0033) |
| `qbo_connections` | 0001_tenancy_schema.sql (line 98) | yes | Per-org QBO connection: realm_id (unique per 0005), AES-GCM-encrypted access/refresh tokens (text since 0004), CDC cursor last_cdc_time, status |
| `messaging_config` | 0001_tenancy_schema.sql (line 111) | yes | Per-org Twilio sender override (messaging_service_sid/sender) + sms_enabled toggle (0020); RLS tightened to members-read/owners-write in 0020 |
| `invites` | 0003_invites.sql (line 1) | yes | Teammate invite tokens (email + random token + accepted_at); token lifetime bounded in 0032 |
| `oauth_states` | 0004_qbo_oauth.sql (line 2) | yes | Single-use CSRF nonces carrying org across the QBO OAuth redirect; RLS on with NO policies — service-role only by design |
| `collection_cases` | 0009_collection_cases.sql (line 2) | yes | Durable per-customer collection case: status lifecycle (new/working/promised/waiting/on_hold/resolved), next action, exception_reason taxonomy (0011, widened 0015), priority override (0012); partial unique index enforces one open case per customer |
| `promises` | 0010_promise_payment_loop.sql (line 4) | yes | Promise-to-pay records: promised amount/date, baseline_balance, grace_until, status (pending/kept/partially kept/broken/canceled) |
| `promise_invoices` | 0010_promise_payment_loop.sql (line 31) | yes | Join table linking a promise to the invoices it covers |
| `payments` | 0010_promise_payment_loop.sql (line 45) | yes | QBO payments/credit-memos ledger (upserted on org_id,qbo_id,type) used by promise evaluation |
| `sync_errors` | 0013_sync_errors.sql (line 5) | yes | Durable failed-QBO-sync records (source manual/webhook/cron); auto-resolved on successful sync, manually dismissable; surfaced in settings/dashboard |
| `case_presence` | 0014_case_presence.sql (line 10) | yes | Poll-based presence heartbeats, one row per (org, customer, user); liveness derived from last_seen_at; composite FK prevents cross-tenant orphan rows |
| `org_settings` | 0016_org_scheduling_config.sql (line 19) | yes | Per-org config kitchen-sink: promise grace, working days, cadences (0016), late fees (0023), company profile/timezone (0025), priority thresholds (0027), workflow knobs (0028), digest schedule (0029), SMS quiet hours (0030); members read, owners write |
| `org_holidays` | 0016_org_scheduling_config.sql (line 32) | yes | Per-org holiday dates excluded from business-day math |
| `email_config` | 0020_channel_settings.sql (line 18) | yes | Per-org email channel config: email_enabled, from_address/from_name, postal_address for CAN-SPAM (0022); dead provider column dropped in 0031 |
| `email_messages` | 0021_email_outbound.sql (line 8) | yes | Two-way email ledger mirroring text_messages (provider_message_id unique-hardened in 0022 for webhook idempotency) |
| `user_notification_prefs` | 0024_notifications.sql (line 8) | yes | Per-user per-org opt-in/out for broken-promise emails and daily digest; self-only RLS policies |
| `notification_log` | 0024_notifications.sql (line 42) | yes | Idempotency/dedup ledger for sent alert emails; service-role only (RLS on, no member policies) |
| `message_templates` | 0026_message_templates.sql (line 3) | yes | Org-editable SMS/email message templates (channel+slug unique, token substitution); members read, owners write |

---

## Release blockers

All twelve were re-verified line-by-line against the current code in a second
pass. File references are relative to the repo root.

### B0 — No password reset / forgot-password flow
`nudgepay-app/app/routes/login.tsx` · verified ✅

A repo-wide search for `resetPasswordForEmail`, recovery routes, or any
forgot-password UI returns nothing, and `app/routes.ts` registers no reset
route. A public user who forgets their password is permanently locked out of
their AR data with no recourse but emailing the operator. Combined with the
missing change-password flow (M5), a compromised password can't be rotated
either. Supabase Auth ships this capability (`resetPasswordForEmail` + a
recovery-token landing route); it simply was never wired.

### B1 — Every loader read silently truncates at Supabase's 1,000-row cap
`nudgepay-app/app/lib/case-queue.server.ts:137` · verified ✅

`supabase/config.toml` sets `max_rows = 1000` (hosted Supabase defaults to
the same), and no query in the app passes `.range()`/`.limit()` above it.
The dashboard invoice query, cases query, accounts directory, messages
inbox, promises ledger, and the inbound-SMS customer-matching query all
return at most 1,000 rows with **no error and no truncation signal**. For
any org beyond hobby scale, KPI totals under-count, cases vanish from the
queue, and — worst — reconciliation misbehaves (B2). This is a
correctness bug that public users will hit as data grows, and it is
invisible when it happens.

### B2 — Truncated reconciliation reads wrongly auto-resolve still-overdue cases
`nudgepay-app/app/lib/case-lifecycle.server.ts:10-30` · verified ✅

`applyCaseReconciliation` loads *all* overdue invoices (unbounded → capped at
1,000 rows), builds the set of overdue customers, and **resolves any open
case whose customer is not in that set**. Once an org has >1,000 overdue
invoice rows, customers past the cap disappear from the set and their open
cases are marked `resolved`/closed on the next sync — active collection
work silently self-deletes. This turns B1 from "stale numbers" into
destructive state transitions.

### B3 — Account-profile "Save preferences" silently re-subscribes unsubscribed customers
`nudgepay-app/app/components/AccountProfile.tsx:120-142` +
`nudgepay-app/app/routes/api.comm-prefs.tsx:22` · verified ✅

The comm-prefs form on `/accounts/:id` submits only `preferred_channel`,
`do_not_call`, and `do_not_text` — it has **no `do_not_email` field** — while
the shared action unconditionally writes
`do_not_email: form.get("do_not_email") === "true"`. Saving any preference
from that page therefore resets `do_not_email` to `false`, wiping a CAN-SPAM
unsubscribe the customer recorded through the tokenized `/unsubscribe` flow.
That is direct legal exposure (CAN-SPAM requires honoring opt-outs) and it
happens invisibly during routine staff edits. (The dashboard's
`CommPrefsDrawer` does include the field; only the account-profile form is
affected.)

### B4 — All tenants share one operator-owned Twilio sender, by design
`nudgepay-app/app/lib/twilio-messaging.server.ts:42-52` · verified ✅

`resolveSender` deliberately ignores tenant-managed sender config and always
returns the operator's env-configured sender ("Tenant-managed sender
overrides are intentionally ignored… all outbound SMS uses the
operator-owned default sender"). The reasoning (preventing cross-tenant
sender spoofing) is sound, but the consequence for a public launch is not:
every org's collection texts come from the same phone number, A2P 10DLC
brand/campaign registration cannot be done per customer-brand, one abusive
tenant gets the shared number carrier-filtered for everyone (compounded by
the absence of rate limits, M24), and inbound routing must guess which org a
reply belongs to (B5). Public release needs per-org provisioned senders
(e.g. Twilio subaccounts / Messaging Services per org) or an explicit
sub-sender architecture.

### B5 — Inbound SMS, including STOP opt-outs, is silently dropped when unmatched
`nudgepay-app/app/lib/twilio-messaging.server.ts:156-211` · verified ✅

`resolveInboundOrgId` routes an inbound message by matching the sender's
phone against prior *outbound* messages; if zero or more-than-one org
matches, it returns `null` and `recordInboundMessage` returns
`{ matched: false }` — the message is **not stored anywhere**, and the
STOP-keyword handling further down is never reached. Concretely: a customer
who was texted by two NudgePay tenants (realistic on a shared sender, B4), or
who replies from a different phone than the one on file, or whose customer
record was edited — can text STOP and keep receiving dunning messages. The
Twilio webhook returns 200 in all these cases, so there is no operator
visibility either. (Twilio's own Messaging-Service-level STOP handling may
mask part of this in production — but then START/HELP and ordinary replies
are still lost with no record, and org-level `sms_consent` is never updated.)

### B6 — Per-org email "from" is unverified free text on the operator's shared Resend key
`nudgepay-app/app/lib/email-settings.ts:1-39` +
`nudgepay-app/app/lib/email-client.server.ts:1-28` · verified ✅

`email_config.from_address` is validated only against an RFC-lite regex —
the module comment concedes "domain verification is an operator concern" —
and every send goes through the single `RESEND_API_KEY`. Two public-release
consequences: (1) a tenant typing their own domain gets runtime send
failures (Resend rejects unverified domains) with no self-serve
verification path, i.e. the email channel cannot actually be enabled by a
public customer without operator intervention; (2) a tenant typing any
domain the operator *has* verified (including another tenant's) can send
as it — cross-tenant sender impersonation. Needs per-tenant domain
verification (Resend Domains API) or enforced sub-domain sending.

### B7 — Inbound email handling cannot work against the real Resend API
`nudgepay-app/app/lib/email-events.ts:40-46` · verified ✅

The event mapper listens for `inbound.email.received` and `email.inbound` —
two guessed names; Resend's inbound event type is `email.received`. It also
coerces `data.to` with a string-only helper (`str(d.to)`), but Resend
delivers `to` as an array, so even under the right event name the recipient
would map to `""`, and inbound webhook payloads don't carry the full body
the mapper expects in `data.text`/`data.html`. Net effect: replies to
collection emails are never captured, while the UI (unified inbox, "Needs
reply" tab, email thread panel) is built as if they were. Customers *will*
reply to dunning email; today those replies vanish (see also M22 — no
`reply_to` is ever set).

### B8 — First sync after connecting QuickBooks never happens automatically *(refined during verification)*
`nudgepay-app/app/routes/auth.qbo.callback.tsx:23-31` +
`nudgepay-app/app/lib/qbo-sync.server.ts:285-293` · verified ✅ with correction

The original finding claimed the pre-existing overdue book "can never" be
backfilled. Verification found a real full backfill —
`syncOverdueInvoices` queries *all* invoices with `Balance > 0` — but it is
wired **only** to the manual "Sync now" button in Settings
(`api.qbo.refresh.tsx:44`). The OAuth callback stores tokens and redirects
to `/dashboard?qbo=connected` without triggering any sync, the CDC cron's
first run covers only a 7-day change window (months-old overdue invoices
haven't changed and thus never arrive via CDC), and nothing renders the
`qbo=connected` param (M17). So the actual first-run flow is: connect →
land on an empty dashboard with no message → data appears only if the user
discovers "Sync now" back in Settings, or partially over subsequent cron
runs. The fix is small (invoke `syncOverdueInvoices` from the callback, or
queue it) but without it the product's first impression is "it didn't
work."

### B9 — A dead QBO connection reports "Connected" forever
`nudgepay-app/app/lib/qbo-connection.server.ts:26-46` · verified ✅

`getValidAccessToken` throws when Intuit refuses a token refresh (refresh
tokens expire after ~100 days of disuse and can be revoked by the user on
Intuit's side), but nothing catches that to transition the stored `status`
— the only values ever written are `"connected"` (store) and
`"disconnected"` (explicit disconnect). Settings keeps showing a healthy
connection while every sync fails into `sync_errors` — which, per M9, is
surfaced nowhere outside the Settings Integrations tab. A public org whose
token lapses experiences permanently frozen AR data with a green status and
no reconnect prompt.

### B10 — Production environment was never configured
`nudgepay-app/wrangler.toml:26` · verified ✅

`[env.production.vars] SUPABASE_URL = "https://<your-prod-project-ref>.supabase.co"`
is a literal placeholder, and the deploy-gate comment in the same file
notes QBO/Twilio routes throw 500 until every production secret is set.
Together with the fully open Intuit production checklist (M30), there is no
evidence a production deployment exists at all.

### B11 — Intuit compliance URLs redirect to a placeholder
`netlify/_redirects:8-10` · verified ✅

The legacy-domain redirects that keep Intuit's app-card `/privacy` and
`/eula` links alive point at `https://WORKER_PROD_URL_PLACEHOLDER/…` with an
in-file `TODO(deploy)`. If the Intuit portal still references the Netlify
domain (the 2 July analysis confirmed the old site 404s), the compliance
pages required for app review are unreachable until this ships with a real
URL.

---

## Major findings

Grouped by theme; each entry carries the auditor's file evidence. Items
marked ✅ were independently re-verified in the second pass.

### Identity & team lifecycle

- **M1. Email-confirmation landing is unhandled.** No `/auth/confirm` route,
  no code/token exchange, no resend; signup's confirm branch also drops the
  Set-Cookie headers. Users who click the confirmation email land on the
  marketing page, not signed in, with `returnTo` (e.g. an invite) lost —
  `app/routes/signup.tsx:41`.
- **M2. Invites don't send email.** The action returns a *relative*
  `/accept/<token>` path rendered in a `<code>` block (no origin, no copy
  button) despite the button saying "Sending invite…", and `/invite` is
  linked from no page — team setup is effectively a hidden developer
  feature — `app/routes/invite.tsx:41`.
- **M3. Multi-org membership is a trap.** ✅ `resolveOrg` always picks the
  oldest membership (`.order("created_at").limit(1)`) and no org switcher
  exists — accepting an invite while owning a workspace reports success but
  the user can never see the second org — `app/lib/session.server.ts:38`.
- **M4. No member removal, role change, invite revocation, or leave-org.**
  No UI, no API, no RLS delete policy on `memberships`. A terminated
  employee keeps full access to customer AR data and SMS sending forever —
  `supabase/migrations/0002_rls_policies.sql:23`.
- **M5. No change-password, change-email, or account deletion.** The only
  `auth.updateUser` call sets display name; privacy policy punts deletion to
  a support email — `app/routes/api.profile.tsx:21`.

### Sync trust & first-run truth

- **M6. Loader DB errors render as healthy empty states.** Every
  destructured `{ data }` discards `error`; a failed query shows a normal
  empty queue and $0 KPIs — a collections team could believe there's nothing
  to collect — `app/lib/case-queue.server.ts:130`.
- **M9. The SyncIssues warning badge exists but is mounted nowhere.** ✅
  Imported by zero routes (AppShell accepts the prop; only `reports.tsx`
  passes `null`). Sync failures are invisible outside Settings →
  Integrations — `app/components/SyncIssues.tsx:27`.
- **M11. "Total customers" counts only ever-overdue customers.** Sync pulls
  only overdue/coming-due invoices and their customers, but the Accounts
  page presents itself as the full directory — a 500-customer org reads
  "Total customers: 30" — `app/components/AccountsMetrics.tsx:9`.
- **M17. OAuth/sync outcome params are never rendered.** ✅ Nothing reads
  `qbo=` or `sync=`; a failed QuickBooks connect looks like the button
  didn't work — `app/routes/auth.qbo.callback.tsx:30`.
- **M18. No pagination of QBO query/CDC results.** Hard
  `maxresults 1000` everywhere, in-code comment sizes it to the pilot org,
  and the computed `truncated` flag is discarded by the caller —
  `app/lib/qbo-sync.server.ts:27`.
- **M19. Reconnecting a different QuickBooks company merges two books.**
  `storeConnection` upserts on `org_id`, silently replacing `realm_id`
  without purging the prior company's customers/invoices/cases —
  `app/lib/qbo-connection.server.ts:11`.
- **M20. QBO webhook processes synchronously before responding.** Each event
  does Intuit reads + ~6 DB round trips inline; slow acks count as delivery
  failures and can get the subscription suspended — no `ctx.waitUntil`
  offload — `app/routes/webhooks.qbo.tsx:45`.
- **M21. CDC cron is one serial loop over all orgs.** Single scheduled
  invocation, no time budget, checkpoint, or fan-out; growth of the user
  base breaks background sync for orgs late in iteration order —
  `app/lib/qbo-cron.server.ts:42`.
- **M26. QBO deletions/voids are mishandled.** CDC "Deleted" skeletons
  clobber real rows (customer becomes "(unnamed)"), and the webhook path
  leaves deleted invoices open with nonzero balances that users keep
  dunning — `app/lib/qbo-api.server.ts:55`.

### Work-queue & messaging experience

- **M7. Focus Mode has no collision safeguards.** The dashboard's
  presence/collision system is absent here (`includePresence: false`); two
  reps in `/focus` walk the identical deterministic queue and double-text
  the same customers — `app/routes/focus.tsx:58`.
- **M8. No pagination/virtualization in the work queue; loader re-runs every
  20 s.** ✅ Plain `items.map(...)` renders every row, and the DetailPanel
  heartbeat calls `revalidate()` every 20 s while a case is open, re-running
  the entire multi-query loader — `app/components/WorkQueue.tsx:648`,
  `app/components/DetailPanel.tsx:622-626`.
- **M10. Email never counts as contact.** `last contact` derives only from
  contact_logs + text_messages; after emailing a customer the case still
  says "Never contacted", gets +15 priority points, and `whyNow()` explains
  it wrongly — reps double-contact — `app/lib/case-queue.server.ts:247`.
- **M14. No read/unread state for inbound messages.** The only signal is
  "last message was inbound"; the sole way to clear "Needs reply" is to send
  a reply — `app/lib/message-inbox.ts:161`.
- **M15. Messages inbox never updates while open.** Load-time only — no
  polling/revalidation/push; the dedicated inbox lacks the heartbeat the
  dashboard got — `app/routes/messages.tsx:46`.
- **M16. Default templates resurrect after deletion.** ✅ The resolver
  re-appends any default slug missing from the DB, so Delete reports success
  and the template returns — `app/lib/message-templates.ts:40`.
- **M31. QuickBooks Disconnect is one un-confirmed click** that revokes
  tokens and locks the whole org out of every workspace page until a full
  reconnect — `app/routes/settings.tsx:248`.

### Compliance & abuse surface

- **M22. No `reply_to` and no inbound-email setup path.** Even with B7
  fixed, tenants aren't told replies require MX-to-Resend on the sending
  domain; with the normal dedicated-subdomain setup, customer replies bounce
  — for templates that ask customers to reply — `app/lib/email-client.server.ts:10`.
- **M23. Consent has no provenance and STOP is one-click reversible.**
  `sms_consent` is a bare boolean; an inbound STOP is indistinguishable from
  never-consented, and the UI then invites "Mark consent" to resume texting
  — TCPA exposure at $500–$1,500/text — `app/routes/api.sms-consent.tsx:44`.
- **M24. No rate limiting or send-frequency caps on any send endpoint.** Any
  authenticated member can loop sends without ceiling on the shared Twilio
  and Resend accounts every tenant depends on — `app/routes/api.text.send.tsx:15`.
- **M25. Plain members can DELETE/rewrite the audit trail.** `FOR ALL`
  member-keyed RLS on text_messages, contact_logs, cases, promises — the
  compliance record for a collections product is editable by anyone in the
  org via PostgREST (mitigated by the anon key not shipping to the browser,
  but Supabase treats publishable keys as public by design) —
  `supabase/migrations/0002_rls_policies.sql:33`.

### Product breadth

- **M12. No CSV/data export anywhere** — receivables, promises, messages,
  reports. AR teams live in spreadsheets; there is also no aging-bucket
  report — `app/routes/reports.tsx:155`.
- **M13. Money is hardcoded USD/en-US.** QBO onboards CA/UK/AU orgs through
  the same OAuth; their balances render — and get texted to customers — as
  USD. Needs currency sync or an explicit US-only gate —
  `app/lib/format.ts:20`.

### Accessibility

- **M32. Copper brand color fails WCAG AA on light surfaces (~2.9–3.1:1)**
  across links, badges, and two primary button styles — `app/app.css:12`.
- **M33. Focus Mode dark theme renders secondary text at 1.6–2.8:1** —
  amounts, due dates, hints, recipient number — `app/components/focus/FocusCard.tsx:48`.
- **M34. Unlabeled controls in core flows** — the Focus Mode SMS body,
  accounts search, late-fee master toggle (placeholder-as-label antipattern)
  — `app/components/focus/SendTextMiniForm.tsx:158`.

### Release operations

- **M27. No CI** — no `.github/`, nothing runs the 90-file test suite or
  typecheck on PRs.
- **M28. No error monitoring or analytics** — no observability config; cron
  failures go to `console.error` only — `nudgepay-app/wrangler.toml`.
- **M29. Tests unrunnable from a fresh clone** — require undocumented
  `.env.test` + local Supabase (verified: `npm test` exits with ENOENT);
  also blocks CI — `nudgepay-app/tests/global-setup.ts:13`.
- **M30. Intuit production checklist entirely open** — every launch item is
  a placeholder or unverified — `docs/intuit-production-checklist.md`.

---

## Minor findings

| # | Finding | Category | Where |
|---|---|---|---|
| 1 | Onboarding action doesn't re-check org membership — replayed POST creates orphaned organizations | bug | `app/routes/onboarding.tsx:36` |
| 2 | Non-owner Reports nav item is announced as "(coming soon)" though the feature exists and is owner-gated | a11y | `app/components/AppShell.tsx:245` |
| 3 | Clicking the user avatar instantly signs you out — no profile menu, no confirmation | ux | `app/components/AppShell.tsx:154` |
| 4 | All unmapped Supabase auth errors collapse to "Something went wrong. Please try again." | ux | `app/lib/auth-flow.server.ts:40` |
| 5 | Landing page is a single headline with no features, screenshots, pricing, or support contact; EULA still says "private beta" | ux | `app/routes/home.tsx:19` |
| 6 | Empty work queue always shows the filter-centric message, even for a brand-new org with zero cases | ux | `app/components/WorkQueue.tsx:610` |
| 7 | Focus Mode surfaces raw machine error codes in user-facing toasts | ux | `app/routes/focus.tsx:394` |
| 8 | Focus Mode is unreachable on mobile — its only nav entry is hidden below the sm breakpoint | ux | `app/routes/dashboard.tsx:529` |
| 9 | Bulk SMS skipped-reason summary omits the do-not-text bucket, so counts don't add up | bug | `app/components/BulkSmsDrawer.tsx:10` |
| 10 | Consent toggle in the Messages tab breaks (with a wrong error message) when the case has no representative invoice | bug | `app/components/DetailPanel.tsx:210` |
| 11 | Dashboard detail panel is a fixed 384px (w-96) pane that overflows and clips on sub-384px phones | ux | `app/routes/dashboard.tsx:609` |
| 12 | Coming-due empty state hardcodes "next 7 days" though the window is org-configurable | ux | `app/components/ComingDueList.tsx:29` |
| 13 | UTC calendar day compared against org-local 'today' skews the broken-promise flag and daysSinceContact for orgs west of UTC | bug | `app/components/DetailPanel.tsx:89` |
| 14 | Promises cannot be edited, and the Promises page itself offers no cancel/renegotiate action | partial-feature | `app/components/PromiseQuickPanel.tsx:73` |
| 15 | Timestamp dates render in the server's UTC zone during SSR (hydration mismatch) and show no time-of-day | ux | `app/lib/dates.ts:32` |
| 16 | Collections rules form gives zero success or error feedback; saved=1 lights "Saved." on the wrong forms | ux | `app/components/CollectionsRulesForm.tsx:71` |
| 17 | Priority high-value threshold: client allows min $0.01 but server rejects anything under $1,000, and the error copy/codes don't match | bug | `app/components/PriorityThresholdsForm.tsx:37` |
| 18 | No unsaved-changes protection on any settings form; tab switches silently discard edits | ux | `app/components/SettingsTabs.tsx:34` |
| 19 | Template editor has no preview, no token insertion, and no validation of misspelled {placeholders}; legend copy is wrong | partial-feature | `app/components/TemplateEditor.tsx:95` |
| 20 | SMS thread bubbles show no timestamps and the thread pane doesn't scroll to the newest message | ux | `app/components/MessageBubbles.tsx:30` |
| 21 | No rate-limit (429) detection, backoff, or retry on any Intuit API call | tech-gap | `app/lib/qbo-api.server.ts:21` |
| 22 | CDC watermark stamped with local time AFTER fetch/processing — changes during the processing window can be skipped | bug | `app/lib/qbo-sync.server.ts:321` |
| 23 | Invoice status column goes stale when a due date passes without any QBO change | bug | `app/lib/qbo-mappers.server.ts:43` |
| 24 | No data-retention or cleanup job for unbounded operational tables (oauth_states, notification_log, resolved sync_errors, expired invites) | release-ops | `workers/app.ts:27` |
| 25 | CloudEvents webhook parser shipped with an in-code admission it is unverified against real Intuit payloads | tech-gap | `app/lib/qbo-webhook.server.ts:88` |
| 26 | Resend email.failed / email.suppressed events are ignored, so async send failures stay 'sent' forever | bug | `app/lib/email-events.ts:44` |
| 27 | No 'Reply STOP to opt out' language in default SMS templates and none appended at send time | missing-feature | `app/lib/sms-templates.ts:26` |
| 28 | Quiet hours computed in the org's timezone, not the recipient's | tech-gap | `app/lib/twilio-messaging.server.ts:110` |
| 29 | No server-side duplicate-send protection (idempotency) on single-send endpoints | missing-feature | `app/routes/api.text.send.tsx:48` |
| 30 | Bulk SMS partial failures reported only as an aggregate count; per-case errors are swallowed | ux | `app/lib/bulk-send.server.ts:97` |
| 31 | Broken-promise alert email failures are permanently lost — one-shot trigger with no retry path | tech-gap | `app/lib/notifications.server.ts:114` |
| 32 | No List-Unsubscribe / one-click unsubscribe headers on customer emails | missing-feature | `app/lib/email-client.server.ts:10` |
| 33 | Promise kept/partially-kept boundary uses exact float comparison on float-summed money | bug | `app/lib/promises.ts:29` |
| 34 | high_value_threshold above $10,000 is accepted but silently stops affecting priority scoring | bug | `app/lib/priority.ts:41` |
| 35 | worklist.ts retains a dead, conflicting age-only priority model (plus static-zero metrics) | tech-gap | `app/lib/worklist.ts:68` |
| 36 | Late-fee estimate model is simplistic (no cap, fixed 30-day months, retroactive basis) and priority weights remain hardcoded behind a stale 'deferred to C7' comment | docs-drift | `app/lib/late-fees.ts:37` |
| 37 | Promise evaluation counts any QBO balance reduction (credit memo, void, edit) as payment received | tech-gap | `app/lib/promises.ts:26` |
| 38 | Owner test-SMS endpoint sends to arbitrary numbers with no consent gate and no throttle | security | `app/routes/api.test-message.tsx:39` |
| 39 | Auth actions (login/signup/logout) bypass the same-origin CSRF check applied to every other mutation | security | `app/routes/logout.tsx:7` |
| 40 | Invite action returns raw database error message to the client | security | `app/routes/invite.tsx:40` |
| 41 | dev-data.sql is broken by the 0032 member-source-edit trigger — its 'UPDATE customers SET phone = NULL' raises and rolls back the whole snippet | test-gap | `supabase/snippets/dev-data.sql:147` |
| 42 | email_config.updated_at is never maintained — no trigger and no code sets it | tech-gap | `supabase/migrations/0020_channel_settings.sql:25` |
| 43 | Audit-actor columns are bare uuids without FKs, and user-reference FKs lack ON DELETE actions, making auth-user deletion impossible | tech-gap | `supabase/migrations/0013_sync_errors.sql:13` |
| 44 | Invites allow unlimited duplicate pending invites per (org, email) — no uniqueness constraint | tech-gap | `supabase/migrations/0003_invites.sql:4` |
| 45 | No robots.txt, sitemap, meta description, or Open Graph tags for the public marketing surface | ux | `app/lib/meta.ts:1` |
| 46 | README.md materially stale: 24 migrations (actual 33), repo layout lists deleted directories, route map missing routes, superseded status link | docs-drift | `README.md:60` |
| 47 | AGENTS.md stale: migrations 0001–0024 (actual 0033), nonexistent legacy dirs, wrong table name and typecheck command | docs-drift | `AGENTS.md:57` |
| 48 | Starter-template boilerplate remains: nudgepay-app/README.md is the untouched Cloudflare starter README and package.json still carries the template-marketplace block with publish:true | docs-drift | `README.md:1` |
| 49 | No LICENSE file committed | release-ops | `README.md:142` |
| 50 | Six demo-recording PNGs (~870 KB) committed to the repo | docs-drift | `demo-recording/frontend-screenshot.png` |
| 51 | Open security action item: legacy Supabase anon key rotation is documented as pending and unverifiable | security | `AGENTS.md:98` |
| 52 | listOrgMembers fetches only the first 1000 auth users project-wide — display names and team alerts silently break past that | tech-gap | `app/lib/orgs.server.ts:88` |
| 53 | Team alert emails and daily digest are gated on the customer-facing email channel being configured | partial-feature | `app/lib/notifications.server.ts:40` |
| 54 | WorkQueue desktop grid has no table semantics; column headers not associated with cell values | a11y | `app/components/WorkQueue.tsx:647` |
| 55 | Infinite loading animation and fade-in not gated on prefers-reduced-motion | a11y | `app/components/AppShell.tsx:86` |
| 56 | CommPrefsDrawer scrim link has contradictory aria-hidden="true" + aria-label="Close" | a11y | `app/components/CommPrefsDrawer.tsx:29` |
| 57 | TemplateEditor uses role=tablist/tab without tabpanel association or arrow-key navigation | a11y | `app/components/TemplateEditor.tsx:63` |
| 58 | QuickBooks sync status chip and sync-issue alerts are completely hidden on mobile | ux | `app/components/SyncIssues.tsx:59` |
| 59 | Async UI results not announced: copy-to-clipboard confirmation and bulk-selection count lack live regions | a11y | `app/components/WebhookUrlField.tsx:31` |
| 60 | No in-app notification surface: broken-promise alerts and daily digests are email-only, with no bell/center and no fallback when email is unconfigured or opted out | missing-feature | `app/lib/notifications.server.ts:28` |
| 61 | First-run bounce to Settings has no welcome or explanation; brand-new users are dropped on the Integrations tab mid-flow | ux | `app/lib/workspace.server.ts:37` |

---

## What is verified solid

The audit's second job was confirming what already holds up. Highlights, each
checked against code:

- **Tenancy.** RLS enabled on all tables with org-membership-keyed policies;
  every loader/action query additionally pins `.eq("org_id", …)` (defense in
  depth); the service-role client stays in sync/cron/admin paths.
- **CSRF & redirects.** All authenticated mutations pass an
  Origin-then-Referer same-origin check (`csrf.server.ts`); `safeReturnTo`
  blocks open redirects (`//`, backslashes, control chars).
- **Webhook authentication.** Twilio HMAC-SHA1 with timing-safe compare, QBO
  verifier-token HMAC, Resend/Svix signature verification — all three
  providers verified.
- **Token security.** QBO tokens AES-256-GCM encrypted at rest; OAuth `state`
  is single-use with expiry and replay rejection; invite tokens are 32-hex
  random, 14-day expiry, with friendly dead-end screens for
  not-found/expired/already-accepted/wrong-account.
- **Send-path gating.** Quiet hours, workspace SMS toggle, consent, and
  do-not-contact flags are re-checked **server-side** on every SMS path
  (single, bulk, focus) — not just hidden in the UI. Bulk SMS is a two-step
  review→send with per-reason skip partitions and a server-side re-check.
- **Promise machine.** Supersede-on-renegotiate with linkage, cancel with
  recoverable write order, payment-validated broken detection via balance
  delta with business-day grace, partial payments surfaced live.
- **Prior gap-analysis items closed.** Late fees (display-only,
  org-configurable) ✅; coming-due view ✅; display names via profile +
  `user_metadata` ✅ ; broken-promise email alerts + per-member daily digest
  with dedup ledger ✅; DetailPanel UUID fallback fixed (`docNumber ?? "—"`)
  ✅; `AGENTS.md` rewritten for `nudgepay-app` ✅ (counts stale, see minors);
  legacy `nudgepay-frontend`/`-backend` directories deleted ✅.
- **UI state discipline.** Mutating controls disable + relabel while
  submitting; URL params validated against whitelists; deep links to
  missing cases degrade gracefully; keyboard shortcuts ignore form fields;
  root ErrorBoundary renders real 404/500 pages and hides stacks in prod.
- **Focus Mode session flow** is completable and un-stuckable (skip always
  available, snooze advances only on server-confirmed success, failed sends
  toast and stay put).

---

## Path to release

Severity above is judged against **public release**. A staged path:

**Phase 0 — safe for the current managed pilot (days).**
Fix the compliance/data-integrity bugs that bite at any scale: B3
(do_not_email reset), B5 (dropped inbound/STOP — at minimum store unmatched
inbound and alert the operator), B9 (mark connection errored + reconnect
prompt), M6 (stop swallowing loader errors), M17/B8 (render OAuth outcome;
trigger `syncOverdueInvoices` from the callback), M16 (template
resurrection), M31 (confirm dialog on disconnect). Set the production
Supabase URL and Netlify redirect targets (B10, B11) and close the Intuit
checklist (M30).

**Phase 1 — public core (weeks).**
Account lifecycle: password reset (B0), email-confirm landing + resend (M1),
real invite emails (M2), member removal/roles (M4), self-serve
password/email change (M5), org switcher or single-org guard (M3).
Data honesty at scale: paginate/bound every Supabase read and make
truncation loud (B1), fix reconciliation to page or count (B2), paginate QBO
queries (M18), handle QBO deletions (M26), purge-on-realm-change (M19).
Messaging for strangers: per-org SMS senders + A2P story (B4), per-tenant
email domain verification (B6), fix inbound email mapping + reply_to
(B7/M22), consent provenance + STOP irreversibility-by-UI (M23), STOP
language in templates, rate limits (M24). Ops: CI on the pure test suite +
typecheck (M27/M29), error monitoring (M28), tighten member RLS (M25).

**Phase 2 — competitive polish.**
Email-as-contact in priority/timelines (M10), inbox read state + live
updates (M14/M15), queue virtualization + calmer revalidation (M8), CSV
exports + aging report (M12), currency support or US-only gate (M13),
accessibility pass to WCAG AA (M32–M34 + minors), full customer directory
sync (M11), Focus Mode collision parity (M7), webhook/cron scaling
(M20/M21), and the minors backlog above.

---

## Audit trail

- Raw multi-agent findings, merge output, and the structural map are
  reproducible from the audit workflow journal (session artifacts).
- 144 raw findings → 107 after cross-auditor dedup → 12 blockers / 34
  majors / 61 minors. 150 confirmed-working notes accompany them.
- Every blocker was re-verified manually against the code on this date;
  verification refined B8 (a manual backfill exists; the gap is that
  nothing triggers it automatically and the outcome is silent).
- Objective signals: `typecheck` ✅ · `build` ✅ · `vitest` blocked by
  missing `.env.test`/local Supabase in this environment (M29).
