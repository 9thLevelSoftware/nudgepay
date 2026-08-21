# Canonical atomic findings

Generated from `findings.json` for candidate `88b9baca35be5b8d9235b2f96863150ef3a67ad1`.

Counts: 168 total; 0 critical, 56 high, 46 medium, 64 low, 2 informational.

## NP-AUD-2026-001 — No password reset / forgot-password flow

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: security / security
- Verification: browser-verified (high confidence)
- Fix order / size: 1 / M
- Roles: anonymous, member, owner
- Routes: /login
- Aliases: B0 [still-open]; NP-2026-001 [still-open]; AUG20:wave-1:auth:TEMP-AUTH-001 [duplicate-merged]; AUG20:wave-2:workflow-static:TEMP-WF-007 [duplicate-merged]

Expected: The no password reset / forgot-password flow condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-001. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: nudgepay-app/app/routes.ts has no recovery route. login.tsx is email+password only. Repo grep for resetPasswordForEmail in app/ is empty. api.profile.tsx updateUser writes display_name only.

Impact: A public user who forgets their password is locked out of AR data. Operator can reset in Studio for a managed tenant, so this is not a managed-bar blocker by itself.

Remediation: 1. Add forgot-password.tsx + auth.confirm.tsx (shared with NP-2026-002) + reset-password.tsx. Register in routes.ts. Link from login.tsx. 2. resetPasswordForEmail with redirectTo = production /auth/confirm. Confirm exchanges token_hash via verifyOtp({ type: "recovery" }). New-password POST behind requireUser + requireSameOrigin. Same success copy whether or not the email exists. 3. Tests: unknown email same copy/timing; recovery sets cookies; redirectTo open-redirect rejected; CSRF on password POST. 4. Manual: request reset, set new password, old password fails.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-002 — No /auth/confirm; signup confirm branch drops Set-Cookie

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: anonymous, member
- Routes: /signup
- Aliases: M1 [still-open]; NP-2026-002 [still-open]; AUG20:wave-1:auth:TEMP-AUTH-002 [duplicate-merged]

Expected: The no /auth/confirm; signup confirm branch drops set-cookie condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-002. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: No confirm route. signup.tsx:39-41 returns { confirmEmail, returnTo } and drops headers from createSupabaseUserClient. auth-flow.server.ts:6-16 documents production confirmations ON → session null. Local enable_confirmations = false hides this in dev. site_url in config.toml points at /.

Impact: Confirmation mail lands on marketing, unsigned-in. Invite returnTo is lost. If confirmations are OFF in production, anyone can create an org with an unproven email.

Remediation: 1. auth.confirm.tsx: verifyOtp then safeReturnTo(next). Return signup confirm JSON with headers. Set hosted site_url / redirect allowlist to /auth/confirm. 2. Support type=signup|email|recovery. Never render tokens in HTML. 3. Tests: valid hash sets Set-Cookie and honors next=/accept/<token>; signup confirm response includes Set-Cookie. 4. Manual: confirmations ON, sign up with invite returnTo, click mail, land signed-in on accept.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-003 — Account-profile Save preferences silently re-subscribes unsubscribed customers

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: anonymous
- Routes: /accounts/:id, /unsubscribe
- Aliases: B3 [still-open]; NP-2026-003 [still-open]; AUG20:wave-1:email:TEMP-EMAIL-001 [duplicate-merged]; AUG20:wave-1:email:TEMP-EMAIL-009 [duplicate-merged]; AUG20:wave-2:workflow-static:TEMP-WF-004 [duplicate-merged]

Expected: The account-profile save preferences silently re-subscribes unsubscribed customers condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-003. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: AccountProfile.tsx:120-142 posts preferred_channel, do_not_call, do_not_text only. api.comm-prefs.tsx:20-22 writes do_not_email: form.get("do_not_email") === "true". accounts.$id.tsx SELECT omits do_not_email. tests/api-comm-prefs.test.ts:13-15 locks the wipe in. CommPrefsDrawer.tsx:64 has the checkbox (dashboard only).

Impact: CAN-SPAM requires honoring opt-out. Staff saving owner/channel on /accounts/:id clears a tokenized /unsubscribe. Subsequent collection mail is a send after opt-out.

Remediation: 1. Add do_not_email checkbox to AccountProfile (same pattern as drawer). SELECT the column in accounts.$id.tsx. 2. Change parseCommPrefsUpdate: omit do_not_email from the UPDATE when the field was not posted (or require a hidden sentinel that preserves current DB value). Never default missing → false. 3. Tests: form without the field leaves DB true; form with checkbox off after explicit “re-subscribe” is a separate, confirmed path. 4. Manual: unsubscribe via token, open account profile, Save owner, confirm do_not_email still true, send path still blocked.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-004 — Unmatched inbound SMS, including STOP, is dropped with HTTP 200

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member
- Routes: /webhooks/twilio/inbound
- Aliases: B5 [still-open]; NP-2026-004 [still-open]; AUG20:wave-1:sms:TEMP-SMS-002 [duplicate-merged]

Expected: The unmatched inbound sms, including stop, is dropped with http 200 condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-004. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: twilio-messaging.server.ts:156-211 — resolveInboundOrgId null unless exactly one org has outbound history; then customer match; else { matched: false, optOut: false } with no insert. STOP handling is after that. webhooks.twilio.inbound.tsx always 200s empty TwiML. Tests twilio-inbound.test.ts:58-60 expect the drop.

Impact: Customer texts STOP, keeps getting dunning. TCPA $500–$1,500/text. Also fires for a single tenant if the reply phone last-10 ≠ stored outbound to_number. Webhook 200 means no Twilio retry and no operator queue.

Remediation: 1. Persist unmatched inbound (From, To, Body, SID) before 200. 2. On STOP/START, apply to every customer whose last-10 matches (all orgs with history), or route solely by To once per-org senders exist (NP-2026-012). 3. SQL-filter phone_last10 instead of loading the org (1,000-row cap). 4. Alert ops on unmatched STOP. Return TwiML confirming opt-out. 5. Tests: unknown From + body STOP is stored and flagged; two-org collision still records STOP somewhere.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-005 — QBO OAuth callback never runs the overdue backfill

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member, owner, provider
- Routes: /settings
- Aliases: B8 [still-open]; NP-2026-005 [still-open]; AUG20:wave-1:qbo:TEMP-QBO-001 [duplicate-merged]; AUG20:wave-2:workflow-static:TEMP-WF-002 [duplicate-merged]

Expected: The qbo oauth callback never runs the overdue backfill condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-005. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: auth.qbo.callback.tsx:32-34 stores tokens, redirects ?qbo=connected, no syncOverdueInvoices. That function is only api.qbo.refresh.tsx:44. CDC first-run window is 7 days (qbo-sync.server.ts). Dashboard never reads qbo= (NP-2026-017).

Impact: First-run: connect → empty dashboard. Months-old overdue invoices have not “changed”, so CDC will not bring them. Operator must discover Settings → Sync now.

Remediation: 1. After storeConnection, ctx.waitUntil(syncOverdueInvoices(...)) or redirect to a “Syncing…” page that POSTs refresh. Keep the callback fast enough for Intuit. 2. Render ?qbo=connected|error|forbidden on dashboard/settings (NP-2026-017). 3. Tests: callback mock stores tokens and invokes sync deps; failed sync records sync_errors and still shows reconnect copy. 4. Manual: sandbox connect, invoices on dashboard without clicking Sync now.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-009 — Intuit compliance URLs 404; Netlify redirects are placeholders

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: anonymous
- Routes: cross-cutting
- Aliases: B11 [still-open]; M30 [still-open]; NP-2026-009 [still-open]; AUG20:wave-1:ops-a11y:TEMP-OPS-007 [duplicate-merged]; AUG20:wave-1:ops-a11y:TEMP-OPS-008 [duplicate-merged]

Expected: The intuit compliance urls 404; netlify redirects are placeholders condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-009. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: netlify/_redirects:8-10 → https://WORKER_PROD_URL_PLACEHOLDER/.... docs/intuit-production-checklist.md same placeholder.

Impact: Intuit app review requires reachable Privacy and EULA. The portal historically pointed at this Netlify host.

Remediation: 1. Replace placeholder with the real Worker origin. netlify deploy --prod --dir netlify. Submit Worker URLs in Intuit portal. 2. Curl -I must 301 to Worker /privacy and /eula with 200 HTML (operator 9th Level Software, QBO scope). 3. Fill every row of the Intuit checklist.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-010 — No member removal, role change, leave-org; memberships RLS is SELECT-only

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member, owner
- Routes: cross-cutting
- Aliases: M4 [still-open]; NP-2026-010 [still-open]; AUG20:wave-1:auth:TEMP-AUTH-012 [duplicate-merged]

Expected: The no member removal, role change, leave-org; memberships rls is select-only condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-010. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: 0002_rls_policies.sql:23-24 mem_select only. No DELETE/UPDATE policy, no API, Workspace roster is display-name only (settings.tsx).

Impact: A terminated collector keeps JWT access to customer phones, invoices, and SMS send until someone deletes the auth user in Studio (which also has FK issues — minor 43).

Remediation: 1. Owner-only DELETE/UPDATE policies on memberships. API + UI: remove member, change role, revoke pending invite, leave-org (block leaving last owner). 2. Tests in *-rls.test.ts: member cannot delete others; owner can; last owner cannot leave. 3. Manual: remove a user, their next dashboard load redirects, SMS send 401/403.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-011 — Consent has no provenance; STOP is one-click reversible

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member
- Routes: /webhooks/twilio/inbound
- Aliases: M23 [still-open]; NP-2026-011 [still-open]; AUG20:wave-1:sms:TEMP-SMS-003 [duplicate-merged]

Expected: The consent has no provenance; stop is one-click reversible condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-011. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: customers.sms_consent boolean. api.sms-consent.tsx sets true/false. UI “Mark consented” after STOP (MessageThreadPanel.tsx). STOP does not set do_not_text. No source/timestamp column.

Impact: TCPA. An inbound STOP is indistinguishable from never-consented. Staff can resume texting with one click. Combined with NP-2026-004, even a recorded STOP may never have been recorded.

Remediation: 1. Add sms_consent_source (inbound_stop|inbound_start|staff|import) + sms_consent_at + optional actor. Inbound STOP sets sms_consent=false and do_not_text=true and is not reversible from “Mark consented” without a logged staff override reason. 2. Hide “Mark consented” when source is inbound_stop unless owner + typed reason. 3. Tests: STOP then staff toggle without reason leaves false; START may re-enable per CTIA.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-012 — All tenants share one operator-owned Twilio sender

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member, provider
- Routes: /webhooks/twilio/inbound
- Aliases: B4 [still-open]; NP-2026-012 [still-open]; AUG20:wave-1:sms:TEMP-SMS-001 [duplicate-merged]

Expected: The all tenants share one operator-owned twilio sender condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-012. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: resolveSender (twilio-messaging.server.ts:42-52) returns env default. save_sms_sender is locked (api.org-settings.tsx:56-61). Correct lock given the shared account; still a public-launch blocker.

Impact: One abusive tenant filters the number for everyone. Inbound cannot be routed by To (root of NP-2026-004). A2P cannot be the tenant’s brand.

Remediation: Per-org Messaging Service / subaccount inventory. resolveSender reads only that. Keep the lock until then. Managed single-tenant: acceptable as operator process.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-013 — Per-org From is unverified free text on the shared Resend key

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member, owner, provider
- Routes: /webhooks/resend
- Aliases: B6 [still-open]; NP-2026-013 [still-open]; AUG20:wave-1:email:TEMP-EMAIL-003 [duplicate-merged]; AUG20:wave-1:rls-tenancy:TEMP-RLS-011 [duplicate-merged]

Expected: The per-org from is unverified free text on the shared resend key condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-013. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: email-settings.ts RFC-lite regex; comment “domain verification is an operator concern”. All sends use one RESEND_API_KEY.

Impact: Tenant types unverified domain → runtime 422. Tenant types a domain the operator *has* verified (including another tenant’s) → From impersonation.

Remediation: Bind org → Resend-verified domain (API or provisioned subdomain). Reject from_address outside that set. Unique index on normalized From. Managed: operator sets the one From.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-014 — Inbound email mapping cannot work against the real Resend API

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member, provider
- Routes: /webhooks/resend
- Aliases: B7 [still-open]; NP-2026-014 [still-open]; AUG20:wave-1:email:TEMP-EMAIL-004 [duplicate-merged]

Expected: The inbound email mapping cannot work against the real resend api condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-014. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: email-events.ts:40-43 listens for inbound.email.received / email.inbound. Resend uses email.received. str(d.to) empties arrays. Receiving webhooks do not include full body. Tests freeze the wrong names.

Impact: UI is a two-way inbox; replies vanish. Templates ask customers to reply (NP-2026-032).

