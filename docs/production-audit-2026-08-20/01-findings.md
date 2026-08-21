# Findings catalog

Canonical IDs for the 2026-08-20 audit. Each card is the fix-pass interface. Raw specialist notes with extra file:line context live under `wave-*/`.

HEAD: `820fb1ba`. Product code was not changed.

Severity: **blocker** | **major** | **minor**. Bars: **P0-managed** | **P0-public** | **polish**.

---

## Blockers

### [NP-2026-001] No password reset / forgot-password flow
- **Severity:** blocker
- **Bars:** P0-public
- **Area:** auth
- **Status:** reconfirmed (B0)
- **Evidence (code):** `nudgepay-app/app/routes.ts` has no recovery route. `login.tsx` is email+password only. Repo grep for `resetPasswordForEmail` in `app/` is empty. `api.profile.tsx` `updateUser` writes `display_name` only.
- **Evidence (live):** not tested (no GoTrue). Login form has no “Forgot password?” control (code).
- **User / legal impact:** A public user who forgets their password is locked out of AR data. Operator can reset in Studio for a managed tenant, so this is not a managed-bar blocker by itself.
- **Fix recipe:**
  1. Add `forgot-password.tsx` + `auth.confirm.tsx` (shared with NP-2026-002) + `reset-password.tsx`. Register in `routes.ts`. Link from `login.tsx`.
  2. `resetPasswordForEmail` with `redirectTo` = production `/auth/confirm`. Confirm exchanges `token_hash` via `verifyOtp({ type: "recovery" })`. New-password POST behind `requireUser` + `requireSameOrigin`. Same success copy whether or not the email exists.
  3. Tests: unknown email same copy/timing; recovery sets cookies; `redirectTo` open-redirect rejected; CSRF on password POST.
  4. Manual: request reset, set new password, old password fails.
- **Do not:** Call `updateUser({ password })` without a recovery session. Echo “no such user”.

### [NP-2026-002] No `/auth/confirm`; signup confirm branch drops Set-Cookie
- **Severity:** blocker
- **Bars:** P0-public
- **Area:** auth
- **Status:** reconfirmed (M1)
- **Evidence (code):** No confirm route. `signup.tsx:39-41` returns `{ confirmEmail, returnTo }` and drops `headers` from `createSupabaseUserClient`. `auth-flow.server.ts:6-16` documents production confirmations ON → session null. Local `enable_confirmations = false` hides this in dev. `site_url` in `config.toml` points at `/`.
- **Evidence (live):** not tested.
- **User / legal impact:** Confirmation mail lands on marketing, unsigned-in. Invite `returnTo` is lost. If confirmations are OFF in production, anyone can create an org with an unproven email.
- **Fix recipe:**
  1. `auth.confirm.tsx`: `verifyOtp` then `safeReturnTo(next)`. Return signup confirm JSON **with** `headers`. Set hosted `site_url` / redirect allowlist to `/auth/confirm`.
  2. Support `type=signup|email|recovery`. Never render tokens in HTML.
  3. Tests: valid hash sets Set-Cookie and honors `next=/accept/<token>`; signup confirm response includes Set-Cookie.
  4. Manual: confirmations ON, sign up with invite returnTo, click mail, land signed-in on accept.
- **Do not:** Turn confirmations OFF as the “fix”. Consume tokens in a client `useEffect` (`detectSessionInUrl` is off).

### [NP-2026-003] Account-profile Save preferences silently re-subscribes unsubscribed customers
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** reconfirmed (B3)
- **Evidence (code):** `AccountProfile.tsx:120-142` posts `preferred_channel`, `do_not_call`, `do_not_text` only. `api.comm-prefs.tsx:20-22` writes `do_not_email: form.get("do_not_email") === "true"`. `accounts.$id.tsx` SELECT omits `do_not_email`. `tests/api-comm-prefs.test.ts:13-15` **locks the wipe in**. `CommPrefsDrawer.tsx:64` has the checkbox (dashboard only).
- **Evidence (live):** not tested. Code path is unambiguous.
- **User / legal impact:** CAN-SPAM requires honoring opt-out. Staff saving owner/channel on `/accounts/:id` clears a tokenized `/unsubscribe`. Subsequent collection mail is a send after opt-out.
- **Fix recipe:**
  1. Add `do_not_email` checkbox to `AccountProfile` (same pattern as drawer). SELECT the column in `accounts.$id.tsx`.
  2. Change `parseCommPrefsUpdate`: **omit** `do_not_email` from the UPDATE when the field was not posted (or require a hidden sentinel that preserves current DB value). Never default missing → `false`.
  3. Tests: form without the field leaves DB `true`; form with checkbox off after explicit “re-subscribe” is a separate, confirmed path.
  4. Manual: unsubscribe via token, open account profile, Save owner, confirm `do_not_email` still true, send path still blocked.
- **Do not:** Add a hidden `do_not_email=false`. Fix only the drawer.

