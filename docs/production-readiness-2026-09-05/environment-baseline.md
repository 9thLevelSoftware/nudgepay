# Production readiness baseline — 2026-09-05

Baseline commit: `f7ebf21820deeecae95f4b41ba3b5275715e18c6` (branch `codex/production-readiness`). This is a source and local-environment snapshot; it is not a production certification.

## Repository inventory

| Surface | Observed |
|---|---:|
| Registered React Router routes | 63 (`nudgepay-app/app/routes.ts`) |
| Supabase migrations | 58 (`0001` through `0058`, latest `0058_org_billing.sql`) |
| Vitest specs (`tests/*.test.ts`) | 183 |
| Pure library modules | 94 |
| Server library modules (`*.server.ts`) | 51 |
| React components (`app/components/*.tsx`) | 54 |
| Worker entrypoints | `workers/app.ts`; Render mirrors in `cron/cdc.ts` and `cron/digest.ts` |

Routes cover public auth/legal (`/`, signup, login, forgot/reset/confirm, privacy/eula), workspace UI (`dashboard`, focus, accounts, promises, messages, reports, settings), CSV exports, workspace/account/customer lifecycle APIs, QBO, Twilio, Resend, Stripe, health and readiness. `app/routes.ts` is authoritative for the 63 count.

## Roles and scheduled work

Membership roles are `owner`, `admin`, and `member` (migrations `0056_multiple_memberships.sql` and `0057_admin_role.sql`). Owners retain owner-only workspace and owner-grant powers; admins run operational settings/invites/reports; members use ordinary collection workflows. RLS policies and server checks remain the tenancy boundary.

Cloudflare schedules are `*/30 * * * *` (CDC catch-up) and `0 * * * *` (digest plus retention). The Worker dispatches these in `workers/app.ts`; Render has equivalent `cron/cdc.ts` and `cron/digest.ts` entries. Operator alerting is optional and configured by secret.

## Local verification

`npm run test:unit` was run after dependencies became available, but the checkout included concurrent in-progress edits and is therefore an **interim worktree run**, not a clean baseline result. It collected 1,250 tests: 1,244 passed and 6 failed; two suites (`tests/log-redaction.test.ts`, `tests/request-boundary.test.ts`) could not import newly added modules, and six assertions failed in `tests/load-env-safety.test.ts`, `tests/pilot-load-lib.test.ts`, `tests/security-headers.test.ts` (3), and `tests/worker-observability.test.ts`. The redacted raw log is retained outside the repository at `C:\Users\dasbl\AppData\Local\NudgePay\evidence\baseline-unit-2026-09-05.log`. The initial clean-checkout attempt, before dependencies were installed, exited because Vitest was unavailable. No full DB suite was run.

Docker is available: server version `29.7.2`. Availability does not prove that local Supabase was started; the database suite was intentionally left to the QA owner.

Hosted checks found one healthy production Supabase project and no separate
staging project. A staging project creation attempt was rejected by the
account's two-project quota, so staging isolation is an external blocker.
Read-only Worker secret-name inventories show production has application,
Supabase, QBO encryption/redirect, Twilio public-base, and unsubscribe names;
the provider credentials required for QBO/Twilio/email operation are absent.
Staging has application, Supabase, and unsubscribe names but no provider
credentials. Secret values and account identifiers are intentionally omitted.

The hosted Worker `/healthz` returned HTTP 200 with `{ "ok": true }` for both
production and staging. `/readyz` returned HTTP 200 in both targets, but all
provider presence flags were false (`qbo`, `twilio`, `email`, and
`operatorAlert`); this does not prove authenticated traffic or provider
operation. Production Supabase migrations exactly matched local `0001` through
`0058`. The organization plan is `free`, explaining the staging quota
rejection.

Supabase advisors reported mutable `search_path` warnings for existing helper
functions and disabled leaked-password protection. These are triage items, not
confirmed exploits: [function search path guidance](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
and [leaked-password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
The advisor also listed no RLS policies on service-only tables
(`cron_checkpoints`, `inbound_orphans`, `notification_log`, `oauth_states`,
`workspace_deletions`); this is expected deny-by-default design and is not
recorded as a vulnerability.

Read-only GitHub checks succeeded. `gh auth status` reports the authenticated `9thLevelSoftware` account; repository view reports `9thLevelSoftware/nudgepay`, public, default branch `main`, viewer permission `ADMIN`. Branch protection API reports required checks `typecheck + unit tests`, `production check`, `supabase integration`, `browser smoke`, and `npm audit (production)`; force pushes and branch deletion are disabled. Required approving reviews are unset and admin enforcement is false, so the protection result is not equivalent to a complete approval gate.

No secrets, tokens, provider payloads, production deployment, authenticated browser run, backup/restore drill, or external operational gate was inspected or claimed here.

## Current worktree delta — request security

This section records verification performed after the immutable baseline above.
It does not update the baseline commit, counts, hosted inventory, or readiness
claim.

- The focused request-security suite passed 31/31 across security headers,
  bounded request ingestion, log redaction, and Worker observability. An
  expanded selection covering invite and notification error paths passed
  44/44.
- `npm run check` passed TypeScript, the production Worker build, deployment
  preflight, and Wrangler dry-run in the current shared worktree.
- Local Worker smoke checks observed exact CSP nonces on React Router SSR
  scripts, a 204 sanitized CSP-report response, 415 for a wrong Stripe webhook
  media type, route handling for valid JSON, and 413 for oversize input.
- The Render/Node mirror passed syntax/build checks and equivalent local smoke
  paths for CSP nonce delivery, bounded reports, webhook media type, route
  forwarding, and oversize rejection.
- QA's DB-free Playwright smoke passed 7/7 with zero CSP violation reports,
  including the unknown-route ErrorBoundary. The policy now derives an exact
  HTTP(S) and matching WS(S) source from configured `SUPABASE_URL` for local or
  hosted Supabase. Its form destinations are limited to self plus the exact
  Stripe checkout/billing and Intuit App Center origins used by server
  redirects. The authenticated enforcing-mode Realtime and provider-redirect
  retests are still pending.

The external environment gates are unchanged. The Supabase account quota still
blocks an isolated staging project. Provider and operator-alert credentials are
absent from the hosted readiness inventory, and no secret value was inspected.
No provider sandbox callback, signature/retry replay, or Stripe/QBO browser
redirect was exercised. No retained staging CSP observation, 60-minute load
qualification, 24-hour soak, capacity conclusion, backup/restore drill,
application/database rollback rehearsal, monitoring check, or operator alert
response drill is attached.

## Current candidate delta — provider monitoring

The immutable baseline schedule above is historical. The current candidate is
an uncommitted shared-worktree state, not the baseline SHA or a tested release
artifact. It adds
`*/5 * * * *` in the application and Workers Builds Wrangler configurations.
That trigger dispatches a bounded, service-only provider monitor; `*/30` stays
CDC and the hourly branch stays digest plus retention. The monitor scans only
attempt identifiers for stale SMS/email sends and checkout attempts, uses
hour-bucketed leased receipts to suppress successful duplicates and retry a
failed alert post, and emits a structured missing-webhook configuration event.
The operator-alert webhook is therefore required for this monitor to notify an
operator; it remains absent in the historical hosted inventory.

Static/unit and focused local integration coverage exists for candidate
selection, service-only access, receipt lease/retry, page progress, redaction,
and cron configuration. Coordinated full database execution and all hosted
monitoring, alert-acknowledgement, provider, load, and soak evidence remain
pending. This delta does not amend the historical baseline or certify a
deployment.
