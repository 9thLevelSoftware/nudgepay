# Production-readiness coverage matrix

Audit snapshot: `88b9baca35be5b8d9235b2f96863150ef3a67ad1` (`2026-08-20`).
This is a source-and-test inventory, not a live certification. No authenticated
browser, provider, Docker, local Supabase, or deployed environment was used. A later
supplemental anonymous Playwright pass and local Node rehearsal are recorded in the
evidence log; they do not change blocked authenticated rows. The August production
audit corpus at `docs/production-audit-2026-08-20/` was reconciled as a comparison;
its `820fb1ba` findings are retained below only where they still describe current
source. `88b9baca` adds the Node/Render path and does not change route/component
behavior.

## Evidence key and scope

| State | Meaning |
|---|---|
| `STATIC PASS` | Current source has a coherent path; this never means the path was exercised live. |
| `AUTOMATED` | A named Vitest test covers some source behavior. It may still be unit, integration, or RLS-only. |
| `STATIC GAP` | Current source exposes a missing, misleading, or inconsistent path. |
| `BROWSER BLOCKED` | Requires authenticated click-through, responsive rendering, hydration, focus, or screen-reader observation. |
| `PROVIDER BLOCKED` | Requires Supabase Auth, QuickBooks, Twilio, Resend, or production secrets/payloads. |
| `ENVIRONMENT BLOCKED` | Requires Docker/local Supabase, `.env.test`, CI, or a deploy target. |

Inventory totals: 44 registered React Router routes (`nudgepay-app/app/routes.ts:3-48`),
39 components, 87 library modules (51 pure and 36 `.server.ts`), 109 Vitest specs,
34 sequential migrations, 23 application tables, and 5 runtime/build entrypoints
plus the two Render cron entries. There are no Playwright/Cypress specs.

## 1. React Router route/action coverage (44 path rows + 3 boundary rows)