### [NP-2026-004] Unmatched inbound SMS, including STOP, is dropped with HTTP 200
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** reconfirmed (B5)
- **Evidence (code):** `twilio-messaging.server.ts:156-211` — `resolveInboundOrgId` null unless exactly one org has outbound history; then customer match; else `{ matched: false, optOut: false }` with **no insert**. STOP handling is after that. `webhooks.twilio.inbound.tsx` always 200s empty TwiML. Tests `twilio-inbound.test.ts:58-60` expect the drop.
- **Evidence (live):** Confirm whether the Messaging Service has Twilio Advanced Opt-Out (carrier STOP may mask some of this; app `sms_consent` still stale).
- **User / legal impact:** Customer texts STOP, keeps getting dunning. TCPA $500–$1,500/text. Also fires for a **single** tenant if the reply phone last-10 ≠ stored outbound `to_number`. Webhook 200 means no Twilio retry and no operator queue.
- **Fix recipe:**
  1. Persist unmatched inbound (From, To, Body, SID) before 200.
  2. On STOP/START, apply to every customer whose last-10 matches (all orgs with history), or route solely by To once per-org senders exist (NP-2026-012).
  3. SQL-filter `phone_last10` instead of loading the org (1,000-row cap).
  4. Alert ops on unmatched STOP. Return TwiML confirming opt-out.
  5. Tests: unknown From + body STOP is stored and flagged; two-org collision still records STOP somewhere.
- **Do not:** Treat Twilio Advanced Opt-Out as a substitute for writing `sms_consent=false`.

### [NP-2026-005] QBO OAuth callback never runs the overdue backfill
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** qbo
- **Status:** reconfirmed (B8)
- **Evidence (code):** `auth.qbo.callback.tsx:32-34` stores tokens, redirects `?qbo=connected`, no `syncOverdueInvoices`. That function is only `api.qbo.refresh.tsx:44`. CDC first-run window is 7 days (`qbo-sync.server.ts`). Dashboard never reads `qbo=` (NP-2026-017).
- **Evidence (live):** not tested.
- **User / legal impact:** First-run: connect → empty dashboard. Months-old overdue invoices have not “changed”, so CDC will not bring them. Operator must discover Settings → Sync now.
- **Fix recipe:**
  1. After `storeConnection`, `ctx.waitUntil(syncOverdueInvoices(...))` or redirect to a “Syncing…” page that POSTs refresh. Keep the callback fast enough for Intuit.
  2. Render `?qbo=connected|error|forbidden` on dashboard/settings (NP-2026-017).
  3. Tests: callback mock stores tokens and invokes sync deps; failed sync records `sync_errors` and still shows reconnect copy.
  4. Manual: sandbox connect, invoices on dashboard without clicking Sync now.
- **Do not:** Rely on the 30-min cron for first-run completeness.

### [NP-2026-006] Dead QBO connection reports Connected forever
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** qbo
- **Status:** reconfirmed (B9)
- **Evidence (code):** `qbo-connection.server.ts` writes status `"connected"` (store) or `"disconnected"` (explicit disconnect) only. `getValidAccessToken:26-45` throws on refresh failure and does not update status. Sync failures go to `sync_errors`, which are not mounted in the header (NP-2026-023).
- **Evidence (live):** not tested.
- **User / legal impact:** Token lapse (~100 days idle, or user revoke at Intuit) freezes AR with a green chip. Collectors work stale balances.
- **Fix recipe:**
  1. Catch refresh failure → `status='error'` (or `needs_reconnect`) + `sync_errors` row. `loadWorkspaceChrome` treats error like disconnected: banner + Connect CTA, do not silently empty the queue.
  2. Tests: mock 400 from Intuit token endpoint → status error; UI copy; reconnect overwrites.
  3. Manual: revoke app at Intuit, wait for cron/refresh, see reconnect prompt.
- **Do not:** Leave status connected and hope Settings → Integrations is opened.

### [NP-2026-007] Silent 1,000-row truncation; reconciliation auto-resolves live cases
- **Severity:** blocker
- **Bars:** P0-public (Chancey-scale 125–175 overdue invoices is under the cap today)
- **Area:** cases
- **Status:** reconfirmed (B1, B2)
- **Evidence (code):** `supabase/config.toml:18` `max_rows = 1000`. `case-queue.server.ts:137-147` unbounded invoice/case selects. `case-lifecycle.server.ts:10-30` loads overdue `customer_id`s, then **resolves any open case whose customer is not in that set**.
- **Evidence (live):** not tested.
- **User / legal impact:** Past 1,000 overdue invoice rows, KPIs under-count and **active collection cases close themselves** on the next sync. Invisible.
- **Fix recipe:**
  1. Page every list (`.range` loop until short page) **or** use `count: exact` for recon. Never treat a truncated set as “these customers are no longer overdue”.
  2. If a page is truncated, fail the recon and record `sync_errors`; do not resolve.
  3. Tests: 1001 overdue invoices → recon does not close case 1001’s customer; loader surfaces truncation.
- **Do not:** Raise `max_rows` and call it done (payload and Worker CPU still blow up).

