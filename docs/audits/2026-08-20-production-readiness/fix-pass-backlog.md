# Fix-pass backlog

Dependency-ordered batches generated from `findings.json`. Product fixes were not made during this audit. Each packet carries its prior aliases so closure updates the same ledger rather than creating a new defect ID.

## 1. Security, legal communication, and tenant controls

**Batch dependency:** Freeze the retained candidate and isolated audit resources.

**Batch execution controls:** Write focused regression tests before product changes; include unauthorized, cross-tenant, duplicate-submit, retry, and concurrency cases wherever state changes. Apply database changes only after historical-data preflight and backup. Verify affected browser and provider paths on both Cloudflare and Render staging. Deploy to retained isolated staging first, preserve the previous deploy and database restore point, rehearse rollback, and attach redacted test, browser/provider, migration, deploy, monitoring, and rollback evidence before changing a disposition.

### Finding packets

#### NP-AUD-2026-001 — No password reset / forgot-password flow

- **Owner / size / gate:** security; M; blocker.
- **Prior aliases:** july-13:B0 (still-open); august-20-canonical:NP-2026-001 (still-open); august-20-wave:AUG20:wave-1:auth:TEMP-AUTH-001 (duplicate-merged); august-20-wave:AUG20:wave-2:workflow-static:TEMP-WF-007 (duplicate-merged).
- **Root cause:** nudgepay-app/app/routes.ts has no recovery route. login.tsx is email+password only. Repo grep for resetPasswordForEmail in app/ is empty. api.profile.tsx updateUser writes display_name only.
- **Exact source areas:** nudgepay-app/app/routes.ts; nudgepay-app/app/routes/login.tsx; nudgepay-app/app/routes/api.profile.tsx; forgot-password.tsx; auth.confirm.tsx; reset-password.tsx.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-001; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** 1. Add forgot-password.tsx + auth.confirm.tsx (shared with NP-2026-002) + reset-password.tsx. Register in routes.ts. Link from login.tsx. 2. resetPasswordForEmail with redirectTo = production /auth/confirm. Confirm exchanges token_hash via verifyOtp({ type: "recovery" }). New-password POST behind requireUser + requireSameOrigin. Same success copy whether or not the email exists. 3. Tests: unknown email same copy/timing; recovery sets cookies; redirectTo open-redirect rejected; CSRF on password POST. 4. Manual: request reset, set new password, old password fails.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-002 — No /auth/confirm; signup confirm branch drops Set-Cookie

- **Owner / size / gate:** security; M; blocker.
- **Prior aliases:** july-13:M1 (still-open); august-20-canonical:NP-2026-002 (still-open); august-20-wave:AUG20:wave-1:auth:TEMP-AUTH-002 (duplicate-merged).
- **Root cause:** No confirm route. signup.tsx:39-41 returns { confirmEmail, returnTo } and drops headers from createSupabaseUserClient. auth-flow.server.ts:6-16 documents production confirmations ON → session null. Local enable_confirmations = false hides this in dev. site_url in config.toml points at /.
- **Exact source areas:** nudgepay-app/app/routes/signup.tsx:39; nudgepay-app/app/lib/auth-flow.server.ts:6; nudgepay-app/supabase/config.toml; auth.confirm.tsx.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-002; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** 1. auth.confirm.tsx: verifyOtp then safeReturnTo(next). Return signup confirm JSON with headers. Set hosted site_url / redirect allowlist to /auth/confirm. 2. Support type=signup|email|recovery. Never render tokens in HTML. 3. Tests: valid hash sets Set-Cookie and honors next=/accept/<token>; signup confirm response includes Set-Cookie. 4. Manual: confirmations ON, sign up with invite returnTo, click mail, land signed-in on accept.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-003 — Account-profile Save preferences silently re-subscribes unsubscribed customers

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** july-13:B3 (still-open); august-20-canonical:NP-2026-003 (still-open); august-20-wave:AUG20:wave-1:email:TEMP-EMAIL-001 (duplicate-merged); august-20-wave:AUG20:wave-1:email:TEMP-EMAIL-009 (duplicate-merged); august-20-wave:AUG20:wave-2:workflow-static:TEMP-WF-004 (duplicate-merged).
- **Root cause:** AccountProfile.tsx:120-142 posts preferred_channel, do_not_call, do_not_text only. api.comm-prefs.tsx:20-22 writes do_not_email: form.get("do_not_email") === "true". accounts.$id.tsx SELECT omits do_not_email. tests/api-comm-prefs.test.ts:13-15 locks the wipe in. CommPrefsDrawer.tsx:64 has the checkbox (dashboard only).
- **Exact source areas:** nudgepay-app/app/components/AccountProfile.tsx:120; nudgepay-app/app/routes/api.comm-prefs.tsx:20; nudgepay-app/app/routes/accounts.$id.tsx; nudgepay-app/tests/api-comm-prefs.test.ts:13; nudgepay-app/app/components/CommPrefsDrawer.tsx:64.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-003; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** 1. Add do_not_email checkbox to AccountProfile (same pattern as drawer). SELECT the column in accounts.$id.tsx. 2. Change parseCommPrefsUpdate: omit do_not_email from the UPDATE when the field was not posted (or require a hidden sentinel that preserves current DB value). Never default missing → false. 3. Tests: form without the field leaves DB true; form with checkbox off after explicit “re-subscribe” is a separate, confirmed path. 4. Manual: unsubscribe via token, open account profile, Save owner, confirm do_not_email still true, send path still blocked.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-004 — Unmatched inbound SMS, including STOP, is dropped with HTTP 200

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** july-13:B5 (still-open); august-20-canonical:NP-2026-004 (still-open); august-20-wave:AUG20:wave-1:sms:TEMP-SMS-002 (duplicate-merged).
- **Root cause:** twilio-messaging.server.ts:156-211 — resolveInboundOrgId null unless exactly one org has outbound history; then customer match; else { matched: false, optOut: false } with no insert. STOP handling is after that. webhooks.twilio.inbound.tsx always 200s empty TwiML. Tests twilio-inbound.test.ts:58-60 expect the drop.
- **Exact source areas:** nudgepay-app/app/lib/twilio-messaging.server.ts:156; nudgepay-app/app/routes/webhooks.twilio.inbound.tsx; nudgepay-app/tests/twilio-inbound.test.ts:58.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-004; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** 1. Persist unmatched inbound (From, To, Body, SID) before 200. 2. On STOP/START, apply to every customer whose last-10 matches (all orgs with history), or route solely by To once per-org senders exist (NP-2026-012). 3. SQL-filter phone_last10 instead of loading the org (1,000-row cap). 4. Alert ops on unmatched STOP. Return TwiML confirming opt-out. 5. Tests: unknown From + body STOP is stored and flagged; two-org collision still records STOP somewhere.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-005 — QBO OAuth callback never runs the overdue backfill

- **Owner / size / gate:** security; M; blocker.
- **Prior aliases:** july-13:B8 (still-open); august-20-canonical:NP-2026-005 (still-open); august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-001 (duplicate-merged); august-20-wave:AUG20:wave-2:workflow-static:TEMP-WF-002 (duplicate-merged).
- **Root cause:** auth.qbo.callback.tsx:32-34 stores tokens, redirects ?qbo=connected, no syncOverdueInvoices. That function is only api.qbo.refresh.tsx:44. CDC first-run window is 7 days (qbo-sync.server.ts). Dashboard never reads qbo= (NP-2026-017).
- **Exact source areas:** nudgepay-app/app/routes/auth.qbo.callback.tsx:32; nudgepay-app/app/routes/api.qbo.refresh.tsx:44; nudgepay-app/app/lib/qbo-sync.server.ts.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-005; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** 1. After storeConnection, ctx.waitUntil(syncOverdueInvoices(...)) or redirect to a “Syncing…” page that POSTs refresh. Keep the callback fast enough for Intuit. 2. Render ?qbo=connected|error|forbidden on dashboard/settings (NP-2026-017). 3. Tests: callback mock stores tokens and invokes sync deps; failed sync records sync_errors and still shows reconnect copy. 4. Manual: sandbox connect, invoices on dashboard without clicking Sync now.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-009 — Intuit compliance URLs 404; Netlify redirects are placeholders

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** july-13:B11 (still-open); july-13:M30 (still-open); august-20-canonical:NP-2026-009 (still-open); august-20-wave:AUG20:wave-1:ops-a11y:TEMP-OPS-007 (duplicate-merged); august-20-wave:AUG20:wave-1:ops-a11y:TEMP-OPS-008 (duplicate-merged).
- **Root cause:** netlify/_redirects:8-10 → https://WORKER_PROD_URL_PLACEHOLDER/.... docs/intuit-production-checklist.md same placeholder.
- **Exact source areas:** docs/intuit-production-checklist.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-009; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** 1. Replace placeholder with the real Worker origin. netlify deploy --prod --dir netlify. Submit Worker URLs in Intuit portal. 2. Curl -I must 301 to Worker /privacy and /eula with 200 HTML (operator 9th Level Software, QBO scope). 3. Fill every row of the Intuit checklist.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-010 — No member removal, role change, leave-org; memberships RLS is SELECT-only

