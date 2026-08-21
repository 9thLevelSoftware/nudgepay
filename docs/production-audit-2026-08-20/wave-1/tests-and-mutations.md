# Wave 1 — Test inventory and mutation security matrix

- **HEAD:** `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc`
- **App:** `nudgepay-app/`
- **Audit date:** 2026-08-20
- **Scope:** `tests/*.test.ts` (109 files) + every mutating `action`/`loader`
- **Product code:** not modified

CSRF in this app is **not** a synchronizer token. Authenticated unsafe requests
go through `requireUser` → `requireSameOrigin`, which accepts a matching
`Origin` or (if `Origin` is absent) a matching `Referer`
(`app/lib/csrf.server.ts:16-28`, `app/lib/session.server.ts:13-27`). GET is
exempt. Routes that never call `requireUser` have **no** origin check.

---

## Part A — Test inventory

**Harness facts (all domains):**

| Fact | Evidence |
|------|----------|
| No `"test"` script | `nudgepay-app/package.json:6-15` — scripts are `build` / `check` / `dev` / `typecheck` only |
| `npx vitest run` is the only documented runner | `Agents.md` Commands; not wired in npm or CI |
| Every file requires `.env.test` | `vitest.config.ts:12` `globalSetup: ["tests/global-setup.ts"]`; `tests/global-setup.ts:11-13` `readFileSync("../.env.test")` |
| `.env.test` is **missing** on this freeze | `docs/production-audit-2026-08-20/wave-0/freeze.md`; `Test-Path nudgepay-app/.env.test` → false. `.gitignore` ignores `.env` / `.env.local` but **not** `.env.test` (`nudgepay-app/.gitignore:127-132`) |
| Integration tests share one local Supabase | `vitest.config.ts:14-18` `fileParallelism: false` because `runScheduledCdc` sweeps all `qbo_connections` |
| `globalSetup` truncates the shared DB | `tests/global-setup.ts:25-63` — service-role wipe of auth users + public tables **before unit files too** |
| No Playwright/Vitest-browser suite | No `tests/**/*.spec.ts`, no `@playwright/test`. `package-lock.json` may pull `@vitest/browser-playwright` transitively; it is unused |
| Playwright in repo is demo capture | `nudgepay-app/scripts/{shoot-app,shoot-timeline,demo-record,demo-record-full,check-frontend}.mjs` — screenshots/video, not assertions |
| No GitHub Actions | no `D:\nudgepay\.github`, no `nudgepay-app/.github` |

**Classification rule used here:**

- **Unit (pure):** no `./helpers` import, no live DB. Still **cannot execute** without `.env.test` + reachable local Supabase because `globalSetup` always runs.
- **Integration:** imports `tests/helpers.ts` (`serviceClient` / `makeUserClient` / `TEST_ENV`) and/or invokes a route `action`/`loader` against local Supabase.
- **Missing browser e2e:** every domain. Nothing drives Chromium against `/login` → dashboard → send.

**109 `*.test.ts` files = 59 unit + 50 integration.**

### Auth, session, CSRF, unsubscribe

| File | Kind |
|------|------|
| `auth-flow.test.ts` | unit — `signupOutcome` / `humanAuthError` / Intuit-disconnect plan (pure) |
| `return-to.test.ts` | unit |
| `crypto.test.ts` | unit — AES wrap for QBO tokens |
| `unsubscribe-token.test.ts` | unit — HMAC sign/verify |
| `routes-registration.test.ts` | unit — `api.*`/`webhooks.*`/`auth.*` files must appear in `app/routes.ts` |
| `session.test.ts` | integration — `requireUser` / `requireOrgUser` + Origin 403/200 |
| `oauth-state.test.ts` | integration — OAuth `state` create/consume/replay |
| `unsubscribe.route.test.ts` | integration — GET does not mutate; POST sets `do_not_email` |

**Cannot see:** `/login`, `/signup`, `/logout` actions; cookie `Secure`/`SameSite` in production; login CSRF; password-reset (route does not exist); actual browser Origin on `<Form method="post">`.

### Onboarding, orgs, invites, tenancy RLS

| File | Kind |
|------|------|
| `onboarding.test.ts` | integration — `createOrgForUser` / `acceptInvite` **lib**, not routes |
| `orgs.test.ts` | integration — roster labels + expired invite |
| `rls.test.ts` | integration — customer isolation, invite owner-write, QBO connection member-read |

**Cannot see:** `/onboarding` double-POST creating two orgs; `/invite` action (service-role insert + link returned in HTML, **no email send**); `/accept/:token` action; invite token leakage via referrer.

### Worklist, cases, dashboard, accounts, focus, reports, presence, priority

