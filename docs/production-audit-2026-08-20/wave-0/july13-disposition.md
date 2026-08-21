# July 13 → August 20 disposition

Re-read of every finding in [`docs/codebase-audit-2026-07-13.md`](../../codebase-audit-2026-07-13.md) against HEAD `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc` (2026-07-28). Product code since the July 13 audit commit (`87b9c5b`) is a single change: OAuth state user-binding (PR #43 / `0034`). No other blocker, major, or minor was closed by that PR.

Dispositions: **still-open** | **fixed** | **partial** | **superseded**.

File paths are repo-root-relative.

---

## Summary

| Severity | Total | still-open | fixed | partial | superseded |
|---|---|---|---|---|---|
| Blockers B0–B11 | 12 | 12 | 0 | 0 | 0 |
| Majors M1–M34 | 34 | 33 | 0 | 1 | 0 |
| Minors 1–61 | 61 | 59 | 0 | 2 | 0 |
| **All** | **107** | **104** | **0** | **3** | **0** |

Partial: **M25** (0032 already in the July 13 tree tightened some tables; the cited audit-trail tables still `FOR ALL`), **minor 10** (Messages inbox now posts `customerId`; dashboard DetailPanel still does not), **minor 16** (some settings forms have distinct saved markers; Collections rules still has none and still shares `?saved=1` with sibling forms).

No later contrast PR landed after July 13. `app.css` copper token and Focus Mode muted-on-ink classes are unchanged.

---

## Blockers B0–B11

| Prior ID | Title | Disposition | Fresh evidence (file:line) | Notes |
|---|---|---|---|---|
| B0 | No password reset / forgot-password flow | still-open | `nudgepay-app/app/routes.ts:3-47`; `nudgepay-app/app/routes/login.tsx:81-88` | Repo-wide search for `resetPasswordForEmail`, recovery routes, and forgot-password UI is empty outside the July 13 audit doc. `routes.ts` has login/signup/logout only. Login form is email+password with a signup link; no reset link. |
| B1 | Every loader read silently truncates at Supabase's 1,000-row cap | still-open | `nudgepay-app/supabase/config.toml:18`; `nudgepay-app/app/lib/case-queue.server.ts:137-147` | `max_rows = 1000` still set. Dashboard invoice + open-case selects have no `.range()` / high `.limit()`. App-wide `.limit()` usage is only `1` or `20` (settings sync-error cap). Accounts, messages, promises, and inbound customer-candidate reads are similarly unbounded-then-capped. |
| B2 | Truncated reconciliation reads wrongly auto-resolve still-overdue cases | still-open | `nudgepay-app/app/lib/case-lifecycle.server.ts:10-30` | `applyCaseReconciliation` still loads all overdue invoices (no page/count), builds `overdueCustomerIds`, and resolves any open case whose customer is missing from that set. Past 1,000 overdue invoice rows this still auto-closes live work. |
| B3 | Account-profile "Save preferences" silently re-subscribes unsubscribed customers | still-open | `nudgepay-app/app/components/AccountProfile.tsx:120-141`; `nudgepay-app/app/routes/api.comm-prefs.tsx:20-22` | Profile form still posts only `preferred_channel`, `do_not_call`, `do_not_text`. Action still writes `do_not_email: form.get("do_not_email") === "true"`, so a missing checkbox becomes `false`. `CommPrefsDrawer` still has the checkbox (`CommPrefsDrawer.tsx:64`). |
| B4 | All tenants share one operator-owned Twilio sender, by design | still-open | `nudgepay-app/app/lib/twilio-messaging.server.ts:42-51` | `resolveSender` still ignores org args and returns the env default. Comment still says tenant overrides are intentionally ignored. Tests still assert that (`tests/twilio-send.test.ts`). Settings now *rejects* sender writes (`api.org-settings.tsx:56-61`) rather than persisting a spoofable override — same shared-sender architecture. |
| B5 | Inbound SMS, including STOP opt-outs, is silently dropped when unmatched | still-open | `nudgepay-app/app/lib/twilio-messaging.server.ts:156-177`, `196-211` | `resolveInboundOrgId` still returns `null` unless outbound history resolves to exactly one org. `recordInboundMessage` then returns `{ matched: false, optOut: false }` with no insert and STOP never applied. Tests still expect unknown numbers store nothing (`tests/twilio-inbound.test.ts:58-60`). Routing now uses `to_number_norm` (0033, pre–July 13); unmatched drop is unchanged. |
| B6 | Per-org email "from" is unverified free text on the operator's shared Resend key | still-open | `nudgepay-app/app/lib/email-settings.ts:3`, `23-36`; `nudgepay-app/app/lib/email-client.server.ts:7-20` | Comment still: "domain verification is an operator concern." Validation is still `EMAIL_RE` only. Every send still uses the single `RESEND_API_KEY`. No Domains API / verified-domain allowlist. |
| B7 | Inbound email handling cannot work against the real Resend API | still-open | `nudgepay-app/app/lib/email-events.ts:40-43`; `nudgepay-app/tests/email-events.test.ts:21-24` | Switch still listens for `inbound.email.received` / `email.inbound`, not Resend's `email.received`. `str(d.to)` still string-only (array `to` → `""`). Tests still encode the guessed event name. Failed/suppressed still fall through to `ignore` (minor 26). |
| B8 | First sync after connecting QuickBooks never happens automatically | still-open | `nudgepay-app/app/routes/auth.qbo.callback.tsx:32-34`; `nudgepay-app/app/routes/api.qbo.refresh.tsx:44`; `nudgepay-app/app/lib/qbo-sync.server.ts:287-291` | Callback stores tokens and redirects `?qbo=connected` with no `syncOverdueInvoices`. Full backfill remains Settings "Refresh" only. CDC first-run window is still 7 days. PR #43 added a `userId` bind on this callback; it did not add a sync. |
| B9 | A dead QBO connection reports "Connected" forever | still-open | `nudgepay-app/app/lib/qbo-connection.server.ts:11-14`, `26-45`, `60-62` | `storeConnection` writes `"connected"`; `disconnectConnection` writes `"disconnected"`. `getValidAccessToken` throws on refresh failure and never writes an error status. `qbo_connections.status` has no check constraint and no `"error"` writer. |
| B10 | Production environment was never configured | still-open | `nudgepay-app/wrangler.toml:25-27` | `[env.production.vars] SUPABASE_URL` is still `https://<your-prod-project-ref>.supabase.co`. Deploy-gate comment at lines 50-52 still says QBO/Twilio routes 500 until secrets exist. |
| B11 | Intuit compliance URLs redirect to a placeholder | still-open | `netlify/_redirects:5-10`; `docs/intuit-production-checklist.md:5-15` | `/privacy` and `/eula` still 301 to `https://WORKER_PROD_URL_PLACEHOLDER/…` with `TODO(deploy)`. Checklist URLs are the same placeholder. |

---

## Majors M1–M34

| Prior ID | Title | Disposition | Fresh evidence (file:line) | Notes |
|---|---|---|---|---|
| M1 | Email-confirmation landing is unhandled | still-open | `nudgepay-app/app/routes.ts:3-47`; `nudgepay-app/app/routes/signup.tsx:32-41` | No `/auth/confirm` route. Signup confirm branch still returns `{ confirmEmail: true }` and drops Set-Cookie when session is null. No `emailRedirectTo`. |
| M2 | Invites don't send email | still-open | `nudgepay-app/app/routes/invite.tsx:38-54` | Action still inserts a row and returns a relative `/accept/<token>` in a `<code>` block. Button still says "Sending invite…". `/invite` is registered in `routes.ts` and linked from no in-app page (grep of components/routes: only `routes.ts` + `invite.tsx` + a meta test). |
| M3 | Multi-org membership is a trap | still-open | `nudgepay-app/app/lib/session.server.ts:30-41` | `resolveOrg` still `.order("created_at").limit(1)`. No org switcher. Accepting a second-org invite still cannot surface that org. |
| M4 | No member removal, role change, invite revocation, or leave-org | still-open | `nudgepay-app/supabase/migrations/0002_rls_policies.sql:23-24`; `nudgepay-app/app/routes/settings.tsx:176-209` | Memberships still SELECT-only. No delete/update policy, no API, no roster UI (Workspace tab is display name + company profile only). |
| M5 | No change-password, change-email, or account deletion | still-open | `nudgepay-app/app/routes/api.profile.tsx:21-23` | Sole `auth.updateUser` still sets `display_name`. |
| M6 | Loader DB errors render as healthy empty states | still-open | `nudgepay-app/app/lib/case-queue.server.ts:130-147` | Stage-1 invoice/case queries still destructure `{ data }` and ignore `error`. Failed reads still become `[]` / $0 KPIs. |
| M7 | Focus Mode has no collision safeguards | still-open | `nudgepay-app/app/routes/focus.tsx:57-58` | `includePresence: false` still. Dashboard still passes `true` (`dashboard.tsx:189`). |
| M8 | No pagination/virtualization; loader re-runs every 20 s | still-open | `nudgepay-app/app/components/WorkQueue.tsx:648`; `nudgepay-app/app/components/DetailPanel.tsx:622-626` | Still `items.map(...)`. Heartbeat interval still calls `revalidateRef.current()` every 20 s while a case is open. |
| M9 | SyncIssues warning badge exists but is mounted nowhere | still-open | `nudgepay-app/app/components/SyncIssues.tsx:27`; `nudgepay-app/app/components/AppShell.tsx:17`, `139`; `nudgepay-app/app/routes/reports.tsx:150` | Zero route imports of `SyncIssues`. AppShell still accepts `syncIssues`; only `reports.tsx` passes `null`. Settings renders an inline list on the Integrations tab, not the header badge. |
| M10 | Email never counts as contact | still-open | `nudgepay-app/app/lib/case-queue.server.ts:213-250` | Last-contact still built from `contact_logs` + outbound `text_messages` only. No `email_messages` read in this module. |
| M11 | "Total customers" counts only ever-overdue customers | still-open | `nudgepay-app/app/components/AccountsMetrics.tsx:9`; `nudgepay-app/app/routes/accounts.tsx:60-64`; `nudgepay-app/app/lib/qbo-sync.server.ts:144-160`; `nudgepay-app/app/lib/accounts.ts:144` | Accounts loader now SELECTs all `customers` rows (not overdue-filtered), but those rows are still created by overdue/coming-due sync only. Tile still reads "Total customers" / "in directory". |
| M12 | No CSV/data export anywhere | still-open | `nudgepay-app/app/routes/reports.tsx:155-163` | No `text/csv` / export path in the app. Reports is still an on-screen range toggle. |
| M13 | Money is hardcoded USD/en-US | still-open | `nudgepay-app/app/lib/format.ts:20-27` | `Intl.NumberFormat("en-US", { currency: "USD" })`. No QBO currency field. |
| M14 | No read/unread state for inbound messages | still-open | `nudgepay-app/app/lib/message-inbox.ts:161` | `needsReply` is still `last.direction === "inbound"`. No read flag, no mark-read API. |
| M15 | Messages inbox never updates while open | still-open | `nudgepay-app/app/routes/messages.tsx:46-60` | Loader is request-time only. No `useRevalidator`, poll, or push. |
| M16 | Default templates resurrect after deletion | still-open | `nudgepay-app/app/lib/message-templates.ts:22-47` | `resolveChannel` still appends any default slug missing from DB. Delete can succeed and the default reappears on next load. Org-create now seeds rows (`orgs.server.ts:51-67`); that does not stop resurrection after delete. |
| M17 | OAuth/sync outcome params are never rendered | still-open | `nudgepay-app/app/routes/auth.qbo.callback.tsx:19`, `30`, `34`, `36`; `nudgepay-app/app/routes/dashboard.tsx` (no `qbo`/`sync` search-param read) | Callback still redirects `?qbo=connected` / `error` / `forbidden`. Refresh still redirects `?sync=ok`/`error`. Dashboard/settings never read those params. PR #43 added `qbo=forbidden` but still no UI. |
| M18 | No pagination of QBO query/CDC results | still-open | `nudgepay-app/app/lib/qbo-sync.server.ts:26-28`, `146-148`, `227`; `nudgepay-app/app/routes/api.qbo.refresh.tsx:44` | `QUERY_LIMIT = 1000` with the Chancey-scale comment. `truncated` is computed then discarded by the refresh caller (`await syncOverdueInvoices(...)` with no use of the return value). |
| M19 | Reconnecting a different QuickBooks company merges two books | still-open | `nudgepay-app/app/lib/qbo-connection.server.ts:11-14` | `upsert` on `org_id` still replaces `realm_id` without purging customers/invoices/cases. |
| M20 | QBO webhook processes synchronously before responding | still-open | `nudgepay-app/app/routes/webhooks.qbo.tsx:45-76` | Per-event Intuit reads + DB work still run in the request. `waitUntil` exists only on cron in `workers/app.ts:30-33`. |
| M21 | CDC cron is one serial loop over all orgs | still-open | `nudgepay-app/app/lib/qbo-cron.server.ts:42-56` | `for (const c of conns ?? []) { await runCdcCatchup(...) }`. No time budget, checkpoint, or fan-out. |
| M22 | No `reply_to` and no inbound-email setup path | still-open | `nudgepay-app/app/lib/email-client.server.ts:10-12` | Payload is still `{ from, to, subject, html?, text? }`. No `reply_to`. Settings email section has webhook URL copy, not MX-to-Resend instructions. |
| M23 | Consent has no provenance and STOP is one-click reversible | still-open | `nudgepay-app/app/routes/api.sms-consent.tsx:18`, `44-48`; `nudgepay-app/app/components/MessageThreadPanel.tsx:138-139` | `sms_consent` is still a bare boolean. UI still offers "Mark consented" / "Revoke consent". No source/timestamp column. |
| M24 | No rate limiting or send-frequency caps on any send endpoint | still-open | `nudgepay-app/app/routes/api.text.send.tsx:15-49` | Repo-wide search for `rateLimit`/`ratelimit` is empty. Single-send, bulk, and test-message paths have no ceiling. |
| M25 | Plain members can DELETE/rewrite the audit trail | partial | `nudgepay-app/supabase/migrations/0002_rls_policies.sql:31-33`; `nudgepay-app/supabase/migrations/0009_collection_cases.sql:24-25`; `nudgepay-app/supabase/migrations/0010_promise_payment_loop.sql:27-28`; `nudgepay-app/supabase/migrations/0032_security_hardening.sql:35-59` | 0032 (already in the July 13 tree) split invoices/payments/customers/qbo_connections off `FOR ALL`. The tables named in the finding — `text_messages`, `contact_logs`, `collection_cases`, `promises` — still have member `FOR ALL`. |
| M26 | QBO deletions/voids are mishandled | still-open | `nudgepay-app/app/lib/qbo-api.server.ts:54-58`; `nudgepay-app/app/lib/qbo-mappers.server.ts:31-37`; `nudgepay-app/app/lib/qbo-sync.server.ts:239-251` | CDC still flattens every entity with no `Deleted` filter. `mapQboCustomer` still falls back to `"(unnamed)"`. Webhook `if (!inv) return` / `if (!c) return` leaves local overdue rows in place. |
| M27 | No CI | still-open | repo root and `nudgepay-app/` have no `.github/` | Freeze.md agrees. Nothing runs typecheck/tests on PRs. |
| M28 | No error monitoring or analytics | still-open | `nudgepay-app/wrangler.toml`; `nudgepay-app/app/lib/qbo-cron.server.ts:50` | No Sentry/PostHog/Workers Observability binding in app config. Cron failures still `console.error`. |
| M29 | Tests unrunnable from a fresh clone | still-open | `nudgepay-app/tests/global-setup.ts:13-15`; freeze.md `.env.test: missing` | `readFileSync("../.env.test")` with no committed sample. |
| M30 | Intuit production checklist entirely open | still-open | `docs/intuit-production-checklist.md:5-37` | Every URL is `WORKER_PROD_URL_PLACEHOLDER`. No "Verified by" boxes filled. |
| M31 | QuickBooks Disconnect is one un-confirmed click | still-open | `nudgepay-app/app/routes/settings.tsx:248-252` | Bare submit button, no `confirm` / dialog. |
| M32 | Copper brand color fails WCAG AA on light surfaces | still-open | `nudgepay-app/app/app.css:12`; `nudgepay-app/app/components/KpiBand.tsx:25`, `61-66`; `nudgepay-app/app/components/ui.tsx:6` | `--color-copper: #cf8136` unchanged. No contrast PR after July 13. `text-copper` still used for links/badges on `surface`/`paper`. Some primary buttons now use `text-ink` on copper (better); Settings profile Save still `bg-copper … text-white` (`settings.tsx:192`). |
| M33 | Focus Mode dark theme renders secondary text at 1.6–2.8:1 | still-open | `nudgepay-app/app/components/focus/FocusCard.tsx:48-49`, `63-66`, `78`, `84-88`, `146-168`; `nudgepay-app/app/app.css:18` | Still `text-muted` / `text-muted/60` (`#5b6474`) on `bg-ink`. Amount is `text-copper` on dark. No later contrast pass. |
| M34 | Unlabeled controls in core flows | still-open | `nudgepay-app/app/components/focus/SendTextMiniForm.tsx:158-164`; `nudgepay-app/app/components/AccountsDirectory.tsx:61-63`; `nudgepay-app/app/components/LateFeesForm.tsx:27-36` | SMS body: placeholder only, no `<label>`/`aria-label`. Accounts search: placeholder only. Late-fee enable control is a `<select>` inside a label with no visible name. |

---

## Minors 1–61

| Prior ID | Title | Disposition | Fresh evidence (file:line) | Notes |
|---|---|---|---|---|
| 1 | Onboarding action doesn't re-check org membership | still-open | `nudgepay-app/app/routes/onboarding.tsx:33-37` | Action still `createOrgForUser` with no existing-membership guard. Replay POST still inserts another `organizations` row. |
| 2 | Non-owner Reports nav item announced as "(coming soon)" | still-open | `nudgepay-app/app/components/AppShell.tsx:196-199`, `238-245` | Owners get a live `/reports` link. Non-owners still fall through to `aria-label={`${item.label} (coming soon)`}` for Reports. |
| 3 | Clicking the user avatar instantly signs you out | still-open | `nudgepay-app/app/components/AppShell.tsx:153-162` | Avatar is still a POST `/logout` submit. `aria-label` now says "Sign out"; still no menu/confirm. |
| 4 | Unmapped Supabase auth errors collapse to a generic string | still-open | `nudgepay-app/app/lib/auth-flow.server.ts:33-40` | Map still covers three strings; default is "Something went wrong. Please try again." |
| 5 | Landing page is a headline; EULA still says "private beta" | still-open | `nudgepay-app/app/routes/home.tsx:19-29`; `nudgepay-app/app/routes/eula.tsx:25-26` | Home is headline + one sentence + signup/login. EULA §3 still "during private beta". |
| 6 | Empty work queue always shows the filter-centric message | still-open | `nudgepay-app/app/components/WorkQueue.tsx:604-614` | Zero items still: "No accounts match this view." + "Clear the search". |
| 7 | Focus Mode surfaces raw machine error codes in toasts | still-open | `nudgepay-app/app/routes/focus.tsx:394` | `onError={(code) => addToast(\`Text failed: ${code}\`)}`. |
| 8 | Focus Mode is unreachable on mobile | still-open | `nudgepay-app/app/routes/dashboard.tsx:527-529` | Focus link still `hidden sm:flex`. No other nav entry. |
| 9 | Bulk SMS skipped-reason summary omits the do-not-text bucket | still-open | `nudgepay-app/app/components/BulkSmsDrawer.tsx:10-18`; `nudgepay-app/app/lib/bulk.ts:9`, `42` | Partition emits `do-not-text`; summary only counts `no-phone` / `no-consent` / `do-not-contact`. |
| 10 | Consent toggle in Messages tab breaks with no representative invoice | partial | `nudgepay-app/app/components/MessageThreadPanel.tsx:133-135`; `nudgepay-app/app/routes/api.sms-consent.tsx:33-40`; `nudgepay-app/app/components/DetailPanel.tsx:209-210` | Inbox now posts `customerId` and the API has a customerId fallback — Messages-tab path works. Dashboard DetailPanel consent form still posts only `invoiceId` (empty when no rep invoice) and still 302s `sms=error`. |
| 11 | Dashboard detail panel is a fixed 384px pane | still-open | `nudgepay-app/app/routes/dashboard.tsx:609` | Still `w-96 xl:w-[28rem] shrink-0`. |
| 12 | Coming-due empty state hardcodes "next 7 days" | still-open | `nudgepay-app/app/components/ComingDueList.tsx:29`; `nudgepay-app/app/lib/org-config.ts:149` | Copy is still "next 7 days" though the window is `orgConfig.workflow.comingDueDays`. |
| 13 | UTC calendar day vs org-local today skews broken-promise flag | still-open | `nudgepay-app/app/components/DetailPanel.tsx:88-89`, `1075-1103` | `todayISO()` is still `new Date().toISOString().slice(0, 10)` (UTC). Compared to `e.promisedDate` for the "· broken" flag. |
| 14 | Promises cannot be edited; Promises page has no cancel/renegotiate | still-open | `nudgepay-app/app/components/PromiseQuickPanel.tsx:73-90` | Panel is "Open in Collections" / account link only. Cancel API exists (`api.promises.cancel.tsx`) and is used from the dashboard, not this page. |
| 15 | Timestamp dates render in the server's UTC zone during SSR; no time-of-day | still-open | `nudgepay-app/app/lib/dates.ts:10-12`, `27-34` | Timestamps still `toLocaleDateString("en-US")` with date-only options. Comment admits viewer-local rendering; SSR still uses the Worker zone. |
| 16 | Collections rules form gives zero success/error feedback; saved=1 lights the wrong forms | partial | `nudgepay-app/app/components/CollectionsRulesForm.tsx:69-75`; `nudgepay-app/app/routes/api.org-settings.tsx:73-79`, `134-136`; `nudgepay-app/app/components/LateFeesForm.tsx:67`; `nudgepay-app/app/routes/settings.tsx:345-358` | Rules form still has no saved/error UI. `save_rules` still redirects `?saved=1`, which still lights Late fees / Priority / Workflow on the same Collections tab. Email now uses `email_saved=1`; quiet hours / templates / profile have distinct markers. |
| 17 | Priority high-value threshold: client min $0.01, server min $1,000 | still-open | `nudgepay-app/app/components/PriorityThresholdsForm.tsx:37`, `77`; `nudgepay-app/app/lib/org-settings.ts:125` | Input `min={0.01}`; parser rejects `< 1000`. Error copy still "must be greater than 0." |
| 18 | No unsaved-changes protection on any settings form | still-open | `nudgepay-app/app/components/SettingsTabs.tsx:29-40` | Tabs are `<Link>` search-param switches. No dirty guard. |
| 19 | Template editor has no preview, no token insertion, no placeholder validation | still-open | `nudgepay-app/app/components/TemplateEditor.tsx:88-96` | Token legend only. Copy still "Unset tokens render blank." No preview / insert / misspelling check. |
| 20 | SMS thread bubbles show no timestamps; pane doesn't scroll to newest | still-open | `nudgepay-app/app/components/MessageBubbles.tsx:12-18`, `30-34` | Bubble type has no timestamp field. Footer is `direction · status`. No `scrollIntoView` anywhere. |
| 21 | No 429 detection, backoff, or retry on Intuit API calls | still-open | `nudgepay-app/app/lib/qbo-api.server.ts:16-22` | `getJson` still throws on `!res.ok` with no Retry-After handling. |
| 22 | CDC watermark stamped with local time AFTER fetch/processing | still-open | `nudgepay-app/app/lib/qbo-sync.server.ts:295`, `320-321` | `changedSince` from stored cursor; watermark is `now.toISOString()` after upserts. |
| 23 | Invoice status column goes stale when a due date passes without a QBO change | still-open | `nudgepay-app/app/lib/qbo-mappers.server.ts:41-44` | `invoiceStatus` is computed only at map/upsert time. No daily recompute job. |
| 24 | No data-retention or cleanup job for unbounded operational tables | still-open | `nudgepay-app/workers/app.ts:25-34` | Scheduled handler is digest + CDC only. No oauth_states / notification_log / resolved sync_errors / expired invites purge. |
| 25 | CloudEvents webhook parser admits it is unverified against real Intuit payloads | still-open | `nudgepay-app/app/lib/qbo-webhook.server.ts:85-88` | Comment still: "confirm exact CloudEvents field casing/nesting against a real Intuit payload before production cutover". |
| 26 | Resend email.failed / email.suppressed events are ignored | still-open | `nudgepay-app/app/lib/email-events.ts:44-45` | Those types are not in the switch; they return `{ kind: "ignore" }`. Outbound rows can stay `sent`. |
| 27 | No "Reply STOP to opt out" language in default SMS templates | still-open | `nudgepay-app/app/lib/sms-templates.ts:26-45` | Four defaults; none mention STOP. `sendInvoiceText` does not append a footer. |
| 28 | Quiet hours computed in the org's timezone, not the recipient's | still-open | `nudgepay-app/app/lib/twilio-messaging.server.ts:107-113`; `nudgepay-app/app/lib/quiet-hours.ts:1-14` | Window is org-local (`hourInTz` + org settings). No customer TZ. |
| 29 | No server-side duplicate-send protection on single-send endpoints | still-open | `nudgepay-app/app/routes/api.text.send.tsx:48-49` | Each POST calls `sendInvoiceText` with no idempotency key. |
| 30 | Bulk SMS partial failures reported only as an aggregate count | still-open | `nudgepay-app/app/lib/bulk-send.server.ts:87-101` | Per-case `catch { failed++ }` swallows the error. Return is `{ sent, failed, skipped }`. |
| 31 | Broken-promise alert email failures are permanently lost | still-open | `nudgepay-app/app/lib/notifications.server.ts:112-116` | Catch logs and skips the ledger row. Comment still: one-shot transition, needs manual re-trigger. |
| 32 | No List-Unsubscribe / one-click unsubscribe headers | still-open | `nudgepay-app/app/lib/email-client.server.ts:10-12` | Payload has no `headers`. Repo search for `List-Unsubscribe` is empty. |
| 33 | Promise kept/partially-kept boundary uses exact float comparison | still-open | `nudgepay-app/app/lib/promises.ts:27-30` | `received >= row.promisedAmount` on JS numbers from summed balances. |
| 34 | high_value_threshold above $10,000 is accepted but silently stops affecting scoring | still-open | `nudgepay-app/app/lib/priority.ts:39-45` | Hardcoded 25k/10k tiers still fire before `highValueThreshold`. A threshold ≥ 10,000 never creates a distinct 12-point band. |
| 35 | worklist.ts retains a dead, conflicting age-only priority model | still-open | `nudgepay-app/app/lib/worklist.ts:68-76`, `193-194` | `priorityOf` is still age-only. `computeMetrics` still hardcodes `onHold`/`comingDue` to `{ count: 0, amount: 0 }`. Live scoring is `priority.ts`. |
| 36 | Late-fee estimate model is simplistic; priority weights stay hardcoded | still-open | `nudgepay-app/app/lib/late-fees.ts:31-38`; `nudgepay-app/app/lib/priority.ts:1-3` | Fixed 30-day months, no cap. Priority header still "deferred to C7" even though thresholds are org-configurable. |
| 37 | Promise evaluation counts any QBO balance reduction as payment | still-open | `nudgepay-app/app/lib/promises.ts:1-2`, `26-27` | Still `received = max(0, baseline - currentLinkedBalance)`. Credit memos/voids/edits still count. |
| 38 | Owner test-SMS endpoint sends to arbitrary numbers with no consent gate and no throttle | still-open | `nudgepay-app/app/routes/api.test-message.tsx:39-47`; `nudgepay-app/app/lib/test-message.server.ts:22-37` | Owner-gated only. `sendTestSms` documents "no consent gates, no ledger". |
| 39 | Auth actions bypass the same-origin CSRF check | still-open | `nudgepay-app/app/routes/logout.tsx:5-9`; `nudgepay-app/app/lib/session.server.ts:13-27`; `nudgepay-app/app/lib/csrf.server.ts:25-28` | `requireSameOrigin` runs inside `requireUser`. Login/signup/logout build a user client and never call it. |
| 40 | Invite action returns raw database error message to the client | still-open | `nudgepay-app/app/routes/invite.tsx:40` | `if (error) return { error: error.message }`. |
| 41 | dev-data.sql is broken by the 0032 member-source-edit trigger | still-open | `nudgepay-app/supabase/snippets/dev-data.sql:147`; `nudgepay-app/supabase/migrations/0032_security_hardening.sql:72-78` | Snippet still `UPDATE customers SET phone = NULL`. Trigger still raises on member phone changes. (Snippet runs as the connected role; if that is not service_role/owner it still aborts.) |
| 42 | email_config.updated_at is never maintained | still-open | `nudgepay-app/supabase/migrations/0020_channel_settings.sql:25` | Column default `now()`; comment still "not auto-updated". No trigger; upserts do not set it. |
| 43 | Audit-actor columns are bare uuids without FKs / ON DELETE | still-open | `nudgepay-app/supabase/migrations/0013_sync_errors.sql:13`; repo SQL `ON DELETE` grep empty | `resolved_by uuid` has no FK. User-reference FKs still lack ON DELETE actions. |
| 44 | Invites allow unlimited duplicate pending invites per (org, email) | still-open | `nudgepay-app/supabase/migrations/0003_invites.sql:4` | `email text not null` with no unique `(org_id, email)` where pending. 0032 added expiry, not uniqueness. |
| 45 | No robots.txt, sitemap, meta description, or Open Graph tags | still-open | `nudgepay-app/app/lib/meta.ts:1-3`; `nudgepay-app/app/root.tsx:40-45` | `pageTitle` returns `{ title }` only. Layout has charset/viewport, no description/OG. No robots.txt route. |
| 46 | README.md materially stale | still-open | `README.md:60`, `71-80` | Still "24 migrations", still lists deleted `nudgepay-frontend/` / `nudgepay-backend/`. Disk has 0001–0034. |
| 47 | AGENTS.md stale | still-open | `AGENTS.md:57-62` | Still "Migrations (0001–0024)". Tables named `orgs` (actual: `organizations`). |
| 48 | Starter-template boilerplate remains | still-open | `nudgepay-app/README.md:1-9`; `nudgepay-app/package.json:40-50` | Cloudflare starter README. `cloudflare.publish: true` marketplace block still present. |
| 49 | No LICENSE file committed | still-open | `README.md:141-144` | No `LICENSE` in the tree. README still "All rights reserved until one is added." |
| 50 | Six demo-recording PNGs committed | still-open | `nudgepay-app/demo-recording/` (6 PNGs including `frontend-screenshot.png`) | Directory still present. |
| 51 | Legacy Supabase anon key rotation documented as pending | still-open | `AGENTS.md:98` | Still: credentials "exist in git history. Rotate the anon key." Unverifiable from this tree. |
| 52 | listOrgMembers fetches only the first 1000 auth users project-wide | still-open | `nudgepay-app/app/lib/orgs.server.ts:88` | `auth.admin.listUsers({ perPage: 1000 })` with no pagination loop. |
| 53 | Team alert emails and daily digest gated on the customer-facing email channel | still-open | `nudgepay-app/app/lib/notifications.server.ts:34-40`, `131-137` | Both paths still return unless `email_config.email_enabled` and `from_address`. |
| 54 | WorkQueue desktop grid has no table semantics | still-open | `nudgepay-app/app/components/WorkQueue.tsx:647-649` | Header is a `div` grid; rows are `role="list"` / `listitem`, not `table`/`th`/`td`. |
| 55 | Infinite loading animation and fade-in not gated on prefers-reduced-motion | still-open | `nudgepay-app/app/components/AppShell.tsx:85-87`; `nudgepay-app/app/app.css:43-58` | `animate-[progress-slide_…]` / `fade-in`. Repo search for `prefers-reduced-motion` is empty. |
| 56 | CommPrefsDrawer scrim link has contradictory aria-hidden + aria-label | still-open | `nudgepay-app/app/components/CommPrefsDrawer.tsx:29` | `<Link … aria-hidden="true" tabIndex={-1} aria-label="Close">`. |
| 57 | TemplateEditor uses role=tablist/tab without tabpanel or arrow keys | still-open | `nudgepay-app/app/components/TemplateEditor.tsx:63-85` | `role="tablist"` + two `role="tab"` buttons. No `tabpanel`, no arrow-key handler. |
| 58 | QuickBooks sync status chip and sync-issue alerts hidden on mobile | still-open | `nudgepay-app/app/components/SyncIssues.tsx:59` | Trigger still `hidden sm:inline-flex`. Compounded by M9 (component unmounted). |
| 59 | Async UI results not announced: copy-to-clipboard and bulk-selection count | still-open | `nudgepay-app/app/components/WebhookUrlField.tsx:26-31` | Button text flips to "Copied" with no live region. Repo has zero `aria-live`. |
| 60 | No in-app notification surface | still-open | `nudgepay-app/app/lib/notifications.server.ts:28-40` | Broken-promise + digest are email-only. No bell/center; unconfigured email means silence. |
| 61 | First-run bounce to Settings has no welcome or explanation | still-open | `nudgepay-app/app/lib/workspace.server.ts:35-37`; `nudgepay-app/app/routes/dashboard.tsx:197-198` | Disconnected orgs still `redirect("/settings?tab=integrations")` with no welcome copy. |

---

## NEW surfaces since July 13

### Strictly new at HEAD (not in the July 13 report)

The only product change between the July 13 audit commit (`87b9c5b`, 2026-07-13) and freeze HEAD (`820fb1b`, 2026-07-28) is **PR #43 — bind QBO OAuth state to the initiating user**.

| Surface | Where | What it is |
|---|---|---|
| Migration `0034_oauth_state_user_binding.sql` | `nudgepay-app/supabase/migrations/0034_oauth_state_user_binding.sql` | Adds `oauth_states.user_id uuid NOT NULL references auth.users(id) on delete cascade`. Deletes unbound rows. |
| `createOAuthState(service, orgId, userId)` | `nudgepay-app/app/lib/oauth-state.server.ts:12-19` | Inserts `user_id` with the nonce. |
| `consumeOAuthState` returns `{ orgId, userId }` | `nudgepay-app/app/lib/oauth-state.server.ts:22-34` | Callers must compare both. |
| Connect binds the signed-in user | `nudgepay-app/app/routes/api.qbo.connect.tsx:17` | `createOAuthState(service, org.org_id, user.id)`. |
| Callback rejects stolen/cross-user state | `nudgepay-app/app/routes/auth.qbo.callback.tsx:29-30` | `user.id !== oauthState.userId` → `/dashboard?qbo=forbidden`. |

This **does not** close B8 (still no auto-sync), M17 (still no UI for `qbo=`/`sync=`), or B9 (status still never `error`). It is a new authz control on the existing OAuth callback.

### Already in the July 13 map (not new since that audit)

These landed ~2026-07-03 (PR #36 and related) and were already described in the July 13 report. Unchanged at HEAD except as noted above. Listed because the wave-0 brief named them:

| Surface | Migrations / files | July 13 status |
|---|---|---|
| Company profile + timezone | `0025_org_profile.sql`; Settings → Workspace | already mapped |
| Message templates table + editor | `0026_message_templates.sql`; Settings → Templates; `message-templates.ts` | already mapped; M16 still-open |
| Priority thresholds | `0027_org_priority_thresholds.sql`; Collections tab | already mapped; minors 17, 34 still-open |
| Workflow knobs (coming-due / due-soon / batch) | `0028_org_workflow_knobs.sql` | already mapped; minor 12 still-open |
| Digest schedule (`digest_hour_local`) | `0029_org_digest_schedule.sql`; Company profile hour select | already mapped |
| Quiet hours | `0030_org_quiet_hours.sql`; Channels tab; enforced on send | already mapped; minor 28 still-open |
| Cleanup (drop dead `email_config.provider`) | `0031_cleanup.sql` | already mapped |
| Security hardening (owner writes, invite expiry, source-field trigger) | `0032_security_hardening.sql` | already mapped; M25 still partial; minor 41 still-open |
| SMS phone normalization | `0033_text_message_phone_norm.sql` | already mapped; B5 unmatched drop remains |
| Settings 5 tabs | `SettingsTabs.tsx` (`workspace` / `integrations` / `channels` / `templates` / `collections`) | already mapped |
| Focus Mode | `/focus`, `FocusCard`, `SendTextMiniForm` | already mapped; M7/M33/M34 still-open |

---

## Method

- Every prior ID was checked in current source, not copied from the July 13 write-up.
- Git range `87b9c5b..820fb1b` is docs-only plus `e4b6391` / PR #43 (OAuth user bind).
- HEAD hints from the wave-0 brief were verified: B0 absent; B1/B2 still unbounded; B3 checkbox + `=== "true"` still; B4 `resolveSender` still ignores tenant; B5 unmatched still dropped; B6 regex-only; B7 guessed event names; B8 callback still no `syncOverdueInvoices`; B9 no `"error"` status; B10/B11 placeholders; M9 unmounted; M16 resurrection; M27 no CI; M32/M33 CSS unchanged; 0034 is the only new surface.