- **Owner / size / gate:** security; M; blocker.
- **Prior aliases:** july-13:M4 (still-open); august-20-canonical:NP-2026-010 (still-open); august-20-wave:AUG20:wave-1:auth:TEMP-AUTH-012 (duplicate-merged).
- **Root cause:** 0002_rls_policies.sql:23-24 mem_select only. No DELETE/UPDATE policy, no API, Workspace roster is display-name only (settings.tsx).
- **Exact source areas:** nudgepay-app/supabase/migrations/0002_rls_policies.sql:23; nudgepay-app/app/routes/settings.tsx; *-rls.test.ts.
- **Migration / compatibility:** Review existing data before validating or tightening constraints.; Preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-010; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** 1. Owner-only DELETE/UPDATE policies on memberships. API + UI: remove member, change role, revoke pending invite, leave-org (block leaving last owner). 2. Tests in *-rls.test.ts: member cannot delete others; owner can; last owner cannot leave. 3. Manual: remove a user, their next dashboard load redirects, SMS send 401/403.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Preflight historical rows, snapshot the audit database, use a compatible forward migration, rehearse application rollback against the migrated schema, and retain restore evidence.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-011 — Consent has no provenance; STOP is one-click reversible

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** july-13:M23 (still-open); august-20-canonical:NP-2026-011 (still-open); august-20-wave:AUG20:wave-1:sms:TEMP-SMS-003 (duplicate-merged).
- **Root cause:** customers.sms_consent boolean. api.sms-consent.tsx sets true/false. UI “Mark consented” after STOP (MessageThreadPanel.tsx). STOP does not set do_not_text. No source/timestamp column.
- **Exact source areas:** nudgepay-app/app/routes/api.sms-consent.tsx; nudgepay-app/app/components/MessageThreadPanel.tsx.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-011; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** 1. Add sms_consent_source (inbound_stop|inbound_start|staff|import) + sms_consent_at + optional actor. Inbound STOP sets sms_consent=false and do_not_text=true and is not reversible from “Mark consented” without a logged staff override reason. 2. Hide “Mark consented” when source is inbound_stop unless owner + typed reason. 3. Tests: STOP then staff toggle without reason leaves false; START may re-enable per CTIA.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-012 — All tenants share one operator-owned Twilio sender

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** july-13:B4 (still-open); august-20-canonical:NP-2026-012 (still-open); august-20-wave:AUG20:wave-1:sms:TEMP-SMS-001 (duplicate-merged).
- **Root cause:** resolveSender (twilio-messaging.server.ts:42-52) returns env default. save_sms_sender is locked (api.org-settings.tsx:56-61). Correct lock given the shared account; still a public-launch blocker.
- **Exact source areas:** nudgepay-app/app/lib/twilio-messaging.server.ts:42; nudgepay-app/app/routes/api.org-settings.tsx:56.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-012; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Per-org Messaging Service / subaccount inventory. resolveSender reads only that. Keep the lock until then. Managed single-tenant: acceptable as operator process.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-013 — Per-org From is unverified free text on the shared Resend key

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** july-13:B6 (still-open); august-20-canonical:NP-2026-013 (still-open); august-20-wave:AUG20:wave-1:email:TEMP-EMAIL-003 (duplicate-merged); august-20-wave:AUG20:wave-1:rls-tenancy:TEMP-RLS-011 (duplicate-merged).
- **Root cause:** email-settings.ts RFC-lite regex; comment “domain verification is an operator concern”. All sends use one RESEND_API_KEY.
- **Exact source areas:** nudgepay-app/app/lib/email-settings.ts.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-013; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Bind org → Resend-verified domain (API or provisioned subdomain). Reject from_address outside that set. Unique index on normalized From. Managed: operator sets the one From.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-014 — Inbound email mapping cannot work against the real Resend API

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** july-13:B7 (still-open); august-20-canonical:NP-2026-014 (still-open); august-20-wave:AUG20:wave-1:email:TEMP-EMAIL-004 (duplicate-merged).
- **Root cause:** email-events.ts:40-43 listens for inbound.email.received / email.inbound. Resend uses email.received. str(d.to) empties arrays. Receiving webhooks do not include full body. Tests freeze the wrong names.
- **Exact source areas:** nudgepay-app/app/lib/email-events.ts:40.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-014; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Map email.received. Coerce to/from from string | string[]. Fetch body from Resend receiving API. Log unmatched. Tests using the real event shape.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-021 — Session cookies are not HttpOnly, not Secure, max-age 400 days

- **Owner / size / gate:** security; M; blocker.
- **Prior aliases:** august-20-canonical:NP-2026-021 (still-open); august-20-wave:AUG20:wave-1:auth:TEMP-AUTH-003 (duplicate-merged); august-20-wave:AUG20:wave-3:security:TEMP-SEC-003 (duplicate-merged).
- **Root cause:** supabase.server.ts passes no cookieOptions. @supabase/ssr defaults: httpOnly: false, no secure, 400d (node_modules/@supabase/ssr/src/utils/constants.ts).
- **Exact source areas:** nudgepay-app/app/lib/supabase.server.ts; node_modules/@supabase/ssr/src/utils/constants.ts.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-021; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** cookieOptions: { httpOnly: true, secure: true (HTTPS), sameSite: "lax", maxAge: 7–30d }. Tests assert Set-Cookie flags.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-022-AUTH-CSRF — Login and signup lack same-origin CSRF protection

- **Owner / size / gate:** security; M; blocker.
- **Prior aliases:** july-13:min 39 (still-open); august-20-canonical:NP-2026-022 (superseded); august-20-wave:AUG20:wave-1:auth:TEMP-AUTH-004 (duplicate-merged); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-TEST-006 (still-open); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-SEC-001 (duplicate-merged); august-20-wave:AUG20:wave-3:security:TEMP-SEC-002 (duplicate-merged).
- **Root cause:** requireSameOrigin only inside requireUser. Login honors returnTo after attacker POST of attacker credentials.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-022-AUTH-CSRF; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Origin check on login/signup/logout. Upgrade react-router to ≥ 7.12.0 (NP-2026-040). Optional CSRF token. Same generic login error timing.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-022-LOGOUT-CSRF — Logout lacks same-origin CSRF protection

- **Owner / size / gate:** security; M; blocker.
- **Prior aliases:** july-13:min 39 (still-open); august-20-canonical:NP-2026-022 (superseded); august-20-wave:AUG20:wave-1:auth:TEMP-AUTH-005 (duplicate-merged).
- **Root cause:** requireSameOrigin only inside requireUser. Login honors returnTo after attacker POST of attacker credentials.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-022-LOGOUT-CSRF; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Origin check on login/signup/logout. Upgrade react-router to ≥ 7.12.0 (NP-2026-040). Optional CSRF token. Same generic login error timing.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-033-POSTAL — Customer email sends do not enforce or always render a postal address

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** august-20-canonical:NP-2026-033 (superseded); august-20-wave:AUG20:wave-1:email:TEMP-EMAIL-002 (duplicate-merged).
- **Root cause:** No List-Unsubscribe in repo. email-settings.ts accepts email_enabled with empty postal; send appends postal only if non-empty; UI says required.
- **Exact source areas:** nudgepay-app/app/lib/email-settings.ts.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-033-POSTAL; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Reject enable-without-postal. Always append postal. Add List-Unsubscribe + List-Unsubscribe-Post. Unsubscribe POST must honor RFC 8058 one-click (empty form POST with token).
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-033-UNSUBSCRIBE — List-Unsubscribe and RFC 8058 one-click support are missing

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** july-13:min 32 (still-open); august-20-canonical:NP-2026-033 (superseded); august-20-wave:AUG20:wave-1:email:TEMP-EMAIL-005 (duplicate-merged).
- **Root cause:** No List-Unsubscribe in repo. email-settings.ts accepts email_enabled with empty postal; send appends postal only if non-empty; UI says required.
- **Exact source areas:** nudgepay-app/app/lib/email-settings.ts.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-033-UNSUBSCRIBE; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Reject enable-without-postal. Always append postal. Add List-Unsubscribe + List-Unsubscribe-Post. Unsubscribe POST must honor RFC 8058 one-click (empty form POST with token).
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-035-EMAIL-RATE — Email sends lack rate limiting and idempotency

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** july-13:M24 (still-open); july-13:min 29 (still-open); august-20-canonical:NP-2026-035 (superseded); august-20-wave:AUG20:wave-1:email:TEMP-EMAIL-011 (duplicate-merged); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-SEC-002 (duplicate-merged); august-20-wave:AUG20:wave-3:security:TEMP-SEC-004 (duplicate-merged).
- **Root cause:** No rateLimit in app. api.text.send, bulk, api.test-message, login, invite, presence unbounded. Test SMS skips consent, quiet hours, sms_enabled, ledger.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-035-EMAIL-RATE; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Per-org and per-customer caps; Twilio Idempotency-Key; test-message throttle + quiet hours + ledger. Cloudflare rate-limit or Durable Object counters.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-035-SMS-RATE — SMS sends lack rate limiting and idempotency

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** july-13:M24 (still-open); july-13:min 29 (still-open); august-20-canonical:NP-2026-035 (superseded); august-20-wave:AUG20:wave-1:sms:TEMP-SMS-008 (duplicate-merged); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-TEST-005 (duplicate-merged); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-SEC-002 (duplicate-merged); august-20-wave:AUG20:wave-3:security:TEMP-SEC-004 (duplicate-merged).
- **Root cause:** No rateLimit in app. api.text.send, bulk, api.test-message, login, invite, presence unbounded. Test SMS skips consent, quiet hours, sms_enabled, ledger.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-035-SMS-RATE; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Per-org and per-customer caps; Twilio Idempotency-Key; test-message throttle + quiet hours + ledger. Cloudflare rate-limit or Durable Object counters.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-036-INVITE-TOKEN — Members can retrieve invite bearer tokens