| File | Kind |
|------|------|
| `worklist.test.ts`, `cases.test.ts`, `accounts.test.ts`, `coming-due.test.ts` | unit |
| `focus-queue.test.ts`, `focus-session.test.ts`, `reports.test.ts`, `collision.test.ts` | unit |
| `priority.test.ts`, `next-best-action.test.ts`, `exceptions.test.ts`, `follow-up-cadence.test.ts` | unit |
| `late-fees.test.ts`, `labels.test.ts`, `names.test.ts`, `dates.test.ts`, `tz.test.ts` | unit |
| `business-days.test.ts`, `status-style.test.ts`, `meta.test.ts`, `timeline.test.ts` | unit |
| `settings-tabs.test.ts` | unit |
| `dashboard-worklist.test.ts` | integration — loader-shaped `buildCaseData` against DB |
| `cases-rls.test.ts`, `case-exceptions.test.ts` | integration |
| `next-step.test.ts` | integration — `applyNextStep` |
| `presence.test.ts`, `api-presence-heartbeat.test.ts` | integration — `recordHeartbeat` **lib**, not the route |
| `api-priority-override.test.ts` | integration — RLS updates, not `action` |

**Cannot see:** dashboard view switching, keyboard focus mode, presence 20s poll, filter/sort UI, late-fee **display** against real QBO balances, reports page loader auth.

### Assignment, notes, communication preferences

| File | Kind |
|------|------|
| `bulk.test.ts`, `comm-prefs.test.ts` | unit |
| `api-assign.test.ts`, `api-bulk-assign.test.ts`, `api-account-notes.test.ts` | integration — **RLS client writes**, plus a routes.ts registration string check |
| `account-notes-schema.test.ts`, `comm-prefs-schema.test.ts` | integration — schema |
| `api-comm-prefs.test.ts` | mixed — `parseCommPrefsUpdate` unit + RLS; **does not call `action`** |

**Cannot see:** `requireUser` origin 403 on these routes; multi-org `org_id` pin in the action (tests hit RLS, which allows **every** membership org, the exact footgun the routes comment about).

### Contact logs and promises

| File | Kind |
|------|------|
| `contact-log.test.ts`, `promises.test.ts`, `promise-ledger.test.ts` | unit |
| `api-contact-logs.test.ts` | integration — **does invoke** `action` (one of the few) + promise column/RLS |
| `api-promises-cancel.test.ts` | integration — `cancelPromise` lib, not the route |
| `promise-create-grace.test.ts`, `promise-evaluation-rls.test.ts` | integration |

**Cannot see:** Focus Mode `respond=json` path in a browser; cancel button CSRF/origin; concurrent cancel vs keep.

### SMS / Twilio

| File | Kind |
|------|------|
| `sms-gate.test.ts`, `sms-templates.test.ts`, `quiet-hours.test.ts`, `channel-actions.test.ts`, `channel-settings.test.ts` | unit |
| `provider-status.test.ts`, `twilio-client.test.ts`, `twilio-webhook.test.ts`, `test-message.test.ts` | unit (fetch mocked) |
| `api-text-send.test.ts` | unit — **only** `withSms` / `smsSendReason`; does **not** call `api.text.send` |
| `twilio-send.test.ts`, `twilio-inbound.test.ts`, `bulk-send.test.ts` | integration — lib + DB, Twilio fetch mocked |
| `twilio-routes.test.ts` | integration-lite — inbound/status **action** 403 on bad/missing signature (`TEST_ENV`, no DB rows) |
| `api-sms-consent.test.ts` | mixed — RLS toggles + **one** `action` test (multi-org active-org pin) |

**Cannot see:** `/api/text/send` and `/api/bulk-sms` actions (CSRF, quiet-hours at wall clock, double-click duplicate SMS, Twilio 429); staff `consent=true` as a TCPA artifact; `/api/test-message` sending to an arbitrary E.164; production A2P brand; STOP/START at a real number.

### Email / Resend / CAN-SPAM

| File | Kind |
|------|------|
| `email-client.test.ts`, `email-events.test.ts`, `email-settings.test.ts`, `email-templates.test.ts`, `resend-webhook.test.ts` | unit |
| `email-config-schema.test.ts`, `email-messages.rls.test.ts`, `email-messaging.gate.test.ts`, `email-inbound-status.test.ts` | integration |
| `save-email.action.test.ts` | integration — `api.org-settings` `save_email` **action** |
| `webhooks-resend.test.ts` | integration — Resend **action** |

**Cannot see:** `/api/email/send` action; real Resend domain auth; CAN-SPAM footer in the sent MIME (lib builds it; no provider capture); List-Unsubscribe header (not implemented — page POST only).

### Notifications / digest cron

| File | Kind |
|------|------|
| `notifications.test.ts` | unit — HTML email builders |
| `digest-cron.test.ts` | integration — `runScheduledDigest` with extra email env injected |

**Cannot see:** `/api/notification-prefs` action; broken-promise alert send on live sync; Worker `scheduled` dispatch (`workers/app.ts:25-35`); digest actually hitting Resend.

### Org settings / templates / profile

| File | Kind |
|------|------|
| `org-config.test.ts`, `org-config-server-errors.test.ts`, `org-settings.test.ts`, `org-profile.test.ts` | unit |
| `message-templates.test.ts`, `message-inbox.test.ts` | unit |
| `org-config-loader.test.ts`, `org-settings-rls.test.ts`, `messaging-config-rls.test.ts` | integration |
| `holiday-action.test.ts` | integration — `add_holiday` **action** + owner no-op |
| `save-workflow.action.test.ts` | integration — `save_workflow` **action** + owner no-op + range error |

**Action-tested intents:** `save_workflow`, `save_email`, `add_holiday` only.