| # | Path / source | Current coded behavior | Tests/evidence | State, environment, and gap |
|---:|---|---|---|---|
| 1 | `/` — `app/routes/home.tsx:1-38` | Public marketing links to signup/login and legal pages. | `routes-registration.test.ts`; no route-render test. | `STATIC PASS`; `BROWSER BLOCKED` for visual copy/metadata. Thin marketing and missing description/OG remain NP-2026-104/131. |
| 2 | `/signup` — `app/routes/signup.tsx:21-110` | Public signup; session branch redirects, confirm-email branch renders a card. | `auth-flow.test.ts`; no action round-trip. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for confirmation delivery and `BROWSER BLOCKED` for form/hydration. Public POST does not call `requireSameOrigin`. |
| 3 | `/login` — `app/routes/login.tsx:22-92` | Public password login; return-to and org resolution choose destination. | `auth-flow.test.ts`, `return-to.test.ts`; no browser action test. | `STATIC PASS` / `AUTOMATED`; `BROWSER BLOCKED` for CSRF origin and session UI. Forgot-password path is absent (NP-2026-001). |
| 4 | `/logout` — `app/routes/logout.tsx:5-14` | POST signs out; GET redirects to login. | No direct route test. | `STATIC PASS`; `BROWSER BLOCKED` for avatar behavior. Public POST bypasses same-origin check; avatar is an instant logout control (NP-2026-102). |
| 5 | `/onboarding` — `app/routes/onboarding.tsx:20-55` | Authenticated org-less user creates org, owner membership, and defaults; existing org redirects. | `onboarding.test.ts`; service-client bootstrap is source-covered. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for Auth/DB transaction and `BROWSER BLOCKED` for first-run flow. |
| 6 | `/invite` — `app/routes/invite.tsx:19-64` | Owner-only invite creation; loader shows invite form/list. | `orgs.test.ts` covers member labels; no route/action test. | `STATIC PASS`; `PROVIDER BLOCKED` for invite email delivery and `BROWSER BLOCKED` for error/copy. “Sending…”/unlinked invite path remains NP-2026-018. |
| 7 | `/accept/:token` — `app/routes/accept.$token.tsx:23-106` | Authenticated invitee reads token and accepts membership via service client. | No direct route test. | `STATIC PASS`; `PROVIDER BLOCKED` for Auth/invite DB and `BROWSER BLOCKED` for expired/wrong-user screens. |
| 8 | `/dashboard` — `app/routes/dashboard.tsx:161-668` | QBO-connected org loads queue, metrics, roster, presence, and flash params. | `dashboard-worklist.test.ts`, `cases.test.ts`, `worklist.test.ts`, `coming-due.test.ts`, `focus-queue.test.ts`; no route loader test. | `STATIC PASS` / `AUTOMATED`; `BROWSER BLOCKED` for hydration/keyboard/mobile. Empty copy, error-to-$0, ignored `qbo`/`sync` flashes remain NP-2026-015/017/105. |
| 9 | `/focus` — `app/routes/focus.tsx:44-470` | QBO-gated focused queue with 1/2/3/space actions and drawers. | `focus-queue.test.ts`, `focus-session.test.ts`, `use-focus-keys` behavior is indirectly covered. | `STATIC PASS` / `AUTOMATED`; `BROWSER BLOCKED` for mobile reachability, focus, and live collision. Focus hidden below `md` (NP-2026-107). |
| 10 | `/accounts` — `app/routes/accounts.tsx:35-219` | QBO-gated searchable/filterable account directory. | `accounts.test.ts`; no loader/render test. | `STATIC PASS` / `AUTOMATED`; `BROWSER BLOCKED` for 390px table/cards and search label. Metrics overclaim remains NP-2026-051. |
| 11 | `/accounts/:id` — `app/routes/accounts.$id.tsx:81-361` | Loads account profile, invoices, case detail, notes, comm prefs, assignment. | `accounts.test.ts`, `api-account-notes.test.ts`, `api-assign.test.ts`, `api-comm-prefs.test.ts`; no full route test. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for live synced data; profile omits `do_not_email` (NP-2026-003). |
| 12 | `/promises` — `app/routes/promises.tsx:29-216` | QBO-gated ledger with lifecycle filters and selection panel. | `promises.test.ts`, `promise-ledger.test.ts`, `api-promises-cancel.test.ts`. | `STATIC PASS` / `AUTOMATED`; `BROWSER BLOCKED` for cancel affordance. Cancel on page is absent (NP-2026-113). |
| 13 | `/messages` — `app/routes/messages.tsx:46-314` | QBO-gated SMS/email inbox, filters, thread panel, consent and reply actions. | `message-inbox.test.ts`, `email-inbound-status.test.ts`, `api-sms-consent.test.ts`; no route/render test. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for provider callbacks and `BROWSER BLOCKED` for polling/read state. No polling/read state (NP-2026-047). |
| 14 | `/reports` — `app/routes/reports.tsx:21-251` | Owner-only report loader with 7/30/90-day views and CSV action links. | `reports.test.ts`; no loader/render test. | `STATIC PASS` / `AUTOMATED`; `BROWSER BLOCKED` for tables and member nav. CSV remains broken (NP-2026-048); “coming soon” member nav remains NP-2026-101. |
| 15 | `/settings` — `app/routes/settings.tsx:28-364` | Org/member settings loader composes tabs, config, templates, sync issues, and chrome. | `settings-tabs.test.ts`, `org-settings.test.ts`, `org-config.test.ts`, `save-email.action.test.ts`, `save-workflow.action.test.ts`, `holiday-action.test.ts`, `message-templates.test.ts`. | `STATIC PASS` / `AUTOMATED`; `BROWSER BLOCKED` for dirty-tab/focus/zoom. Dirty tab switch and template preview gaps remain NP-2026-116/117. |
| 16 | `/privacy` — `app/routes/privacy.tsx:1-63` | Public Worker legal page. | No route test. | `STATIC PASS`; `BROWSER BLOCKED` for typography/mobile; Netlify redirect is unresolved placeholder (NP-2026-009), and copy is private-beta/Resend-incomplete (NP-2026-104/141). |
| 17 | `/eula` — `app/routes/eula.tsx:1-41` | Public Worker EULA page. | No route test. | `STATIC PASS`; `BROWSER BLOCKED` for prose/mobile; Netlify redirect placeholder remains. |
| 18 | `/api/contact-logs` — `app/routes/api.contact-logs.tsx:9-83` | Auth/org-scoped parser, collision confirmation, contact log insert, promise/next-step transition; JSON mode for Focus. | `api-contact-logs.test.ts`, `contact-log.test.ts`, `collision.test.ts`, `next-step.test.ts`, `promise-create-grace.test.ts`. | `STATIC PASS` / `AUTOMATED`; `BROWSER BLOCKED` for drawer focus/collision. Terminal DNC contact blocking remains NP-2026-144. |
| 19 | `/api/sms-consent` — `app/routes/api.sms-consent.tsx:6-56` | Auth/org-scoped customer opt-in/out update. | `api-sms-consent.test.ts`, `sms-gate.test.ts`. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for consent round-trip. |
| 20 | `/api/comm-prefs` — `app/routes/api.comm-prefs.tsx:26-82` | Auth/org-scoped communication preferences update. | `api-comm-prefs.test.ts`, `comm-prefs-schema.test.ts`, `comm-prefs.test.ts`. | `STATIC GAP` / `AUTOMATED`; omitted `do_not_email` can write false and wipe opt-out (NP-2026-003). |
| 21 | `/api/org-settings` — `app/routes/api.org-settings.tsx:17-187` | Owner-only 14-intent settings action: profile, channels, sender lock, quiet hours, rules, holidays, late fees, thresholds, workflow, email, template CRUD/reset. | `org-settings.test.ts`, `org-settings-rls.test.ts`, `holiday-action.test.ts`, `save-email.action.test.ts`, `save-workflow.action.test.ts`, `message-templates.test.ts`. | `STATIC PASS` for implemented intents / `AUTOMATED`; sender is intentionally locked (NP-2026-142), dirty flash/copy gaps NP-2026-115/116. Live DB writes `PROVIDER/ENVIRONMENT BLOCKED`. |
| 22 | `/api/assign` — `app/routes/api.assign.tsx:6-42` | Auth/org-scoped case assignment with org-pinned update. | `api-assign.test.ts`. | `STATIC PASS` / `AUTOMATED`; `BROWSER BLOCKED` for stale form/flash. |
| 23 | `/api/bulk-assign` — `app/routes/api.bulk-assign.tsx:21-64` | Auth/org-scoped bulk owner assignment. | `api-bulk-assign.test.ts`, `bulk.test.ts`. | `STATIC PASS` / `AUTOMATED`; `BROWSER BLOCKED` for selection/error summary. |
| 24 | `/api/priority-override` — `app/routes/api.priority-override.tsx:8-48` | Auth/org-scoped per-case priority override. | `api-priority-override.test.ts`, `priority.test.ts`. | `STATIC PASS` / `AUTOMATED`; threshold/min mismatch remains NP-2026-045. |
| 25 | `/api/sync-errors/dismiss` — `app/routes/api.sync-errors.dismiss.tsx:6-30` | Auth/org-scoped member dismisses a sync error. | `api-sync-errors-dismiss.test.ts`, `sync-errors-wiring.test.ts`. | `STATIC PASS` / `AUTOMATED`; `BROWSER BLOCKED` because SyncIssues is not mounted on integrations (NP-2026-023). |
| 26 | `/api/presence/heartbeat` — `app/routes/api.presence.heartbeat.tsx:8-30` | Auth/org-scoped presence upsert; org-less returns 204. | `api-presence-heartbeat.test.ts`, `presence.test.ts`. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for multi-user timing/collision. |
| 27 | `/api/promises/cancel` — `app/routes/api.promises.cancel.tsx:14-32` | Auth/org-scoped promise cancellation. | `api-promises-cancel.test.ts`, `promise-cancel` behavior in promise tests. | `STATIC PASS` / `AUTOMATED`; page-level cancel path remains absent (NP-2026-113). |
| 28 | `/api/qbo/connect` — `app/routes/api.qbo.connect.tsx:8-28` | Owner-only POST creates bound OAuth state and redirects to Intuit. | `oauth-state.test.ts`, `qbo-connection.test.ts`; no action route test. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for Intuit redirect. |
| 29 | `/api/qbo/disconnect` — `app/routes/api.qbo.disconnect.tsx:14-49` | Owner POST decrypts/revokes/clears connection; GET is a non-mutating public-ish redirect. | `qbo-connection.test.ts`; no route test. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for token revoke; no confirmation affordance (NP-2026-043). |
| 30 | `/api/qbo/refresh` — `app/routes/api.qbo.refresh.tsx:11-67` | Auth/org member manual bounded sync, sync-error writes, optional alerts. | `qbo-sync*.test.ts`, `sync-errors*.test.ts`, `provider-status.test.ts`. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for QBO API/payment CDC and stale flash. |
| 31 | `/auth/qbo/callback` — `app/routes/auth.qbo.callback.tsx:9-38` | GET validates bound state/org/user/owner, exchanges code, stores encrypted tokens, redirects with qbo flash. | `oauth-state.test.ts`, `qbo-client.test.ts`, `qbo-connection.test.ts`; no callback action/redirect test. | `STATIC GAP` / `AUTOMATED` helper coverage only; `PROVIDER BLOCKED` for Intuit OAuth and first sync. Callback does not sync and ignores flash (`NP-2026-005/017`). |
| 32 | `/webhooks/qbo` — `app/routes/webhooks.qbo.tsx:12-77` | Verifies Intuit signature, maps realm to org, applies CDC, returns status. | `qbo-webhook.test.ts`, `webhooks-route.test.ts`. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for real CloudEvent/body shape and production signature. |
| 33 | `/api/text/send` — `app/routes/api.text.send.tsx:15-59` | Auth/org-scoped SMS gate + Twilio send + ledger insert. | `api-text-send.test.ts`, `sms-gate.test.ts`, `twilio-send.test.ts`. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for Twilio signatures/sender routing; missing env returns 500 rather than 4xx (TEMP-WF-009). |
| 34 | `/api/email/send` — `app/routes/api.email.send.tsx:8-46` | Auth/org-scoped email gate, template/ledger, Resend send and unsubscribe token. | `email-messaging.gate.test.ts`, `email-settings.test.ts`, `email-templates.test.ts`. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for Resend delivery and inbound status. |
| 35 | `/unsubscribe` — `app/routes/unsubscribe.tsx:14-71` | Public HMAC-token GET confirmation and POST-only mutation. | `unsubscribe.route.test.ts`, `unsubscribe-token.test.ts`. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for mailed-link round-trip; no same-origin check is intentional token-based public flow. |
| 36 | `/api/account-notes` — `app/routes/api.account-notes.tsx:6-40` | Auth/org-scoped NudgePay-only notes update. | `api-account-notes.test.ts`, `account-notes-schema.test.ts`. | `STATIC PASS` / `AUTOMATED`; `BROWSER BLOCKED` for save feedback. |
| 37 | `/api/bulk-sms` — `app/routes/api.bulk-sms.tsx:31-96` | Auth/org-scoped server recheck, capped batch SMS, per-case outcome summary. | `bulk-send.test.ts`, `bulk.test.ts`, `twilio-send.test.ts`. | `STATIC GAP` / `AUTOMATED`; skip summary omits do-not-text and per-case errors are swallowed (NP-2026-108/123); provider send blocked. |
| 38 | `/webhooks/twilio/inbound` — `app/routes/webhooks.twilio.inbound.tsx:13-35` | Verifies Twilio signature, records inbound/STOP/HELP. | `twilio-inbound.test.ts`, `twilio-webhook.test.ts`, `webhooks-route.test.ts`. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for public URL signature and unmatched STOP persistence (NP-2026-004). |
| 39 | `/webhooks/twilio/status` — `app/routes/webhooks.twilio.status.tsx:11-33` | Verifies signature and updates message status. | `twilio-webhook.test.ts`, `webhooks-route.test.ts`. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for provider callback delivery. |
| 40 | `/webhooks/resend` — `app/routes/webhooks.resend.tsx:8-37` | Verifies Svix signature, updates outbound status or records inbound mail. | `resend-webhook.test.ts`, `webhooks-resend.test.ts`, `webhooks-route.test.ts`. | `STATIC GAP` / `AUTOMATED`; current test/event mapping encodes wrong Resend event names (NP-2026-014); provider payload blocked. |
| 41 | `/api/profile` — `app/routes/api.profile.tsx:6-29` | Auth/org-scoped profile update. | `org-profile.test.ts`. | `STATIC PASS` / `AUTOMATED`; `BROWSER BLOCKED` for save/validation feedback. |
| 42 | `/api/notification-prefs` — `app/routes/api.notification-prefs.tsx:10-42` | Auth/org-scoped self-only notification preference update. | `notification-prefs` behavior covered in `notifications.test.ts`/schema tests; no direct route test. | `STATIC PASS`; `ENVIRONMENT BLOCKED` for RLS round-trip and `BROWSER BLOCKED` for form status. |
| 43 | `/api/test-message` — `app/routes/api.test-message.tsx:22-89` | Owner-only test SMS/email intents; GET redirects to settings. | `test-message.test.ts`, `twilio-send.test.ts`, `email-client.test.ts`. | `STATIC PASS` / `AUTOMATED`; `PROVIDER BLOCKED` for real sender/provider response. |
| 44 | `/healthz` — `app/routes/healthz.tsx:3-8` | Public JSON `{ ok: true }` health endpoint. | No direct test. | `STATIC PASS`; deploy/load-balancer behavior `ENVIRONMENT BLOCKED`. |
| 45 | `/api/...` registration boundary — `app/routes.ts:21-46` | All resource actions use POST forms; GET loaders redirect where defined. | `routes-registration.test.ts`. | `STATIC PASS` / `AUTOMATED`; no exhaustive method/auth contract test. |
| 46 | Root layout/error boundary — `app/root.tsx` (Layout/ErrorBoundary) | Global shell and 404/500 rendering; no auth loader. | No root/browser test. | `BROWSER BLOCKED`; dev-only stack exposure and anonymous 404 CTA require browser/runtime observation. |
| 47 | Route build manifest — `app/routes.ts:3-48` | React Router route registration includes all public, authenticated, API, webhook, and health surfaces. | `routes-registration.test.ts`. | `AUTOMATED`; build/runtime manifest verification still `ENVIRONMENT BLOCKED` for Cloudflare and Node targets. |