### [NP-2026-008] Production environment was never configured
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** ops
- **Status:** reconfirmed (B10)
- **Evidence (code):** `wrangler.toml:25-27` `SUPABASE_URL = "https://<your-prod-project-ref>.supabase.co"`. Deploy-gate comment: QBO/Twilio routes 500 until secrets exist. This run could not `wrangler secret list --env production`.
- **Evidence (live):** wrangler types dump the same placeholder into `Cloudflare.ProductionEnv`.
- **User / legal impact:** There is no evidence a production Worker can boot against a real database.
- **Fix recipe:**
  1. Create hosted Supabase; `wrangler secret put` every name in `wrangler.toml` comments (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, QBO, Twilio, Resend, `UNSUBSCRIBE_SECRET`, `APP_PUBLIC_BASE_URL`). Set real `SUPABASE_URL`. `QBO_SANDBOX=false`.
  2. Checklist in `07-ops-intuit.md`. Rotate the legacy anon key (`AGENTS.md:98`).
  3. Verify: `wrangler secret list --env production`; owner signup → connect QBO → invoices.
- **Do not:** Deploy with the placeholder URL.

### [NP-2026-009] Intuit compliance URLs 404; Netlify redirects are placeholders
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** ops
- **Status:** reconfirmed (B11)
- **Evidence (code):** `netlify/_redirects:8-10` → `https://WORKER_PROD_URL_PLACEHOLDER/...`. `docs/intuit-production-checklist.md` same placeholder.
- **Evidence (live):** `GET https://nudgepay-ar.netlify.app/privacy` → **404**. `/eula` → **404**. Home 200 title “NudgePay - Chancey AR”.
- **User / legal impact:** Intuit app review requires reachable Privacy and EULA. The portal historically pointed at this Netlify host.
- **Fix recipe:**
  1. Replace placeholder with the real Worker origin. `netlify deploy --prod --dir netlify`. Submit Worker URLs in Intuit portal.
  2. Curl `-I` must 301 to Worker `/privacy` and `/eula` with 200 HTML (operator 9th Level Software, QBO scope).
  3. Fill every row of the Intuit checklist.
- **Do not:** Leave the Netlify stub as the listed compliance host.

### [NP-2026-010] No member removal, role change, leave-org; memberships RLS is SELECT-only
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** auth
- **Status:** reconfirmed (M4)
- **Evidence (code):** `0002_rls_policies.sql:23-24` `mem_select` only. No DELETE/UPDATE policy, no API, Workspace roster is display-name only (`settings.tsx`).
- **Evidence (live):** not tested.
- **User / legal impact:** A terminated collector keeps JWT access to customer phones, invoices, and SMS send until someone deletes the auth user in Studio (which also has FK issues — minor 43).
- **Fix recipe:**
  1. Owner-only `DELETE`/`UPDATE` policies on `memberships`. API + UI: remove member, change role, revoke pending invite, leave-org (block leaving last owner).
  2. Tests in `*-rls.test.ts`: member cannot delete others; owner can; last owner cannot leave.
  3. Manual: remove a user, their next dashboard load redirects, SMS send 401/403.
- **Do not:** Delete `auth.users` as the only offboarding path without membership cleanup.

### [NP-2026-011] Consent has no provenance; STOP is one-click reversible
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** reconfirmed (M23)
- **Evidence (code):** `customers.sms_consent` boolean. `api.sms-consent.tsx` sets true/false. UI “Mark consented” after STOP (`MessageThreadPanel.tsx`). STOP does not set `do_not_text`. No source/timestamp column.
- **Evidence (live):** not tested.
- **User / legal impact:** TCPA. An inbound STOP is indistinguishable from never-consented. Staff can resume texting with one click. Combined with NP-2026-004, even a recorded STOP may never have been recorded.
- **Fix recipe:**
  1. Add `sms_consent_source` (`inbound_stop|inbound_start|staff|import`) + `sms_consent_at` + optional actor. Inbound STOP sets `sms_consent=false` **and** `do_not_text=true` and is not reversible from “Mark consented” without a logged staff override reason.
  2. Hide “Mark consented” when source is `inbound_stop` unless owner + typed reason.
  3. Tests: STOP then staff toggle without reason leaves false; START may re-enable per CTIA.
- **Do not:** Keep a bare boolean and train staff “not to click it”.

### [NP-2026-012] All tenants share one operator-owned Twilio sender
- **Severity:** blocker
- **Bars:** P0-public
- **Area:** sms
- **Status:** reconfirmed (B4)
- **Evidence (code):** `resolveSender` (`twilio-messaging.server.ts:42-52`) returns env default. `save_sms_sender` is locked (`api.org-settings.tsx:56-61`). **Correct** lock given the shared account; still a public-launch blocker.
- **Evidence (live):** Confirm A2P brand/campaign is operator-owned.
- **User / legal impact:** One abusive tenant filters the number for everyone. Inbound cannot be routed by To (root of NP-2026-004). A2P cannot be the tenant’s brand.
- **Fix recipe:** Per-org Messaging Service / subaccount inventory. `resolveSender` reads only that. Keep the lock until then. Managed single-tenant: acceptable as operator process.
- **Do not:** Re-enable tenant-writable `messaging_config.sender` without an allowlist.

### [NP-2026-013] Per-org From is unverified free text on the shared Resend key
- **Severity:** blocker
- **Bars:** P0-public
- **Area:** email
- **Status:** reconfirmed (B6)
- **Evidence (code):** `email-settings.ts` RFC-lite regex; comment “domain verification is an operator concern”. All sends use one `RESEND_API_KEY`.
- **Evidence (live):** not tested.
- **User / legal impact:** Tenant types unverified domain → runtime 422. Tenant types a domain the operator *has* verified (including another tenant’s) → From impersonation.
- **Fix recipe:** Bind org → Resend-verified domain (API or provisioned subdomain). Reject `from_address` outside that set. Unique index on normalized From. Managed: operator sets the one From.
- **Do not:** Trust settings placeholder copy as a control.