**Cannot see:** `/api/profile`; remaining org-settings intents (`save_company_profile`, `save_channels`, `save_sms_sender` lock, `save_quiet_hours`, `save_rules`, `remove_holiday`, `save_late_fees`, `save_priority_thresholds`, `save_template`, `delete_template`, `reset_templates`); owner-vs-member for those intents (except the three above).

### QuickBooks Online

| File | Kind |
|------|------|
| `qbo-api.test.ts`, `qbo-client.test.ts`, `qbo-mappers.test.ts`, `qbo-webhook.test.ts`, `payments-mappers.test.ts` | unit |
| `webhooks-route.test.ts` | integration-lite — QBO **action** 401 on bad/missing signature |
| `qbo-connection.test.ts`, `qbo-sync.test.ts`, `qbo-sync-cdc.test.ts`, `qbo-sync-payments.test.ts`, `qbo-cron.test.ts` | integration |
| `sync-errors.test.ts`, `sync-errors-schema.test.ts`, `sync-errors-wiring.test.ts` | integration |
| `api-sync-errors-dismiss.test.ts` | integration — RLS, not the route |

**Cannot see:** `/api/qbo/connect` (authorize URL + state insert); `/auth/qbo/callback` GET token exchange + `storeConnection`; `/api/qbo/disconnect` POST; `/api/qbo/refresh` by a **member**; Intuit production vs sandbox; webhook happy-path against Intuit; encryption key rotation.

### Production behaviors the suite cannot see (cross-cutting)

1. **The suite itself cannot run on this freeze** — `.env.test` is absent, so `globalSetup` throws before any assertion.
2. **No CI** — even a green local suite is optional tribal knowledge (`npx vitest run`).
3. **No browser** — cookie session issuance, `<Form>` Origin, Focus Mode keys, drawers, bulk bar, settings tabs.
4. **Most mutations never call `action`/`loader`.** Route `action` is imported in only: `api-contact-logs`, `api-sms-consent` (one test), `holiday-action`, `save-email.action`, `save-workflow.action`, `unsubscribe.route`, `webhooks-route`, `webhooks-resend`, `twilio-routes`, `sync-errors-wiring` (QBO webhook). Everything else is RLS or pure lib.
5. **Service-role send paths** (`api.text.send`, `api.email.send`, `api.bulk-sms`, `api.test-message`) are untested at the HTTP boundary; lib tests inject a service client and a fake `fetch`.
6. **CSRF is tested only on `requireUser`**, not on login/signup/logout/unsubscribe (the routes that skip it).
7. **Rate limits do not exist in app code**, so nothing asserts 429 / backoff / per-org send caps beyond `smsBatchLimit` clamp.
8. **Idempotency of outbound SMS/email** is untested (double POST = two Twilio/Resend calls).
9. **Cron in Cloudflare** (`workers/app.ts` `scheduled`) is not executed; tests call `runScheduledCdc` / `runScheduledDigest` directly.
10. **Real providers** (Twilio, Resend, Intuit) never see traffic from this suite.

---

## Part B — Mutation security matrix

Legend:

- **CSRF:** `via requireUser` = Origin/Referer check after session (`session.server.ts:26`). `no` = unsafe POST with neither origin check nor capability token. Webhooks use provider signatures instead.
- **Owner gate:** surface `org.role !== "owner"` (RLS may still apply).
- **org_id pin:** explicit `.eq("org_id", org.org_id)` / token claims — **not** “RLS alone” (RLS allows every membership org).
- **Rate limit:** application-level. Hosted Supabase Auth may rate-limit `/login`/`/signup` outside this Worker; that is not in-repo.
- **Idempotency:** safe replay of the **same** request.