- **Owner / size / gate:** security; M; blocker.
- **Prior aliases:** august-20-canonical:NP-2026-036 (superseded); august-20-wave:AUG20:wave-1:rls-tenancy:TEMP-RLS-003 (duplicate-merged).
- **Root cause:** contact_logs, text_messages, collection_cases, promises still member FOR ALL after 0032. Invites readable by members (bearer token). qbo_connections member SELECT includes token columns (app may not request them; PostgREST will if asked).
- **Exact source areas:** docs/production-audit-2026-08-20/01-findings.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-036-INVITE-TOKEN; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** INSERT-only (or no DELETE/UPDATE) for logs/messages. Invites: members SELECT email/status not token. QBO: column privilege or view without *_enc. Tests with user JWT + PostgREST.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-036-LEDGER-RLS — Members can rewrite or delete audit and messaging ledgers

- **Owner / size / gate:** security; M; blocker.
- **Prior aliases:** july-13:M25 (partially-fixed); august-20-canonical:NP-2026-036 (superseded); august-20-wave:AUG20:wave-1:rls-tenancy:TEMP-RLS-002 (duplicate-merged); august-20-wave:AUG20:wave-1:sms:TEMP-SMS-013 (still-open); august-20-wave:AUG20:wave-3:security:TEMP-SEC-008 (duplicate-merged).
- **Root cause:** contact_logs, text_messages, collection_cases, promises still member FOR ALL after 0032. Invites readable by members (bearer token). qbo_connections member SELECT includes token columns (app may not request them; PostgREST will if asked).
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-036-LEDGER-RLS; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** INSERT-only (or no DELETE/UPDATE) for logs/messages. Invites: members SELECT email/status not token. QBO: column privilege or view without *_enc. Tests with user JWT + PostgREST.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-037 — 0032 composite FKs are still NOT VALID

- **Owner / size / gate:** security; M; blocker.
- **Prior aliases:** august-20-canonical:NP-2026-037 (still-open); august-20-wave:AUG20:wave-1:rls-tenancy:TEMP-RLS-001 (duplicate-merged).
- **Root cause:** 0032_security_hardening.sql NOT VALID. No later VALIDATE CONSTRAINT.
- **Exact source areas:** nudgepay-app/supabase/migrations/0032_security_hardening.sql.
- **Migration / compatibility:** Review existing data before validating or tightening constraints.; Preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-037; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** VALIDATE CONSTRAINT in a migration after data cleanup. Tests insert cross-org pair → fail.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Preflight historical rows, snapshot the audit database, use a compatible forward migration, rehearse application rollback against the migrated schema, and retain restore evidence.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-052-CONSENT-TOGGLE — Staff can re-enable SMS consent without provenance

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** august-20-canonical:NP-2026-052 (superseded); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-SEC-003 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-052. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/01-findings.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-052-CONSENT-TOGGLE; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Consent API must not set true without provenance (NP-2026-011). Test SMS: owner + throttle + quiet hours + ledger + no production customer numbers by default.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-052-TEST-SMS — Owner test SMS can target arbitrary numbers without production controls

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** july-13:min 38 (still-open); august-20-canonical:NP-2026-052 (superseded); august-20-wave:AUG20:wave-1:settings-ux:TEMP-SET-012 (duplicate-merged); august-20-wave:AUG20:wave-1:sms:TEMP-SMS-007 (duplicate-merged); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-SEC-004 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-052. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-052-TEST-SMS; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Consent API must not set true without provenance (NP-2026-011). Test SMS: owner + throttle + quiet hours + ledger + no production customer numbers by default.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-121 — No STOP language in SMS templates

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** july-13:min 27 (still-open); august-20-canonical:NP-2026-121 (still-open); august-20-wave:AUG20:wave-1:settings-ux:TEMP-SET-015 (duplicate-merged); august-20-wave:AUG20:wave-1:sms:TEMP-SMS-004 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-121. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-121; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add “Reply STOP to opt out” to defaults and append if missing at send.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-139 — HELP/INFO SMS keywords missing

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** august-20-canonical:NP-2026-139 (still-open); august-20-wave:AUG20:wave-1:sms:TEMP-SMS-005 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-139. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/01-findings.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-139; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** CTIA: HELP → org name + opt-out instructions TwiML.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-141 — Privacy/EULA omit Resend

- **Owner / size / gate:** legal; M; blocker.
- **Prior aliases:** august-20-canonical:NP-2026-141 (still-open); august-20-wave:AUG20:wave-1:email:TEMP-EMAIL-010 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-141. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/01-findings.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-141; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Disclose email processor + inbound.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-D01 — Render trusts forwarded origin headers without a bounded proxy or host allowlist

- **Owner / size / gate:** security; S; blocker.
- **Prior aliases:** current-delta:WORKTREE:FORWARDED-ORIGIN (unverified).
- **Root cause:** The Node runtime sets trust proxy to true, while the React Router adapter constructs request origin from forwarded protocol and host. Deployed header sanitization was not proven.
- **Exact source areas:** nudgepay-app/server.js:20; nudgepay-app/app/lib/csrf.server.ts:16.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-D01; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Use a bounded trusted-hop/address policy and validate the effective host against explicit runtime configuration; test hostile forwarded headers on staging.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-D05 — Mandatory Codex Deep Security Scan could not start

- **Owner / size / gate:** security; XS; blocker.
- **Prior aliases:** current-delta:WORKTREE:DEEP-SCAN (unverified).
- **Root cause:** The scanner required a managed filesystem permission profile and TAC status could not be checked because the connector was not logged in.
- **Exact source areas:** docs/audits/2026-08-20-production-readiness/evidence/security/README.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-D05; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Re-run the Deep Security Scan in a managed read-only workspace, complete it once, and link the sealed artifacts before re-verification.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-X228 — Login CSRF, duplicate-org onboarding, and invite accept mismatches can ship green

- **Owner / size / gate:** security; M; blocker.
- **Prior aliases:** august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-TEST-006 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-1:tests-and-mutations:TEMP-TEST-006. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-1/tests-and-mutations.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X228; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-018 — Invites do not send email; /invite is linked from no page

- **Owner / size / gate:** security; S; conditional.
- **Prior aliases:** july-13:M2 (still-open); august-20-canonical:NP-2026-018 (still-open); august-20-wave:AUG20:wave-1:auth:TEMP-AUTH-007 (duplicate-merged); august-20-wave:AUG20:wave-1:settings-ux:TEMP-SET-010 (duplicate-merged); august-20-wave:AUG20:wave-1:settings-ux:TEMP-UX-010 (duplicate-merged); august-20-wave:AUG20:wave-2:workflow-static:TEMP-WF-014 (duplicate-merged).
- **Root cause:** invite.tsx:38-54 inserts row, returns relative /accept/<token> in <code>. Button says “Sending invite…”. Grep: only routes.ts + invite.tsx. Raw error.message to client (minor 40).
- **Exact source areas:** nudgepay-app/app/routes/invite.tsx:38; nudgepay-app/app/routes.ts; nudgepay-app/app/routes/invite.tsx.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-018; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Owner Settings → Workspace “Invite teammate”. Send via Resend (team-alert path, not customer email_enabled). Absolute URL + copy button. Generic errors. Unique pending (org_id, email).
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-019 — Multi-org membership is a trap (resolveOrg oldest)

- **Owner / size / gate:** security; S; conditional.
- **Prior aliases:** july-13:M3 (still-open); august-20-canonical:NP-2026-019 (still-open); august-20-wave:AUG20:wave-1:auth:TEMP-AUTH-011 (duplicate-merged); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-SEC-005 (duplicate-merged).
- **Root cause:** session.server.ts:34-40 .order("created_at").limit(1).
- **Exact source areas:** nudgepay-app/app/lib/session.server.ts:34.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-019; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Org switcher (cookie/org header) or reject a second membership until v2 and show “already in a workspace”.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-020 — No change-password, change-email, or account deletion