### [NP-2026-014] Inbound email mapping cannot work against the real Resend API
- **Severity:** blocker
- **Bars:** P0-public
- **Area:** email
- **Status:** reconfirmed (B7)
- **Evidence (code):** `email-events.ts:40-43` listens for `inbound.email.received` / `email.inbound`. Resend uses `email.received`. `str(d.to)` empties arrays. Receiving webhooks do not include full body. Tests freeze the wrong names.
- **Evidence (live):** not tested against Resend.
- **User / legal impact:** UI is a two-way inbox; replies vanish. Templates ask customers to reply (`NP-2026-032`).
- **Fix recipe:** Map `email.received`. Coerce `to`/`from` from `string | string[]`. Fetch body from Resend receiving API. Log unmatched. Tests using the real event shape.
- **Do not:** Ship the guessed event names.

### [NP-2026-015] Loader DB errors render as a healthy empty queue
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** cases
- **Status:** reconfirmed (M6)
- **Evidence (code):** `case-queue.server.ts:130-147` destructures `{ data }` and ignores `error`. Failed reads become `[]` / $0 KPIs.
- **Evidence (live):** not tested.
- **User / legal impact:** A collections team can believe there is nothing to collect while PostgREST is failing.
- **Fix recipe:** If any stage-1 query errors, throw (ErrorBoundary) or return an explicit `loadError` banner. Never convert `error` to empty metrics.
- **Do not:** `?? []` on a failed select.

### [NP-2026-016] Tests cannot run from a fresh clone; no CI
- **Severity:** blocker
- **Bars:** P0-managed (release process)
- **Area:** ops
- **Status:** reconfirmed (M27, M29)
- **Evidence (code):** No `.github/`. `package.json` has no `test` script. `tests/global-setup.ts:13` `readFileSync("../.env.test")`. This run: `ENV_TEST=missing`. `globalSetup` runs even for pure unit files.
- **Evidence (live):** `npx vitest run` not executed here because of ENOENT.
- **User / legal impact:** Nothing gates PRs. The 109-file suite is operator folklore.
- **Fix recipe:**
  1. Commit `.env.test.example`. Add `"test": "vitest run"` / `"test:unit"` that skips globalSetup for pure files. GitHub Action: typecheck + unit tests on every PR; integration job with `supabase start`.
  2. Document `npx supabase start` in README (replace the Cloudflare starter README).
- **Do not:** Require Docker for `priority.test.ts`.

---

## Majors (de-duplicated)

Full recipes for these also appear in the cited `wave-*` files. Cards below are complete enough to implement.

### [NP-2026-017] `qbo=` / `sync=` query params are never rendered
- **Severity:** major · **Bars:** P0-managed · **Area:** qbo · **Status:** reconfirmed (M17)
- **Evidence:** Callback/refresh/disconnect write `qbo=connected|error|forbidden|disconnected` and `sync=ok|error`. `dashboard.tsx` does not read them. Settings first-run bounce has no welcome (`workspace.server.ts:35-37`).
- **Fix recipe:** Banner on dashboard + Settings Integrations. Copy for each code. Clear the param after display (`use-flash-cleanup.ts` pattern).
- **Do not:** Only `console.log`.

### [NP-2026-018] Invites do not send email; `/invite` is linked from no page
- **Severity:** major · **Bars:** P0-public · **Area:** auth · **Status:** reconfirmed (M2)
- **Evidence:** `invite.tsx:38-54` inserts row, returns relative `/accept/<token>` in `<code>`. Button says “Sending invite…”. Grep: only `routes.ts` + `invite.tsx`. Raw `error.message` to client (minor 40).
- **Fix recipe:** Owner Settings → Workspace “Invite teammate”. Send via Resend (team-alert path, not customer `email_enabled`). Absolute URL + copy button. Generic errors. Unique pending `(org_id, email)`.
- **Do not:** Keep “Sending…” on a copy-link flow.

### [NP-2026-019] Multi-org membership is a trap (`resolveOrg` oldest)
- **Severity:** major · **Bars:** P0-public · **Area:** auth · **Status:** reconfirmed (M3)
- **Evidence:** `session.server.ts:34-40` `.order("created_at").limit(1)`.
- **Fix recipe:** Org switcher (cookie/org header) **or** reject a second membership until v2 and show “already in a workspace”.
- **Do not:** Accept the invite and silently keep org A.

### [NP-2026-020] No change-password, change-email, or account deletion
- **Severity:** major · **Bars:** P0-public · **Area:** auth · **Status:** reconfirmed (M5)
- **Evidence:** `api.profile.tsx` display_name only. Privacy policy punts deletion to support email.
- **Fix recipe:** Authenticated password change (current + new). Email change via confirm. Deletion: export + wipe memberships + QBO disconnect, matching privacy policy.