| Route | Method | Auth | CSRF (`requireSameOrigin` via `requireUser`?) | Owner gate | org_id pin | Rate limit | Idempotency | Notes |
|-------|--------|------|-----------------------------------------------|------------|------------|------------|-------------|-------|
| `/login` | POST `action` | Public → session | **No** — never calls `requireUser` (`login.tsx:22-31`) | n/a | n/a | **none** | Session replace | Login CSRF: victim browser can be bound to attacker account, then connect QBO |
| `/signup` | POST `action` | Public → session | **No** (`signup.tsx:21-36`) | n/a | n/a | **none** | GoTrue unique email | Same-origin not required; creates `auth.users` |
| `/logout` | POST `action` | Cookie optional | **No** (`logout.tsx:5-9`) | n/a | n/a | none | Yes (`signOut`) | GET `loader` redirects to `/login` **without** signing out (`logout.tsx:12-14`) |
| `/onboarding` | POST `action` | `requireUser` | Yes | n/a (creates owner) | n/a (new org) | **none** | **No** | `createOrgForUser` with **service role**; **does not** re-check existing membership (`onboarding.tsx:28-37`). Loader redirects if org exists; action does not |
| `/invite` | POST `action` | `requireUser` | Yes | **owner** (`invite.tsx:32`) | insert `org_id: org.org_id` | **none** | No (new row) | Service-role insert bypasses RLS; token `gen_random_bytes(16)` (`0003_invites.sql:5`); **no email**, link returned in HTML (`invite.tsx:41`) |
| `/accept/:token` | POST `action` | `requireUser` | Yes | n/a (invitee) | via invite row | none | Yes (`accepted_at` + membership unique) | Service-role `acceptInvite`; email match + expiry (`orgs.server.ts:6-32`). Loader does not mutate |
| `/auth/qbo/callback` | **GET `loader` (mutates)** | `requireUser` | N/A for GET; **OAuth `state`** is the CSRF (`auth.qbo.callback.tsx:24-33`) | **owner** + `user.id === oauthState.userId` + `org.org_id === oauthState.orgId` | `oauthState.orgId` | none | State single-use (`oauth-state.server` consume) | Exchanges code, `storeConnection` (encrypted tokens). Missing `Origin` is fine (Intuit redirect) |
| `/api/qbo/connect` | POST `action` | `requireUser` | Yes | **owner** (`api.qbo.connect.tsx:13-15`) | state row `org_id` | none | New state each click | Redirects to Intuit; GET loader → `/dashboard` |
| `/api/qbo/disconnect` | POST `action` | `requireUser` | Yes | **owner** (`api.qbo.disconnect.tsx:19`) | `org.org_id` | none | Repeat = no-op-ish | GET `loader` is **not** a mutation — unsigned Intuit landing HTML only (`api.qbo.disconnect.tsx:32-48`) |
| `/api/qbo/refresh` | POST `action` | `requireUser` | Yes | **any member** (`api.qbo.refresh.tsx:14-16` — no role check) | `org.org_id` | **none** | No (full overdue pull) | Service-role QBO + may send broken-promise emails. Member can hammer Intuit quota |
| `/api/assign` | POST `action` | `requireUser` | Yes | any member | customer `eq("org_id")` + membership guard on `ownerId` (`api.assign.tsx:19-33`) | none | Yes (same owner) | |
| `/api/bulk-assign` | POST `action` | `requireUser` | Yes | any member | cases + customers pinned (`api.bulk-assign.tsx:47-56`) | batch clamp only (`smsBatchLimit`) | Yes | Caps via workflow knob, not a rate limiter |
| `/api/account-notes` | POST `action` | `requireUser` | Yes | any member | customer pin (`api.account-notes.tsx:21-31`) | none | Yes | |
| `/api/comm-prefs` | POST `action` | `requireUser` | Yes | any member | customer/case/invoice pin (`api.comm-prefs.tsx:45-72`) | none | Yes | Explicitly **omits** `sms_consent` (`api.comm-prefs.tsx:7-8`) |
| `/api/sms-consent` | POST `action` | `requireUser` | Yes | **any member** | invoice/customer pin (`api.sms-consent.tsx:25-48`) | none | Yes (same flag) | **Staff can set `sms_consent: true`** — contradicts STOP/START-only comment on comm-prefs |
| `/api/contact-logs` | POST `action` | `requireUser` | Yes | any member | case/invoice pin (`api.contact-logs.tsx:24-45`) | none | **No** | Creates log ± promise. `respond=json` for Focus |
| `/api/promises/cancel` | POST `action` | `requireUser` | Yes | any member | `cancelPromise(..., org.org_id)` (`api.promises.cancel.tsx:29`) | none | Second call fails (not pending) | |
| `/api/priority-override` | POST `action` | `requireUser` | Yes | any member | case pin (`api.priority-override.tsx:22-38`) | none | Yes | |
| `/api/presence/heartbeat` | POST `action` | `requireUser` | Yes | any member | writes `org_id` from membership | none (20s poll) | Upsert | **Does not verify `customerId` belongs to org** (`api.presence.heartbeat.tsx:14-21`, `presence.server.ts:7-21`); RLS pins `user_id` |
| `/api/sync-errors/dismiss` | POST `action` | `requireUser` | Yes | any member | `eq("org_id")` (`api.sync-errors.dismiss.tsx:20-22`) | none | Yes | |
| `/api/text/send` | POST `action` | `requireUser` | Yes | any member | `sendInvoiceText` pins invoice+customer (`twilio-messaging.server.ts:85-94`) | **none** | **No** | Service role; consent/quiet-hours/do_not_text gates in lib. Duplicate POST = duplicate SMS |
| `/api/email/send` | POST `action` | `requireUser` | Yes | any member | `sendInvoiceEmail` pin (`email-messaging.server.ts:23-32`) | **none** | **No** | Service role; email must be enabled. Duplicate POST = duplicate email |
| `/api/bulk-sms` | POST `action` | `requireUser` | Yes | any member | `runBulkSms(..., orgId)` (`api.bulk-sms.tsx:84-86`) | batch clamp only | **No** | Service role; quiet-hours pre-check; sequential `sendInvoiceText` |
| `/api/test-message` | POST `action` | `requireUser` | Yes | **owner** (`api.test-message.tsx:31`) | org sender lookup | **none** | **No** | **`test_sms`:** any parsed E.164 (`provider-status.ts:35-44`); **skips consent, quiet hours, ledger** (`test-message.server.ts:1-4`). `test_email`: owner’s email only |
| `/api/profile` | POST `action` | `requireUser` | Yes | self (`auth.updateUser`) | membership required; no org column | none | Yes | Display name in `user_metadata` (`api.profile.tsx:21-23`) |
| `/api/notification-prefs` | POST `action` | `requireUser` | Yes | self | form `org_id` must equal session org (`api.notification-prefs.tsx:17-19`) | none | Upsert | |
| `/api/org-settings` `save_company_profile` | POST | `requireUser` | Yes | **owner** (`api.org-settings.tsx:26`) | upsert `org_id` + org rename `.eq("id", org.org_id)` | none | Upsert | |
| `/api/org-settings` `save_channels` | POST | `requireUser` | Yes | owner | `messaging_config.org_id` | none | Upsert | Toggles `sms_enabled` only |
| `/api/org-settings` `save_sms_sender` | POST | `requireUser` | Yes | owner | n/a (rejected) | none | n/a | Hard-lock: `error=sms_sender_locked` (`api.org-settings.tsx:56-61`) |
| `/api/org-settings` `save_quiet_hours` | POST | `requireUser` | Yes | owner | `org_settings.org_id` | none | Upsert | |
| `/api/org-settings` `save_rules` | POST | `requireUser` | Yes | owner | `org_settings.org_id` | none | Upsert | |
| `/api/org-settings` `add_holiday` | POST | `requireUser` | Yes | owner | `org_holidays.org_id` | none | Upsert on `(org_id, holiday_date)` | Action-tested |
| `/api/org-settings` `remove_holiday` | POST | `requireUser` | Yes | owner | delete pin | none | Yes | **Not** action-tested |
| `/api/org-settings` `save_late_fees` | POST | `requireUser` | Yes | owner | `org_settings.org_id` | none | Upsert | Display knobs only |
| `/api/org-settings` `save_priority_thresholds` | POST | `requireUser` | Yes | owner | `org_settings.org_id` | none | Upsert | |
| `/api/org-settings` `save_workflow` | POST | `requireUser` | Yes | owner | `org_settings.org_id` | none | Upsert | Action-tested (incl. `sms_batch_limit` range) |
| `/api/org-settings` `save_email` | POST | `requireUser` | Yes | owner | `email_config.org_id` | none | Upsert | Action-tested |
| `/api/org-settings` `save_template` | POST | `requireUser` | Yes | owner | `message_templates.org_id` | none | Upsert `(org_id,channel,slug)` | |
| `/api/org-settings` `delete_template` | POST | `requireUser` | Yes | owner | delete pin | none | Yes | |
| `/api/org-settings` `reset_templates` | POST | `requireUser` | Yes | owner | delete+insert pin | none | Re-seed | |
| `/unsubscribe` | POST `action` | HMAC token | **No origin check** (`unsubscribe.tsx:21-35`) | n/a | token `orgId`+`customerId` | none | Yes (`do_not_email=true`) | GET loader confirm-only (RFC 8058). Token **is** the capability. CSRF with a leaked token opts the customer out |
| `/webhooks/qbo` | POST `action` | Intuit HMAC (`intuit-signature`) | N/A (signature) (`webhooks.qbo.tsx:16-20`) | n/a | `qbo_connections.realm_id` → `org_id` | none | Entity upserts; 500 retries | Unauthenticated otherwise. Fail-closed on bad sig (401) |
| `/webhooks/twilio/inbound` | POST `action` | Twilio `X-Twilio-Signature` | N/A (`webhooks.twilio.inbound.tsx:19-22`) | n/a | phone → customer/org | none | `MessageSid` unique (`0032_security_hardening.sql:102-106`) | STOP/START flips `sms_consent`. 403 on bad sig |
| `/webhooks/twilio/status` | POST `action` | Twilio signature | N/A (`webhooks.twilio.status.tsx:17-20`) | n/a | via `MessageSid` | none | Status overwrite | 403 on bad sig |
| `/webhooks/resend` | POST `action` | Svix (`svix-*`) | N/A (`webhooks.resend.tsx:11-16`) | n/a | `provider_message_id` / from_address | none | Inbound skip on duplicate id (`email-messaging.server.ts:124-136`) | Complaints set `do_not_email`. 401 on bad sig |