- **Owner / size / gate:** security; S; conditional.
- **Prior aliases:** july-13:M5 (still-open); august-20-canonical:NP-2026-020 (still-open); august-20-wave:AUG20:wave-1:auth:TEMP-AUTH-006 (duplicate-merged).
- **Root cause:** api.profile.tsx display_name only. Privacy policy punts deletion to support email.
- **Exact source areas:** nudgepay-app/app/routes/api.profile.tsx.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-020; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Authenticated password change (current + new). Email change via confirm. Deletion: export + wipe memberships + QBO disconnect, matching privacy policy.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-032 — No reply_to; templates ask customers to reply

- **Owner / size / gate:** legal; S; conditional.
- **Prior aliases:** july-13:M22 (still-open); august-20-canonical:NP-2026-032 (still-open); august-20-wave:AUG20:wave-1:email:TEMP-EMAIL-006 (duplicate-merged).
- **Root cause:** email-client.server.ts:10-12 payload { from, to, subject, html?, text? }.
- **Exact source areas:** nudgepay-app/app/lib/email-client.server.ts:10.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-032; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Set reply_to to a received-mailbox. Document MX. Or change templates to “do not reply; use the portal/pay link”.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-034 — email.failed / email.suppressed ignored

- **Owner / size / gate:** legal; S; conditional.
- **Prior aliases:** july-13:min 26 (still-open); august-20-canonical:NP-2026-034 (still-open); august-20-wave:AUG20:wave-1:email:TEMP-EMAIL-007 (duplicate-merged).
- **Root cause:** email-events.ts default ignore. Rows stay sent.
- **Exact source areas:** nudgepay-app/app/lib/email-events.ts.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-034; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Map those types to bounced/failed; permanent bounce sets do_not_email.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-038-ROSTER — Roster loading exposes and truncates a project-wide 1,000-user directory

- **Owner / size / gate:** security; S; conditional.
- **Prior aliases:** july-13:min 52 (still-open); august-20-canonical:NP-2026-038 (superseded); august-20-wave:AUG20:wave-1:auth:TEMP-AUTH-013 (duplicate-merged); august-20-wave:AUG20:wave-1:rls-tenancy:TEMP-RLS-006 (duplicate-merged); august-20-wave:AUG20:wave-3:security:TEMP-SEC-006 (duplicate-merged).
- **Root cause:** orgs.server.ts:88. Promise/alert paths in wave-1 RLS notes update by id without org_id.
- **Exact source areas:** nudgepay-app/app/lib/orgs.server.ts:88.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-038-ROSTER; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Store display labels on memberships or paginate listUsers by membership user ids only. Always .eq("org_id") on service-role writes.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-038-SERVICE-PIN — Service-role id-keyed writes omit explicit organization scope

- **Owner / size / gate:** security; S; conditional.
- **Prior aliases:** july-13:min 52 (still-open); august-20-canonical:NP-2026-038 (superseded); august-20-wave:AUG20:wave-1:rls-tenancy:TEMP-RLS-005 (duplicate-merged).
- **Root cause:** orgs.server.ts:88. Promise/alert paths in wave-1 RLS notes update by id without org_id.
- **Exact source areas:** nudgepay-app/app/lib/orgs.server.ts:88.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-038-SERVICE-PIN; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Store display labels on memberships or paginate listUsers by membership user ids only. Always .eq("org_id") on service-role writes.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-044 — Onboarding replay creates orphan orgs

- **Owner / size / gate:** security; S; conditional.
- **Prior aliases:** july-13:min 1 (still-open); august-20-canonical:NP-2026-044 (still-open); august-20-wave:AUG20:wave-1:auth:TEMP-AUTH-010 (duplicate-merged); august-20-wave:AUG20:wave-1:rls-tenancy:TEMP-RLS-014 (duplicate-merged); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-TEST-006 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-044. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-044; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Action re-checks resolveOrg; if present, redirect dashboard. Unique membership constraint.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-133 — No LICENSE

- **Owner / size / gate:** legal; S; conditional.
- **Prior aliases:** july-13:min 49 (still-open); august-20-canonical:NP-2026-133 (still-open); august-20-wave:AUG20:wave-1:ops-a11y:TEMP-OPS-011 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-133. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-133; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add one before public launch.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X201 — Password policy is HTML-only (8) vs GoTrue min 6, no server check

- **Owner / size / gate:** security; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-1:auth:TEMP-AUTH-014 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-1:auth:TEMP-AUTH-014. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-1/auth.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X201; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X202 — Signup enumerates registered emails

- **Owner / size / gate:** security; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-1:auth:TEMP-AUTH-015 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-1:auth:TEMP-AUTH-015. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-1/auth.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X202; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X212 — Loaders/helpers that omit `.eq("org_id")` and rely on RLS or global uniqueness

- **Owner / size / gate:** security; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-1:rls-tenancy:TEMP-RLS-010 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-010. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-1/rls-tenancy.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X212; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X213 — User-facing loaders mint service-role clients for RLS-readable rows

- **Owner / size / gate:** security; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-1:rls-tenancy:TEMP-RLS-012 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-012. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-1/rls-tenancy.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X213; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X215 — RLS / IDOR test coverage holes

- **Owner / size / gate:** security; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-1:rls-tenancy:TEMP-RLS-015 (still-open); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-TEST-004 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-015. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-1/rls-tenancy.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X215; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X225 — STOP/START match the entire body only; no confirmation TwiML

- **Owner / size / gate:** legal; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-1:sms:TEMP-SMS-011 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-1:sms:TEMP-SMS-011. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-1/sms.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X225; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X226 — SMS ledger is member-writable; send-then-insert can orphan a live Twilio message

- **Owner / size / gate:** legal; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-1:sms:TEMP-SMS-013 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-1:sms:TEMP-SMS-013. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-1/sms.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X226; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X231 — Lockout / rate-limit is not distinguishable from a generic failure

- **Owner / size / gate:** security; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-2:workflow-static:TEMP-WF-008 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-008. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-2/workflow-static.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X231; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X232 — Collector send paths 500 when provider secrets are missing

- **Owner / size / gate:** legal; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-2:workflow-static:TEMP-WF-009 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-009. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-2/workflow-static.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X232; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X233 — Comm prefs drawer cannot represent preferred channel = email

- **Owner / size / gate:** legal; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-2:workflow-static:TEMP-WF-011 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-011. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-2/workflow-static.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X233; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X236 — QBO callback error redirects drop auth headers

- **Owner / size / gate:** security; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-2:workflow-static:TEMP-WF-017 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-017. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-2/workflow-static.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X236; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.


## 2. Production environment and runtime safety

**Batch dependency:** Complete and re-verify batches 1–1; do not mask an upstream failure in this batch.

**Batch execution controls:** Write focused regression tests before product changes; include unauthorized, cross-tenant, duplicate-submit, retry, and concurrency cases wherever state changes. Apply database changes only after historical-data preflight and backup. Verify affected browser and provider paths on both Cloudflare and Render staging. Deploy to retained isolated staging first, preserve the previous deploy and database restore point, rehearse rollback, and attach redacted test, browser/provider, migration, deploy, monitoring, and rollback evidence before changing a disposition.

### Finding packets

#### NP-AUD-2026-008 — Production environment was never configured

- **Owner / size / gate:** devops; M; blocker.
- **Prior aliases:** july-13:B10 (still-open); august-20-canonical:NP-2026-008 (still-open); august-20-wave:AUG20:wave-1:ops-a11y:TEMP-OPS-001 (duplicate-merged).
- **Root cause:** wrangler.toml:25-27 SUPABASE_URL = "https://<your-prod-project-ref>.supabase.co". Deploy-gate comment: QBO/Twilio routes 500 until secrets exist. This run could not wrangler secret list --env production.
- **Exact source areas:** nudgepay-app/wrangler.toml:25; nudgepay-app/wrangler.toml; 07-ops-intuit.md; AGENTS.md:98.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-008; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** 1. Create hosted Supabase; wrangler secret put every name in wrangler.toml comments (SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, QBO, Twilio, Resend, UNSUBSCRIBE_SECRET, APP_PUBLIC_BASE_URL). Set real SUPABASE_URL. QBO_SANDBOX=false. 2. Checklist in 07-ops-intuit.md. Rotate the legacy anon key (AGENTS.md:98). 3. Verify: wrangler secret list --env production; owner signup → connect QBO → invoices.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-D02 — Render readiness reports healthy when required configuration or Supabase is unavailable