Remediation: Map email.received. Coerce to/from from string | string[]. Fetch body from Resend receiving API. Log unmatched. Tests using the real event shape.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-021 — Session cookies are not HttpOnly, not Secure, max-age 400 days

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member
- Routes: cross-cutting
- Aliases: NP-2026-021 [still-open]; AUG20:wave-1:auth:TEMP-AUTH-003 [duplicate-merged]; AUG20:wave-3:security:TEMP-SEC-003 [duplicate-merged]

Expected: The session cookies are not httponly, not secure, max-age 400 days condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-021. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: supabase.server.ts passes no cookieOptions. @supabase/ssr defaults: httpOnly: false, no secure, 400d (node_modules/@supabase/ssr/src/utils/constants.ts).

Impact: Public-GA correctness, security, compliance, or operability is reduced by session cookies are not httponly, not secure, max-age 400 days.

Remediation: cookieOptions: { httpOnly: true, secure: true (HTTPS), sameSite: "lax", maxAge: 7–30d }. Tests assert Set-Cookie flags.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-022-AUTH-CSRF — Login and signup lack same-origin CSRF protection

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: anonymous, member
- Routes: /login, /signup
- Aliases: min 39 [still-open]; NP-2026-022 [superseded]; AUG20:wave-1:auth:TEMP-AUTH-004 [duplicate-merged]; AUG20:wave-1:tests-and-mutations:TEMP-TEST-006 [still-open]; AUG20:wave-1:tests-and-mutations:TEMP-SEC-001 [duplicate-merged]; AUG20:wave-3:security:TEMP-SEC-002 [duplicate-merged]

Expected: The login and signup lack same-origin csrf protection condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-022. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: requireSameOrigin only inside requireUser. Login honors returnTo after attacker POST of attacker credentials.

Impact: Public-GA correctness, security, compliance, or operability is reduced by login and signup lack same-origin csrf protection.

Remediation: Origin check on login/signup/logout. Upgrade react-router to ≥ 7.12.0 (NP-2026-040). Optional CSRF token. Same generic login error timing.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-022-LOGOUT-CSRF — Logout lacks same-origin CSRF protection

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member
- Routes: cross-cutting
- Aliases: min 39 [still-open]; NP-2026-022 [superseded]; AUG20:wave-1:auth:TEMP-AUTH-005 [duplicate-merged]

Expected: The logout lacks same-origin csrf protection condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-022. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: requireSameOrigin only inside requireUser. Login honors returnTo after attacker POST of attacker credentials.

Impact: Public-GA correctness, security, compliance, or operability is reduced by logout lacks same-origin csrf protection.

Remediation: Origin check on login/signup/logout. Upgrade react-router to ≥ 7.12.0 (NP-2026-040). Optional CSRF token. Same generic login error timing.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-033-POSTAL — Customer email sends do not enforce or always render a postal address

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member
- Routes: cross-cutting
- Aliases: NP-2026-033 [superseded]; AUG20:wave-1:email:TEMP-EMAIL-002 [duplicate-merged]

Expected: The customer email sends do not enforce or always render a postal address condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-033. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: No List-Unsubscribe in repo. email-settings.ts accepts email_enabled with empty postal; send appends postal only if non-empty; UI says required.

Impact: Public-GA correctness, security, compliance, or operability is reduced by customer email sends do not enforce or always render a postal address.

Remediation: Reject enable-without-postal. Always append postal. Add List-Unsubscribe + List-Unsubscribe-Post. Unsubscribe POST must honor RFC 8058 one-click (empty form POST with token).

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-033-UNSUBSCRIBE — List-Unsubscribe and RFC 8058 one-click support are missing

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: anonymous
- Routes: /unsubscribe
- Aliases: min 32 [still-open]; NP-2026-033 [superseded]; AUG20:wave-1:email:TEMP-EMAIL-005 [duplicate-merged]

Expected: The list-unsubscribe and rfc 8058 one-click support are missing condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-033. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: No List-Unsubscribe in repo. email-settings.ts accepts email_enabled with empty postal; send appends postal only if non-empty; UI says required.

Impact: Public-GA correctness, security, compliance, or operability is reduced by list-unsubscribe and rfc 8058 one-click support are missing.

Remediation: Reject enable-without-postal. Always append postal. Add List-Unsubscribe + List-Unsubscribe-Post. Unsubscribe POST must honor RFC 8058 one-click (empty form POST with token).

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-035-EMAIL-RATE — Email sends lack rate limiting and idempotency

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member
- Routes: cross-cutting
- Aliases: M24 [still-open]; min 29 [still-open]; NP-2026-035 [superseded]; AUG20:wave-1:email:TEMP-EMAIL-011 [duplicate-merged]; AUG20:wave-1:tests-and-mutations:TEMP-SEC-002 [duplicate-merged]; AUG20:wave-3:security:TEMP-SEC-004 [duplicate-merged]

Expected: The email sends lack rate limiting and idempotency condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-035. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: No rateLimit in app. api.text.send, bulk, api.test-message, login, invite, presence unbounded. Test SMS skips consent, quiet hours, sms_enabled, ledger.

Impact: Public-GA correctness, security, compliance, or operability is reduced by email sends lack rate limiting and idempotency.

Remediation: Per-org and per-customer caps; Twilio Idempotency-Key; test-message throttle + quiet hours + ledger. Cloudflare rate-limit or Durable Object counters.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-035-SMS-RATE — SMS sends lack rate limiting and idempotency

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member
- Routes: /webhooks/twilio/inbound
- Aliases: M24 [still-open]; min 29 [still-open]; NP-2026-035 [superseded]; AUG20:wave-1:sms:TEMP-SMS-008 [duplicate-merged]; AUG20:wave-1:tests-and-mutations:TEMP-TEST-005 [duplicate-merged]; AUG20:wave-1:tests-and-mutations:TEMP-SEC-002 [duplicate-merged]; AUG20:wave-3:security:TEMP-SEC-004 [duplicate-merged]

Expected: The sms sends lack rate limiting and idempotency condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-035. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: No rateLimit in app. api.text.send, bulk, api.test-message, login, invite, presence unbounded. Test SMS skips consent, quiet hours, sms_enabled, ledger.

Impact: Public-GA correctness, security, compliance, or operability is reduced by sms sends lack rate limiting and idempotency.

Remediation: Per-org and per-customer caps; Twilio Idempotency-Key; test-message throttle + quiet hours + ledger. Cloudflare rate-limit or Durable Object counters.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-036-INVITE-TOKEN — Members can retrieve invite bearer tokens

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: invitee, member
- Routes: /invite
- Aliases: NP-2026-036 [superseded]; AUG20:wave-1:rls-tenancy:TEMP-RLS-003 [duplicate-merged]

Expected: The members can retrieve invite bearer tokens condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-036. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: contact_logs, text_messages, collection_cases, promises still member FOR ALL after 0032. Invites readable by members (bearer token). qbo_connections member SELECT includes token columns (app may not request them; PostgREST will if asked).

Impact: Public-GA correctness, security, compliance, or operability is reduced by members can retrieve invite bearer tokens.

Remediation: INSERT-only (or no DELETE/UPDATE) for logs/messages. Invites: members SELECT email/status not token. QBO: column privilege or view without *_enc. Tests with user JWT + PostgREST.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-036-LEDGER-RLS — Members can rewrite or delete audit and messaging ledgers

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member
- Routes: cross-cutting
- Aliases: M25 [partially-fixed]; NP-2026-036 [superseded]; AUG20:wave-1:rls-tenancy:TEMP-RLS-002 [duplicate-merged]; AUG20:wave-1:sms:TEMP-SMS-013 [still-open]; AUG20:wave-3:security:TEMP-SEC-008 [duplicate-merged]

Expected: The members can rewrite or delete audit and messaging ledgers condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-036. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: contact_logs, text_messages, collection_cases, promises still member FOR ALL after 0032. Invites readable by members (bearer token). qbo_connections member SELECT includes token columns (app may not request them; PostgREST will if asked).

Impact: Public-GA correctness, security, compliance, or operability is reduced by members can rewrite or delete audit and messaging ledgers.

Remediation: INSERT-only (or no DELETE/UPDATE) for logs/messages. Invites: members SELECT email/status not token. QBO: column privilege or view without *_enc. Tests with user JWT + PostgREST.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-037 — 0032 composite FKs are still NOT VALID

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member
- Routes: cross-cutting
- Aliases: NP-2026-037 [still-open]; AUG20:wave-1:rls-tenancy:TEMP-RLS-001 [duplicate-merged]

Expected: The 0032 composite fks are still not valid condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-037. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: 0032_security_hardening.sql NOT VALID. No later VALIDATE CONSTRAINT.

Impact: Public-GA correctness, security, compliance, or operability is reduced by 0032 composite fks are still not valid.

Remediation: VALIDATE CONSTRAINT in a migration after data cleanup. Tests insert cross-org pair → fail.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-052-CONSENT-TOGGLE — Staff can re-enable SMS consent without provenance

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member
- Routes: /webhooks/twilio/inbound
- Aliases: NP-2026-052 [superseded]; AUG20:wave-1:tests-and-mutations:TEMP-SEC-003 [duplicate-merged]

Expected: The staff can re-enable sms consent without provenance condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-052. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-052. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by staff can re-enable sms consent without provenance.

Remediation: Consent API must not set true without provenance (NP-2026-011). Test SMS: owner + throttle + quiet hours + ledger + no production customer numbers by default.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-052-TEST-SMS — Owner test SMS can target arbitrary numbers without production controls

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member, owner
- Routes: /webhooks/twilio/inbound
- Aliases: min 38 [still-open]; NP-2026-052 [superseded]; AUG20:wave-1:settings-ux:TEMP-SET-012 [duplicate-merged]; AUG20:wave-1:sms:TEMP-SMS-007 [duplicate-merged]; AUG20:wave-1:tests-and-mutations:TEMP-SEC-004 [duplicate-merged]

Expected: The owner test sms can target arbitrary numbers without production controls condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-052. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-052. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by owner test sms can target arbitrary numbers without production controls.

Remediation: Consent API must not set true without provenance (NP-2026-011). Test SMS: owner + throttle + quiet hours + ledger + no production customer numbers by default.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-121 — No STOP language in SMS templates

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member
- Routes: /settings, /webhooks/twilio/inbound
- Aliases: min 27 [still-open]; NP-2026-121 [still-open]; AUG20:wave-1:settings-ux:TEMP-SET-015 [duplicate-merged]; AUG20:wave-1:sms:TEMP-SMS-004 [duplicate-merged]

Expected: The no stop language in sms templates condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-121. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-121. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by no stop language in sms templates.

Remediation: Add “Reply STOP to opt out” to defaults and append if missing at send.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-139 — HELP/INFO SMS keywords missing

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: member
- Routes: /webhooks/twilio/inbound
- Aliases: NP-2026-139 [still-open]; AUG20:wave-1:sms:TEMP-SMS-005 [duplicate-merged]

Expected: The help/info sms keywords missing condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-139. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-139. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by help/info sms keywords missing.

Remediation: CTIA: HELP → org name + opt-out instructions TwiML.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-141 — Privacy/EULA omit Resend

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: anonymous, member, provider
- Routes: /webhooks/resend
- Aliases: NP-2026-141 [still-open]; AUG20:wave-1:email:TEMP-EMAIL-010 [duplicate-merged]

Expected: The privacy/eula omit resend condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-141. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-141. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by privacy/eula omit resend.

Remediation: Disclose email processor + inbound.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-D01 — Render trusts forwarded origin headers without a bounded proxy or host allowlist

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: security / security
- Verification: environment-blocked (medium confidence)
- Fix order / size: 1 / S
- Roles: member
- Routes: cross-cutting
- Aliases: WORKTREE:FORWARDED-ORIGIN [unverified]

Expected: Only the known Render proxy and an allowlisted public host may influence the origin used by CSRF validation.

Actual: The Node runtime sets trust proxy to true, while the React Router adapter constructs request origin from forwarded protocol and host. Deployed header sanitization was not proven.

Root cause: The Node runtime sets trust proxy to true, while the React Router adapter constructs request origin from forwarded protocol and host. Deployed header sanitization was not proven.

Impact: Public-GA correctness, security, compliance, or operability is reduced by render trusts forwarded origin headers without a bounded proxy or host allowlist.

