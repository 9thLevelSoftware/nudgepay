# Workflow coverage inventory — 2026-09-05

Final local browser verification is recorded in [release evidence](release-evidence.md):
37 passed and 23 intentional skips across five projects, including both-theme
desktop/mobile axe audits, role/RLS cases, contact/promise mutation, report CSV
download, navigation, dialogs and history. This supersedes earlier local-browser
pending statements below; provider-backed workflows and large-data qualification
remain unverified.

This inventory maps the principal operator workflows to current source and tests. A test name or static path is evidence of implementation coverage only; it is not live provider, browser, migration, or production evidence.

| Workflow | Source surfaces | Automated evidence | Current gate |
|---|---|---|---|
| Sign up, confirm, login, reset password | `app/routes/signup.tsx`, `login.tsx`, `forgot-password.tsx`, `auth.confirm.tsx`, `reset-password.tsx` | auth-flow and return-to specs | Auth delivery and browser round-trip unverified |
| Create/switch workspace and accept invite | onboarding, invite, accept routes; `0056`, `0057` | onboarding/org/invite specs and current authenticated local workflow | Hosted auth delivery and retained staging evidence unverified |
| Connect, refresh, disconnect QuickBooks | QBO API/callback routes; `qbo-sync.server.ts` | qbo/oauth/provider-status specs | Intuit sandbox and real payload unverified |
| Queue → account → contact log → next step | dashboard/accounts/detail and contact APIs | worklist, cases, contact-log, next-step specs and current authenticated local workflow | Hosted provider/data and retained staging evidence unverified |
| Promise create, evaluate, cancel | promises route, promise APIs/evaluation | promise and ledger specs | Payment/CDC provider round-trip unverified |
| SMS send, inbound STOP/HELP, status | text/bulk routes and Twilio webhooks | SMS gate/send/inbound/webhook specs | Twilio signature and owned-destination run unverified |
| Email send, unsubscribe, inbound events | email route, unsubscribe, Resend webhook | email settings/templates/events specs | Resend payload/delivery run unverified |
| Reports and CSV exports | reports, `reports.csv`, `queue.csv` | reports specs | Browser/download and large data unverified |
| Member administration and offboarding | member/workspace/account APIs; role migrations | org/RLS/account deletion specs, current authenticated local workflow, and completed fresh local DB concurrency/deletion execution | Hosted evidence unverified |
| Workspace/customer/account export and erasure | export/delete/erase routes; migrations `0053`–`0055` | route/helper specs where present | Backup, restore, and legal-ops evidence unverified |
| Billing checkout/portal/webhook | billing routes; `0058_org_billing.sql` | Candidate source plus completed fresh local DB/provider-integrity execution | Stripe provider and webhook replay unverified |
| Scheduled CDC, digest, retention, provider monitor | Worker schedule and `app/lib/*cron.server.ts`; Render cron mirrors | cron/provider-monitor specs, including five-minute schedule and receipt progress | Worker/Render deployment, configured operator webhook, alerting, and retry drill unverified |
| Mutating request and webhook intake | `workers/app.ts`, `server.js`, `app/lib/request-boundary.ts` | focused boundary tests cover exact signed bytes, media types, declared/streamed overflow, and endpoint limits | Real provider payload sizes, signatures, and retry replay unverified |
| SSR CSP and violation handling | `app/lib/security-headers.ts`, `app/root.tsx`, `app/entry.server.tsx`, both runtime entry points | focused policy tests; DB-free browser smoke 7/7 with no CSP reports, including unknown 404 | Staging observation and authenticated enforcement with Realtime and provider redirect navigation unverified |
| Edge/SSR/provider error correlation and redaction | `app/lib/log-redaction.ts`, `app/lib/worker-observability.ts`, SSR entry, notification/invite senders, provider webhook routes | focused redaction/observability tests; invite/notification failure tests; sanitized sampled CSP-report smoke | Current confirmed PII paths are covered; repository-wide log review and external aggregation/alert response remain unverified |

At the baseline snapshot, the repository had broad unit coverage but no clean
completed run. Later current-worktree security verification passed its 31-test
focused suite and `npm run check`; the public DB-free browser smoke passed 7/7.
Current candidate work also has authenticated local browser/RLS workflows.
These later results do not turn the baseline into a clean full-suite run or
prove provider, staging, or production flows.

The current candidate's coordinated local database suite passed 206 files /
1,736 tests after a fresh reset through `0063`, with a populated `0058`→`0063`
upgrade and a focused 14-file / 151-test selection also passing. Database lint
exited 0 with only an unused `p_member_count` notice. This supplements the
historical baseline inventory; it does not alter historical per-ID
**unverified** statuses or external workflow gates.

External workflow gates remain unverified: isolated staging is blocked by the
account project quota; provider secrets and callbacks are absent; provider
signature/retry and redirect flows have not run; authenticated CSP enforcement
has not completed; no 60-minute load run or 24-hour soak is attached; and
monitoring, operator alert response, backup/restore, failover, and application
and database rollback rehearsals remain open.