- **Owner / size / gate:** devops; S; blocker.
- **Prior aliases:** current-delta:WORKTREE:READINESS (unverified).
- **Root cause:** The configured health route always returns 200 with { ok: true } and performs no configuration or dependency readiness check.
- **Exact source areas:** nudgepay-app/app/routes/healthz.tsx:6; nudgepay-app/render.yaml.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-D02; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Separate liveness and readiness. Validate required non-secret configuration and a bounded Supabase connectivity query without returning diagnostic values.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-D03 — Render free-plan secondary runtime is not production callback or failover capacity

- **Owner / size / gate:** devops; S; blocker.
- **Prior aliases:** current-delta:WORKTREE:FREE-RENDER (unverified).
- **Root cause:** The Blueprint selects plan: free. Render documents idle spin-down, about one-minute wake-up, and says free instances are not for production.
- **Exact source areas:** nudgepay-app/render.yaml.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-D03; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Use a paid always-on staging/failover service, then measure cold/start latency, webhook acknowledgement, shutdown, scaling, and rollback behavior.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-D04 — Node waitUntil shim does not drain background work during shutdown

- **Owner / size / gate:** backend; M; blocker.
- **Prior aliases:** current-delta:WORKTREE:WAITUNTIL (unverified).
- **Root cause:** The shim catches rejected promises with console.error but does not track pending work, expose failure telemetry, or drain on SIGTERM.
- **Exact source areas:** nudgepay-app/server.js:54.
- **Migration / compatibility:** Review existing data before validating or tightening constraints.; Preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-D04; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Persist jobs before acknowledging callbacks or track and drain work with bounded graceful shutdown, durable retries, and monitoring.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-D06 — Mandatory staging, provider, database, and authenticated browser evidence is unavailable

- **Owner / size / gate:** devops; L; blocker.
- **Prior aliases:** current-delta:WORKTREE:ENV-EVIDENCE (unverified).
- **Root cause:** Docker/local Supabase, dedicated staging, provider accounts, authenticated fixtures, the in-app Browser service, monitoring, backup/restore, and rollback proof were unavailable.
- **Exact source areas:** docs/audits/2026-08-20-production-readiness/provider-evidence.md; docs/audits/2026-08-20-production-readiness/workflow-matrix.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-D06; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Provision retained isolated audit resources and execute every environment-blocked matrix row with synthetic data and owned destinations.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.


## 3. Data integrity, pagination, reconciliation, and QBO lifecycle

**Batch dependency:** Complete and re-verify batches 1–2; do not mask an upstream failure in this batch.

**Batch execution controls:** Write focused regression tests before product changes; include unauthorized, cross-tenant, duplicate-submit, retry, and concurrency cases wherever state changes. Apply database changes only after historical-data preflight and backup. Verify affected browser and provider paths on both Cloudflare and Render staging. Deploy to retained isolated staging first, preserve the previous deploy and database restore point, rehearse rollback, and attach redacted test, browser/provider, migration, deploy, monitoring, and rollback evidence before changing a disposition.

### Finding packets

#### NP-AUD-2026-006 — Dead QBO connection reports Connected forever

- **Owner / size / gate:** backend; M; blocker.
- **Prior aliases:** july-13:B9 (still-open); august-20-canonical:NP-2026-006 (still-open); august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-003 (duplicate-merged).
- **Root cause:** qbo-connection.server.ts writes status "connected" (store) or "disconnected" (explicit disconnect) only. getValidAccessToken:26-45 throws on refresh failure and does not update status. Sync failures go to sync_errors, which are not mounted in the header (NP-2026-023).
- **Exact source areas:** nudgepay-app/app/lib/qbo-connection.server.ts.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-006; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** 1. Catch refresh failure → status='error' (or needs_reconnect) + sync_errors row. loadWorkspaceChrome treats error like disconnected: banner + Connect CTA, do not silently empty the queue. 2. Tests: mock 400 from Intuit token endpoint → status error; UI copy; reconnect overwrites. 3. Manual: revoke app at Intuit, wait for cron/refresh, see reconnect prompt.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-007-RECONCILIATION — Truncated reconciliation can auto-resolve live collection cases

- **Owner / size / gate:** database; M; blocker.
- **Prior aliases:** july-13:B2 (still-open); august-20-canonical:NP-2026-007 (superseded); august-20-wave:AUG20:wave-1:cases-queue:TEMP-CASE-001 (duplicate-merged).
- **Root cause:** supabase/config.toml:18 max_rows = 1000. case-queue.server.ts:137-147 unbounded invoice/case selects. case-lifecycle.server.ts:10-30 loads overdue customer_ids, then resolves any open case whose customer is not in that set.
- **Exact source areas:** nudgepay-app/supabase/config.toml:18; nudgepay-app/app/lib/case-queue.server.ts:137; nudgepay-app/app/lib/case-lifecycle.server.ts:10.
- **Migration / compatibility:** Review existing data before validating or tightening constraints.; Preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-007-RECONCILIATION; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** 1. Page every list (.range loop until short page) or use count: exact for recon. Never treat a truncated set as “these customers are no longer overdue”. 2. If a page is truncated, fail the recon and record sync_errors; do not resolve. 3. Tests: 1001 overdue invoices → recon does not close case 1001’s customer; loader surfaces truncation.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Preflight historical rows, snapshot the audit database, use a compatible forward migration, rehearse application rollback against the migrated schema, and retain restore evidence.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-007-TRUNCATION — PostgREST list reads silently truncate above 1,000 rows

- **Owner / size / gate:** database; M; blocker.
- **Prior aliases:** july-13:B1 (still-open); august-20-canonical:NP-2026-007 (superseded); august-20-wave:AUG20:wave-1:cases-queue:TEMP-CASE-001 (duplicate-merged).
- **Root cause:** supabase/config.toml:18 max_rows = 1000. case-queue.server.ts:137-147 unbounded invoice/case selects. case-lifecycle.server.ts:10-30 loads overdue customer_ids, then resolves any open case whose customer is not in that set.
- **Exact source areas:** nudgepay-app/supabase/config.toml:18; nudgepay-app/app/lib/case-queue.server.ts:137; nudgepay-app/app/lib/case-lifecycle.server.ts:10.
- **Migration / compatibility:** Review existing data before validating or tightening constraints.; Preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-007-TRUNCATION; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** 1. Page every list (.range loop until short page) or use count: exact for recon. Never treat a truncated set as “these customers are no longer overdue”. 2. If a page is truncated, fail the recon and record sync_errors; do not resolve. 3. Tests: 1001 overdue invoices → recon does not close case 1001’s customer; loader surfaces truncation.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Preflight historical rows, snapshot the audit database, use a compatible forward migration, rehearse application rollback against the migrated schema, and retain restore evidence.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-015 — Loader DB errors render as a healthy empty queue

- **Owner / size / gate:** database; M; blocker.
- **Prior aliases:** july-13:M6 (still-open); august-20-canonical:NP-2026-015 (still-open); august-20-wave:AUG20:wave-1:cases-queue:TEMP-CASE-002 (duplicate-merged); august-20-wave:AUG20:wave-2:workflow-static:TEMP-WF-010 (duplicate-merged).
- **Root cause:** case-queue.server.ts:130-147 destructures { data } and ignores error. Failed reads become [] / $0 KPIs.
- **Exact source areas:** nudgepay-app/app/lib/case-queue.server.ts:130.
- **Migration / compatibility:** Review existing data before validating or tightening constraints.; Preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-015; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** If any stage-1 query errors, throw (ErrorBoundary) or return an explicit loadError banner. Never convert error to empty metrics.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Preflight historical rows, snapshot the audit database, use a compatible forward migration, rehearse application rollback against the migrated schema, and retain restore evidence.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-027 — QBO realm switch merges two books

- **Owner / size / gate:** backend; M; blocker.
- **Prior aliases:** july-13:M19 (still-open); august-20-canonical:NP-2026-027 (still-open); august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-004 (duplicate-merged).
- **Root cause:** storeConnection upserts on org_id, replaces realm_id, no purge.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-027; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** If realm_id changes, require typed confirm and delete org-scoped QBO rows (customers, invoices, payments, cases, messages) inside a transaction, then sync. Test: realm A then B → no A invoices.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-028 — QBO query/CDC cap 1000; truncated discarded

- **Owner / size / gate:** backend; M; blocker.
- **Prior aliases:** july-13:M18 (still-open); august-20-canonical:NP-2026-028 (still-open); august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-005 (duplicate-merged).
- **Root cause:** qbo-sync.server.ts:26-28,227; refresh caller ignores return value. Comment sizes to Chancey.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-028; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Page Intuit queries. If truncated, sync_errors + do not advance CDC watermark.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-030 — QBO deletions/voids mishandled

- **Owner / size / gate:** backend; M; blocker.
- **Prior aliases:** july-13:M26 (still-open); august-20-canonical:NP-2026-030 (still-open); august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-007 (duplicate-merged).
- **Root cause:** CDC flattens Deleted skeletons → customer "(unnamed)". Webhook missing entity returns without closing local overdue rows.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-030; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Honor Deleted / void: zero balance or delete local row; recon will close cases. Never upsert "(unnamed)" over a named customer.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-031 — QBO webhook does Intuit+DB work before 200; no waitUntil