Rows 45–47 are boundary rows, not additional URL paths. Rows 1–44 correspond to
the 44 `index()`/`route()` calls in `app/routes.ts`; the source registration itself
is authoritative, rather than the stale 47-entry count in the earlier August map.

## 2. Component coverage (all 39 files)

Component tests are mostly indirect through pure-module and route tests. No component
has a browser interaction test. `STATIC PASS` below means the component is imported
and its source contract was inspected; it does not certify focus, layout, hydration,
or screen-reader behavior.

| Component source | Role / inspected evidence | Automated evidence and current gap |
|---|---|---|
| `AccountProfile.tsx:1-219` | Profile metrics, assignment, comm prefs, notes, invoices. | API/schema tests only; missing `do_not_email`, no browser form feedback (NP-2026-003). |
| `AccountQuickPanel.tsx:1-45` | Compact account summary/navigation. | No direct test; browser-only responsive/focus behavior. |
| `AccountsDirectory.tsx:1-133` | Search/filter tabs and responsive account list. | `accounts.test.ts`; placeholder-as-label and mobile layout browser-unverified. |
| `AccountsMetrics.tsx:1-15` | Summary metric tiles. | No direct test; data semantics covered by accounts source only. |
| `AppShell.tsx:1-269` | Header, nav, skip link, mobile menu, sign-out. | No browser test; Focus nav omission below `md` and instant avatar logout remain. |
| `BulkActionBar.tsx:1-79` | Bulk owner assignment/SMS controls. | `bulk.test.ts`; selection keyboard/errors browser-unverified. |
| `BulkSmsDrawer.tsx:1-170` | Modal batch-SMS review/confirm. | `bulk-send.test.ts`; dialog source uses `useDialog`, provider/browser blocked. |
| `CollectionsRulesForm.tsx:1-117` | Rules/holidays owner form. | `holiday-action.test.ts`, `org-settings.test.ts`; dirty tab/browser-unverified. |
| `ComingDueList.tsx:1-85` | Coming-due invoice list. | `coming-due.test.ts`; visual/empty state browser-unverified. |
| `CommPrefsDrawer.tsx:1-79` | Communication-preference modal. | `comm-prefs*.test.ts`; do-not-email action path is not wired in profile (NP-2026-003). |
| `CompanyProfileForm.tsx:1-158` | Company profile form. | `org-profile.test.ts`; browser validation/focus unverified. |
| `DetailPanel.tsx:1-1254` | Selected account tabs, contact actions, message/email, promise controls. | Broad domain/API tests; no component test, mobile and screen-reader semantics blocked. |
| `EmailSettingsSection.tsx:1-166` | Email config form/test. | `save-email.action.test.ts`, `email-settings.test.ts`; provider/browser blocked. |
| `Icons.tsx:1-150` | SVG icon set. | No direct test; decorative/label usage inspected in callers. |
| `KpiBand.tsx:1-112` | Dashboard KPI tiles and view links. | `dashboard-worklist.test.ts`; live metrics/error honesty browser/provider blocked. |
| `LateFeesForm.tsx:1-72` | Late-fee settings. | `late-fees.test.ts`, `org-settings.test.ts`; unlabeled/contrast and browser validation unverified. |
| `LogContactDrawer.tsx:1-272` | Contact log, collision confirmation, next steps. | `api-contact-logs.test.ts`, `collision.test.ts`; focus trap source only, browser blocked. |
| `MessageBubbles.tsx:1-40` | Thread bubble rendering. | `message-inbox.test.ts`; timestamps/read state/browser-unverified. |
| `MessagesInbox.tsx:1-160` | Inbox tabs/filter/list. | `message-inbox.test.ts`; no polling/read state (NP-2026-047). |
| `MessagesMetrics.tsx:1-14` | Message metrics. | No direct test; provider data/browser blocked. |
| `MessageThreadPanel.tsx:1-310` | Reply composer and thread state. | send/gate tests; no live polling/read state and provider blocked. |
| `MetricTile.tsx:1-89` | Reusable metric link/status tile. | No direct component test; aria/link behavior browser-unverified. |
| `NotificationPrefsForm.tsx:1-61` | User notification preferences. | Schema/prefs tests; no route/UI/browser test. |
| `PriorityThresholdsForm.tsx:1-84` | Priority threshold form. | `priority.test.ts`, `org-settings.test.ts`; min/flash/browser gaps (NP-2026-045). |
| `PromiseQuickPanel.tsx:1-95` | Promise create/cancel quick panel. | Promise create/cancel tests; page-level cancel/browser blocked. |
| `PromisesLedger.tsx:1-125` | Promise lifecycle filters/list. | `promise-ledger.test.ts`, `promises.test.ts`; table semantics/viewport blocked. |
| `PromisesMetrics.tsx:1-16` | Promise metric tiles. | No direct test; provider/browser blocked. |
| `PublicLayout.tsx:1-27` | Public page wrapper. | No direct test; legal/mobile typography browser-unverified. |
| `QuietHoursForm.tsx:1-82` | Quiet-hour config. | `quiet-hours.test.ts`, `org-settings.test.ts`; browser validation blocked. |
| `SettingsTabs.tsx:1-56` | Settings tab links/active state. | `settings-tabs.test.ts`; no unsaved-change guard/arrow tabs (NP-2026-116/136). |
| `SmsSettingsSection.tsx:1-152` | SMS channel/sender/test controls. | channel/test-message tests; sender intentionally locked (NP-2026-142), provider blocked. |
| `SyncIssues.tsx:1-104` | Sync error list/dismiss. | `sync-errors*.test.ts`; source is not mounted on integrations (NP-2026-023). |
| `TemplateEditor.tsx:1-276` | SMS/email template CRUD/reset. | `message-templates.test.ts`; fake tabs/no preview (NP-2026-026/117). |
| `ThermalBand.tsx:1-36` | Heat/status visual band. | No direct test; color/contrast/browser blocked. |
| `TriageStrip.tsx:1-78` | Queue triage indicators. | No direct test; visual/contrast/browser blocked. |
| `ui.tsx:1-28` | Button primitive. | No direct test; keyboard/contrast browser-unverified. |
| `WebhookUrlField.tsx:1-36` | Copyable webhook URL field. | No direct test; clipboard/browser blocked. |
| `WorkflowSettingsForm.tsx:1-77` | Workflow knob form. | `save-workflow.action.test.ts`; browser validation/status blocked. |
| `WorkQueue.tsx:1-714` | Saved views, sort/search, desktop list/mobile cards, bulk actions, j/k/x. | `dashboard-worklist.test.ts`, `worklist.test.ts`; visual keyboard/mobile and live-region behavior browser blocked. |

