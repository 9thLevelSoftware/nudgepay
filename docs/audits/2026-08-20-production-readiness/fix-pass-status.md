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
| NP-AUD-2026-040 | 12 | code | react-router 7.18.2; `tests/react-router-advisory.test.ts` |
| NP-AUD-2026-043 | 12 | code | typed org-name disconnect confirm |
| NP-AUD-2026-041 | 12 | code | CDC time budget + `cron_checkpoints` |
| NP-AUD-2026-029 | 12 | code | CDC watermark captured before apply |
| NP-AUD-2026-042 | 12 | code | Workers Observability + unhandled logging |
| NP-AUD-2026-045 | 12 | code | org high-value band before hardcoded 10k/25k |
| NP-AUD-2026-054 | 13 | code | 429 Retry-After cap 2s / 2 retries; locked CloudEvents fixture |
| NP-AUD-2026-046 | 13 | code | promise eval in integer cents |
| NP-AUD-2026-048 | 13 | code | US/USD CompanyInfo gate at QBO connect |
| NP-AUD-2026-018 | 13 | code | invite email via team Resend path + copyable link |
| NP-AUD-2026-032 | 13 | code | default email templates do not ask to reply |
| NP-AUD-2026-049 | 13 | code | team alerts ignore customer email_enabled |
| NP-AUD-2026-051 | 13 | code | tile “Customers in collections” |
| NP-AUD-2026-050 | 13 | code | heartbeat POST only; no dashboard revalidate |
| NP-AUD-2026-020 | 14 | code | Settings password change (current + new) |
| NP-AUD-2026-019 | 14 | code | one membership per user; unique `user_id` |
| NP-AUD-2026-048 | 14 | code | `/reports.csv` per-rep download |
| NP-AUD-2026-101 | 14 | code | Reports nav “Owner only” |
| NP-AUD-2026-102 | 14 | code | avatar menu + confirm sign out |
| NP-AUD-2026-105 | 14 | code | first-run vs filter-miss empty queue |
| NP-AUD-2026-107 | 15 | code | Focus mode link visible below `sm` |
| NP-AUD-2026-050 | 15 | code | work-queue virtual window (`tests/virtual-window.test.ts`) |
| NP-AUD-2026-113 | 15 | code | Promises ledger cancel + flash cleanup |
| NP-AUD-2026-108 | 15 | code | bulk skip summary includes `do-not-text` |
| NP-AUD-2026-111 | 15 | code | coming-due empty copy uses org `comingDueDays` |
| NP-AUD-2026-112 | 15 | code | timeline broken badge uses org-local `today` |
| NP-AUD-2026-120 | 15 | code | hourly retention cron (`tests/retention-cron.test.ts`) |
| NP-AUD-2026-131 | 15 | code | `robots.txt` + meta description + OG on `/` |
| NP-AUD-2026-020 | 16 | code | change-email via confirm + in-app account deletion |
| NP-AUD-2026-103 | 16 | code | expanded GoTrue `humanAuthError` map |
| NP-AUD-2026-106 | 16 | code | Focus SMS toasts use `smsFlashCopy` |
| NP-AUD-2026-110 | 16 | code | detail stacks full-width below `md` |
| NP-AUD-2026-114 | 16 | code | `formatDateTime` in org IANA zone |
| NP-AUD-2026-118 | 16 | code | SMS bubble timestamps + scroll to last |
| NP-AUD-2026-115 | 17 | code | distinct Collections `saved=` flash keys |
| NP-AUD-2026-116 | 17 | code | dirty confirm before settings tab switch |
| NP-AUD-2026-117 | 17 | code | template preview, insert chips, unknown `{tokens}` |
| NP-AUD-2026-123 | 17 | code | bulk SMS per-case failures + name flash |
| NP-AUD-2026-104-EULA | 17 | code | EULA drops “private beta” |
| NP-AUD-2026-104-LANDING | 17 | code | landing names collections vs payment processor |