- **Owner / size / gate:** backend; M; blocker.
- **Prior aliases:** july-13:M20 (still-open); august-20-canonical:NP-2026-031 (still-open); august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-008 (duplicate-merged).
- **Root cause:** webhooks.qbo.tsx:45-76. waitUntil only on crons.
- **Exact source areas:** nudgepay-app/app/routes/webhooks.qbo.tsx:45.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-031; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Verify sig, enqueue ctx.waitUntil(process), return 200 quickly. Idempotent upserts already allow retry.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-036-QBO-TOKEN — Members can retrieve encrypted QBO credential columns

- **Owner / size / gate:** backend; M; blocker.
- **Prior aliases:** august-20-canonical:NP-2026-036 (superseded); august-20-wave:AUG20:wave-1:rls-tenancy:TEMP-RLS-004 (duplicate-merged).
- **Root cause:** contact_logs, text_messages, collection_cases, promises still member FOR ALL after 0032. Invites readable by members (bearer token). qbo_connections member SELECT includes token columns (app may not request them; PostgREST will if asked).
- **Exact source areas:** docs/production-audit-2026-08-20/01-findings.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-036-QBO-TOKEN; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** INSERT-only (or no DELETE/UPDATE) for logs/messages. Invites: members SELECT email/status not token. QBO: column privilege or view without *_enc. Tests with user JWT + PostgREST.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-046-FLOAT-MONEY — Promise evaluation compares currency with floating-point arithmetic

- **Owner / size / gate:** database; M; blocker.
- **Prior aliases:** july-13:min 33 (still-open); august-20-canonical:NP-2026-046 (superseded); august-20-wave:AUG20:wave-1:cases-queue:TEMP-CASE-009 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-046. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** Review existing data before validating or tightening constraints.; Preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-046-FLOAT-MONEY; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Integer cents. Count only payments rows of type payment (not credit memo/void) toward received, or document that QBO balance is the source of truth and show why.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Preflight historical rows, snapshot the audit database, use a compatible forward migration, rehearse application rollback against the migrated schema, and retain restore evidence.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-046-PAYMENT-SEMANTICS — Any balance drop, including credit memos, counts as promise payment

- **Owner / size / gate:** database; M; blocker.
- **Prior aliases:** july-13:min 37 (still-open); august-20-canonical:NP-2026-046 (superseded); august-20-wave:AUG20:wave-1:cases-queue:TEMP-CASE-010 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-046. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** Review existing data before validating or tightening constraints.; Preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-046-PAYMENT-SEMANTICS; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Integer cents. Count only payments rows of type payment (not credit memo/void) toward received, or document that QBO balance is the source of truth and show why.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Preflight historical rows, snapshot the audit database, use a compatible forward migration, rehearse application rollback against the migrated schema, and retain restore evidence.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-X227 — Login cookie flow, CSRF Origin from real forms, Focus Mode send, QBO connect button, and unsubscribe confirm page are untested in a browser

- **Owner / size / gate:** backend; M; blocker.
- **Prior aliases:** august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-TEST-003 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-1:tests-and-mutations:TEMP-TEST-003. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-1/tests-and-mutations.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X227; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-017 — qbo= / sync= query params are never rendered

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** july-13:M17 (still-open); august-20-canonical:NP-2026-017 (still-open); august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-002 (duplicate-merged); august-20-wave:AUG20:wave-1:settings-ux:TEMP-SET-007 (duplicate-merged); august-20-wave:AUG20:wave-2:workflow-static:TEMP-WF-001 (duplicate-merged).
- **Root cause:** Callback/refresh/disconnect write qbo=connected|error|forbidden|disconnected and sync=ok|error. dashboard.tsx does not read them. Settings first-run bounce has no welcome (workspace.server.ts:35-37).
- **Exact source areas:** nudgepay-app/app/routes/dashboard.tsx; nudgepay-app/app/lib/workspace.server.ts:35; nudgepay-app/app/lib/use-flash-cleanup.ts.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-017; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Banner on dashboard + Settings Integrations. Copy for each code. Clear the param after display (use-flash-cleanup.ts pattern).
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-023 — SyncIssues exists but is mounted nowhere

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** july-13:M9 (still-open); july-13:min 58 (still-open); august-20-canonical:NP-2026-023 (still-open); august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-013 (duplicate-merged); august-20-wave:AUG20:wave-1:settings-ux:TEMP-SET-009 (duplicate-merged); august-20-wave:AUG20:wave-1:settings-ux:TEMP-UX-009 (duplicate-merged).
- **Root cause:** Zero route imports of SyncIssues. reports.tsx passes null. Failures only on Settings Integrations. Hidden sm:inline-flex even if mounted (minor 58).
- **Exact source areas:** nudgepay-app/app/routes/reports.tsx.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-023; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Pass unresolved sync_errors into AppShell on dashboard/accounts/focus. Show on mobile.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-024 — Email never counts as last contact

- **Owner / size / gate:** database; S; conditional.
- **Prior aliases:** july-13:M10 (still-open); august-20-canonical:NP-2026-024 (still-open); august-20-wave:AUG20:wave-1:cases-queue:TEMP-CASE-003 (duplicate-merged).
- **Root cause:** case-queue.server.ts:213-250 uses contact_logs + outbound text_messages only.
- **Exact source areas:** nudgepay-app/app/lib/case-queue.server.ts:213.
- **Migration / compatibility:** Review existing data before validating or tightening constraints.; Preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-024; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Include outbound email_messages in last-contact. Tests: email-only customer is not “Never contacted” / +15 silence points.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Preflight historical rows, snapshot the audit database, use a compatible forward migration, rehearse application rollback against the migrated schema, and retain restore evidence.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-029 — CDC watermark stamped after processing

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** july-13:min 22 (still-open); august-20-canonical:NP-2026-029 (still-open); august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-006 (duplicate-merged).
- **Root cause:** qbo-sync.server.ts:320-321 now after upserts.
- **Exact source areas:** nudgepay-app/app/lib/qbo-sync.server.ts:320.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-029; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Capture changedSince/fetchedAt before the Intuit call; persist that. Tests for the skip window.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-043 — QBO Disconnect is one unconfirmed click

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** july-13:M31 (still-open); august-20-canonical:NP-2026-043 (still-open); august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-011 (duplicate-merged); august-20-wave:AUG20:wave-1:settings-ux:TEMP-SET-008 (duplicate-merged).
- **Root cause:** settings.tsx:248-252. Locks workspace via requireQbo.
- **Exact source areas:** nudgepay-app/app/routes/settings.tsx:248.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-043; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Confirm dialog (typed org name). GET Intuit disconnect remains a landing (already solid).
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-045-THRESHOLD-ORDER — High-value thresholds at or above $10,000 stop affecting priority scoring

- **Owner / size / gate:** database; S; conditional.
- **Prior aliases:** july-13:min 34 (still-open); august-20-canonical:NP-2026-045 (superseded); august-20-wave:AUG20:wave-1:cases-queue:TEMP-CASE-006 (duplicate-merged).
- **Root cause:** priority.ts:39-45 hardcoded 25k/10k before org threshold. Form min={0.01}; parser < 1000 rejected with wrong copy.
- **Exact source areas:** nudgepay-app/app/lib/priority.ts:39.
- **Migration / compatibility:** Review existing data before validating or tightening constraints.; Preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-045-THRESHOLD-ORDER; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Apply org threshold before hardcoded bands, or cap the input at 9999.99 and match client/server + error copy.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Preflight historical rows, snapshot the audit database, use a compatible forward migration, rehearse application rollback against the migrated schema, and retain restore evidence.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-045-VALIDATION-RANGE — Priority threshold client and server ranges disagree

- **Owner / size / gate:** database; S; conditional.
- **Prior aliases:** july-13:min 17 (still-open); august-20-canonical:NP-2026-045 (superseded); august-20-wave:AUG20:wave-1:settings-ux:TEMP-SET-002 (duplicate-merged).
- **Root cause:** priority.ts:39-45 hardcoded 25k/10k before org threshold. Form min={0.01}; parser < 1000 rejected with wrong copy.
- **Exact source areas:** nudgepay-app/app/lib/priority.ts:39.
- **Migration / compatibility:** Review existing data before validating or tightening constraints.; Preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-045-VALIDATION-RANGE; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Apply org threshold before hardcoded bands, or cap the input at 9999.99 and match client/server + error copy.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Preflight historical rows, snapshot the audit database, use a compatible forward migration, rehearse application rollback against the migrated schema, and retain restore evidence.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-050 — Work queue not virtualized; revalidate every 20s while a case is open