Shared interaction hooks: `app/lib/use-dialog.ts:1-61` implements Escape, Tab
trapping, and focus return; `use-queue-keys.ts:1-36` and `use-focus-keys.ts:1-36`
guard editable fields/dialogs. These are source evidence only until browser and
screen-reader checks run.

## 3. Library-module coverage (all 87 files)

| Domain / source inventory | Test evidence | State and gaps |
|---|---|---|
| Pure queue/case: `accounts.ts`, `bulk.ts`, `cases.ts`, `coming-due.ts`, `collision.ts`, `exceptions.ts`, `focus-queue.ts`, `focus-session.ts`, `next-best-action.ts`, `priority.ts`, `promise-ledger.ts`, `promises.ts`, `worklist.ts` | `accounts`, `bulk`, `cases`, `case-exceptions`, `collision`, `coming-due`, `exceptions`, `focus-queue`, `focus-session`, `next-best-action`, `priority`, `promise-ledger`, `promises`, `dashboard-worklist`, `worklist` specs. | `AUTOMATED` pure behavior; route/render and real data remain browser/provider blocked. |
| Pure forms/config: `channel-actions.ts`, `channel-settings.ts`, `comm-prefs.ts`, `contact-log.ts`, `email-events.ts`, `email-settings.ts`, `email-templates.ts`, `labels.ts`, `late-fees.ts`, `message-templates.ts`, `notification-prefs.ts`, `org-config.ts`, `org-profile.ts`, `org-settings.ts`, `quiet-hours.ts`, `reports.ts`, `sms-gate.ts`, `sms-send-reason.ts`, `sms-templates.ts`, `status-style.ts`, `worklist.ts` | Matching schema/config/settings/template/report/gate tests. | `AUTOMATED` mostly; missing route action coverage and browser validation/status. `email-events.test.ts` has stale event-name contract (NP-2026-014). |
| Pure utility/UX: `business-days.ts`, `dates.ts`, `focus-session.ts`, `follow-up-cadence.ts`, `format.ts`, `meta.ts`, `names.ts`, `provider-status.ts`, `return-to.ts`, `timeline.ts`, `timezones.ts`, `tz.ts`, `unsubscribe-token.ts`, `use-dialog.ts`, `use-flash-cleanup.ts`, `use-focus-keys.ts`, `use-queue-keys.ts` | Matching utility tests for dates, names, metadata, provider status, return-to, timeline, timezones, token; hooks are source-inspected. | `AUTOMATED` pure utilities; hook and browser rendering `BROWSER BLOCKED`. |
| Auth/session/security server: `auth-flow.server.ts`, `csrf.server.ts`, `crypto.server.ts`, `env.server.ts`, `oauth-state.server.ts`, `orgs.server.ts`, `session.server.ts`, `supabase.server.ts`, `unsubscribe-token.ts` | `auth-flow`, `crypto`, `oauth-state`, `orgs`, `session`, `unsubscribe-token`, RLS specs. | `AUTOMATED` helpers/RLS subset; no browser Origin/cookie/CSRF test, no secret/deploy verification. |
| Workspace/org server: `org-config.server.ts`, `orgs.server.ts`, `org-settings.ts`, `workspace.server.ts`, `presence.server.ts`, `sync-errors.server.ts` | `org-config-loader`, `org-config-server-errors`, `org-config`, `org-settings`, `org-settings-rls`, `orgs`, `presence`, `sync-errors`, `sync-errors-wiring`. | `AUTOMATED` injected/error paths; live DB/RLS and mounted SyncIssues remain blocked. |
| Cases/promises server: `case-lifecycle.server.ts`, `case-queue.server.ts`, `next-step.server.ts`, `promise-cancel.server.ts`, `promise-create.server.ts`, `promise-evaluation.server.ts` | `cases`, `next-step`, `promise-create-grace`, `promise-evaluation-rls`, `promise-ledger`, `promises`, API specs. | `AUTOMATED`; live QBO payment and route/UI path provider/browser blocked. |
| Messaging/email server: `bulk-send.server.ts`, `email-client.server.ts`, `email-messaging.server.ts`, `message-templates.server.ts`, `notifications.server.ts`, `test-message.server.ts`, `twilio-client.server.ts`, `twilio-messaging.server.ts`, `twilio-webhook.server.ts`, `resend-webhook.server.ts` | `bulk-send`, email gate/client/events/inbound/status, notifications, test-message, Twilio send/inbound/webhook, Resend webhook specs. | `AUTOMATED` gates/signature/parser paths; real provider credentials, sender routing, payloads, delivery, retry, and browser state blocked. |
| QBO server: `qbo-api.server.ts`, `qbo-client.server.ts`, `qbo-connection.server.ts`, `qbo-cron.server.ts`, `qbo-mappers.server.ts`, `qbo-sync.server.ts`, `qbo-webhook.server.ts`, `digest-cron.server.ts` | `qbo-api`, `qbo-client`, `qbo-connection`, `qbo-cron`, `qbo-mappers`, `qbo-sync*`, `qbo-webhook`, `digest-cron`, provider-status specs. | `AUTOMATED` mocks/injected dependencies; `PROVIDER BLOCKED` for OAuth, production CDC/CloudEvents, token refresh, payment truth and cron scheduling. Callback still does not initial-sync. |
| Domain pure remaining: `contact-log.ts`, `notifications.ts`, `names.ts`, `message-inbox.ts`, `email-events.ts`, `provider-status.ts`, `status-style.ts`, `timeline.ts`, `labels.ts`, `format.ts` | Named tests listed above. | `AUTOMATED` pure logic only; no visual/live notification/inbox proof. |