### [NP-2026-021] Session cookies are not HttpOnly, not Secure, max-age 400 days
- **Severity:** major · **Bars:** P0-public · **Area:** auth · **Status:** open
- **Evidence:** `supabase.server.ts` passes no `cookieOptions`. `@supabase/ssr` defaults: `httpOnly: false`, no `secure`, 400d (`node_modules/@supabase/ssr/src/utils/constants.ts`).
- **Fix recipe:** `cookieOptions: { httpOnly: true, secure: true (HTTPS), sameSite: "lax", maxAge: 7–30d }`. Tests assert Set-Cookie flags.
- **Do not:** `sameSite: "none"` “for OAuth”.

### [NP-2026-022] Login/signup/logout skip CSRF; login CSRF can swap the session
- **Severity:** major · **Bars:** P0-public · **Area:** auth · **Status:** reconfirmed (minor 39) + GHSA-h5cw-625j-3rxh
- **Evidence:** `requireSameOrigin` only inside `requireUser`. Login honors `returnTo` after attacker POST of attacker credentials.
- **Fix recipe:** Origin check on login/signup/logout. Upgrade `react-router` to **≥ 7.12.0** (NP-2026-040). Optional CSRF token. Same generic login error timing.

### [NP-2026-023] SyncIssues exists but is mounted nowhere
- **Severity:** major · **Bars:** P0-managed · **Area:** qbo · **Status:** reconfirmed (M9)
- **Evidence:** Zero route imports of `SyncIssues`. `reports.tsx` passes `null`. Failures only on Settings Integrations. Hidden `sm:inline-flex` even if mounted (minor 58).
- **Fix recipe:** Pass unresolved `sync_errors` into `AppShell` on dashboard/accounts/focus. Show on mobile.

### [NP-2026-024] Email never counts as last contact
- **Severity:** major · **Bars:** P0-managed · **Area:** cases · **Status:** reconfirmed (M10)
- **Evidence:** `case-queue.server.ts:213-250` uses `contact_logs` + outbound `text_messages` only.
- **Fix recipe:** Include outbound `email_messages` in last-contact. Tests: email-only customer is not “Never contacted” / +15 silence points.

### [NP-2026-025] Focus Mode has no collision/presence
- **Severity:** major · **Bars:** P0-managed · **Area:** focus · **Status:** reconfirmed (M7)
- **Evidence:** `focus.tsx:57-58` `includePresence: false`. Queue is deterministic → two agents double-text.
- **Fix recipe:** Same heartbeat as dashboard; skip/lock cases with live presence; show who.

### [NP-2026-026] Default templates resurrect after delete
- **Severity:** major · **Bars:** P0-managed · **Area:** settings · **Status:** reconfirmed (M16)
- **Evidence:** `message-templates.ts:38-47` appends missing default slugs.
- **Fix recipe:** Tombstone deleted default slugs **or** only merge defaults when DB count is 0. Test: delete `friendly-reminder`, reload, absent.

### [NP-2026-027] QBO realm switch merges two books
- **Severity:** major · **Bars:** P0-managed · **Area:** qbo · **Status:** reconfirmed (M19)
- **Evidence:** `storeConnection` upserts on `org_id`, replaces `realm_id`, no purge.
- **Fix recipe:** If `realm_id` changes, require typed confirm and delete org-scoped QBO rows (customers, invoices, payments, cases, messages) inside a transaction, then sync. Test: realm A then B → no A invoices.

### [NP-2026-028] QBO query/CDC cap 1000; `truncated` discarded
- **Severity:** major · **Bars:** P0-public · **Area:** qbo · **Status:** reconfirmed (M18)
- **Evidence:** `qbo-sync.server.ts:26-28,227`; refresh caller ignores return value. Comment sizes to Chancey.
- **Fix recipe:** Page Intuit queries. If truncated, `sync_errors` + do not advance CDC watermark.

### [NP-2026-029] CDC watermark stamped after processing
- **Severity:** major · **Bars:** P0-managed · **Area:** qbo · **Status:** reconfirmed (minor 22)
- **Evidence:** `qbo-sync.server.ts:320-321` `now` after upserts.
- **Fix recipe:** Capture `changedSince`/`fetchedAt` **before** the Intuit call; persist that. Tests for the skip window.

### [NP-2026-030] QBO deletions/voids mishandled
- **Severity:** major · **Bars:** P0-managed · **Area:** qbo · **Status:** reconfirmed (M26)
- **Evidence:** CDC flattens Deleted skeletons → customer `"(unnamed)"`. Webhook missing entity returns without closing local overdue rows.
- **Fix recipe:** Honor `Deleted` / void: zero balance or delete local row; recon will close cases. Never upsert `"(unnamed)"` over a named customer.

### [NP-2026-031] QBO webhook does Intuit+DB work before 200; no waitUntil
- **Severity:** major · **Bars:** P0-public · **Area:** qbo · **Status:** reconfirmed (M20)
- **Evidence:** `webhooks.qbo.tsx:45-76`. `waitUntil` only on crons.
- **Fix recipe:** Verify sig, enqueue `ctx.waitUntil(process)`, return 200 quickly. Idempotent upserts already allow retry.