Non-mutating loaders (`/dashboard`, `/accounts`, `/settings`, …) omitted. Worker crons (`workers/app.ts:25-35` CDC + digest) mutate with service role and are **not** HTTP-authenticated; they are untested as `scheduled` handlers.

---

## Part C — Findings

### [TEMP-TEST-001]

- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** ops
- **Status:** open
- **Evidence (code):** `nudgepay-app/package.json:6-15` has no `"test"` script. `nudgepay-app/vitest.config.ts:12` + `tests/global-setup.ts:11-13` require `nudgepay-app/.env.test`. Wave 0 freeze records `.env.test` missing and `.github/` CI missing. `npx vitest run` is documentation-only (`Agents.md`).
- **Evidence (live):** `Test-Path D:\nudgepay\nudgepay-app\.env.test` → false; `D:\nudgepay\.github` does not exist.
- **User / legal impact:** Production can ship with a red suite nobody runs. Tenancy/SMS regressions will not gate deploy (`npm run check` is tsc+build+wrangler dry-run only, `package.json:10`).
- **Fix recipe:** Add `nudgepay-app/.env.test.example` (no secrets); add `"test": "vitest run"`; add `.github/workflows/test.yml` that starts local Supabase, applies migrations, copies example env, runs `npx vitest run`. Fail deploy on red.
- **Do not:** Commit real service-role keys. Do not make CI optional `continue-on-error`.