The grouped rows enumerate every file in `app/lib`; the server/pure split is by
`.server.ts` suffix. No server module is imported into the client intentionally;
the route/component boundaries were checked while walking imports.

## 4. Runtime, build, and cron coverage

| Source | Current contract | Evidence / state / concern |
|---|---|---|
| `nudgepay-app/workers/app.ts:14-35` | Cloudflare Worker fetch delegates to React Router server build; hourly cron calls digest, all other cron calls CDC via `ctx.waitUntil`. | `STATIC PASS`; `digest-cron.test.ts`, `qbo-cron.test.ts`. Cloudflare deploy/runtime and env secrets `ENVIRONMENT/PROVIDER BLOCKED`. |
| `nudgepay-app/server.js:1-65` | Express 5 Node/Render server loads `build/server/index.js`, serves assets, trusts TLS proxy, preserves raw webhook bodies, injects Cloudflare-shaped context. | Node build/start and loopback public-route/health smoke passed. `BROWSER/ENVIRONMENT BLOCKED` remains for authenticated behavior; trust-proxy, raw-body, readiness, background drain, and production error mode need deployment verification. |
| `nudgepay-app/cron/cdc.ts:1-26` | Node ESM entry runs `runScheduledCdc(process.env)`, logs result, exits after sockets settle. | `STATIC PASS`; no executable cron test. Render scheduling/secrets `ENVIRONMENT/PROVIDER BLOCKED`. |
| `nudgepay-app/cron/digest.ts:1-26` | Node ESM entry mirrors hourly digest branch and exits deterministically. | `STATIC PASS`; no executable cron test. Render scheduling/secrets `ENVIRONMENT/PROVIDER BLOCKED`. |
| `nudgepay-app/scripts/build-cron.mjs:1-27` | esbuild bundles both cron entries to `dist-cron`, Node 22 ESM, externals left in dependencies. | `npm run build:cron` passed and emitted both bundles; scheduler, secrets, and executable provider behavior remain `ENVIRONMENT/PROVIDER BLOCKED`. |
| `nudgepay-app/app/routes.ts:1-48` | 44 route registrations. | `routes-registration.test.ts`; React Router generated manifest still build-environment dependent. |
| `nudgepay-app/vite.config.ts:1-26` | `BUILD_TARGET=node` removes Cloudflare plugin; default retains Worker plugin. | `STATIC PASS`; two-target build matrix unverified. A leaked `BUILD_TARGET=node` would prevent Wrangler manifest generation. |
| `nudgepay-app/render.yaml:13-146` | Secondary Node web service, `npm ci --include=dev`, build + cron bundle, healthcheck; Render cron jobs intentionally commented out. | `STATIC PASS`; Render deploy/secrets/provider blocked. Cloudflare remains primary and owns both schedules; enabling Render crons without removing Wrangler triggers would double-run CDC. |
| `nudgepay-app/package.json:6-46` | Build/check/deploy/start/build:cron scripts; no `test` script; Node `>=22 <25`. | `STATIC PASS`; CI/full suite not established. `npx vitest run` is required by repo instructions. |
| `nudgepay-app/wrangler.toml:1-52` | Worker primary, local vars, production placeholder URL, two cron triggers and documented secret list. | `STATIC GAP` for production config: `SUPABASE_URL` is still `<your-prod-project-ref>`; deploy/secrets blocked. |