### [NP-2026-032] No `reply_to`; templates ask customers to reply
- **Severity:** major · **Bars:** P0-public · **Area:** email · **Status:** reconfirmed (M22)
- **Evidence:** `email-client.server.ts:10-12` payload `{ from, to, subject, html?, text? }`.
- **Fix recipe:** Set `reply_to` to a received-mailbox. Document MX. Or change templates to “do not reply; use the portal/pay link”.

### [NP-2026-033] No List-Unsubscribe headers; postal address advertised as required then skipped
- **Severity:** major · **Bars:** P0-managed · **Area:** compliance · **Status:** reconfirmed (minor 32) + new
- **Evidence:** No `List-Unsubscribe` in repo. `email-settings.ts` accepts `email_enabled` with empty postal; send appends postal only if non-empty; UI says required.
- **Fix recipe:** Reject enable-without-postal. Always append postal. Add `List-Unsubscribe` + `List-Unsubscribe-Post`. Unsubscribe POST must honor RFC 8058 one-click (empty form POST with token).

### [NP-2026-034] `email.failed` / `email.suppressed` ignored
- **Severity:** major · **Bars:** P0-managed · **Area:** email · **Status:** reconfirmed (minor 26)
- **Evidence:** `email-events.ts` default `ignore`. Rows stay `sent`.
- **Fix recipe:** Map those types to bounced/failed; permanent bounce sets `do_not_email`.

### [NP-2026-035] No rate limits or send idempotency
- **Severity:** major · **Bars:** P0-public · **Area:** sms · **Status:** reconfirmed (M24, minor 29)
- **Evidence:** No `rateLimit` in app. `api.text.send`, bulk, `api.test-message`, login, invite, presence unbounded. Test SMS skips consent, quiet hours, `sms_enabled`, ledger.
- **Fix recipe:** Per-org and per-customer caps; Twilio `Idempotency-Key`; test-message throttle + quiet hours + ledger. Cloudflare rate-limit or Durable Object counters.

### [NP-2026-036] Member FOR ALL on audit tables; members can SELECT invite tokens and QBO ciphertext
- **Severity:** major · **Bars:** P0-public · **Area:** tenancy · **Status:** partial (M25) + new
- **Evidence:** `contact_logs`, `text_messages`, `collection_cases`, `promises` still member `FOR ALL` after 0032. Invites readable by members (bearer token). `qbo_connections` member SELECT includes token columns (app may not request them; PostgREST will if asked).
- **Fix recipe:** INSERT-only (or no DELETE/UPDATE) for logs/messages. Invites: members SELECT email/status **not** `token`. QBO: column privilege or view without `*_enc`. Tests with user JWT + PostgREST.

### [NP-2026-037] 0032 composite FKs are still NOT VALID
- **Severity:** major · **Bars:** P0-managed · **Area:** tenancy · **Status:** open
- **Evidence:** `0032_security_hardening.sql` `NOT VALID`. No later `VALIDATE CONSTRAINT`.
- **Fix recipe:** `VALIDATE CONSTRAINT` in a migration after data cleanup. Tests insert cross-org pair → fail.

### [NP-2026-038] Service-role `listUsers(1000)` on every dashboard load; writes sometimes key by id only
- **Severity:** major · **Bars:** P0-public · **Area:** tenancy · **Status:** reconfirmed (minor 52)
- **Evidence:** `orgs.server.ts:88`. Promise/alert paths in wave-1 RLS notes update by id without `org_id`.
- **Fix recipe:** Store display labels on `memberships` or paginate `listUsers` by membership user ids only. Always `.eq("org_id")` on service-role writes.

### [NP-2026-039] Missing security headers on the Worker
- **Severity:** major · **Bars:** P0-public · **Area:** ops · **Status:** open
- **Evidence:** Zero CSP/HSTS/XFO/Referrer-Policy/Permissions-Policy/X-Content-Type-Options. `workers/app.ts` returns RR unmodified.
- **Fix recipe:** Wrap fetch; set CSP (`frame-ancestors 'none'`), HSTS, nosniff, Referrer-Policy, Permissions-Policy. Apply to webhooks too.

### [NP-2026-040] `react-router@7.9.6` HIGH XSS/RCE/CSRF/DoS advisories
- **Severity:** major · **Bars:** P0-managed · **Area:** ops · **Status:** open
- **Evidence:** `npm audit` — GHSA-49rj-9fvp-4h2h (turbo-stream RCE), GHSA-h5cw-625j-3rxh (action CSRF), multiple XSS/DoS. Affected `<= 7.11.0`; patched in 7.12+/7.18.x. Also high: `nanoid`, `postcss`, `vite`, `ws`, `undici`, `brace-expansion`.
- **Fix recipe:** Upgrade `react-router` / `@react-router/dev` to a patched release and re-run typecheck + the suite. Then `npm audit` remaining build-toolchain issues. Do not `--force` blindly.

### [NP-2026-041] CDC cron is one serial loop over all orgs
- **Severity:** major · **Bars:** P0-public · **Area:** cron · **Status:** reconfirmed (M21)
- **Fix recipe:** Time budget + checkpoint `org_id`; fan-out via queue if tenant count grows. Per-org try/catch already exists — keep it.

### [NP-2026-042] No error monitoring
- **Severity:** major · **Bars:** P0-managed · **Area:** ops · **Status:** reconfirmed (M28)
- **Fix recipe:** Sentry or Cloudflare Workers Observability binding. Cron failures must not be `console.error` only.