- **Owner / size / gate:** database; S; conditional.
- **Prior aliases:** july-13:M8 (still-open); august-20-canonical:NP-2026-050 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-050. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** Review existing data before validating or tightening constraints.; Preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-050; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Virtualize rows. Heartbeat should POST presence only, not reload the entire loader.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Preflight historical rows, snapshot the audit database, use a compatible forward migration, rehearse application rollback against the migrated schema, and retain restore evidence.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-051 — “Total customers” is not the QBO directory

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** july-13:M11 (still-open); august-20-canonical:NP-2026-051 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-051. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-051; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Rename tile “Customers in collections” or sync the full customer list.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-054-BACKOFF — Intuit 429 responses have no bounded backoff or Retry-After handling

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** july-13:min 21 (still-open); august-20-canonical:NP-2026-054 (superseded); august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-015 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-054. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** nudgepay-app/supabase/snippets/dev-data.sql; nudgepay-app/app/lib/meta.ts; 00-executive.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-054-BACKOFF; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Capture one real production payload, lock tests to it. Honor 429 Retry-After with bounded retry.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-054-PARSER — The QBO CloudEvents parser is not verified against a real payload

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** july-13:min 25 (still-open); august-20-canonical:NP-2026-054 (superseded); august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-009 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-054. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** nudgepay-app/supabase/snippets/dev-data.sql; nudgepay-app/app/lib/meta.ts; 00-executive.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-054-PARSER; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Capture one real production payload, lock tests to it. Honor 429 Retry-After with bounded retry.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X205 — Manual Refresh does not re-pull paid invoices or payments

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-012 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-1:qbo:TEMP-QBO-012. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-1/qbo.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X205; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X206 — `QBO_SANDBOX` defaults true unless the string is exactly `"false"`

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-014 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-1:qbo:TEMP-QBO-014. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-1/qbo.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X206; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X207 — QBO entity ids interpolated raw into query strings

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-017 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-1:qbo:TEMP-QBO-017. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-1/qbo.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X207; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X214 — Any member can trigger service-role QBO financial rewrite

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-1:rls-tenancy:TEMP-RLS-013 (still-open); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-SEC-006 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-013. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-1/rls-tenancy.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X214; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.


## 4. Authentication lifecycle and offboarding

**Batch dependency:** Complete and re-verify batches 1–3; do not mask an upstream failure in this batch.

**Batch execution controls:** Write focused regression tests before product changes; include unauthorized, cross-tenant, duplicate-submit, retry, and concurrency cases wherever state changes. Apply database changes only after historical-data preflight and backup. Verify affected browser and provider paths on both Cloudflare and Render staging. Deploy to retained isolated staging first, preserve the previous deploy and database restore point, rehearse rollback, and attach redacted test, browser/provider, migration, deploy, monitoring, and rollback evidence before changing a disposition.

### Finding packets


## 5. Error honesty and core collection workflows

**Batch dependency:** Complete and re-verify batches 1–4; do not mask an upstream failure in this batch.

**Batch execution controls:** Write focused regression tests before product changes; include unauthorized, cross-tenant, duplicate-submit, retry, and concurrency cases wherever state changes. Apply database changes only after historical-data preflight and backup. Verify affected browser and provider paths on both Cloudflare and Render staging. Deploy to retained isolated staging first, preserve the previous deploy and database restore point, rehearse rollback, and attach redacted test, browser/provider, migration, deploy, monitoring, and rollback evidence before changing a disposition.

### Finding packets

#### NP-AUD-2026-053-CONTRAST — Core copper and Focus color pairs fail WCAG AA contrast

- **Owner / size / gate:** backend; M; blocker.
- **Prior aliases:** july-13:M32 (still-open); july-13:M33 (still-open); august-20-canonical:NP-2026-053 (superseded); august-20-wave:AUG20:wave-1:ops-a11y:TEMP-UX-011 (duplicate-merged); august-20-wave:AUG20:wave-1:ops-a11y:TEMP-UX-012 (duplicate-merged).
- **Root cause:** --color-copper: #cf8136 (app.css:12). Focus text-muted on bg-ink. Focus SMS body, accounts search, late-fee toggle: placeholder-as-label.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-053-CONTRAST; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Darken copper on light surfaces (~4.5:1). Lighten Focus secondary text. Visible <label> / aria-label on those three controls.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-144 — Terminal DNC does not block Focus log-call / applyNextStep

- **Owner / size / gate:** backend; M; blocker.
- **Prior aliases:** august-20-canonical:NP-2026-144 (still-open); august-20-wave:AUG20:wave-1:cases-queue:TEMP-CASE-013 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-144. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/01-findings.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-144; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Server-gate log-call the same as SMS for blocksContact.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-025 — Focus Mode has no collision/presence

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** july-13:M7 (still-open); august-20-canonical:NP-2026-025 (still-open); august-20-wave:AUG20:wave-1:cases-queue:TEMP-CASE-004 (duplicate-merged); august-20-wave:AUG20:wave-2:workflow-static:TEMP-WF-012 (duplicate-merged).
- **Root cause:** focus.tsx:57-58 includePresence: false. Queue is deterministic → two agents double-text.
- **Exact source areas:** nudgepay-app/app/routes/focus.tsx:57.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-025; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Same heartbeat as dashboard; skip/lock cases with live presence; show who.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-026 — Default templates resurrect after delete

- **Owner / size / gate:** frontend; S; conditional.
- **Prior aliases:** july-13:M16 (still-open); august-20-canonical:NP-2026-026 (still-open); august-20-wave:AUG20:wave-1:settings-ux:TEMP-SET-001 (duplicate-merged).
- **Root cause:** message-templates.ts:38-47 appends missing default slugs.
- **Exact source areas:** nudgepay-app/app/lib/message-templates.ts:38.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-026; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Tombstone deleted default slugs or only merge defaults when DB count is 0. Test: delete friendly-reminder, reload, absent.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Authenticated Chromium/Firefox/WebKit plus keyboard, accessibility-tree, zoom, and required screen-reader evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-047 — No inbox read state or live updates

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** july-13:M14 (still-open); july-13:M15 (still-open); august-20-canonical:NP-2026-047 (still-open); august-20-wave:AUG20:wave-2:workflow-static:TEMP-WF-006 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-047. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-047; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** last_read_at per thread; poll 15–30s or heartbeat; Needs reply uses unread inbound.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-048-CSV — Reports and work queues have no CSV export

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** july-13:M12 (still-open); august-20-canonical:NP-2026-048 (superseded).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-048. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-048-CSV; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** US-only gate at QBO connect (CompanyInfo Country) or sync currency. CSV on reports + queue.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-048-LOCALE — Currency and locale are hardcoded to USD and en-US

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** july-13:M13 (still-open); august-20-canonical:NP-2026-048 (superseded).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-048. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-048-LOCALE; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** US-only gate at QBO connect (CompanyInfo Country) or sync currency. CSV on reports + queue.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-049-CHANNEL-GATE — Operator alerts are incorrectly gated by customer email settings

- **Owner / size / gate:** frontend; S; conditional.
- **Prior aliases:** july-13:min 31 (still-open); july-13:min 53 (still-open); august-20-canonical:NP-2026-049 (superseded); august-20-wave:AUG20:wave-1:email:TEMP-EMAIL-008 (duplicate-merged); august-20-wave:AUG20:wave-1:settings-ux:TEMP-SET-021 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-049. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-049-CHANNEL-GATE; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Separate operator mail env from email_config.email_enabled. Retry/ledger on failure.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Controlled provider sandbox/destination plus both-runtime callback evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X218 — A `message_templates` read error (RLS, missing table, network) renders the factory defaults as if they were the org’s live templates

- **Owner / size / gate:** frontend; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-1:settings-ux:TEMP-SET-013 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-013. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-1/settings-ux.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X218; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Authenticated Chromium/Firefox/WebKit plus keyboard, accessibility-tree, zoom, and required screen-reader evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.


## 6. Messaging resilience and idempotency

**Batch dependency:** Complete and re-verify batches 1–5; do not mask an upstream failure in this batch.

**Batch execution controls:** Write focused regression tests before product changes; include unauthorized, cross-tenant, duplicate-submit, retry, and concurrency cases wherever state changes. Apply database changes only after historical-data preflight and backup. Verify affected browser and provider paths on both Cloudflare and Render staging. Deploy to retained isolated staging first, preserve the previous deploy and database restore point, rehearse rollback, and attach redacted test, browser/provider, migration, deploy, monitoring, and rollback evidence before changing a disposition.

### Finding packets


## 7. Accessibility and responsive blockers

**Batch dependency:** Complete and re-verify batches 1–6; do not mask an upstream failure in this batch.

**Batch execution controls:** Write focused regression tests before product changes; include unauthorized, cross-tenant, duplicate-submit, retry, and concurrency cases wherever state changes. Apply database changes only after historical-data preflight and backup. Verify affected browser and provider paths on both Cloudflare and Render staging. Deploy to retained isolated staging first, preserve the previous deploy and database restore point, rehearse rollback, and attach redacted test, browser/provider, migration, deploy, monitoring, and rollback evidence before changing a disposition.