## 5. Migration/RLS coverage (34 migrations, 23 tables)

| Migration/source range | Schema/security surface | Automated evidence / state |
|---|---|---|
| `0001_tenancy_schema.sql:1-117`, `0002_rls_policies.sql:1-38` | Organizations, memberships, customers, invoices, contact logs, text messages, QBO connections, messaging config; initial member policies and grants. | `rls.test.ts`, table-specific RLS specs; `ENVIRONMENT BLOCKED` for fresh reset and policy execution. |
| `0003_invites.sql:1-15`, `0004_qbo_oauth.sql:1-17`, `0005_qbo_sync.sql:1-7` | Invite rows/expiry base, OAuth states, encrypted QBO token columns/index. | `oauth-state`, `orgs`, `qbo-connection`; no full migration reset. OAuth states have RLS enabled with no user policies by design/service path. |
| `0006_twilio_messaging.sql:1-13`, `0007_contact_log_promises.sql:1-9`, `0008_customer_owner.sql:1-7`, `0009_collection_cases.sql:1-54` | Message/customer fields, promise fields, collection cases and case RLS. | `twilio`, `contact-log`, `cases`, `cases-rls`; live migration/RLS blocked. |
| `0010_promise_payment_loop.sql:1-93`, `0011_case_exceptions.sql:1-6`, `0012_priority_override.sql:1-9`, `0013_sync_errors.sql:1-40`, `0014_case_presence.sql:1-32`, `0015_case_exception_taxonomy.sql:1-20` | Promise/payment loop, exceptions, priority override, sync errors, presence, nine-state exception taxonomy. | Promise/payment/exception/priority/presence/sync specs; no browser/production DB. |
| `0016_org_scheduling_config.sql:1-55`, `0017_comm_preferences.sql:1-10`, `0018_org_settings_updated_at.sql:1-18`, `0019_account_notes.sql:1-7` | Org settings/holidays, communication flags, updated-at trigger, NudgePay notes. | Config/holiday/comm-prefs/notes specs; RLS execution blocked. |
| `0020_channel_settings.sql:1-31`, `0021_email_outbound.sql:1-30`, `0022_email_hardening.sql:1-13`, `0023_late_fees.sql:1-12`, `0024_notifications.sql:1-55` | Channel/email config, email ledger, postal address, late fees, user prefs and service notification ledger. | Email/late-fee/notification/RLS specs; provider and migration reset blocked. `notification_log` RLS has no user policies by design. |
| `0025_org_profile.sql:1-13`, `0026_message_templates.sql:1-62`, `0027_org_priority_thresholds.sql:1-13`, `0028_org_workflow_knobs.sql:1-12`, `0029_org_digest_schedule.sql:1-9`, `0030_org_quiet_hours.sql:1-11`, `0031_cleanup.sql:1-5` | Profile, templates, thresholds, workflow, digest schedule, quiet hours, email provider cleanup. | Settings/template/quiet-hours specs; no fresh DB reset. |
| `0032_security_hardening.sql:1-226`, `0033_text_message_phone_norm.sql:1-22`, `0034_oauth_state_user_binding.sql:1-12` | Invite expiry/owner write; tightened customer/invoice/payment/QBO policies; composite org FKs; member source-edit trigger; normalized phones; OAuth `user_id NOT NULL`. | `rls`, `cases-rls`, `email-messages.rls`, `messaging-config.rls`, `org-settings.rls`, `promise-evaluation-rls`, `oauth-state`; current deployed schema remains `ENVIRONMENT BLOCKED`. |