### [TEMP-TEST-002]

- **Severity:** major
- **Bars:** P0-managed
- **Area:** ops
- **Status:** open
- **Evidence (code):** `vitest.config.ts:9-19` applies `globalSetup` and `fileParallelism: false` to **all** `tests/**/*.test.ts`. `tests/global-setup.ts:25-63` always connects to local Postgres and truncates. 59 unit files (e.g. `tests/names.test.ts`, `tests/worklist.test.ts`) still need a live DB they never query.
- **Evidence (live):** n/a (suite cannot start without `.env.test`).
- **User / legal impact:** Unit tests are unusable in CI agents without Docker/Supabase; contributors skip the suite; coverage of pure modules silently bitrots.
- **Fix recipe:** Split configs: `vitest.unit.config.ts` (no globalSetup, `tests/**/*.test.ts` excluding helpers-importers) vs `vitest.int.config.ts`. CI job 1 = unit (seconds); job 2 = integration with Supabase.
- **Do not:** Keep a single config that `readFileSync`s `.env.test` for `late-fees.test.ts`.

### [TEMP-TEST-003]

- **Severity:** major
- **Bars:** P0-managed
- **Area:** ops
- **Status:** open
- **Evidence (code):** 109 Vitest files, zero Playwright test specs. `scripts/shoot-app.mjs` / `demo-record.mjs` drive Chromium for marketing captures, not `expect`.
- **Evidence (live):** n/a.
- **User / legal impact:** Login cookie flow, CSRF Origin from real forms, Focus Mode send, QBO connect button, and unsubscribe confirm page are untested in a browser. First production user is the test.
- **Fix recipe:** Add a small Playwright smoke: signup/login, onboarding name, settings load, logout. Run against `npm run dev` + local Supabase in CI. Do not automate Intuit OAuth in v1.
- **Do not:** Treat `check-frontend.mjs` as e2e.

### [TEMP-TEST-004]

- **Severity:** major
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** Route `action` imports exist only in `tests/api-contact-logs.test.ts:5`, `tests/api-sms-consent.test.ts:4`, `tests/holiday-action.test.ts:4`, `tests/save-email.action.test.ts:4`, `tests/save-workflow.action.test.ts:4`, `tests/unsubscribe.route.test.ts:2`, `tests/webhooks-route.test.ts:3`, `tests/webhooks-resend.test.ts:3`, `tests/twilio-routes.test.ts:3-4`, `tests/sync-errors-wiring.test.ts:4`. Counterpart “api-*” files such as `tests/api-assign.test.ts`, `tests/api-account-notes.test.ts`, `tests/api-presence-heartbeat.test.ts` call `user.client.from(...)` (RLS), **not** the action. RLS permits every membership org; the routes’ `resolveOrg` pin is the actual tenancy control and is untested for those endpoints.
- **Evidence (live):** n/a.
- **User / legal impact:** A multi-org collector can theoretically be protected only by untested action guards. A regression that drops `.eq("org_id", org.org_id)` will still pass RLS tests.
- **Fix recipe:** For each mutating route, add one cookie+Origin `action()` test: happy path, cross-org id in the body, missing Origin → 403. Reuse `sessionCookie` from `tests/session.test.ts:40-48`.
- **Do not:** Equate “RLS test named `api-foo`” with route coverage.

### [TEMP-TEST-005]

- **Severity:** major
- **Bars:** P0-public
- **Area:** sms
- **Status:** open
- **Evidence (code):** `tests/api-text-send.test.ts` only maps error strings (`smsSendReason`). `tests/twilio-send.test.ts` / `tests/bulk-send.test.ts` call `sendInvoiceText` / `runBulkSms` with mocked `fetch` and a service client — they never import `app/routes/api.text.send.tsx` or `api.bulk-sms.tsx`. No test POSTs twice to prove duplicate SMS. No test asserts 403 without Origin on those routes.
- **Evidence (live):** n/a.
- **User / legal impact:** Duplicate or cross-origin collection texts are uncaught. TCPA exposure and Twilio spend.
- **Fix recipe:** Action tests for `/api/text/send` and `/api/bulk-sms`: Origin 403; invoice from another org → no send; mocked Twilio called once; replay POSTs twice → two provider calls (document until an idempotency key exists).
- **Do not:** Count mocked lib tests as HTTP coverage.

### [TEMP-TEST-006]

- **Severity:** major
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** `tests/auth-flow.test.ts` is pure string mapping. No test imports `app/routes/login.tsx`, `signup.tsx`, `logout.tsx`, `invite.tsx`, `onboarding.tsx`, or `accept.$token.tsx` `action`. `tests/onboarding.test.ts` / `tests/orgs.test.ts` hit `createOrgForUser` / `acceptInvite` only.
- **Evidence (live):** n/a.
- **User / legal impact:** Login CSRF, duplicate-org onboarding, and invite accept mismatches can ship green.
- **Fix recipe:** Action tests: login success/fail + Origin 403 after adding CSRF; onboarding second POST does not create org #2; invite member → error; accept wrong email → no membership.
- **Do not:** Only test `humanAuthError` copy.

### [TEMP-SEC-001]

- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** `requireSameOrigin` runs only inside `requireUser` (`session.server.ts:13-27`). `/login` action (`login.tsx:22-31`) and `/signup` (`signup.tsx:21-36`) and `/logout` (`logout.tsx:5-9`) call `createSupabaseUserClient` only. CSRF helper tests (`session.test.ts:111-159`) never exercise these routes.
- **Evidence (live):** n/a (no browser suite).
- **User / legal impact:** Login CSRF: attacker’s site POSTs attacker credentials to `https://<nudgepay>/login`; victim’s browser stores the attacker session. Victim then hits Connect QuickBooks (`/api/qbo/connect`, owner-gated on **that** org) and attaches **Chancey’s QBO** to the attacker’s tenant. Collections PII + invoice bodies leave the real org.
- **Fix recipe:** Call `requireSameOrigin(request, headers)` at the top of login/signup/logout actions (before `signInWithPassword`). Add `Origin` on those tests. Optionally set cookie `SameSite=Lax` (default) and confirm production `Secure`.
- **Do not:** Rely on “login is public so CSRF does not apply.” Do not use GET for login.

### [TEMP-SEC-002]

- **Severity:** major
- **Bars:** P0-public
- **Area:** sms
- **Status:** open
- **Evidence (code):** Repo-wide `rateLimit`/`throttle` in `app/` is absent (only `supabase/config.toml` local Auth comments). `/api/text/send` (`api.text.send.tsx:15-54`), `/api/email/send` (`api.email.send.tsx:8-41`), `/api/bulk-sms` (`api.bulk-sms.tsx:31-91`), `/api/test-message` (`api.test-message.tsx:39-59`), `/login`, `/signup` have no per-user/per-org limiter. Bulk clamp is `smsBatchLimit` (`bulk.ts` via org settings), not a time window.
- **Evidence (live):** n/a.
- **User / legal impact:** A stolen session or click-jacked authenticated POST (if Origin were bypassed) can flood customer phones/inboxes — TCPA + carrier filtering + Twilio/Resend bill. Login stuffing is Worker-unlimited (Supabase may still 429 GoTrue).
- **Fix recipe:** Per-org and per-user counters (Durable Object or `notification_log`-style table): e.g. 30 SMS/min, 200/day, 5 test SMS/hour. Return 429. Log. Cap `/api/qbo/refresh` at 1/min/org.
- **Do not:** Use only `smsBatchLimit` as a security control.

### [TEMP-SEC-003]

- **Severity:** major
- **Bars:** P0-public
- **Area:** sms
- **Status:** open
- **Evidence (code):** `api.comm-prefs.tsx:7-8` states legal `sms_consent` is “governed solely by STOP/START, never by a preferences write.” `api.sms-consent.tsx:18` + `:44-48` lets **any member** `update({ sms_consent: consent })` including `consent=true`. Inbound STOP/START is the only consumer-origin path (`twilio-messaging.server.ts` STOP/START updates). Tests treat staff toggle as the happy path (`tests/api-sms-consent.test.ts:48-71`).
- **Evidence (live):** n/a.
- **User / legal impact:** A collector can mark a customer consented without written TCPA/A2P consent, then `/api/text/send` will send (`twilio-messaging.server.ts:116`). That is a legal collections-SMS failure, not a UX flag.
- **Fix recipe:** Remove grant from the UI/action (allow `consent=false` / “we heard verbal no” only, or drop the route). Consent **true** only from START or a documented written-consent workflow with actor + timestamp + source. Add a ledger column `sms_consent_source`. Update tests that currently expect staff grant.
- **Do not:** Keep a dashboard checkbox that sets `sms_consent=true`.

### [TEMP-SEC-004]

- **Severity:** major
- **Bars:** P0-public
- **Area:** sms
- **Status:** open
- **Evidence (code):** `app/lib/test-message.server.ts:1-4` and `:27-37` — test SMS skips customer pipeline, consent, quiet hours, and `text_messages`. Destination is any E.164 (`provider-status.ts:35-44`, including `+44…`). Owner-only (`api.test-message.tsx:31`) but **no rate limit** and **no allowlist** to the owner’s phone.
- **Evidence (live):** n/a.
- **User / legal impact:** Compromised owner session (or CSRF if Origin failed) sends unlogged SMS to arbitrary numbers — TCPA and no audit trail.
- **Fix recipe:** Restrict `to` to the owner’s verified phone (settings field) or require typing a code. Write a `text_messages` (or `audit_log`) row with `direction=outbound`, `body` tagged test. Rate-limit. Keep consent skip only for that verified owner number.
- **Do not:** Log “test message” as a customer collection text. Do not send to unrestricted E.164.

### [TEMP-SEC-005]

- **Severity:** major
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** `onboarding.tsx:20-25` loader redirects if `resolveOrg` is set. `onboarding.tsx:28-37` action does **not** re-read membership; it always `createOrgForUser` via service role (`orgs.server.ts:35-48`). Double-submit / two tabs → two owner orgs. `resolveOrg` takes the **oldest** membership (`session.server.ts:34-41`), so the new org may be invisible.
- **Evidence (live):** n/a.
- **User / legal impact:** Split-brain tenant: QBO connected on org B while the dashboard shows org A; invoices never appear; support believes sync is broken.
- **Fix recipe:** In the action, if `resolveOrg` is non-null, redirect `/dashboard`. Unique constraint: one owner-created org per user if that is the product rule, or an explicit org switcher (out of scope) before allowing a second.
- **Do not:** Compensate only in the loader.