### Finding packets

#### NP-AUD-2026-053-LABELS — Core controls lack explicit accessible labels

- **Owner / size / gate:** frontend; M; blocker.
- **Prior aliases:** july-13:M33 (still-open); july-13:M34 (still-open); august-20-canonical:NP-2026-053 (superseded); august-20-wave:AUG20:wave-1:ops-a11y:TEMP-UX-013 (duplicate-merged); august-20-wave:AUG20:wave-1:settings-ux:TEMP-SET-006 (duplicate-merged).
- **Root cause:** --color-copper: #cf8136 (app.css:12). Focus text-muted on bg-ink. Focus SMS body, accounts search, late-fee toggle: placeholder-as-label.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-053-LABELS; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Darken copper on light surfaces (~4.5:1). Lighten Focus secondary text. Visible <label> / aria-label on those three controls.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Authenticated Chromium/Firefox/WebKit plus keyboard, accessibility-tree, zoom, and required screen-reader evidence is required.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.


## 8. Performance, observability, documentation, and polish

**Batch dependency:** Complete and re-verify batches 1–7; do not mask an upstream failure in this batch.

**Batch execution controls:** Write focused regression tests before product changes; include unauthorized, cross-tenant, duplicate-submit, retry, and concurrency cases wherever state changes. Apply database changes only after historical-data preflight and backup. Verify affected browser and provider paths on both Cloudflare and Render staging. Deploy to retained isolated staging first, preserve the previous deploy and database restore point, rehearse rollback, and attach redacted test, browser/provider, migration, deploy, monitoring, and rollback evidence before changing a disposition.

### Finding packets

#### NP-AUD-2026-016-CI — No CI or standard test script gates releases

- **Owner / size / gate:** devops; M; blocker.
- **Prior aliases:** july-13:M27 (still-open); august-20-canonical:NP-2026-016 (superseded); august-20-wave:AUG20:wave-1:ops-a11y:TEMP-OPS-002 (duplicate-merged); august-20-wave:AUG20:wave-1:ops-a11y:TEMP-OPS-003 (duplicate-merged); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-TEST-001 (duplicate-merged); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-TEST-007 (duplicate-merged).
- **Root cause:** No .github/. package.json has no test script. tests/global-setup.ts:13 readFileSync("../.env.test"). This run: ENV_TEST=missing. globalSetup runs even for pure unit files.
- **Exact source areas:** nudgepay-app/package.json; nudgepay-app/tests/global-setup.ts:13; nudgepay-app/tests/priority.test.ts.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-016-CI; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** 1. Commit .env.test.example. Add "test": "vitest run" / "test:unit" that skips globalSetup for pure files. GitHub Action: typecheck + unit tests on every PR; integration job with supabase start. 2. Document npx supabase start in README (replace the Cloudflare starter README).
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-016-TEST-ENV — Fresh-clone tests require an undocumented, missing .env.test

- **Owner / size / gate:** devops; M; blocker.
- **Prior aliases:** july-13:M29 (still-open); august-20-canonical:NP-2026-016 (superseded); august-20-wave:AUG20:wave-1:ops-a11y:TEMP-OPS-012 (duplicate-merged); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-TEST-002 (duplicate-merged).
- **Root cause:** No .github/. package.json has no test script. tests/global-setup.ts:13 readFileSync("../.env.test"). This run: ENV_TEST=missing. globalSetup runs even for pure unit files.
- **Exact source areas:** nudgepay-app/package.json; nudgepay-app/tests/global-setup.ts:13; nudgepay-app/tests/priority.test.ts.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-016-TEST-ENV; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** 1. Commit .env.test.example. Add "test": "vitest run" / "test:unit" that skips globalSetup for pure files. GitHub Action: typecheck + unit tests on every PR; integration job with supabase start. 2. Document npx supabase start in README (replace the Cloudflare starter README).
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-039 — Missing security headers on the Worker

- **Owner / size / gate:** devops; M; blocker.
- **Prior aliases:** august-20-canonical:NP-2026-039 (still-open); august-20-wave:AUG20:wave-1:ops-a11y:TEMP-OPS-005 (duplicate-merged); august-20-wave:AUG20:wave-3:security:TEMP-SEC-001 (duplicate-merged).
- **Root cause:** Zero CSP/HSTS/XFO/Referrer-Policy/Permissions-Policy/X-Content-Type-Options. workers/app.ts returns RR unmodified.
- **Exact source areas:** nudgepay-app/workers/app.ts.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-039; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Wrap fetch; set CSP (frame-ancestors 'none'), HSTS, nosniff, Referrer-Policy, Permissions-Policy. Apply to webhooks too.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-040 — react-router@7.9.6 HIGH XSS/RCE/CSRF/DoS advisories

- **Owner / size / gate:** devops; M; blocker.
- **Prior aliases:** august-20-canonical:NP-2026-040 (still-open); august-20-wave:AUG20:wave-3:security:TEMP-SEC-007 (duplicate-merged).
- **Root cause:** npm audit — GHSA-49rj-9fvp-4h2h (turbo-stream RCE), GHSA-h5cw-625j-3rxh (action CSRF), multiple XSS/DoS. Affected <= 7.11.0; patched in 7.12+/7.18.x. Also high: nanoid, postcss, vite, ws, undici, brace-expansion.
- **Exact source areas:** docs/production-audit-2026-08-20/01-findings.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-040; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Upgrade react-router / @react-router/dev to a patched release and re-run typecheck + the suite. Then npm audit remaining build-toolchain issues. Do not --force blindly.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-122 — Quiet hours = org TZ not recipient

- **Owner / size / gate:** devops; M; blocker.
- **Prior aliases:** july-13:min 28 (still-open); august-20-canonical:NP-2026-122 (still-open); august-20-wave:AUG20:wave-1:sms:TEMP-SMS-009 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-122. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-122; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Document US-only; later store customer TZ.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-135 — Legacy anon key rotation pending

- **Owner / size / gate:** backend; M; blocker.
- **Prior aliases:** july-13:min 51 (still-open); august-20-canonical:NP-2026-135 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-135. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-135; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Rotate hosted anon key; treat git history as leaked.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-140 — Phone match is last-10 only

- **Owner / size / gate:** backend; M; blocker.
- **Prior aliases:** august-20-canonical:NP-2026-140 (still-open); august-20-wave:AUG20:wave-1:sms:TEMP-SMS-006 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-140. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/01-findings.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-140; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Store E.164; match on normalized full number.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.; A second reviewer reproduces the closure from written instructions.

#### NP-AUD-2026-041 — CDC cron is one serial loop over all orgs

- **Owner / size / gate:** devops; S; conditional.
- **Prior aliases:** july-13:M21 (still-open); august-20-canonical:NP-2026-041 (still-open); august-20-wave:AUG20:wave-1:qbo:TEMP-QBO-010 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-041. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-041; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Time budget + checkpoint org_id; fan-out via queue if tenant count grows. Per-org try/catch already exists — keep it.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-042 — No error monitoring

- **Owner / size / gate:** devops; S; conditional.
- **Prior aliases:** july-13:M28 (still-open); august-20-canonical:NP-2026-042 (still-open); august-20-wave:AUG20:wave-1:ops-a11y:TEMP-OPS-006 (duplicate-merged).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-042. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-042; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Sentry or Cloudflare Workers Observability binding. Cron failures must not be console.error only.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-049-RETRY — Broken-promise alerts fail once without durable retry

- **Owner / size / gate:** devops; S; conditional.
- **Prior aliases:** july-13:min 31 (still-open); august-20-canonical:NP-2026-049 (superseded); august-20-wave:AUG20:wave-1:email:TEMP-EMAIL-012 (duplicate-merged); august-20-wave:AUG20:wave-1:tests-and-mutations:TEMP-SEC-006 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by NP-2026-049. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/codebase-audit-2026-07-13.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-049-RETRY; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Separate operator mail env from email_config.email_enabled. Retry/ledger on failure.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.

#### NP-AUD-2026-X235 — Production ErrorBoundary hides the failure

- **Owner / size / gate:** backend; S; conditional.
- **Prior aliases:** august-20-wave:AUG20:wave-2:workflow-static:TEMP-WF-016 (still-open).
- **Root cause:** Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-016. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.
- **Exact source areas:** docs/production-audit-2026-08-20/wave-2/workflow-static.md.
- **Migration / compatibility:** No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility.
- **Tests to write first:** Regression for NP-AUD-2026-X235; Negative/unauthorized case; Concurrency or retry case when state changes are involved.
- **Minimal remediation:** Add focused regression coverage and implement the raw card's fix recipe.
- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.
- **Browser / provider verification:** Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.
- **Deployment / rollback:** Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.
- **Evidence required for closure:** Current source no longer contains the root cause.; Original reproduction fails to reproduce the defect.; Focused regression coverage passes.; Required browser/provider/database evidence passes.


