# Fix-pass status

Tracks implementation against the frozen 2026-08-20 audit pack. Do **not** rewrite `findings.json` here. A later audit re-run flips ledger dispositions.

| Finding | PR | Status | Tests |
|---|---|---|---|
| NP-AUD-2026-016-CI | 0 | code | `npm run test:unit`; `.github/workflows/ci.yml` |
| NP-AUD-2026-016-TEST-ENV | 0 | code | `.env.test.example`; `tests/load-env.ts` |
| NP-AUD-2026-003 | 1 | code | `tests/comm-prefs.test.ts` parse omit/sentinel |
| NP-AUD-2026-004 | 2 | code | `tests/twilio-inbound.test.ts` unmatched STOP stored |
| NP-AUD-2026-011 | 2 | code | inbound STOP provenance + `api.sms-consent` lock |
| NP-AUD-2026-052-CONSENT-TOGGLE | 2 | code | owner + reason required after inbound_stop |
| NP-AUD-2026-121 | 2 | code | `tests/sms-templates.test.ts`; `ensureStopLanguage` |
| NP-AUD-2026-139 | 2 | code | `tests/sms-keywords.test.ts` HELP/INFO |
| NP-AUD-2026-033-POSTAL | 3 | code | `tests/email-settings.test.ts` |
| NP-AUD-2026-033-UNSUBSCRIBE | 3 | code | List-Unsubscribe headers; RFC 8058 query token POST |
| NP-AUD-2026-014 | 3 | code | `tests/email-events.test.ts` `email.received` |
| NP-AUD-2026-034 | 3 | code | failed/suppressed mapped |
| NP-AUD-2026-141 | 3 | code | `/privacy` `/eula` disclose Resend |
| NP-AUD-2026-001 | 4 | code | `/forgot-password` |
| NP-AUD-2026-002 | 4 | code | `/auth/confirm`; signup returns Set-Cookie headers |
| NP-AUD-2026-021 | 4 | code | `cookieOptions` httpOnly/secure/lax/14d |
| NP-AUD-2026-022-AUTH-CSRF | 4 | code | `requireSameOrigin` on login/signup |
| NP-AUD-2026-022-LOGOUT-CSRF | 4 | code | `requireSameOrigin` on logout |
| NP-AUD-2026-D01 | 4/8 | code | `trust proxy` 1 + host allowlist |
| NP-AUD-2026-044 | 4 | code | onboarding action re-checks membership |
| NP-AUD-2026-015 | 6 | code | case-queue throws on query error |
| NP-AUD-2026-007-RECONCILIATION | 6 | code | recon fails on truncated count |
| NP-AUD-2026-144 | 6 | code | contact-logs 403 when blocksContact |
| NP-AUD-2026-005 | 7 | code | QBO callback waitUntil(syncOverdueInvoices) |
| NP-AUD-2026-006 | 7 | code | refresh failure → status error |
| NP-AUD-2026-039 | 8 | code | `tests/security-headers.test.ts` |
| NP-AUD-2026-D02 | 8 | code | `/readyz` |
| NP-AUD-2026-D04 | 8 | code | `server.js` waitUntil drain |
| NP-AUD-2026-D03 | 8 | code | `render.yaml` plan starter |
| NP-AUD-2026-017 / first-run | 10 | code | QBO optional; `FirstRunBanner`; Connect degrades |
| NP-AUD-2026-023 | 10 | code | `SyncIssues` in AppShell |
| NP-AUD-2026-036-INVITE-TOKEN | 5 | code | members cannot SELECT `invites.token` |
| NP-AUD-2026-036-LEDGER-RLS | 5 | code | contact_logs/text_messages insert+select only |
| NP-AUD-2026-038-ROSTER | 10 | code | `listOrgMembers` uses `getUserById` |
| NP-AUD-2026-024 | 11 | code | outbound email counts as last-contact |
| NP-AUD-2026-026 | 11 | code | deleted default templates stay gone |
| NP-AUD-2026-025 | 11 | code | Focus skips live-presence cases |
| NP-AUD-2026-053-CONTRAST | 11 | code | darker copper; Focus `on-ink` / `copper-bright` |
| NP-AUD-2026-053-LABELS | 11 | code | accounts search, Focus SMS, late-fee labels |
| NP-AUD-2026-035-SMS-RATE | 9 | code | per-org/customer caps + Twilio Idempotency-Key |
| NP-AUD-2026-035-EMAIL-RATE | 9 | code | per-org/customer caps + Resend Idempotency-Key |
| NP-AUD-2026-037 | 5 | code | `0037_validate_tenant_fks.sql` |