### [TEMP-SEC-006]

- **Severity:** major
- **Bars:** P0-managed
- **Area:** ops
- **Status:** open
- **Evidence (code):** `/api/qbo/refresh` (`api.qbo.refresh.tsx:14-16`) requires any membership, not owner, and has no debounce. It runs `syncOverdueInvoices` + `resolveSyncErrors` with service role and may email broken-promise alerts (`api.qbo.refresh.tsx:24-51`). Contrast `/api/qbo/connect` and `disconnect` which are owner-only.
- **Evidence (live):** n/a.
- **User / legal impact:** Every collector can trigger Intuit-rate-limited CDC-ish pulls; parallel clicks amplify; broken-promise emails duplicate if notify is not fully ledger-deduped on this path.
- **Fix recipe:** Owner-only **or** shared org lock (one in-flight refresh). Idempotency key per org. Return `?sync=busy`. Confirm `notification_log` dedup covers this path (Wave 2).
- **Do not:** Leave member-triggered unbounded QBO pulls in production.

### [TEMP-SEC-007]

- **Severity:** minor
- **Bars:** polish
- **Area:** email
- **Status:** open
- **Evidence (code):** `/unsubscribe` POST (`unsubscribe.tsx:21-35`) does not call `requireSameOrigin`. Capability is the HMAC token (good). GET is confirm-only (`unsubscribe.tsx:10-18`, tested in `unsubscribe.route.test.ts:42-56`).
- **Evidence (live):** n/a.
- **User / legal impact:** If a token leaks (email logs, Referer), a third-party site can POST unsubscribe. Usually aligned with the user’s interest; still an unauthenticated state change.
- **Fix recipe:** Keep token auth. Optional: bind POST to same-origin **or** accept RFC 8058 `List-Unsubscribe=One-Click` with `List-Unsubscribe-Post` only from mail-provider IPs. Rotate `UNSUBSCRIBE_SECRET` on incident.
- **Do not:** Opt out on GET (scanners). Do not require login (legal opt-out must work).

### [TEMP-SEC-008]

- **Severity:** minor
- **Bars:** polish
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** `api.presence.heartbeat.tsx:14-21` upserts whatever `customerId` the client sends with the session `org_id`. No `customers` lookup. `presence.server.ts:11-18` upserts on `(org_id, customer_id, user_id)`.
- **Evidence (live):** n/a.
- **User / legal impact:** Junk presence rows; low PII risk because reads filter loader customer ids. Do not confuse with cross-org write (RLS + org_id from membership).
- **Fix recipe:** `select id from customers where org_id = org.org_id and id = customerId` before upsert; 204 if missing (same as today’s swallow).
- **Do not:** Trust the form id without an org-scoped existence check — copy the pattern in `api.assign.tsx:21-23`.

### [TEMP-TEST-007]

- **Severity:** minor
- **Bars:** polish
- **Area:** ops
- **Status:** open
- **Evidence (code):** Org-settings intents in `api.org-settings.tsx:30-180` vs tests: only `save_workflow`, `save_email`, `add_holiday` invoke `action`. `save_sms_sender` lock (`api.org-settings.tsx:56-61`) has no test that a forged sender is rejected. `/api/profile` and `/api/notification-prefs` have zero tests. `/api/qbo/connect|disconnect|refresh` and `auth.qbo.callback` have lib tests (`oauth-state`, `qbo-connection`) but no route tests.
- **Evidence (live):** n/a.
- **User / legal impact:** Sender-lock or callback `userId` mismatch could regress without CI signal (once CI exists).
- **Fix recipe:** One action test per remaining intent (especially `save_sms_sender` → `sms_sender_locked`); callback test with mismatched user; profile/prefs upsert.
- **Do not:** Expand demo shoot scripts instead of assertions.

---

## Coverage cheat sheet (mutating HTTP)

| Mutating endpoint | Route `action`/`loader` test? | Lib/RLS test? |
|-------------------|-------------------------------|---------------|
| login / signup / logout | no | copy only (`auth-flow`) |
| onboarding / invite / accept | no | lib (`onboarding`, `orgs`) |
| qbo connect / disconnect / refresh / callback | no | oauth-state, qbo-connection, qbo-sync |
| assign / bulk-assign / notes / comm-prefs | no | RLS files named `api-*` |
| sms-consent | partial (multi-org pin) | RLS toggle |
| contact-logs | **yes** | yes |
| promises/cancel | no | `cancelPromise` |
| priority-override / presence / sync-errors dismiss | no | RLS/lib |
| text/send / email/send / bulk-sms | no | mocked lib |
| test-message | no | mocked lib |
| profile / notification-prefs | no | no |
| org-settings (3 intents) | **yes** | yes |
| org-settings (other 11 intents) | no | parsers / RLS |
| unsubscribe | **yes** | token unit |
| webhooks qbo / twilio / resend | **sig-reject yes**; limited happy path | verify* unit + inbound DB |

End of Wave 1.