Remediation: Use a bounded trusted-hop/address policy and validate the effective host against explicit runtime configuration; test hostile forwarded headers on staging.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-D05 — Mandatory Codex Deep Security Scan could not start

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: security / security
- Verification: environment-blocked (medium confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: WORKTREE:DEEP-SCAN [unverified]

Expected: Canonical deep-scan manifest, findings, coverage, and report artifacts must be sealed for the exact candidate.

Actual: The scanner required a managed filesystem permission profile and TAC status could not be checked because the connector was not logged in.

Root cause: The scanner required a managed filesystem permission profile and TAC status could not be checked because the connector was not logged in.

Impact: Public-GA correctness, security, compliance, or operability is reduced by mandatory codex deep security scan could not start.

Remediation: Re-run the Deep Security Scan in a managed read-only workspace, complete it once, and link the sealed artifacts before re-verification.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-X228 — Login CSRF, duplicate-org onboarding, and invite accept mismatches can ship green

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / M
- Roles: anonymous, invitee, member, owner
- Routes: /login, /invite, /accept/:token
- Aliases: AUG20:wave-1:tests-and-mutations:TEMP-TEST-006 [still-open]

Expected: The login csrf, duplicate-org onboarding, and invite accept mismatches can ship green condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:tests-and-mutations:TEMP-TEST-006. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:tests-and-mutations:TEMP-TEST-006. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by login csrf, duplicate-org onboarding, and invite accept mismatches can ship green.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-018 — Invites do not send email; /invite is linked from no page

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: invitee, member
- Routes: /invite
- Aliases: M2 [still-open]; NP-2026-018 [still-open]; AUG20:wave-1:auth:TEMP-AUTH-007 [duplicate-merged]; AUG20:wave-1:settings-ux:TEMP-SET-010 [duplicate-merged]; AUG20:wave-1:settings-ux:TEMP-UX-010 [duplicate-merged]; AUG20:wave-2:workflow-static:TEMP-WF-014 [duplicate-merged]

Expected: The invites do not send email; /invite is linked from no page condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-018. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: invite.tsx:38-54 inserts row, returns relative /accept/<token> in <code>. Button says “Sending invite…”. Grep: only routes.ts + invite.tsx. Raw error.message to client (minor 40).

Impact: Public-GA correctness, security, compliance, or operability is reduced by invites do not send email; /invite is linked from no page.

Remediation: Owner Settings → Workspace “Invite teammate”. Send via Resend (team-alert path, not customer email_enabled). Absolute URL + copy button. Generic errors. Unique pending (org_id, email).

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-019 — Multi-org membership is a trap (resolveOrg oldest)

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: member, owner
- Routes: cross-cutting
- Aliases: M3 [still-open]; NP-2026-019 [still-open]; AUG20:wave-1:auth:TEMP-AUTH-011 [duplicate-merged]; AUG20:wave-1:tests-and-mutations:TEMP-SEC-005 [duplicate-merged]

Expected: The multi-org membership is a trap (resolveorg oldest) condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-019. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: session.server.ts:34-40 .order("created_at").limit(1).

Impact: Public-GA correctness, security, compliance, or operability is reduced by multi-org membership is a trap (resolveorg oldest).

Remediation: Org switcher (cookie/org header) or reject a second membership until v2 and show “already in a workspace”.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-020 — No change-password, change-email, or account deletion

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: anonymous, member
- Routes: /login, /accounts/:id
- Aliases: M5 [still-open]; NP-2026-020 [still-open]; AUG20:wave-1:auth:TEMP-AUTH-006 [duplicate-merged]

Expected: The no change-password, change-email, or account deletion condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-020. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: api.profile.tsx display_name only. Privacy policy punts deletion to support email.

Impact: Public-GA correctness, security, compliance, or operability is reduced by no change-password, change-email, or account deletion.

Remediation: Authenticated password change (current + new). Email change via confirm. Deletion: export + wipe memberships + QBO disconnect, matching privacy policy.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-032 — No reply_to; templates ask customers to reply

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: member
- Routes: /settings
- Aliases: M22 [still-open]; NP-2026-032 [still-open]; AUG20:wave-1:email:TEMP-EMAIL-006 [duplicate-merged]

Expected: The no reply_to; templates ask customers to reply condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-032. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: email-client.server.ts:10-12 payload { from, to, subject, html?, text? }.

Impact: Public-GA correctness, security, compliance, or operability is reduced by no reply_to; templates ask customers to reply.

Remediation: Set reply_to to a received-mailbox. Document MX. Or change templates to “do not reply; use the portal/pay link”.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-034 — email.failed / email.suppressed ignored

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: member
- Routes: cross-cutting
- Aliases: min 26 [still-open]; NP-2026-034 [still-open]; AUG20:wave-1:email:TEMP-EMAIL-007 [duplicate-merged]

Expected: The email.failed / email.suppressed ignored condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-034. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: email-events.ts default ignore. Rows stay sent.

Impact: Public-GA correctness, security, compliance, or operability is reduced by email.failed / email.suppressed ignored.

Remediation: Map those types to bounced/failed; permanent bounce sets do_not_email.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-038-ROSTER — Roster loading exposes and truncates a project-wide 1,000-user directory

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: member
- Routes: cross-cutting
- Aliases: min 52 [still-open]; NP-2026-038 [superseded]; AUG20:wave-1:auth:TEMP-AUTH-013 [duplicate-merged]; AUG20:wave-1:rls-tenancy:TEMP-RLS-006 [duplicate-merged]; AUG20:wave-3:security:TEMP-SEC-006 [duplicate-merged]

Expected: The roster loading exposes and truncates a project-wide 1,000-user directory condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-038. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: orgs.server.ts:88. Promise/alert paths in wave-1 RLS notes update by id without org_id.

Impact: Public-GA correctness, security, compliance, or operability is reduced by roster loading exposes and truncates a project-wide 1,000-user directory.

Remediation: Store display labels on memberships or paginate listUsers by membership user ids only. Always .eq("org_id") on service-role writes.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-038-SERVICE-PIN — Service-role id-keyed writes omit explicit organization scope

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: member, owner
- Routes: cross-cutting
- Aliases: min 52 [still-open]; NP-2026-038 [superseded]; AUG20:wave-1:rls-tenancy:TEMP-RLS-005 [duplicate-merged]

Expected: The service-role id-keyed writes omit explicit organization scope condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-038. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: orgs.server.ts:88. Promise/alert paths in wave-1 RLS notes update by id without org_id.

Impact: Public-GA correctness, security, compliance, or operability is reduced by service-role id-keyed writes omit explicit organization scope.

Remediation: Store display labels on memberships or paginate listUsers by membership user ids only. Always .eq("org_id") on service-role writes.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-044 — Onboarding replay creates orphan orgs

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: member, owner
- Routes: cross-cutting
- Aliases: min 1 [still-open]; NP-2026-044 [still-open]; AUG20:wave-1:auth:TEMP-AUTH-010 [duplicate-merged]; AUG20:wave-1:rls-tenancy:TEMP-RLS-014 [duplicate-merged]; AUG20:wave-1:tests-and-mutations:TEMP-TEST-006 [still-open]

Expected: The onboarding replay creates orphan orgs condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-044. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-044. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by onboarding replay creates orphan orgs.

Remediation: Action re-checks resolveOrg; if present, redirect dashboard. Unique membership constraint.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-133 — No LICENSE

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: member
- Routes: cross-cutting
- Aliases: min 49 [still-open]; NP-2026-133 [still-open]; AUG20:wave-1:ops-a11y:TEMP-OPS-011 [duplicate-merged]

Expected: The no license condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-133. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-133. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by no license.

Remediation: Add one before public launch.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X201 — Password policy is HTML-only (8) vs GoTrue min 6, no server check

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: anonymous, member
- Routes: /login
- Aliases: AUG20:wave-1:auth:TEMP-AUTH-014 [still-open]

Expected: The password policy is html-only (8) vs gotrue min 6, no server check condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:auth:TEMP-AUTH-014. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:auth:TEMP-AUTH-014. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by password policy is html-only (8) vs gotrue min 6, no server check.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X202 — Signup enumerates registered emails

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: anonymous, member
- Routes: /signup
- Aliases: AUG20:wave-1:auth:TEMP-AUTH-015 [still-open]

Expected: The signup enumerates registered emails condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:auth:TEMP-AUTH-015. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:auth:TEMP-AUTH-015. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by signup enumerates registered emails.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X212 — Loaders/helpers that omit `.eq("org_id")` and rely on RLS or global uniqueness

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: member, owner
- Routes: /dashboard, /webhooks/twilio/inbound
- Aliases: AUG20:wave-1:rls-tenancy:TEMP-RLS-010 [still-open]

Expected: The loaders/helpers that omit `.eq("org_id")` and rely on rls or global uniqueness condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-010. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-010. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by loaders/helpers that omit .eq("org_id") and rely on rls or global uniqueness.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X213 — User-facing loaders mint service-role clients for RLS-readable rows

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: member
- Routes: /dashboard
- Aliases: AUG20:wave-1:rls-tenancy:TEMP-RLS-012 [still-open]

Expected: The user-facing loaders mint service-role clients for rls-readable rows condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-012. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-012. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by user-facing loaders mint service-role clients for rls-readable rows.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X215 — RLS / IDOR test coverage holes

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: member
- Routes: cross-cutting
- Aliases: AUG20:wave-1:rls-tenancy:TEMP-RLS-015 [still-open]; AUG20:wave-1:tests-and-mutations:TEMP-TEST-004 [still-open]

Expected: The rls / idor test coverage holes condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-015. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-015. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by rls / idor test coverage holes.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X225 — STOP/START match the entire body only; no confirmation TwiML

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: member
- Routes: /signup, /webhooks/twilio/inbound
- Aliases: AUG20:wave-1:sms:TEMP-SMS-011 [still-open]

Expected: The stop/start match the entire body only; no confirmation twiml condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:sms:TEMP-SMS-011. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:sms:TEMP-SMS-011. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by stop/start match the entire body only; no confirmation twiml.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X226 — SMS ledger is member-writable; send-then-insert can orphan a live Twilio message

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: compliance / legal
- Verification: environment-blocked (medium confidence)
- Fix order / size: 1 / S
- Roles: member, provider
- Routes: /messages, /webhooks/twilio/inbound
- Aliases: AUG20:wave-1:sms:TEMP-SMS-013 [still-open]

Expected: The sms ledger is member-writable; send-then-insert can orphan a live twilio message condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:sms:TEMP-SMS-013. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:sms:TEMP-SMS-013. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by sms ledger is member-writable; send-then-insert can orphan a live twilio message.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X231 — Lockout / rate-limit is not distinguishable from a generic failure

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: member
- Routes: cross-cutting
- Aliases: AUG20:wave-2:workflow-static:TEMP-WF-008 [still-open]

Expected: The lockout / rate-limit is not distinguishable from a generic failure condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-008. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-008. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by lockout / rate-limit is not distinguishable from a generic failure.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X232 — Collector send paths 500 when provider secrets are missing

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: compliance / legal
- Verification: environment-blocked (medium confidence)
- Fix order / size: 1 / S
- Roles: member, owner, provider
- Routes: cross-cutting
- Aliases: AUG20:wave-2:workflow-static:TEMP-WF-009 [still-open]

Expected: The collector send paths 500 when provider secrets are missing condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-009. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-009. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by collector send paths 500 when provider secrets are missing.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X233 — Comm prefs drawer cannot represent preferred channel = email

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: member
- Routes: cross-cutting
- Aliases: AUG20:wave-2:workflow-static:TEMP-WF-011 [still-open]

Expected: The comm prefs drawer cannot represent preferred channel = email condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-011. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-011. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by comm prefs drawer cannot represent preferred channel = email.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X236 — QBO callback error redirects drop auth headers

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / S
- Roles: anonymous, member, owner, provider
- Routes: /settings
- Aliases: AUG20:wave-2:workflow-static:TEMP-WF-017 [still-open]

Expected: The qbo callback error redirects drop auth headers condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-017. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-017. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by qbo callback error redirects drop auth headers.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-103 — Generic auth errors

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 4 [still-open]; NP-2026-103 [still-open]

Expected: The generic auth errors condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-103. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-103. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by generic auth errors.

Remediation: Map more GoTrue strings; keep timing equal.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-104-EULA — The EULA still describes a private beta

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: anonymous
- Routes: cross-cutting
- Aliases: min 5 [still-open]; NP-2026-104 [superseded]; AUG20:wave-1:settings-ux:TEMP-UX-005 [duplicate-merged]

Expected: The the eula still describes a private beta condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-104. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-104. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by the eula still describes a private beta.

Remediation: Real marketing or “internal tool”; drop private-beta before Intuit.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-109 — DetailPanel consent posts only invoiceId

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 10 [partially-fixed]; NP-2026-109 [still-open]; AUG20:wave-1:sms:TEMP-SMS-014 [duplicate-merged]

Expected: The detailpanel consent posts only invoiceid condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-109. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-109. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by detailpanel consent posts only invoiceid.

Remediation: Always post customerId (inbox already does).

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-117 — Template editor no preview/tokens

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: /settings
- Aliases: min 19 [still-open]; NP-2026-117 [still-open]; AUG20:wave-1:settings-ux:TEMP-SET-022 [duplicate-merged]

Expected: The template editor no preview/tokens condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-117. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-117. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by template editor no preview/tokens.

Remediation: Preview pane; insert buttons; warn unknown {tokens}.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-118 — SMS bubbles no timestamps / no scroll

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: /webhooks/twilio/inbound
- Aliases: min 20 [still-open]; NP-2026-118 [still-open]

Expected: The sms bubbles no timestamps / no scroll condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-118. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-118. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by sms bubbles no timestamps / no scroll.

Remediation: Show time; scrollIntoView on last.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-123 — Bulk SMS swallows per-case errors

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: /dashboard, /webhooks/twilio/inbound
- Aliases: min 30 [still-open]; NP-2026-123 [still-open]

Expected: The bulk sms swallows per-case errors condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-123. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-123. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by bulk sms swallows per-case errors.

Remediation: Return { caseId, error }[]; show in drawer.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-128 — email_config.updated_at never set

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 42 [still-open]; NP-2026-128 [still-open]

Expected: The email_config.updated_at never set condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-128. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-128. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by email_config.updated_at never set.

Remediation: Trigger or set on upsert.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-142 — save_sms_sender locked (not a bug)

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: /webhooks/twilio/inbound
- Aliases: NP-2026-142 [still-open]

Expected: The save_sms_sender locked (not a bug) condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-142. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-142. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by save_sms_sender locked (not a bug).

Remediation: Keep locked until NP-2026-012. Document in Settings UI (already “Inactive”).

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X208 — OAuth callback swallows all errors; consume is SELECT then DELETE

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: AUG20:wave-1:qbo:TEMP-QBO-018 [still-open]

Expected: The oauth callback swallows all errors; consume is select then delete condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:qbo:TEMP-QBO-018. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:qbo:TEMP-QBO-018. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by oauth callback swallows all errors; consume is select then delete.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X209 — `sync_errors` member UPDATE is not column-constrained

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: /settings
- Aliases: AUG20:wave-1:rls-tenancy:TEMP-RLS-007 [still-open]

Expected: The `sync_errors` member update is not column-constrained condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-007. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-007. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by sync_errors member update is not column-constrained.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X210 — FORCE ROW LEVEL SECURITY is never set

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: AUG20:wave-1:rls-tenancy:TEMP-RLS-008 [still-open]

Expected: The force row level security is never set condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-008. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-008. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by force row level security is never set.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X211 — Owner/assignee columns are not membership-constrained

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member, owner
- Routes: cross-cutting
- Aliases: AUG20:wave-1:rls-tenancy:TEMP-RLS-009 [still-open]

Expected: The owner/assignee columns are not membership-constrained condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-009. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-009. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by owner/assignee columns are not membership-constrained.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X216 — `prevent_member_customer_source_edits` is the only member UPDATE column gate

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: AUG20:wave-1:rls-tenancy:TEMP-RLS-016 [still-open]

Expected: The `prevent_member_customer_source_edits` is the only member update column gate condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-016. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-016. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by prevent_member_customer_source_edits is the only member update column gate.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X224 — Server and bulk evaluate consent before do-not-text; UI does the reverse

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: AUG20:wave-1:sms:TEMP-SMS-010 [still-open]

Expected: The server and bulk evaluate consent before do-not-text; ui does the reverse condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:sms:TEMP-SMS-010. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:sms:TEMP-SMS-010. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by server and bulk evaluate consent before do-not-text; ui does the reverse.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X230 — Junk presence rows; low PII risk because reads filter loader customer ids

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: security / security
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: /dashboard
- Aliases: AUG20:wave-1:tests-and-mutations:TEMP-SEC-008 [still-open]

Expected: The junk presence rows; low pii risk because reads filter loader customer ids condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:tests-and-mutations:TEMP-SEC-008. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:tests-and-mutations:TEMP-SEC-008. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by junk presence rows; low pii risk because reads filter loader customer ids.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X238 — Status rewind can hide a failed SMS from collectors (compliance display)

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: member
- Routes: /webhooks/twilio/inbound
- Aliases: AUG20:wave-3:security:TEMP-SEC-005 [still-open]

Expected: The status rewind can hide a failed sms from collectors (compliance display) condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-3:security:TEMP-SEC-005. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-3:security:TEMP-SEC-005. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by status rewind can hide a failed sms from collectors (compliance display).

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X229 — If a token leaks (email logs, Referer), a third-party site can POST unsubscribe

- Severity: **informational**
- Release gate: **non-blocking**
- Domain / owner: compliance / legal
- Verification: static-only (high confidence)
- Fix order / size: 1 / XS
- Roles: anonymous, member
- Routes: /unsubscribe
- Aliases: AUG20:wave-1:tests-and-mutations:TEMP-SEC-007 [not-a-defect]

Expected: Preserve the intended behavior and regression-test it.

Actual: Current source matches the documented intended behavior; the prior raw card is retained as a non-defect record.

Root cause: No defect; the raw audit card described an intended or harmless behavior.

Impact: No release impact unless the intended control regresses.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-008 — Production environment was never configured

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: operations / devops
- Verification: environment-blocked (medium confidence)
- Fix order / size: 2 / M
- Roles: member, operator
- Routes: cross-cutting
- Aliases: B10 [still-open]; NP-2026-008 [still-open]; AUG20:wave-1:ops-a11y:TEMP-OPS-001 [duplicate-merged]

Expected: The production environment was never configured condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-008. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: wrangler.toml:25-27 SUPABASE_URL = "https://<your-prod-project-ref>.supabase.co". Deploy-gate comment: QBO/Twilio routes 500 until secrets exist. This run could not wrangler secret list --env production.

Impact: There is no evidence a production Worker can boot against a real database.

Remediation: 1. Create hosted Supabase; wrangler secret put every name in wrangler.toml comments (SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, QBO, Twilio, Resend, UNSUBSCRIBE_SECRET, APP_PUBLIC_BASE_URL). Set real SUPABASE_URL. QBO_SANDBOX=false. 2. Checklist in 07-ops-intuit.md. Rotate the legacy anon key (AGENTS.md:98). 3. Verify: wrangler secret list --env production; owner signup → connect QBO → invoices.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-D02 — Render readiness reports healthy when required configuration or Supabase is unavailable

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: operations / devops
- Verification: environment-blocked (medium confidence)
- Fix order / size: 2 / S
- Roles: member, operator
- Routes: /reports, /healthz
- Aliases: WORKTREE:READINESS [unverified]

Expected: Rollout readiness must fail when the application cannot serve authenticated traffic; a separate shallow liveness endpoint may remain.

Actual: The configured health route always returns 200 with { ok: true } and performs no configuration or dependency readiness check.

Root cause: The configured health route always returns 200 with { ok: true } and performs no configuration or dependency readiness check.

Impact: Public-GA correctness, security, compliance, or operability is reduced by render readiness reports healthy when required configuration or supabase is unavailable.

Remediation: Separate liveness and readiness. Validate required non-secret configuration and a bounded Supabase connectivity query without returning diagnostic values.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-D03 — Render free-plan secondary runtime is not production callback or failover capacity

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: operations / devops
- Verification: environment-blocked (medium confidence)
- Fix order / size: 2 / S
- Roles: member, owner, operator
- Routes: cross-cutting
- Aliases: WORKTREE:FREE-RENDER [unverified]

Expected: A failover runtime receiving provider callbacks must remain available within provider acknowledgement windows and have supported rollback capacity.

Actual: The Blueprint selects plan: free. Render documents idle spin-down, about one-minute wake-up, and says free instances are not for production.

Root cause: The Blueprint selects plan: free. Render documents idle spin-down, about one-minute wake-up, and says free instances are not for production.

Impact: Public-GA correctness, security, compliance, or operability is reduced by render free-plan secondary runtime is not production callback or failover capacity.

Remediation: Use a paid always-on staging/failover service, then measure cold/start latency, webhook acknowledgement, shutdown, scaling, and rollback behavior.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-D04 — Node waitUntil shim does not drain background work during shutdown

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: data-integrity / backend
- Verification: environment-blocked (medium confidence)
- Fix order / size: 2 / M
- Roles: member
- Routes: cross-cutting
- Aliases: WORKTREE:WAITUNTIL [unverified]

Expected: Provider acknowledgement followed by background work must survive ordinary deploy/restart boundaries or durably enqueue before acknowledgement.

Actual: The shim catches rejected promises with console.error but does not track pending work, expose failure telemetry, or drain on SIGTERM.

Root cause: The shim catches rejected promises with console.error but does not track pending work, expose failure telemetry, or drain on SIGTERM.

Impact: Public-GA correctness, security, compliance, or operability is reduced by node waituntil shim does not drain background work during shutdown.

Remediation: Persist jobs before acknowledging callbacks or track and drain work with bounded graceful shutdown, durable retries, and monitoring.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-D06 — Mandatory staging, provider, database, and authenticated browser evidence is unavailable

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: operations / devops
- Verification: environment-blocked (medium confidence)
- Fix order / size: 2 / L
- Roles: member, owner, provider, operator
- Routes: cross-cutting
- Aliases: WORKTREE:ENV-EVIDENCE [unverified]

Expected: Every mandatory public-GA database, browser, provider, runtime, resilience, and operations gate must have executable evidence.

Actual: Docker/local Supabase, dedicated staging, provider accounts, authenticated fixtures, the in-app Browser service, monitoring, backup/restore, and rollback proof were unavailable.

Root cause: Docker/local Supabase, dedicated staging, provider accounts, authenticated fixtures, the in-app Browser service, monitoring, backup/restore, and rollback proof were unavailable.

Impact: Public-GA correctness, security, compliance, or operability is reduced by mandatory staging, provider, database, and authenticated browser evidence is unavailable.

Remediation: Provision retained isolated audit resources and execute every environment-blocked matrix row with synthetic data and owned destinations.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-132-STARTER — Cloudflare and npm metadata still describe a generic starter

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: operations / devops
- Verification: static-only (high confidence)
- Fix order / size: 2 / XS
- Roles: member, operator
- Routes: cross-cutting
- Aliases: min 48 [still-open]; NP-2026-132 [superseded]; AUG20:wave-1:ops-a11y:TEMP-OPS-004 [duplicate-merged]; AUG20:wave-1:ops-a11y:TEMP-OPS-015 [duplicate-merged]

Expected: The cloudflare and npm metadata still describe a generic starter condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-132. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-132. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by cloudflare and npm metadata still describe a generic starter.

Remediation: Rewrite app README; migrations 0001–0034; organizations not orgs; drop publish: true.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-006 — Dead QBO connection reports Connected forever

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / M
- Roles: member, owner, provider
- Routes: /reports, /settings
- Aliases: B9 [still-open]; NP-2026-006 [still-open]; AUG20:wave-1:qbo:TEMP-QBO-003 [duplicate-merged]

Expected: The dead qbo connection reports connected forever condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-006. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: qbo-connection.server.ts writes status "connected" (store) or "disconnected" (explicit disconnect) only. getValidAccessToken:26-45 throws on refresh failure and does not update status. Sync failures go to sync_errors, which are not mounted in the header (NP-2026-023).

Impact: Token lapse (~100 days idle, or user revoke at Intuit) freezes AR with a green chip. Collectors work stale balances.

Remediation: 1. Catch refresh failure → status='error' (or needs_reconnect) + sync_errors row. loadWorkspaceChrome treats error like disconnected: banner + Connect CTA, do not silently empty the queue. 2. Tests: mock 400 from Intuit token endpoint → status error; UI copy; reconnect overwrites. 3. Manual: revoke app at Intuit, wait for cron/refresh, see reconnect prompt.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-007-RECONCILIATION — Truncated reconciliation can auto-resolve live collection cases

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: data-integrity / database
- Verification: environment-blocked (medium confidence)
- Fix order / size: 3 / M
- Roles: member
- Routes: /dashboard
- Aliases: B2 [still-open]; NP-2026-007 [superseded]; AUG20:wave-1:cases-queue:TEMP-CASE-001 [duplicate-merged]

Expected: The truncated reconciliation can auto-resolve live collection cases condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-007. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: supabase/config.toml:18 max_rows = 1000. case-queue.server.ts:137-147 unbounded invoice/case selects. case-lifecycle.server.ts:10-30 loads overdue customer_ids, then resolves any open case whose customer is not in that set.

Impact: Past 1,000 overdue invoice rows, KPIs under-count and active collection cases close themselves on the next sync. Invisible.

Remediation: 1. Page every list (.range loop until short page) or use count: exact for recon. Never treat a truncated set as “these customers are no longer overdue”. 2. If a page is truncated, fail the recon and record sync_errors; do not resolve. 3. Tests: 1001 overdue invoices → recon does not close case 1001’s customer; loader surfaces truncation.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-007-TRUNCATION — PostgREST list reads silently truncate above 1,000 rows

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: data-integrity / database
- Verification: static-only (high confidence)
- Fix order / size: 3 / M
- Roles: member
- Routes: cross-cutting
- Aliases: B1 [still-open]; NP-2026-007 [superseded]; AUG20:wave-1:cases-queue:TEMP-CASE-001 [duplicate-merged]

Expected: The postgrest list reads silently truncate above 1,000 rows condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-007. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: supabase/config.toml:18 max_rows = 1000. case-queue.server.ts:137-147 unbounded invoice/case selects. case-lifecycle.server.ts:10-30 loads overdue customer_ids, then resolves any open case whose customer is not in that set.

Impact: Past 1,000 overdue invoice rows, KPIs under-count and active collection cases close themselves on the next sync. Invisible.

Remediation: 1. Page every list (.range loop until short page) or use count: exact for recon. Never treat a truncated set as “these customers are no longer overdue”. 2. If a page is truncated, fail the recon and record sync_errors; do not resolve. 3. Tests: 1001 overdue invoices → recon does not close case 1001’s customer; loader surfaces truncation.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-015 — Loader DB errors render as a healthy empty queue

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: data-integrity / database
- Verification: static-only (high confidence)
- Fix order / size: 3 / M
- Roles: member
- Routes: /dashboard, /healthz
- Aliases: M6 [still-open]; NP-2026-015 [still-open]; AUG20:wave-1:cases-queue:TEMP-CASE-002 [duplicate-merged]; AUG20:wave-2:workflow-static:TEMP-WF-010 [duplicate-merged]

Expected: The loader db errors render as a healthy empty queue condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-015. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: case-queue.server.ts:130-147 destructures { data } and ignores error. Failed reads become [] / $0 KPIs.

Impact: A collections team can believe there is nothing to collect while PostgREST is failing.

Remediation: If any stage-1 query errors, throw (ErrorBoundary) or return an explicit loadError banner. Never convert error to empty metrics.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-027 — QBO realm switch merges two books

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / M
- Roles: member, owner, provider
- Routes: /settings
- Aliases: M19 [still-open]; NP-2026-027 [still-open]; AUG20:wave-1:qbo:TEMP-QBO-004 [duplicate-merged]

Expected: The qbo realm switch merges two books condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-027. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: storeConnection upserts on org_id, replaces realm_id, no purge.

Impact: Public-GA correctness, security, compliance, or operability is reduced by qbo realm switch merges two books.

Remediation: If realm_id changes, require typed confirm and delete org-scoped QBO rows (customers, invoices, payments, cases, messages) inside a transaction, then sync. Test: realm A then B → no A invoices.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-028 — QBO query/CDC cap 1000; truncated discarded

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / M
- Roles: member, owner, provider
- Routes: /settings
- Aliases: M18 [still-open]; NP-2026-028 [still-open]; AUG20:wave-1:qbo:TEMP-QBO-005 [duplicate-merged]

Expected: The qbo query/cdc cap 1000; truncated discarded condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-028. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: qbo-sync.server.ts:26-28,227; refresh caller ignores return value. Comment sizes to Chancey.

Impact: Public-GA correctness, security, compliance, or operability is reduced by qbo query/cdc cap 1000; truncated discarded.

Remediation: Page Intuit queries. If truncated, sync_errors + do not advance CDC watermark.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-030 — QBO deletions/voids mishandled

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / M
- Roles: member, owner, provider
- Routes: /settings
- Aliases: M26 [still-open]; NP-2026-030 [still-open]; AUG20:wave-1:qbo:TEMP-QBO-007 [duplicate-merged]

Expected: The qbo deletions/voids mishandled condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-030. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: CDC flattens Deleted skeletons → customer "(unnamed)". Webhook missing entity returns without closing local overdue rows.

Impact: Public-GA correctness, security, compliance, or operability is reduced by qbo deletions/voids mishandled.

Remediation: Honor Deleted / void: zero balance or delete local row; recon will close cases. Never upsert "(unnamed)" over a named customer.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-031 — QBO webhook does Intuit+DB work before 200; no waitUntil

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / M
- Roles: member, owner, provider
- Routes: /settings, /webhooks/qbo
- Aliases: M20 [still-open]; NP-2026-031 [still-open]; AUG20:wave-1:qbo:TEMP-QBO-008 [duplicate-merged]

Expected: The qbo webhook does intuit+db work before 200; no waituntil condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-031. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: webhooks.qbo.tsx:45-76. waitUntil only on crons.

Impact: Public-GA correctness, security, compliance, or operability is reduced by qbo webhook does intuit+db work before 200; no waituntil.

Remediation: Verify sig, enqueue ctx.waitUntil(process), return 200 quickly. Idempotent upserts already allow retry.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-036-QBO-TOKEN — Members can retrieve encrypted QBO credential columns

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / M
- Roles: member, owner, provider
- Routes: /settings
- Aliases: NP-2026-036 [superseded]; AUG20:wave-1:rls-tenancy:TEMP-RLS-004 [duplicate-merged]

Expected: The members can retrieve encrypted qbo credential columns condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-036. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: contact_logs, text_messages, collection_cases, promises still member FOR ALL after 0032. Invites readable by members (bearer token). qbo_connections member SELECT includes token columns (app may not request them; PostgREST will if asked).

Impact: Public-GA correctness, security, compliance, or operability is reduced by members can retrieve encrypted qbo credential columns.

Remediation: INSERT-only (or no DELETE/UPDATE) for logs/messages. Invites: members SELECT email/status not token. QBO: column privilege or view without *_enc. Tests with user JWT + PostgREST.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-046-FLOAT-MONEY — Promise evaluation compares currency with floating-point arithmetic

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: data-integrity / database
- Verification: static-only (high confidence)
- Fix order / size: 3 / M
- Roles: member
- Routes: /promises
- Aliases: min 33 [still-open]; NP-2026-046 [superseded]; AUG20:wave-1:cases-queue:TEMP-CASE-009 [duplicate-merged]

Expected: The promise evaluation compares currency with floating-point arithmetic condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-046. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-046. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by promise evaluation compares currency with floating-point arithmetic.

Remediation: Integer cents. Count only payments rows of type payment (not credit memo/void) toward received, or document that QBO balance is the source of truth and show why.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-046-PAYMENT-SEMANTICS — Any balance drop, including credit memos, counts as promise payment

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: data-integrity / database
- Verification: static-only (high confidence)
- Fix order / size: 3 / M
- Roles: member
- Routes: /promises
- Aliases: min 37 [still-open]; NP-2026-046 [superseded]; AUG20:wave-1:cases-queue:TEMP-CASE-010 [duplicate-merged]

Expected: The any balance drop, including credit memos, counts as promise payment condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-046. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-046. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by any balance drop, including credit memos, counts as promise payment.

Remediation: Integer cents. Count only payments rows of type payment (not credit memo/void) toward received, or document that QBO balance is the source of truth and show why.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-X227 — Login cookie flow, CSRF Origin from real forms, Focus Mode send, QBO connect button, and unsubscribe confirm page are untested in a browser

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / M
- Roles: anonymous, member, owner, provider
- Routes: /login, /focus, /settings, /unsubscribe
- Aliases: AUG20:wave-1:tests-and-mutations:TEMP-TEST-003 [still-open]

Expected: The login cookie flow, csrf origin from real forms, focus mode send, qbo connect button, and unsubscribe confirm page are untested in a browser condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:tests-and-mutations:TEMP-TEST-003. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:tests-and-mutations:TEMP-TEST-003. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by login cookie flow, csrf origin from real forms, focus mode send, qbo connect button, and unsubscribe confirm page are untested in a browser.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-017 — qbo= / sync= query params are never rendered

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / S
- Roles: member, owner, provider
- Routes: /settings
- Aliases: M17 [still-open]; NP-2026-017 [still-open]; AUG20:wave-1:qbo:TEMP-QBO-002 [duplicate-merged]; AUG20:wave-1:settings-ux:TEMP-SET-007 [duplicate-merged]; AUG20:wave-2:workflow-static:TEMP-WF-001 [duplicate-merged]

Expected: The qbo= / sync= query params are never rendered condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-017. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Callback/refresh/disconnect write qbo=connected|error|forbidden|disconnected and sync=ok|error. dashboard.tsx does not read them. Settings first-run bounce has no welcome (workspace.server.ts:35-37).

Impact: Public-GA correctness, security, compliance, or operability is reduced by qbo= / sync= query params are never rendered.

Remediation: Banner on dashboard + Settings Integrations. Copy for each code. Clear the param after display (use-flash-cleanup.ts pattern).

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-023 — SyncIssues exists but is mounted nowhere

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / S
- Roles: member
- Routes: /settings
- Aliases: M9 [still-open]; min 58 [still-open]; NP-2026-023 [still-open]; AUG20:wave-1:qbo:TEMP-QBO-013 [duplicate-merged]; AUG20:wave-1:settings-ux:TEMP-SET-009 [duplicate-merged]; AUG20:wave-1:settings-ux:TEMP-UX-009 [duplicate-merged]

Expected: The syncissues exists but is mounted nowhere condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-023. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Zero route imports of SyncIssues. reports.tsx passes null. Failures only on Settings Integrations. Hidden sm:inline-flex even if mounted (minor 58).

Impact: Public-GA correctness, security, compliance, or operability is reduced by syncissues exists but is mounted nowhere.

Remediation: Pass unresolved sync_errors into AppShell on dashboard/accounts/focus. Show on mobile.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-024 — Email never counts as last contact

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: data-integrity / database
- Verification: static-only (high confidence)
- Fix order / size: 3 / S
- Roles: member
- Routes: cross-cutting
- Aliases: M10 [still-open]; NP-2026-024 [still-open]; AUG20:wave-1:cases-queue:TEMP-CASE-003 [duplicate-merged]

Expected: The email never counts as last contact condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-024. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: case-queue.server.ts:213-250 uses contact_logs + outbound text_messages only.

Impact: Public-GA correctness, security, compliance, or operability is reduced by email never counts as last contact.

Remediation: Include outbound email_messages in last-contact. Tests: email-only customer is not “Never contacted” / +15 silence points.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-029 — CDC watermark stamped after processing

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / S
- Roles: member
- Routes: cross-cutting
- Aliases: min 22 [still-open]; NP-2026-029 [still-open]; AUG20:wave-1:qbo:TEMP-QBO-006 [duplicate-merged]

Expected: The cdc watermark stamped after processing condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-029. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: qbo-sync.server.ts:320-321 now after upserts.

Impact: Public-GA correctness, security, compliance, or operability is reduced by cdc watermark stamped after processing.

Remediation: Capture changedSince/fetchedAt before the Intuit call; persist that. Tests for the skip window.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-043 — QBO Disconnect is one unconfirmed click

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / S
- Roles: member, owner, provider
- Routes: /settings
- Aliases: M31 [still-open]; NP-2026-043 [still-open]; AUG20:wave-1:qbo:TEMP-QBO-011 [duplicate-merged]; AUG20:wave-1:settings-ux:TEMP-SET-008 [duplicate-merged]

Expected: The qbo disconnect is one unconfirmed click condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-043. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: settings.tsx:248-252. Locks workspace via requireQbo.

Impact: Public-GA correctness, security, compliance, or operability is reduced by qbo disconnect is one unconfirmed click.

Remediation: Confirm dialog (typed org name). GET Intuit disconnect remains a landing (already solid).

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-045-THRESHOLD-ORDER — High-value thresholds at or above $10,000 stop affecting priority scoring

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: data-integrity / database
- Verification: static-only (high confidence)
- Fix order / size: 3 / S
- Roles: member
- Routes: /webhooks/twilio/inbound
- Aliases: min 34 [still-open]; NP-2026-045 [superseded]; AUG20:wave-1:cases-queue:TEMP-CASE-006 [duplicate-merged]

Expected: The high-value thresholds at or above $10,000 stop affecting priority scoring condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-045. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: priority.ts:39-45 hardcoded 25k/10k before org threshold. Form min={0.01}; parser < 1000 rejected with wrong copy.

Impact: Public-GA correctness, security, compliance, or operability is reduced by high-value thresholds at or above $10,000 stop affecting priority scoring.

Remediation: Apply org threshold before hardcoded bands, or cap the input at 9999.99 and match client/server + error copy.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-045-VALIDATION-RANGE — Priority threshold client and server ranges disagree

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: data-integrity / database
- Verification: static-only (high confidence)
- Fix order / size: 3 / S
- Roles: member
- Routes: cross-cutting
- Aliases: min 17 [still-open]; NP-2026-045 [superseded]; AUG20:wave-1:settings-ux:TEMP-SET-002 [duplicate-merged]

Expected: The priority threshold client and server ranges disagree condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-045. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: priority.ts:39-45 hardcoded 25k/10k before org threshold. Form min={0.01}; parser < 1000 rejected with wrong copy.

Impact: Public-GA correctness, security, compliance, or operability is reduced by priority threshold client and server ranges disagree.

Remediation: Apply org threshold before hardcoded bands, or cap the input at 9999.99 and match client/server + error copy.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-050 — Work queue not virtualized; revalidate every 20s while a case is open

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: data-integrity / database
- Verification: static-only (high confidence)
- Fix order / size: 3 / S
- Roles: member
- Routes: /dashboard
- Aliases: M8 [still-open]; NP-2026-050 [still-open]

Expected: The work queue not virtualized; revalidate every 20s while a case is open condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-050. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-050. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by work queue not virtualized; revalidate every 20s while a case is open.

Remediation: Virtualize rows. Heartbeat should POST presence only, not reload the entire loader.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-051 — “Total customers” is not the QBO directory

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / S
- Roles: member, owner, provider
- Routes: /settings
- Aliases: M11 [still-open]; NP-2026-051 [still-open]

Expected: The “total customers” is not the qbo directory condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-051. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-051. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by “total customers” is not the qbo directory.

Remediation: Rename tile “Customers in collections” or sync the full customer list.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-054-BACKOFF — Intuit 429 responses have no bounded backoff or Retry-After handling

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / S
- Roles: member
- Routes: cross-cutting
- Aliases: min 21 [still-open]; NP-2026-054 [superseded]; AUG20:wave-1:qbo:TEMP-QBO-015 [duplicate-merged]

Expected: The intuit 429 responses have no bounded backoff or retry-after handling condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-054. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-054. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by intuit 429 responses have no bounded backoff or retry-after handling.

Remediation: Capture one real production payload, lock tests to it. Honor 429 Retry-After with bounded retry.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-054-PARSER — The QBO CloudEvents parser is not verified against a real payload

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / S
- Roles: member, owner, provider
- Routes: /settings, /webhooks/qbo
- Aliases: min 25 [still-open]; NP-2026-054 [superseded]; AUG20:wave-1:qbo:TEMP-QBO-009 [duplicate-merged]

Expected: The the qbo cloudevents parser is not verified against a real payload condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-054. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-054. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by the qbo cloudevents parser is not verified against a real payload.

Remediation: Capture one real production payload, lock tests to it. Honor 429 Retry-After with bounded retry.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X205 — Manual Refresh does not re-pull paid invoices or payments

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / S
- Roles: member
- Routes: cross-cutting
- Aliases: AUG20:wave-1:qbo:TEMP-QBO-012 [still-open]

Expected: The manual refresh does not re-pull paid invoices or payments condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:qbo:TEMP-QBO-012. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:qbo:TEMP-QBO-012. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by manual refresh does not re-pull paid invoices or payments.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X206 — `QBO_SANDBOX` defaults true unless the string is exactly `"false"`

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: integration / backend
- Verification: environment-blocked (medium confidence)
- Fix order / size: 3 / S
- Roles: member, owner, provider
- Routes: /settings
- Aliases: AUG20:wave-1:qbo:TEMP-QBO-014 [still-open]

Expected: The `qbo_sandbox` defaults true unless the string is exactly `"false"` condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:qbo:TEMP-QBO-014. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:qbo:TEMP-QBO-014. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by qbo_sandbox defaults true unless the string is exactly "false".

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X207 — QBO entity ids interpolated raw into query strings

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / S
- Roles: member, owner, provider
- Routes: /settings
- Aliases: AUG20:wave-1:qbo:TEMP-QBO-017 [still-open]

Expected: The qbo entity ids interpolated raw into query strings condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:qbo:TEMP-QBO-017. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:qbo:TEMP-QBO-017. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by qbo entity ids interpolated raw into query strings.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X214 — Any member can trigger service-role QBO financial rewrite

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: integration / backend
- Verification: static-only (high confidence)
- Fix order / size: 3 / S
- Roles: member, owner, provider
- Routes: /settings
- Aliases: AUG20:wave-1:rls-tenancy:TEMP-RLS-013 [still-open]; AUG20:wave-1:tests-and-mutations:TEMP-SEC-006 [still-open]

Expected: The any member can trigger service-role qbo financial rewrite condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-013. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:rls-tenancy:TEMP-RLS-013. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by any member can trigger service-role qbo financial rewrite.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-113 — Promises page has no cancel

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: data-integrity / database
- Verification: static-only (high confidence)
- Fix order / size: 3 / XS
- Roles: member
- Routes: /promises
- Aliases: min 14 [still-open]; NP-2026-113 [still-open]; AUG20:wave-1:cases-queue:TEMP-CASE-014 [duplicate-merged]; AUG20:wave-2:workflow-static:TEMP-WF-018 [duplicate-merged]

Expected: The promises page has no cancel condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-113. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-113. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by promises page has no cancel.

Remediation: Wire api.promises.cancel + renegotiate.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-143-SUPPRESSED-FOCUS — My Work includes suppressed or parked cases

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: data-integrity / database
- Verification: static-only (high confidence)
- Fix order / size: 3 / XS
- Roles: member
- Routes: /dashboard
- Aliases: NP-2026-143 [superseded]; AUG20:wave-1:cases-queue:TEMP-CASE-016 [duplicate-merged]

Expected: The my work includes suppressed or parked cases condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-143. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-143. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by my work includes suppressed or parked cases.

Remediation: Exclude parked cases from focus deck; snooze must not count as contact.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-143-WAITING-PROMISE — Focus includes waiting and pending-promise cases

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: data-integrity / database
- Verification: static-only (high confidence)
- Fix order / size: 3 / XS
- Roles: member
- Routes: /dashboard, /focus, /promises
- Aliases: NP-2026-143 [superseded]; AUG20:wave-1:cases-queue:TEMP-CASE-018 [duplicate-merged]

Expected: The focus includes waiting and pending-promise cases condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-143. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-143. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by focus includes waiting and pending-promise cases.

Remediation: Exclude parked cases from focus deck; snooze must not count as contact.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X203 — Owner/user labels fall back to UUID prefix or "Unknown"

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: data-integrity / database
- Verification: static-only (high confidence)
- Fix order / size: 3 / XS
- Roles: member, owner
- Routes: cross-cutting
- Aliases: AUG20:wave-1:cases-queue:TEMP-CASE-007 [still-open]

Expected: The owner/user labels fall back to uuid prefix or "unknown" condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:cases-queue:TEMP-CASE-007. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:cases-queue:TEMP-CASE-007. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by owner/user labels fall back to uuid prefix or "unknown".

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-101 — Reports nav “(coming soon)” for members

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: functionality / backend
- Verification: static-only (high confidence)
- Fix order / size: 4 / XS
- Roles: member
- Routes: /reports
- Aliases: min 2 [still-open]; NP-2026-101 [still-open]; AUG20:wave-1:ops-a11y:TEMP-UX-021 [duplicate-merged]; AUG20:wave-1:settings-ux:TEMP-SET-018 [duplicate-merged]; AUG20:wave-2:workflow-static:TEMP-WF-015 [duplicate-merged]

Expected: The reports nav “(coming soon)” for members condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-101. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-101. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by reports nav “(coming soon)” for members.

Remediation: Use “Owner only” or hide the item.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-126 — Invite returns raw DB errors

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 4 / XS
- Roles: invitee, member
- Routes: /invite
- Aliases: min 40 [still-open]; NP-2026-126 [still-open]; AUG20:wave-1:auth:TEMP-AUTH-009 [duplicate-merged]

Expected: The invite returns raw db errors condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-126. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-126. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by invite returns raw db errors.

Remediation: Generic “Could not create invite”.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-130 — Duplicate pending invites

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 4 / XS
- Roles: invitee, member
- Routes: /invite
- Aliases: min 44 [still-open]; NP-2026-130 [still-open]; AUG20:wave-1:auth:TEMP-AUTH-008 [duplicate-merged]

Expected: The duplicate pending invites condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-130. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-130. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by duplicate pending invites.

Remediation: Unique (org_id, email) WHERE accepted_at IS NULL.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X217 — A member who tampers a form (or an owner who lost the role mid-session) gets bounced to the same tab with no explanation

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: ux-ui / frontend
- Verification: static-only (high confidence)
- Fix order / size: 4 / XS
- Roles: member, owner
- Routes: cross-cutting
- Aliases: AUG20:wave-1:settings-ux:TEMP-SET-011 [still-open]; AUG20:wave-2:workflow-static:TEMP-WF-019 [still-open]

Expected: The a member who tampers a form (or an owner who lost the role mid-session) gets bounced to the same tab with no explanation condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-011. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-011. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by a member who tampers a form (or an owner who lost the role mid-session) gets bounced to the same tab with no explanation.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-053-CONTRAST — Core copper and Focus color pairs fail WCAG AA contrast

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: workflow / backend
- Verification: static-only (high confidence)
- Fix order / size: 5 / M
- Roles: member
- Routes: /focus
- Aliases: M32 [still-open]; M33 [still-open]; NP-2026-053 [superseded]; AUG20:wave-1:ops-a11y:TEMP-UX-011 [duplicate-merged]; AUG20:wave-1:ops-a11y:TEMP-UX-012 [duplicate-merged]

Expected: The core copper and focus color pairs fail wcag aa contrast condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-053. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: --color-copper: #cf8136 (app.css:12). Focus text-muted on bg-ink. Focus SMS body, accounts search, late-fee toggle: placeholder-as-label.

Impact: Public-GA correctness, security, compliance, or operability is reduced by core copper and focus color pairs fail wcag aa contrast.

Remediation: Darken copper on light surfaces (~4.5:1). Lighten Focus secondary text. Visible <label> / aria-label on those three controls.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-144 — Terminal DNC does not block Focus log-call / applyNextStep

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: workflow / backend
- Verification: static-only (high confidence)
- Fix order / size: 5 / M
- Roles: member
- Routes: /focus
- Aliases: NP-2026-144 [still-open]; AUG20:wave-1:cases-queue:TEMP-CASE-013 [duplicate-merged]

Expected: The terminal dnc does not block focus log-call / applynextstep condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-144. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-144. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by terminal dnc does not block focus log-call / applynextstep.

Remediation: Server-gate log-call the same as SMS for blocksContact.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-025 — Focus Mode has no collision/presence

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: workflow / backend
- Verification: static-only (high confidence)
- Fix order / size: 5 / S
- Roles: member
- Routes: /focus
- Aliases: M7 [still-open]; NP-2026-025 [still-open]; AUG20:wave-1:cases-queue:TEMP-CASE-004 [duplicate-merged]; AUG20:wave-2:workflow-static:TEMP-WF-012 [duplicate-merged]

Expected: The focus mode has no collision/presence condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-025. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: focus.tsx:57-58 includePresence: false. Queue is deterministic → two agents double-text.

Impact: Public-GA correctness, security, compliance, or operability is reduced by focus mode has no collision/presence.

Remediation: Same heartbeat as dashboard; skip/lock cases with live presence; show who.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-026 — Default templates resurrect after delete

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: ux-ui / frontend
- Verification: static-only (high confidence)
- Fix order / size: 5 / S
- Roles: member
- Routes: /settings
- Aliases: M16 [still-open]; NP-2026-026 [still-open]; AUG20:wave-1:settings-ux:TEMP-SET-001 [duplicate-merged]

Expected: The default templates resurrect after delete condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-026. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: message-templates.ts:38-47 appends missing default slugs.

Impact: Public-GA correctness, security, compliance, or operability is reduced by default templates resurrect after delete.

Remediation: Tombstone deleted default slugs or only merge defaults when DB count is 0. Test: delete friendly-reminder, reload, absent.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-047 — No inbox read state or live updates

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: workflow / backend
- Verification: environment-blocked (medium confidence)
- Fix order / size: 5 / S
- Roles: member
- Routes: /messages
- Aliases: M14 [still-open]; M15 [still-open]; NP-2026-047 [still-open]; AUG20:wave-2:workflow-static:TEMP-WF-006 [duplicate-merged]

Expected: The no inbox read state or live updates condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-047. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-047. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by no inbox read state or live updates.

Remediation: last_read_at per thread; poll 15–30s or heartbeat; Needs reply uses unread inbound.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-048-CSV — Reports and work queues have no CSV export

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: functionality / backend
- Verification: static-only (high confidence)
- Fix order / size: 5 / S
- Roles: member
- Routes: /dashboard, /reports
- Aliases: M12 [still-open]; NP-2026-048 [superseded]

Expected: The reports and work queues have no csv export condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-048. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-048. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by reports and work queues have no csv export.

Remediation: US-only gate at QBO connect (CompanyInfo Country) or sync currency. CSV on reports + queue.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-048-LOCALE — Currency and locale are hardcoded to USD and en-US

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: functionality / backend
- Verification: static-only (high confidence)
- Fix order / size: 5 / S
- Roles: member
- Routes: cross-cutting
- Aliases: M13 [still-open]; NP-2026-048 [superseded]

Expected: The currency and locale are hardcoded to usd and en-us condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-048. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-048. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by currency and locale are hardcoded to usd and en-us.

Remediation: US-only gate at QBO connect (CompanyInfo Country) or sync currency. CSV on reports + queue.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-049-CHANNEL-GATE — Operator alerts are incorrectly gated by customer email settings

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: ux-ui / frontend
- Verification: static-only (high confidence)
- Fix order / size: 5 / S
- Roles: member, owner
- Routes: /settings
- Aliases: min 31 [still-open]; min 53 [still-open]; NP-2026-049 [superseded]; AUG20:wave-1:email:TEMP-EMAIL-008 [duplicate-merged]; AUG20:wave-1:settings-ux:TEMP-SET-021 [duplicate-merged]

Expected: The operator alerts are incorrectly gated by customer email settings condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-049. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-049. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by operator alerts are incorrectly gated by customer email settings.

Remediation: Separate operator mail env from email_config.email_enabled. Retry/ledger on failure.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X218 — A `message_templates` read error (RLS, missing table, network) renders the factory defaults as if they were the org’s live templates

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: ux-ui / frontend
- Verification: environment-blocked (medium confidence)
- Fix order / size: 5 / S
- Roles: member, owner
- Routes: /messages, /settings
- Aliases: AUG20:wave-1:settings-ux:TEMP-SET-013 [still-open]

Expected: The a `message_templates` read error (rls, missing table, network) renders the factory defaults as if they were the org’s live templates condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-013. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-013. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by a message_templates read error (rls, missing table, network) renders the factory defaults as if they were the org’s live templates.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-106 — Focus raw error codes

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: workflow / backend
- Verification: static-only (high confidence)
- Fix order / size: 5 / XS
- Roles: member
- Routes: /focus
- Aliases: min 7 [still-open]; NP-2026-106 [still-open]; AUG20:wave-2:workflow-static:TEMP-WF-020 [still-open]

Expected: The focus raw error codes condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-106. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-106. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by focus raw error codes.

Remediation: Map SMS error codes to human copy.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-107 — Focus hidden below sm

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: workflow / backend
- Verification: static-only (high confidence)
- Fix order / size: 5 / XS
- Roles: member
- Routes: /focus
- Aliases: min 8 [still-open]; NP-2026-107 [still-open]; AUG20:wave-1:settings-ux:TEMP-UX-002 [duplicate-merged]

Expected: The focus hidden below sm condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-107. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-107. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by focus hidden below sm.

Remediation: Show Focus in mobile nav or a usable mobile deck.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-116 — No unsaved-changes on settings tabs

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: ux-ui / frontend
- Verification: static-only (high confidence)
- Fix order / size: 5 / XS
- Roles: member, owner
- Routes: /settings
- Aliases: min 18 [still-open]; NP-2026-116 [still-open]; AUG20:wave-1:settings-ux:TEMP-SET-004 [duplicate-merged]

Expected: The no unsaved-changes on settings tabs condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-116. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-116. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by no unsaved-changes on settings tabs.

Remediation: Dirty guard before <Link> tab switch.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-143-SNOOZE-CONTACT — Focus snooze records false customer contact

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: workflow / backend
- Verification: static-only (high confidence)
- Fix order / size: 5 / XS
- Roles: member
- Routes: /focus
- Aliases: NP-2026-143 [superseded]; AUG20:wave-1:cases-queue:TEMP-CASE-017 [duplicate-merged]

Expected: The focus snooze records false customer contact condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-143. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-143. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by focus snooze records false customer contact.

Remediation: Exclude parked cases from focus deck; snooze must not count as contact.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X219 — Harmless today because the form only lives on the default Workspace tab

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: ux-ui / frontend
- Verification: environment-blocked (medium confidence)
- Fix order / size: 5 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: AUG20:wave-1:settings-ux:TEMP-SET-014 [still-open]

Expected: The harmless today because the form only lives on the default workspace tab condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-014. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-014. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by harmless today because the form only lives on the default workspace tab.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X220 — Gap < 5 or value > 200 fails with a silent redirect

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: ux-ui / frontend
- Verification: static-only (high confidence)
- Fix order / size: 5 / XS
- Roles: anonymous, member
- Routes: cross-cutting
- Aliases: AUG20:wave-1:settings-ux:TEMP-SET-016 [still-open]

Expected: The gap < 5 or value > 200 fails with a silent redirect condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-016. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-016. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by gap < 5 or value > 200 fails with a silent redirect.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X221 — Toggling SMS Off is a high-stakes mute of all outbound text

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: ux-ui / frontend
- Verification: static-only (high confidence)
- Fix order / size: 5 / XS
- Roles: member
- Routes: /webhooks/twilio/inbound
- Aliases: AUG20:wave-1:settings-ux:TEMP-SET-017 [still-open]

Expected: The toggling sms off is a high-stakes mute of all outbound text condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-017. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-017. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by toggling sms off is a high-stakes mute of all outbound text.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X222 — Operators configuring Intuit must leave the app

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: ux-ui / frontend
- Verification: static-only (high confidence)
- Fix order / size: 5 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: AUG20:wave-1:settings-ux:TEMP-SET-019 [still-open]

Expected: The operators configuring intuit must leave the app condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-019. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-019. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by operators configuring intuit must leave the app.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X223 — If insert fails after delete, the channel is empty

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: ux-ui / frontend
- Verification: static-only (high confidence)
- Fix order / size: 5 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: AUG20:wave-1:settings-ux:TEMP-SET-020 [still-open]

Expected: The if insert fails after delete, the channel is empty condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-020. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-1:settings-ux:TEMP-SET-020. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by if insert fails after delete, the channel is empty.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X234 — Focus key `2` ignores SMS gates

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: workflow / backend
- Verification: static-only (high confidence)
- Fix order / size: 5 / XS
- Roles: member
- Routes: /focus, /webhooks/twilio/inbound
- Aliases: AUG20:wave-2:workflow-static:TEMP-WF-013 [still-open]

Expected: The focus key `2` ignores sms gates condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-013. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-013. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by focus key 2 ignores sms gates.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X237 — Unsubscribe POST failure (and Focus log errors) are silent / raw

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: workflow / backend
- Verification: static-only (high confidence)
- Fix order / size: 5 / XS
- Roles: anonymous, member
- Routes: /focus, /unsubscribe
- Aliases: AUG20:wave-2:workflow-static:TEMP-WF-020 [still-open]

Expected: The unsubscribe post failure (and focus log errors) are silent / raw condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-020. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-020. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by unsubscribe post failure (and focus log errors) are silent / raw.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-137-NOTIFICATION-SURFACE — There is no in-app notification surface

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 6 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 60 [still-open]; NP-2026-137 [superseded]

Expected: The there is no in-app notification surface condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-137. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-137. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by there is no in-app notification surface.

Remediation: aria-live; optional bell; Integrations welcome copy.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-053-LABELS — Core controls lack explicit accessible labels

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: accessibility / frontend
- Verification: static-only (high confidence)
- Fix order / size: 7 / M
- Roles: member
- Routes: cross-cutting
- Aliases: M33 [still-open]; M34 [still-open]; NP-2026-053 [superseded]; AUG20:wave-1:ops-a11y:TEMP-UX-013 [duplicate-merged]; AUG20:wave-1:settings-ux:TEMP-SET-006 [duplicate-merged]

Expected: The core controls lack explicit accessible labels condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-053. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: --color-copper: #cf8136 (app.css:12). Focus text-muted on bg-ink. Focus SMS body, accounts search, late-fee toggle: placeholder-as-label.

Impact: Public-GA correctness, security, compliance, or operability is reduced by core controls lack explicit accessible labels.

Remediation: Darken copper on light surfaces (~4.5:1). Lighten Focus secondary text. Visible <label> / aria-label on those three controls.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-136-SCRIM — Drawer scrim ARIA is contradictory

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: accessibility / frontend
- Verification: static-only (high confidence)
- Fix order / size: 7 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 56 [still-open]; NP-2026-136 [superseded]; AUG20:wave-1:ops-a11y:TEMP-UX-020 [duplicate-merged]

Expected: The drawer scrim aria is contradictory condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-136. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-136. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by drawer scrim aria is contradictory.

Remediation: table/th; @media (prefers-reduced-motion); fix scrim; real tabs.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X204 — Production users never see a stack (good)

- Severity: **informational**
- Release gate: **non-blocking**
- Domain / owner: accessibility / frontend
- Verification: static-only (high confidence)
- Fix order / size: 7 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: AUG20:wave-1:ops-a11y:TEMP-UX-017 [not-a-defect]

Expected: Preserve the intended behavior and regression-test it.

Actual: Current source matches the documented intended behavior; the prior raw card is retained as a non-defect record.

Root cause: No defect; the raw audit card described an intended or harmless behavior.

Impact: No release impact unless the intended control regresses.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-016-CI — No CI or standard test script gates releases

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: operations / devops
- Verification: static-only (high confidence)
- Fix order / size: 8 / M
- Roles: member, operator
- Routes: cross-cutting
- Aliases: M27 [still-open]; NP-2026-016 [superseded]; AUG20:wave-1:ops-a11y:TEMP-OPS-002 [duplicate-merged]; AUG20:wave-1:ops-a11y:TEMP-OPS-003 [duplicate-merged]; AUG20:wave-1:tests-and-mutations:TEMP-TEST-001 [duplicate-merged]; AUG20:wave-1:tests-and-mutations:TEMP-TEST-007 [duplicate-merged]

Expected: The no ci or standard test script gates releases condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-016. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: No .github/. package.json has no test script. tests/global-setup.ts:13 readFileSync("../.env.test"). This run: ENV_TEST=missing. globalSetup runs even for pure unit files.

Impact: Nothing gates PRs. The 109-file suite is operator folklore.

Remediation: 1. Commit .env.test.example. Add "test": "vitest run" / "test:unit" that skips globalSetup for pure files. GitHub Action: typecheck + unit tests on every PR; integration job with supabase start. 2. Document npx supabase start in README (replace the Cloudflare starter README).

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-016-TEST-ENV — Fresh-clone tests require an undocumented, missing .env.test

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: operations / devops
- Verification: static-only (high confidence)
- Fix order / size: 8 / M
- Roles: member, operator
- Routes: cross-cutting
- Aliases: M29 [still-open]; NP-2026-016 [superseded]; AUG20:wave-1:ops-a11y:TEMP-OPS-012 [duplicate-merged]; AUG20:wave-1:tests-and-mutations:TEMP-TEST-002 [duplicate-merged]

Expected: The fresh-clone tests require an undocumented, missing .env.test condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-016. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: No .github/. package.json has no test script. tests/global-setup.ts:13 readFileSync("../.env.test"). This run: ENV_TEST=missing. globalSetup runs even for pure unit files.

Impact: Nothing gates PRs. The 109-file suite is operator folklore.

Remediation: 1. Commit .env.test.example. Add "test": "vitest run" / "test:unit" that skips globalSetup for pure files. GitHub Action: typecheck + unit tests on every PR; integration job with supabase start. 2. Document npx supabase start in README (replace the Cloudflare starter README).

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-039 — Missing security headers on the Worker

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: operations / devops
- Verification: static-only (high confidence)
- Fix order / size: 8 / M
- Roles: member, operator
- Routes: cross-cutting
- Aliases: NP-2026-039 [still-open]; AUG20:wave-1:ops-a11y:TEMP-OPS-005 [duplicate-merged]; AUG20:wave-3:security:TEMP-SEC-001 [duplicate-merged]

Expected: The missing security headers on the worker condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-039. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Zero CSP/HSTS/XFO/Referrer-Policy/Permissions-Policy/X-Content-Type-Options. workers/app.ts returns RR unmodified.

Impact: Public-GA correctness, security, compliance, or operability is reduced by missing security headers on the worker.

Remediation: Wrap fetch; set CSP (frame-ancestors 'none'), HSTS, nosniff, Referrer-Policy, Permissions-Policy. Apply to webhooks too.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-040 — react-router@7.9.6 HIGH XSS/RCE/CSRF/DoS advisories

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: operations / devops
- Verification: static-only (high confidence)
- Fix order / size: 8 / M
- Roles: member, operator
- Routes: cross-cutting
- Aliases: NP-2026-040 [still-open]; AUG20:wave-3:security:TEMP-SEC-007 [duplicate-merged]

Expected: The react-router@7.9.6 high xss/rce/csrf/dos advisories condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-040. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: npm audit — GHSA-49rj-9fvp-4h2h (turbo-stream RCE), GHSA-h5cw-625j-3rxh (action CSRF), multiple XSS/DoS. Affected <= 7.11.0; patched in 7.12+/7.18.x. Also high: nanoid, postcss, vite, ws, undici, brace-expansion.

Impact: Public-GA correctness, security, compliance, or operability is reduced by react-router@7.9.6 high xss/rce/csrf/dos advisories.

Remediation: Upgrade react-router / @react-router/dev to a patched release and re-run typecheck + the suite. Then npm audit remaining build-toolchain issues. Do not --force blindly.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-122 — Quiet hours = org TZ not recipient

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: operations / devops
- Verification: static-only (high confidence)
- Fix order / size: 8 / M
- Roles: member, owner, operator
- Routes: cross-cutting
- Aliases: min 28 [still-open]; NP-2026-122 [still-open]; AUG20:wave-1:sms:TEMP-SMS-009 [duplicate-merged]

Expected: The quiet hours = org tz not recipient condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-122. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-122. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by quiet hours = org tz not recipient.

Remediation: Document US-only; later store customer TZ.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-135 — Legacy anon key rotation pending

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / M
- Roles: member
- Routes: cross-cutting
- Aliases: min 51 [still-open]; NP-2026-135 [still-open]

Expected: The legacy anon key rotation pending condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-135. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-135. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by legacy anon key rotation pending.

Remediation: Rotate hosted anon key; treat git history as leaked.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-140 — Phone match is last-10 only

- Severity: **high**
- Release gate: **blocker**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / M
- Roles: member
- Routes: cross-cutting
- Aliases: NP-2026-140 [still-open]; AUG20:wave-1:sms:TEMP-SMS-006 [duplicate-merged]

Expected: The phone match is last-10 only condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-140. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-140. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by phone match is last-10 only.

Remediation: Store E.164; match on normalized full number.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.
- A second reviewer reproduces the closure from written instructions.

## NP-AUD-2026-041 — CDC cron is one serial loop over all orgs

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: operations / devops
- Verification: static-only (high confidence)
- Fix order / size: 8 / S
- Roles: member, owner, operator
- Routes: cross-cutting
- Aliases: M21 [still-open]; NP-2026-041 [still-open]; AUG20:wave-1:qbo:TEMP-QBO-010 [duplicate-merged]

Expected: The cdc cron is one serial loop over all orgs condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-041. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-041. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by cdc cron is one serial loop over all orgs.

Remediation: Time budget + checkpoint org_id; fan-out via queue if tenant count grows. Per-org try/catch already exists — keep it.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-042 — No error monitoring

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: operations / devops
- Verification: static-only (high confidence)
- Fix order / size: 8 / S
- Roles: member, operator
- Routes: cross-cutting
- Aliases: M28 [still-open]; NP-2026-042 [still-open]; AUG20:wave-1:ops-a11y:TEMP-OPS-006 [duplicate-merged]

Expected: The no error monitoring condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-042. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-042. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by no error monitoring.

Remediation: Sentry or Cloudflare Workers Observability binding. Cron failures must not be console.error only.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-049-RETRY — Broken-promise alerts fail once without durable retry

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: operations / devops
- Verification: static-only (high confidence)
- Fix order / size: 8 / S
- Roles: member, operator
- Routes: /promises
- Aliases: min 31 [still-open]; NP-2026-049 [superseded]; AUG20:wave-1:email:TEMP-EMAIL-012 [duplicate-merged]; AUG20:wave-1:tests-and-mutations:TEMP-SEC-006 [still-open]

Expected: The broken-promise alerts fail once without durable retry condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-049. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-049. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by broken-promise alerts fail once without durable retry.

Remediation: Separate operator mail env from email_config.email_enabled. Retry/ledger on failure.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-X235 — Production ErrorBoundary hides the failure

- Severity: **medium**
- Release gate: **conditional**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / S
- Roles: member
- Routes: cross-cutting
- Aliases: AUG20:wave-2:workflow-static:TEMP-WF-016 [still-open]

Expected: The production errorboundary hides the failure condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-016. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by AUG20:wave-2:workflow-static:TEMP-WF-016. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by production errorboundary hides the failure.

Remediation: Add focused regression coverage and implement the raw card's fix recipe.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-102 — Avatar POST-logout

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 3 [still-open]; NP-2026-102 [still-open]; AUG20:wave-1:settings-ux:TEMP-UX-001 [duplicate-merged]

Expected: The avatar post-logout condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-102. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-102. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by avatar post-logout.

Remediation: Profile menu: name, settings, confirm sign out.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-104-LANDING — Public landing content and metadata are too thin for GA

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: operations / devops
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: anonymous, member, operator
- Routes: cross-cutting
- Aliases: NP-2026-104 [superseded]; AUG20:wave-1:settings-ux:TEMP-UX-004 [duplicate-merged]

Expected: The public landing content and metadata are too thin for ga condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-104. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-104. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by public landing content and metadata are too thin for ga.

Remediation: Real marketing or “internal tool”; drop private-beta before Intuit.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-105 — Empty queue “Clear the search”

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: /dashboard
- Aliases: min 6 [still-open]; NP-2026-105 [still-open]; AUG20:wave-1:settings-ux:TEMP-UX-006 [duplicate-merged]; AUG20:wave-2:workflow-static:TEMP-WF-003 [duplicate-merged]

Expected: The empty queue “clear the search” condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-105. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-105. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by empty queue “clear the search”.

Remediation: First-run copy vs filter-miss copy.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-108 — Bulk skip summary omits do-not-text

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 9 [still-open]; NP-2026-108 [still-open]; AUG20:wave-1:sms:TEMP-SMS-012 [duplicate-merged]

Expected: The bulk skip summary omits do-not-text condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-108. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-108. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by bulk skip summary omits do-not-text.

Remediation: Add the bucket; counts must sum to selection.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-110 — Detail w-96 overflow on phones

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 11 [still-open]; NP-2026-110 [still-open]; AUG20:wave-1:settings-ux:TEMP-UX-003 [duplicate-merged]

Expected: The detail w-96 overflow on phones condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-110. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-110. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by detail w-96 overflow on phones.

Remediation: Stack detail below list on <md.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-111 — Coming-due copy “7 days”

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 12 [still-open]; NP-2026-111 [still-open]; AUG20:wave-1:cases-queue:TEMP-CASE-015 [duplicate-merged]; AUG20:wave-1:settings-ux:TEMP-UX-007 [duplicate-merged]

Expected: The coming-due copy “7 days” condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-111. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-111. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by coming-due copy “7 days”.

Remediation: Use orgConfig.workflow.comingDueDays.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-112 — todayISO() UTC vs org-local

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member, owner
- Routes: cross-cutting
- Aliases: min 13 [still-open]; NP-2026-112 [still-open]; AUG20:wave-1:cases-queue:TEMP-CASE-008 [duplicate-merged]

Expected: The todayiso() utc vs org-local condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-112. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-112. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by todayiso() utc vs org-local.

Remediation: Pass org-local today into DetailPanel.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-114 — SSR UTC dates

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 15 [still-open]; NP-2026-114 [still-open]; AUG20:wave-1:ops-a11y:TEMP-UX-018 [duplicate-merged]

Expected: The ssr utc dates condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-114. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-114. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by ssr utc dates.

Remediation: Org-tz format; include time where useful.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-115 — saved=1 lights wrong Collections forms

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 16 [partially-fixed]; NP-2026-115 [still-open]; AUG20:wave-1:settings-ux:TEMP-SET-003 [duplicate-merged]; AUG20:wave-1:settings-ux:TEMP-SET-005 [duplicate-merged]

Expected: The saved=1 lights wrong collections forms condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-115. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-115. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by saved=1 lights wrong collections forms.

Remediation: Distinct flash keys per form (rules already lack UI).

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-119 — Invoice status stale when due date passes

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 23 [still-open]; NP-2026-119 [still-open]; AUG20:wave-1:qbo:TEMP-QBO-016 [duplicate-merged]

Expected: The invoice status stale when due date passes condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-119. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-119. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by invoice status stale when due date passes.

Remediation: Nightly status recompute or derive at read.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-120 — No retention job

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 24 [still-open]; NP-2026-120 [still-open]

Expected: The no retention job condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-120. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-120. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by no retention job.

Remediation: Cron: expire oauth_states, old notification_log, resolved sync_errors, pending invites.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-124 — Dead priorityOf in worklist.ts

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 35 [still-open]; NP-2026-124 [still-open]; AUG20:wave-1:cases-queue:TEMP-CASE-005 [duplicate-merged]

Expected: The dead priorityof in worklist.ts condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-124. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-124. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by dead priorityof in worklist.ts.

Remediation: Delete dead scorer / zeroed metrics or stop exporting.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-125 — Late-fee model simplistic

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 36 [still-open]; NP-2026-125 [still-open]

Expected: The late-fee model simplistic condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-125. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-125. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by late-fee model simplistic.

Remediation: Document display-only + formula; optional cap.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-127 — dev-data.sql trips 0032 trigger

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 41 [still-open]; NP-2026-127 [still-open]

Expected: The dev-data.sql trips 0032 trigger condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-127. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-127. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by dev-data.sql trips 0032 trigger.

Remediation: Run as service_role or stop updating phone.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-129 — Audit actor uuids have no FK / ON DELETE

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 43 [still-open]; NP-2026-129 [still-open]

Expected: The audit actor uuids have no fk / on delete condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-129. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-129. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by audit actor uuids have no fk / on delete.

Remediation: Add FKs with ON DELETE SET NULL; document auth-user deletion.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-131 — No robots/OG/description

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 45 [still-open]; NP-2026-131 [still-open]; AUG20:wave-1:ops-a11y:TEMP-OPS-014 [duplicate-merged]

Expected: The no robots/og/description condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-131. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-131. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by no robots/og/description.

Remediation: meta.ts description; robots.txt; OG on /.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-132-AGENTS — Repository guidance has stale schema and migration inventory

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 47 [still-open]; NP-2026-132 [superseded]; AUG20:wave-1:ops-a11y:TEMP-OPS-010 [duplicate-merged]

Expected: The repository guidance has stale schema and migration inventory condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-132. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-132. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by repository guidance has stale schema and migration inventory.

Remediation: Rewrite app README; migrations 0001–0034; organizations not orgs; drop publish: true.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-132-README — Application README remains starter or stale setup guidance

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: operations / devops
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member, operator
- Routes: cross-cutting
- Aliases: min 46 [still-open]; NP-2026-132 [superseded]; AUG20:wave-1:ops-a11y:TEMP-OPS-009 [duplicate-merged]; AUG20:wave-1:ops-a11y:TEMP-OPS-013 [duplicate-merged]

Expected: The application readme remains starter or stale setup guidance condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-132. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-132. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by application readme remains starter or stale setup guidance.

Remediation: Rewrite app README; migrations 0001–0034; organizations not orgs; drop publish: true.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-134 — Demo PNGs in git

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 50 [still-open]; NP-2026-134 [still-open]

Expected: The demo pngs in git condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-134. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-134. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by demo pngs in git.

Remediation: Git LFS or drop from main.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-136-MOTION — Reduced-motion behavior is incomplete

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 55 [still-open]; NP-2026-136 [superseded]; AUG20:wave-1:ops-a11y:TEMP-UX-014 [duplicate-merged]

Expected: The reduced-motion behavior is incomplete condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-136. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-136. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by reduced-motion behavior is incomplete.

Remediation: table/th; @media (prefers-reduced-motion); fix scrim; real tabs.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-136-TABLE — Queue and report grids lack robust table semantics

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: /dashboard, /reports
- Aliases: min 54 [still-open]; NP-2026-136 [superseded]; AUG20:wave-1:ops-a11y:TEMP-UX-015 [duplicate-merged]

Expected: The queue and report grids lack robust table semantics condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-136. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-136. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by queue and report grids lack robust table semantics.

Remediation: table/th; @media (prefers-reduced-motion); fix scrim; real tabs.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-136-TABS — Custom tabs do not implement the APG tabs pattern

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 57 [still-open]; NP-2026-136 [superseded]; AUG20:wave-1:ops-a11y:TEMP-UX-019 [duplicate-merged]

Expected: The custom tabs do not implement the apg tabs pattern condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-136. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-136. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by custom tabs do not implement the apg tabs pattern.

Remediation: table/th; @media (prefers-reduced-motion); fix scrim; real tabs.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-137-FIRST-RUN — First-run Integrations guidance is missing

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 61 [still-open]; NP-2026-137 [superseded]; AUG20:wave-1:settings-ux:TEMP-UX-008 [duplicate-merged]

Expected: The first-run integrations guidance is missing condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-137. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-137. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by first-run integrations guidance is missing.

Remediation: aria-live; optional bell; Integrations welcome copy.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-137-LIVE-REGIONS — Dynamic copy, selection, loading, and error states lack consistent live regions

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: environment-blocked (medium confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: min 59 [still-open]; NP-2026-137 [superseded]; AUG20:wave-1:ops-a11y:TEMP-UX-016 [duplicate-merged]

Expected: The dynamic copy, selection, loading, and error states lack consistent live regions condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-137. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-137. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by dynamic copy, selection, loading, and error states lack consistent live regions.

Remediation: aria-live; optional bell; Integrations welcome copy.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-138 — Contact methods only call/text/note

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: NP-2026-138 [still-open]; AUG20:wave-1:cases-queue:TEMP-CASE-012 [duplicate-merged]

Expected: The contact methods only call/text/note condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-138. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-138. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by contact methods only call/text/note.

Remediation: Add email/in-person/voicemail if collectors need them, or update docs.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

## NP-AUD-2026-145 — Empty client chunks for API routes

- Severity: **low**
- Release gate: **non-blocking**
- Domain / owner: maintainability / backend
- Verification: static-only (high confidence)
- Fix order / size: 8 / XS
- Roles: member
- Routes: cross-cutting
- Aliases: NP-2026-145 [still-open]

Expected: The empty client chunks for api routes condition must be eliminated and the original reproduction plus negative cases must pass.

Actual: Current candidate source still contains the behavior described by NP-2026-145. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Root cause: Current candidate source still contains the behavior described by NP-2026-145. No product fix affecting this root cause exists between 820fb1ba and 88b9baca.

Impact: Public-GA correctness, security, compliance, or operability is reduced by empty client chunks for api routes.

Remediation: Harmless RR resource-route split; ignore unless bundle audit cares.

Acceptance:

- Current source no longer contains the root cause.
- Original reproduction fails to reproduce the defect.
- Focused regression coverage passes.
- Required browser/provider/database evidence passes.

