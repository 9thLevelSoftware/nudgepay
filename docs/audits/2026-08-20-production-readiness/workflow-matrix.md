# W1–W12 workflow matrix

Snapshot: `88b9baca35be5b8d9235b2f96863150ef3a67ad1` on `2026-08-20`.
This matrix reconciles `docs/production-audit-2026-08-20/04-workflow-matrix.md`
and `wave-2/workflow-static.md` (both based on `820fb1ba`) against current source.
No authenticated browser, Docker, local Supabase, or provider was used. A later
anonymous Playwright smoke covered only `/`, `/login`, `/signup`, `/privacy`, and
`/eula`; it does not verify W1–W12. A `STATIC PASS` is a source judgment only; it is
never live evidence. `AUTOMATED` identifies a named Vitest/helper test in source;
the current full-suite attempts collected zero tests because `.env.test` is absent.

## Evidence key

| Label | Meaning |
|---|---|
| `STATIC PASS` | Source path is present and internally coherent. |
| `STATIC FAIL` | Source path is missing, misleading, or inconsistent; finding IDs are carried forward where the code still matches. |
| `AUTOMATED` | Relevant unit/integration/RLS test exists. This may cover a helper instead of the route itself. |
| `STATIC-ONLY` | No named automated test for the route/UI step; source inspection only. |
| `BROWSER BLOCKED` | Needs authenticated click-through, hydration, layout, focus, keyboard, or screen-reader evidence. |
| `PROVIDER BLOCKED` | Needs Supabase Auth, QuickBooks, Twilio, Resend, or real webhook/secret behavior. |
| `ENVIRONMENT BLOCKED` | Needs Docker/local DB, CI, deployment, or cron scheduler. |

## Matrix