### [NP-2026-043] QBO Disconnect is one unconfirmed click
- **Severity:** major · **Bars:** P0-managed · **Area:** qbo · **Status:** reconfirmed (M31)
- **Evidence:** `settings.tsx:248-252`. Locks workspace via `requireQbo`.
- **Fix recipe:** Confirm dialog (typed org name). GET Intuit disconnect remains a landing (already solid).

### [NP-2026-044] Onboarding replay creates orphan orgs
- **Severity:** major · **Bars:** P0-public · **Area:** auth · **Status:** reconfirmed (minor 1)
- **Fix recipe:** Action re-checks `resolveOrg`; if present, redirect dashboard. Unique membership constraint.

### [NP-2026-045] High-value threshold ≥ $10k silently stops affecting the 12-point band; client min $0.01 vs server $1,000
- **Severity:** major · **Bars:** P0-managed · **Area:** cases · **Status:** reconfirmed (minor 17, 34)
- **Evidence:** `priority.ts:39-45` hardcoded 25k/10k before org threshold. Form `min={0.01}`; parser `< 1000` rejected with wrong copy.
- **Fix recipe:** Apply org threshold before hardcoded bands, or cap the input at 9999.99 and match client/server + error copy.

### [NP-2026-046] Promise kept uses float compare; any balance drop counts as payment
- **Severity:** major · **Bars:** P0-managed · **Area:** promises · **Status:** reconfirmed (minor 33, 37)
- **Fix recipe:** Integer cents. Count only `payments` rows of type payment (not credit memo/void) toward `received`, or document that QBO balance is the source of truth and show why.

### [NP-2026-047] No inbox read state or live updates
- **Severity:** major · **Bars:** polish · **Area:** inbox · **Status:** reconfirmed (M14, M15)
- **Fix recipe:** `last_read_at` per thread; poll 15–30s or heartbeat; Needs reply uses unread inbound.

### [NP-2026-048] USD/en-US hardcoded; no CSV export
- **Severity:** major · **Bars:** P0-public · **Area:** reports · **Status:** reconfirmed (M12, M13)
- **Fix recipe:** US-only gate at QBO connect (CompanyInfo Country) **or** sync currency. CSV on reports + queue.

### [NP-2026-049] Team alerts gated on customer email channel; alert send is one-shot
- **Severity:** major · **Bars:** P0-managed · **Area:** notifications · **Status:** reconfirmed (minor 31, 53)
- **Fix recipe:** Separate operator mail env from `email_config.email_enabled`. Retry/ledger on failure.

### [NP-2026-050] Work queue not virtualized; revalidate every 20s while a case is open
- **Severity:** major · **Bars:** P0-public · **Area:** cases · **Status:** reconfirmed (M8)
- **Fix recipe:** Virtualize rows. Heartbeat should POST presence only, not reload the entire loader.

### [NP-2026-051] “Total customers” is not the QBO directory
- **Severity:** major · **Bars:** P0-managed · **Area:** accounts · **Status:** reconfirmed (M11)
- **Fix recipe:** Rename tile “Customers in collections” **or** sync the full customer list.

### [NP-2026-052] Staff SMS consent toggle / test-SMS to arbitrary numbers
- **Severity:** major · **Bars:** P0-managed · **Area:** compliance · **Status:** reconfirmed (minor 38) + TEMP-SEC-003
- **Fix recipe:** Consent API must not set true without provenance (NP-2026-011). Test SMS: owner + throttle + quiet hours + ledger + no production customer numbers by default.

### [NP-2026-053] Copper / Focus contrast fail WCAG AA; unlabeled core controls
- **Severity:** major · **Bars:** polish · **Area:** a11y · **Status:** reconfirmed (M32–M34)
- **Evidence:** `--color-copper: #cf8136` (`app.css:12`). Focus `text-muted` on `bg-ink`. Focus SMS body, accounts search, late-fee toggle: placeholder-as-label.
- **Fix recipe:** Darken copper on light surfaces (~4.5:1). Lighten Focus secondary text. Visible `<label>` / `aria-label` on those three controls.

### [NP-2026-054] CloudEvents QBO parser is unverified; no Intuit 429 backoff
- **Severity:** major · **Bars:** P0-managed · **Area:** qbo · **Status:** reconfirmed (minor 21, 25)
- **Fix recipe:** Capture one real production payload, lock tests to it. Honor 429 Retry-After with bounded retry.

---

## Minors (fix recipes)