RLS policy summary by table: `organizations` owner update; `memberships` member
select; `customers` member read/update and owner insert/delete with source-field
trigger; `invoices`, `payments`, `qbo_connections` member read/owner write;
`contact_logs`, `text_messages`, `collection_cases`, `promises`, `promise_invoices`
member-scoped policies; `sync_errors` member read/update; `case_presence` member
read plus own insert/update; `org_settings`, `org_holidays`, `messaging_config`,
`email_config`, `email_messages`, `message_templates` member read/owner write;
`invites` owner write; `user_notification_prefs` own-row policies; `oauth_states`
and `notification_log` enabled with no user policies (service role only). Source:
`supabase/migrations/0002_rls_policies.sql`, `0003`, `0009`, `0010`, `0013`,
`0014`, `0016`, `0020`, `0021`, `0024`, `0026`, and hardening `0032`.

## 6. Coverage concerns to carry into release gates

1. There is no browser E2E suite; no current evidence proves 1280px/390px layout,
hydration, keyboard focus, screen-reader announcements, or 200%/400% zoom.
2. Provider paths remain unverified: QBO OAuth/CDC/payment truth, Twilio sender and
signature behavior, Resend events/delivery, Supabase confirmation/Auth/RLS.
3. Route actions are under-tested as route modules: many tests exercise pure/server
helpers or RLS only, not the actual `action()`/`loader()` response and redirect.
4. Current static gaps remain: callback does not initial-sync, `qbo`/`sync` flashes are
ignored, communication preference updates can wipe `do_not_email`, inbox does not
poll/read-track, profile omits `do_not_email`, bulk errors are swallowed, sync issues
are not mounted, CSV is broken, and the production Wrangler Supabase URL is a placeholder.
5. The new Render path is secondary and source-consistent, but it has no deployed
smoke evidence; its raw-body/trust-proxy assumptions and disabled cron services need
an explicit release check.