| Workflow | Step | Current source evidence | Automated evidence | Live status / gap |
|---|---|---|---|---|
| W1 First-run | Home → signup/login/legal | `home.tsx:1-38`; `routes.ts:4-20` | `routes-registration.test.ts` | `STATIC PASS`; `STATIC-ONLY`; `BROWSER BLOCKED` for copy/meta/link rendering (NP-2026-104/131). |
| W1 First-run | Signup with email confirmation on | `signup.tsx:21-110`; `auth-flow.server.ts:1-16` chooses confirm card when no session. | `auth-flow.test.ts` | `STATIC PASS`; `AUTOMATED`; `PROVIDER BLOCKED` for Supabase confirmation email and click-through. |
| W1 First-run | Signup with session/confirmation off | `signup.tsx:39-41` redirects to returnTo/onboarding with cookie headers. | `auth-flow.test.ts` | `STATIC PASS`; `AUTOMATED`; `PROVIDER/BROWSER BLOCKED` for real cookie/session. |
| W1 First-run | Login returnTo/org routing | `login.tsx:22-92`; `session.server.ts:30-61`; `return-to.ts`. | `auth-flow.test.ts`, `return-to.test.ts`, `session.test.ts` | `STATIC PASS`; `AUTOMATED`; `BROWSER/PROVIDER BLOCKED` for Origin/cookie/Auth. Forgot password is absent (NP-2026-001). |
| W1 First-run | Create org/onboarding | `onboarding.tsx:20-55`; `orgs.server.ts` service bootstrap. | `onboarding.test.ts`, `orgs.test.ts` | `STATIC PASS`; `AUTOMATED`; `PROVIDER/ENVIRONMENT BLOCKED` for Auth + transaction/RLS. |
| W1 First-run | Land integrations without welcome | `dashboard.tsx:197-198` redirects disconnected org to `/settings?tab=integrations`; `settings.tsx:28-364`. | No route/UI test. | `STATIC FAIL`; `STATIC-ONLY`; `BROWSER BLOCKED`; first-run welcome is absent (NP-2026-137). |
| W1 First-run | Owner starts QBO OAuth | `api.qbo.connect.tsx:8-28`; `oauth-state.server.ts`. | `oauth-state.test.ts`, `qbo-connection.test.ts` | `STATIC PASS`; `AUTOMATED` helper coverage; `PROVIDER BLOCKED` for Intuit redirect/registered URI. |
| W1 First-run | Callback stores connection | `auth.qbo.callback.tsx:9-38`; `qbo-connection.server.ts`. | `oauth-state.test.ts`, `qbo-client.test.ts`, `qbo-connection.test.ts` | `STATIC PASS` for storage; `AUTOMATED` helpers only; `PROVIDER BLOCKED` for OAuth. Callback does not initial-sync (NP-2026-005/TEMP-WF-002). |
| W1 First-run | Callback flash and first dashboard | `auth.qbo.callback.tsx:31-37` redirects `qbo=connected`; `dashboard.tsx` does not consume qbo/sync params; `WorkQueue.tsx:604-614` uses generic empty copy. | No callback/dashboard route test. | `STATIC FAIL`; `STATIC-ONLY`; `BROWSER/PROVIDER BLOCKED`; NP-2026-017/105 and TEMP-WF-001/003. |
| W1 First-run | Live sandbox connect + first data | QBO client/sync graph exists (`qbo-client.server.ts`, `qbo-sync.server.ts`, `qbo-cron.server.ts`). | Mocked QBO sync tests only. | `PROVIDER BLOCKED`; no live Intuit/CDC/data evidence. |
| W2 Daily collector | Dashboard requires connected QBO | `dashboard.tsx:161-221`; `workspace.server.ts:14-45`. | Queue/worklist tests, no route loader. | `STATIC PASS`; `AUTOMATED` helper coverage; `PROVIDER/BROWSER BLOCKED` for session/QBO. |
| W2 Daily collector | Ten saved views + four sorts | `worklist.ts:38-39,156-171`; `dashboard.tsx:68,220-221`; `WorkQueue.tsx:110-128`. | `worklist.test.ts`, `dashboard-worklist.test.ts`, `coming-due.test.ts`. | `STATIC PASS`; `AUTOMATED`; `BROWSER BLOCKED` for actual view interaction. |
| W2 Daily collector | Search/filter/empty queue | `WorkQueue.tsx:500-614`; empty state says “No accounts match this view” and “Clear the search.” | No component/browser test. | `STATIC FAIL`; `STATIC-ONLY`; `BROWSER BLOCKED`; wrong first-run empty copy NP-2026-105. |
| W2 Daily collector | Log contact methods/outcomes/next steps | `LogContactDrawer.tsx:41-272`; `api.contact-logs.tsx:9-83`; `contact-log.ts`. | `api-contact-logs.test.ts`, `contact-log.test.ts`, `next-step.test.ts`. | `STATIC PASS`; `AUTOMATED`; `BROWSER BLOCKED` for drawer focus and collision UX. |
| W2 Daily collector | Collision confirm and save | `collision.ts`; `api.contact-logs.tsx`; `use-dialog.ts`. | `collision.test.ts`, `api-contact-logs.test.ts`. | `STATIC PASS`; `AUTOMATED`; `BROWSER BLOCKED` for focus trap/live error. |
| W2 Daily collector | Call/text/note controls honor gates | `DetailPanel.tsx:739-780,1139-1163`; `sms-gate.ts`; `channel-actions.ts`. | `sms-gate.test.ts`, API send tests. | `STATIC PASS`; `AUTOMATED`; `PROVIDER/BROWSER BLOCKED` for actual send and stale state. |
| W2 Daily collector | Email updates last-contact | `api.email.send.tsx:8-46`; `email-messaging.server.ts`; detail activity. | `email-messaging.gate.test.ts`, email tests. | `STATIC FAIL`; `AUTOMATED`; last-contact update remains NP-2026-024; provider delivery blocked. |
| W2 Daily collector | Comm prefs include do_not_email | `CommPrefsDrawer.tsx:1-79`; `api.comm-prefs.tsx:26-82`; `customers.do_not_email` migration 0021. | `api-comm-prefs.test.ts`, schema tests. | `STATIC FAIL`; `AUTOMATED` test preserves current omission; profile path can wipe opt-out NP-2026-003. |
| W2 Daily collector | Assign/priority override | `api.assign.tsx:6-42`; `api.priority-override.tsx:8-48`; `DetailPanel.tsx:852-947`. | `api-assign.test.ts`, `api-priority-override.test.ts`, `priority.test.ts`. | `STATIC PASS`; `AUTOMATED`; browser stale/flash and threshold mismatch NP-2026-045 blocked. |
| W2 Daily collector | Presence/collision markers | `presence.server.ts`; `api.presence.heartbeat.tsx:8-30`; `dashboard.tsx`/queue props. | `presence.test.ts`, heartbeat test. | `STATIC PASS`; `AUTOMATED`; `PROVIDER/ENVIRONMENT BLOCKED` for multi-user timing; no live send. |
| W2 Daily collector | Loader error honesty | `dashboard.tsx` catches/constructs metrics and queue; `WorkQueue.tsx` empty path. | No route error test. | `STATIC FAIL`; `STATIC-ONLY`; `BROWSER/ENVIRONMENT BLOCKED`; PostgREST errors can present $0/empty (NP-2026-015). |
| W3 Focus | Keyboard 1/2/3/space | `focus.tsx:44-470`; `use-focus-keys.ts:1-36`. | `focus-session.test.ts`, `focus-queue.test.ts`. | `STATIC PASS`; `AUTOMATED` pure/session; `BROWSER BLOCKED` for real key focus and mobile reachability. |
| W3 Focus | SMS gates and send | `focus.tsx` forms; `api.text.send.tsx:15-59`; `sms-gate.ts`. | `sms-gate.test.ts`, `api-text-send.test.ts`, `twilio-send.test.ts`. | `STATIC PASS`; `AUTOMATED`; `PROVIDER BLOCKED` for Twilio. |
| W3 Focus | Presence/collision in Focus | `focus.tsx` presence load; `api.presence.heartbeat.tsx`; `collision.ts`. | Presence/collision helpers. | `STATIC FAIL`; `AUTOMATED` helper-only; live marker/collision behavior browser/environment blocked (NP-2026-025/TEMP-WF-012). |
| W3 Focus | Focus empty/done path | `focus.tsx` queue and session states. | `focus-session.test.ts`, `focus-queue.test.ts`. | `STATIC PASS`; `AUTOMATED`; `BROWSER BLOCKED` for visual/status announcement. |
| W3 Focus | Mobile navigation reaches Focus | `AppShell.tsx:24-32,181-250`; nav is responsive; Focus is not listed in `NAV_ITEMS`. | No browser test. | `STATIC FAIL`; `STATIC-ONLY`; `BROWSER BLOCKED`; Focus is hidden/unreachable below `md` (NP-2026-107). |
| W4 Promises | Create promise via contact log | `LogContactDrawer.tsx:182-245`; `promise-create.server.ts`; `api.contact-logs.tsx`. | `api-contact-logs.test.ts`, `promise-create-grace.test.ts`, `contact-log.test.ts`. | `STATIC PASS`; `AUTOMATED`; `BROWSER/PROVIDER BLOCKED` for live account/payment data. |
| W4 Promises | Cancel promise from dashboard detail | `DetailPanel.tsx:1020-1058`; `api.promises.cancel.tsx:14-32`; `promise-cancel.server.ts`. | `api-promises-cancel.test.ts`, promise tests. | `STATIC PASS`; `AUTOMATED`; browser confirmation/stale state blocked. |
| W4 Promises | Cancel from `/promises` page | `PromisesLedger.tsx:1-125`; `promises.tsx:29-216` has no cancel action path. | No route test. | `STATIC FAIL`; `STATIC-ONLY`; `BROWSER BLOCKED`; NP-2026-113/TEMP-WF-018. |
| W4 Promises | Payment-validated evaluate | `promise-evaluation.server.ts`; QBO payment sync in `qbo-sync.server.ts`. | `promise-evaluation-rls.test.ts`, `qbo-sync-payments.test.ts`, `payments-mappers.test.ts`. | `STATIC PASS`; `AUTOMATED` mocks/RLS; `PROVIDER BLOCKED` for live QBO/payment deltas (float/credits NP-2026-046). |
| W4 Promises | Broken-promise alert email | `notifications.server.ts`, `notifications.ts`, `digest-cron.server.ts`. | `notifications.test.ts`, `digest-cron.test.ts`. | `STATIC PASS`; `AUTOMATED`; `PROVIDER BLOCKED` for Resend/env/channel and live cron. |
| W5 Messages | Unified SMS/email inbox | `messages.tsx:46-314`; `MessagesInbox.tsx`; `message-inbox.ts`. | `message-inbox.test.ts`, email inbound/status tests. | `STATIC PASS`; `AUTOMATED`; `BROWSER/PROVIDER BLOCKED` for live threads. |
| W5 Messages | Poll while open | `messages.tsx`/`MessagesInbox.tsx` have no polling effect; loader only on navigation. | No polling test. | `STATIC FAIL`; `STATIC-ONLY`; `BROWSER/PROVIDER BLOCKED`; NP-2026-047/TEMP-WF-006. |
| W5 Messages | Read/unread state | `message-inbox.ts` carries thread data; no read mutation route/state. | No read-state test. | `STATIC FAIL`; `STATIC-ONLY`; browser/provider blocked; NP-2026-047. |
| W5 Messages | Reply consent posts customerId | `MessageThreadPanel.tsx:100-310`; `/api/sms-consent`, `/api/text/send`, `/api/email/send`. | `api-sms-consent.test.ts`, send/gate tests. | `STATIC PASS`; `AUTOMATED`; provider delivery/browser composer blocked. |
| W6 Bulk | Bulk assign org-pinned | `BulkActionBar.tsx:1-79`; `api.bulk-assign.tsx:21-64`; `bulk.ts`. | `api-bulk-assign.test.ts`, `bulk.test.ts`. | `STATIC PASS`; `AUTOMATED`; browser selection/error summary blocked. |
| W6 Bulk | Bulk SMS review + server recheck | `BulkSmsDrawer.tsx:49-170`; `api.bulk-sms.tsx:31-96`; `bulk-send.server.ts`. | `bulk-send.test.ts`, `bulk.test.ts`, `twilio-send.test.ts`. | `STATIC PASS` for gate/recheck; `AUTOMATED`; provider/browser blocked. |
| W6 Bulk | Skip summary and per-case errors | `bulk-send.server.ts` result mapping; `BulkSmsDrawer.tsx` summary; API response. | `bulk-send.test.ts` does not lock the required summary. | `STATIC FAIL`; `AUTOMATED` partial; do-not-text omission and swallowed case errors NP-2026-108/123. |
| W7 Accounts | Directory → profile | `accounts.tsx`, `accounts.$id.tsx`, `AccountsDirectory.tsx`, `AccountProfile.tsx`. | `accounts.test.ts`. | `STATIC PASS`; `AUTOMATED`; QBO data/browser responsive path blocked. |
| W7 Accounts | Save communication prefs preserves all flags | `AccountProfile.tsx:121-141`; `api.comm-prefs.tsx:26-82`; migration 0021. | `api-comm-prefs.test.ts` exposes omission. | `STATIC FAIL`; `AUTOMATED`; do-not-email wipe NP-2026-003. |
| W7 Accounts | NudgePay-only notes | `AccountProfile.tsx:145-158`; `api.account-notes.tsx:6-40`. | `api-account-notes.test.ts`, schema test. | `STATIC PASS`; `AUTOMATED`; browser save feedback blocked. |
| W7 Accounts | Member cannot edit QBO source fields | `0032_security_hardening.sql:51-89` trigger/policies; `accounts.$id.tsx` member UI. | RLS/account tests. | `STATIC PASS`; `AUTOMATED` RLS subset; fresh migration/DB environment blocked. |
| W8 Settings | Owner/member read/write split | `workspace.server.ts:14-45`; `settings.tsx:28-364`; `api.org-settings.tsx:17-187`. | `org-settings-rls.test.ts`, `org-settings.test.ts`, settings action tests. | `STATIC PASS`; `AUTOMATED`; browser member/owner navigation and live DB blocked. |
| W8 Settings | Company/profile/channels/rules/holidays | Forms in `CompanyProfileForm.tsx`, `CollectionsRulesForm.tsx`; intents lines 30-99. | `org-profile`, `org-settings`, `holiday-action`, settings RLS tests. | `STATIC PASS`; `AUTOMATED`; browser validation/flash blocked. |
| W8 Settings | Late fees/thresholds/workflow/quiet hours | Forms and `api.org-settings.tsx:64-126`; pure math/config modules. | `late-fees`, `priority`, `save-workflow`, `quiet-hours`, org settings tests. | `STATIC PASS`; `AUTOMATED`; min/flash/contrast/browser gaps NP-2026-045/115. |
| W8 Settings | Email/templates/test messages | `EmailSettingsSection.tsx`, `TemplateEditor.tsx`, `api.org-settings.tsx:128-180`, `api.test-message.tsx:22-89`. | `save-email.action`, `email-settings`, `message-templates`, `test-message` tests. | `STATIC PASS`; `AUTOMATED`; Resend/Twilio provider and preview/browser blocked; fake tabs/no preview NP-2026-026/117. |
| W8 Settings | Sender settings / dirty tab switch | `SmsSettingsSection.tsx`; `settings-tabs.tsx`; `SettingsTabs.tsx:1-56`. | `settings-tabs.test.ts`, channel tests. | `STATIC FAIL`; `AUTOMATED` tab helper only; sender locked NP-2026-142 and dirty-switch NP-2026-116. |
| W8 Settings | Live settings save | Supabase upserts via `api.org-settings.tsx`; RLS migration set. | Local mocked/action/RLS tests only. | `PROVIDER/ENVIRONMENT/BROWSER BLOCKED`; no live DB save evidence. |
| W9 Reports | Owner 7/30/90 reports | `reports.tsx:21-251`; `reports.ts`. | `reports.test.ts`. | `STATIC PASS`; `AUTOMATED`; browser table/CSV blocked. |
| W9 Reports | Member denied redirect/banner | `workspace.server.ts` owner gate; `reports.tsx`; AppShell nav. | `reports.test.ts`; no browser route test. | `STATIC PASS` source; `AUTOMATED` helper; `BROWSER BLOCKED`; member “coming soon” nav remains NP-2026-101. |
| W9 Reports | CSV export | `reports.tsx` export link/action wiring. | `reports.test.ts` covers calculations, not download. | `STATIC FAIL`; `AUTOMATED` data only; browser/download blocked, NP-2026-048. |
| W10 Public/legal | Worker privacy/EULA | `privacy.tsx`, `eula.tsx`, `routes.ts:19-20`. | No route-render test. | `STATIC PASS`; `STATIC-ONLY`; `BROWSER BLOCKED` for public rendering. |
| W10 Public/legal | Netlify privacy/EULA redirects | `netlify/_redirects` points to `WORKER_PROD_URL_PLACEHOLDER`. | No deploy test. | `STATIC FAIL`; `STATIC-ONLY`; `ENVIRONMENT BLOCKED`; live host 404/placeholder NP-2026-009. |
| W10 Public/legal | Unsubscribe GET safe / POST mutates | `unsubscribe.tsx:14-71`; HMAC token helper. | `unsubscribe.route.test.ts`, `unsubscribe-token.test.ts`. | `STATIC PASS`; `AUTOMATED`; provider/mailed-link and browser confirmation blocked. |
| W10 Public/legal | QBO disconnect GET non-mutating | `api.qbo.disconnect.tsx:32-49`; GET uses optional user and no mutation. | `qbo-connection.test.ts`; no route GET test. | `STATIC PASS`; `STATIC-ONLY`; provider/browser blocked. |
| W11 Auth lockouts | Forgot password | `login.tsx:22-92` has no forgot-password action/link. | No test. | `STATIC FAIL`; `STATIC-ONLY`; `PROVIDER/BROWSER BLOCKED`; NP-2026-001. |
| W11 Auth lockouts | Confirm landing | `signup.tsx` confirm card only; no dedicated confirm route. | No test. | `STATIC FAIL`; `STATIC-ONLY`; `PROVIDER/BROWSER BLOCKED`; NP-2026-002. |
| W11 Auth lockouts | Avatar/logout | `AppShell.tsx:155-162` POSTs logout from avatar. | No browser test. | `STATIC FAIL` UX; `STATIC-ONLY`; `BROWSER BLOCKED`; instant logout NP-2026-102. |
| W11 Auth lockouts | Invite expiry/wrong-user | `accept.$token.tsx:23-106`; invite expiry migration 0032. | No route test; invite/org helpers only. | `STATIC PASS` source; `STATIC-ONLY`; `PROVIDER/ENVIRONMENT/BROWSER BLOCKED`. |
| W12 Failure honesty | PostgREST loader error | Dashboard/account/workspace loaders and empty-state components. | No route-level error test. | `STATIC FAIL`; `STATIC-ONLY`; `ENVIRONMENT/BROWSER BLOCKED`; empty `$0`/swallowed errors NP-2026-015. |
| W12 Failure honesty | Missing Twilio env | `env.server.ts`, `api.text.send.tsx`, `api.bulk-sms.tsx`, `twilio-client.server.ts`. | Gate/send tests cover configured/mocked paths. | `STATIC FAIL`; `AUTOMATED` partial; `PROVIDER BLOCKED`; missing env yields 500 not clear 4xx (TEMP-WF-009). |
| W12 Failure honesty | Missing email env | `email-client.server.ts`, `notifications.server.ts`, `api.email.send.tsx`. | `email-client`, notification, email gate tests. | `STATIC PASS` graceful alert degradation; `AUTOMATED`; provider absence/delivery blocked. |
| W12 Failure honesty | Sync errors in chrome | `SyncIssues.tsx`; `/api/sync-errors/dismiss`; `settings.tsx` integration composition. | `sync-errors*.test.ts`, dismiss test. | `STATIC FAIL`; `AUTOMATED` server path only; component is not mounted (NP-2026-023). |
| W12 Failure honesty | QBO/Resend/Twilio webhook rejects | `webhooks.qbo.tsx`, `webhooks.twilio.*.tsx`, `webhooks.resend.tsx` signature paths. | `qbo-webhook`, Twilio webhook/inbound, Resend webhook route tests. | `STATIC PASS`; `AUTOMATED` signature/parser tests; `PROVIDER BLOCKED` for real payload, public URL, replay, and delivery. |

## Release interpretation

- W1, W2, W3, W4, W5, W6, W7, W8, W9, W10, W11, and W12 all contain at least one
  `BROWSER BLOCKED` or `PROVIDER BLOCKED` step. Therefore no workflow is live-green.
- `AUTOMATED` rows are stronger than source-only rows but do not establish browser,
  deployed Worker/Node, real Supabase, or provider behavior.
- The current HEAD adds a secondary Node/Render route (`server.js`), build-target
  switch (`vite.config.ts`), and two disabled Render cron definitions (`render.yaml`).
  Those additions do not provide live workflow evidence and do not remove the
  Cloudflare primary's two Wrangler schedules.
- Highest-impact current static failures remain: no initial QBO sync/flash handling,
  do-not-email wipe, inbox no-poll/read state, page-level promise cancel, bulk error
  honesty, missing SyncIssues mount, forgot-password/confirm landing, and production
  URL/Netlify placeholders.