| ID | Prior | Title | Fix recipe (short) |
|---|---|---|---|
| NP-2026-101 | min 2 | Reports nav “(coming soon)” for members | Use “Owner only” or hide the item. |
| NP-2026-102 | min 3 | Avatar POST-logout | Profile menu: name, settings, confirm sign out. |
| NP-2026-103 | min 4 | Generic auth errors | Map more GoTrue strings; keep timing equal. |
| NP-2026-104 | min 5 | Thin landing; EULA “private beta” | Real marketing or “internal tool”; drop private-beta before Intuit. |
| NP-2026-105 | min 6 | Empty queue “Clear the search” | First-run copy vs filter-miss copy. |
| NP-2026-106 | min 7 | Focus raw error codes | Map SMS error codes to human copy. |
| NP-2026-107 | min 8 | Focus hidden below `sm` | Show Focus in mobile nav or a usable mobile deck. |
| NP-2026-108 | min 9 | Bulk skip summary omits do-not-text | Add the bucket; counts must sum to selection. |
| NP-2026-109 | min 10 p | DetailPanel consent posts only invoiceId | Always post `customerId` (inbox already does). |
| NP-2026-110 | min 11 | Detail `w-96` overflow on phones | Stack detail below list on `<md`. |
| NP-2026-111 | min 12 | Coming-due copy “7 days” | Use `orgConfig.workflow.comingDueDays`. |
| NP-2026-112 | min 13 | `todayISO()` UTC vs org-local | Pass org-local today into DetailPanel. |
| NP-2026-113 | min 14 | Promises page has no cancel | Wire `api.promises.cancel` + renegotiate. |
| NP-2026-114 | min 15 | SSR UTC dates | Org-tz format; include time where useful. |
| NP-2026-115 | min 16 p | `saved=1` lights wrong Collections forms | Distinct flash keys per form (rules already lack UI). |
| NP-2026-116 | min 18 | No unsaved-changes on settings tabs | Dirty guard before `<Link>` tab switch. |
| NP-2026-117 | min 19 | Template editor no preview/tokens | Preview pane; insert buttons; warn unknown `{tokens}`. |
| NP-2026-118 | min 20 | SMS bubbles no timestamps / no scroll | Show time; `scrollIntoView` on last. |
| NP-2026-119 | min 23 | Invoice status stale when due date passes | Nightly status recompute or derive at read. |
| NP-2026-120 | min 24 | No retention job | Cron: expire oauth_states, old notification_log, resolved sync_errors, pending invites. |
| NP-2026-121 | min 27 | No STOP language in SMS templates | Add “Reply STOP to opt out” to defaults **and** append if missing at send. |
| NP-2026-122 | min 28 | Quiet hours = org TZ not recipient | Document US-only; later store customer TZ. |
| NP-2026-123 | min 30 | Bulk SMS swallows per-case errors | Return `{ caseId, error }[]`; show in drawer. |
| NP-2026-124 | min 35 | Dead `priorityOf` in worklist.ts | Delete dead scorer / zeroed metrics or stop exporting. |
| NP-2026-125 | min 36 | Late-fee model simplistic | Document display-only + formula; optional cap. |
| NP-2026-126 | min 40 | Invite returns raw DB errors | Generic “Could not create invite”. |
| NP-2026-127 | min 41 | `dev-data.sql` trips 0032 trigger | Run as service_role or stop updating `phone`. |
| NP-2026-128 | min 42 | `email_config.updated_at` never set | Trigger or set on upsert. |
| NP-2026-129 | min 43 | Audit actor uuids have no FK / ON DELETE | Add FKs with ON DELETE SET NULL; document auth-user deletion. |
| NP-2026-130 | min 44 | Duplicate pending invites | Unique `(org_id, email) WHERE accepted_at IS NULL`. |
| NP-2026-131 | min 45 | No robots/OG/description | `meta.ts` description; `robots.txt`; OG on `/`. |
| NP-2026-132 | min 46–48 | README / AGENTS / starter boilerplate | Rewrite app README; migrations 0001–0034; `organizations` not `orgs`; drop `publish: true`. |
| NP-2026-133 | min 49 | No LICENSE | Add one before public launch. |
| NP-2026-134 | min 50 | Demo PNGs in git | Git LFS or drop from main. |
| NP-2026-135 | min 51 | Legacy anon key rotation pending | Rotate hosted anon key; treat git history as leaked. |
| NP-2026-136 | min 54–57 | A11y: table semantics, reduced-motion, scrim aria, template tabs | `table`/`th`; `@media (prefers-reduced-motion)`; fix scrim; real tabs. |
| NP-2026-137 | min 59–61 | No live regions; no in-app bell; first-run no welcome | `aria-live`; optional bell; Integrations welcome copy. |
| NP-2026-138 | new | Contact methods only call/text/note | Add email/in-person/voicemail if collectors need them, or update docs. |
| NP-2026-139 | new | HELP/INFO SMS keywords missing | CTIA: HELP → org name + opt-out instructions TwiML. |
| NP-2026-140 | new | Phone match is last-10 only | Store E.164; match on normalized full number. |
| NP-2026-141 | new | Privacy/EULA omit Resend | Disclose email processor + inbound. |
| NP-2026-142 | new | `save_sms_sender` locked (not a bug) | Keep locked until NP-2026-012. Document in Settings UI (already “Inactive”). |
| NP-2026-143 | new | Focus includes waiting/promised; snooze writes last-contact | Exclude parked cases from focus deck; snooze must not count as contact. |
| NP-2026-144 | new | Terminal DNC does not block Focus log-call / applyNextStep | Server-gate log-call the same as SMS for `blocksContact`. |
| NP-2026-145 | new | Empty client chunks for API routes | Harmless RR resource-route split; ignore unless bundle audit cares. |

---

## Solid (not findings)

See `00-executive.md` “What is verified solid” and each `wave-*` file’s solid list. PR #43 (`0034` oauth user bind) is the only product change since the July 13 audit; it does **not** close any July 13 blocker.
