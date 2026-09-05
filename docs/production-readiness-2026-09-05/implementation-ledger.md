# Implementation ledger — 2026-09-05 baseline

Final local verification is consolidated in [release evidence](release-evidence.md),
including the green 1,736-test full suite, populated migration upgrade, build,
dependency audit, and 37-pass authenticated browser matrix (23 intentional skips).
That record supersedes intermediate execution-pending statements while preserving
the historical baseline and outstanding hosted/operational gates.

Baseline SHA: `f7ebf21820deeecae95f4b41ba3b5275715e18c6`.
Working branch: `codex/production-readiness`. The existing checkout was used
to keep coordinator and worker changes visible. This ledger records scope and
evidence state; it makes no readiness claim.

| Workstream ID | Baseline evidence | Status at baseline |
|---|---|---|
| `release_foundation` | `wrangler.toml`, package scripts, CI branch protection, `/healthz` and `/readyz` | Source present; deployment/config and rollback proof unverified |
| `request_security` | auth/CSRF helpers, webhook routes, security headers, RLS migrations | Source and historical fix entries present; test/provider/RLS execution unverified |
| `frontend_foundations` | `app/components`, routes, shared UI primitives | Source present; browser, accessibility, hydration and responsive behavior unverified |
| `authenticated_qa` | 63 registered routes; 183 Vitest specs; Playwright config | Interim worktree run: 1,250 tests collected; 1,244 passed and 6 failed; authenticated browser run not performed |
| `backend_integrity` | `app/lib/*.server.ts`, migrations `0001`–`0058`, cron handlers | Source present; local Supabase, RLS, provider callbacks, backup/restore unverified |
| `qualification_tools` | test/build scripts, `gh` read-only checks, Docker availability | Docker 29.7.2 available; interim unit run exit 1 (6 assertion failures plus 2 import-failing suites); no full DB suite |
| `authorization_review` | `owner`/`admin`/`member` role policies in migrations `0056`/`0057`; GitHub protection API | Role source inspected; independent authorization review and required approving review enforcement remain unverified |
| `tenant_boundary_fixes` | Current review confirmed global unmatched STOP disclosure, leave-workspace membership scope, stale-org fallback, members authorization TOCTOU, and personal-export cardinality issues | Open; implementation and cross-tenant/RLS/concurrency verification required |
| `database_hardening` | Current review confirmed last-owner write skew; migration `0061` reserved after `0060` | Open; migration design, historical-row preflight, and RLS/concurrency verification required |

## Baseline test note

The six failed assertions are in `tests/load-env-safety.test.ts`,
`tests/pilot-load-lib.test.ts`, `tests/security-headers.test.ts` (three), and
`tests/worker-observability.test.ts`; `tests/log-redaction.test.ts` and
`tests/request-boundary.test.ts` failed suite import because concurrent new
modules were absent. The raw log is outside the repository at
`C:\Users\dasbl\AppData\Local\NudgePay\evidence\baseline-unit-2026-09-05.log`.
This is not a clean baseline commit test. The coordinator owns the final ledger
and acceptance decision. No production secrets or provider payloads were
printed or inspected.

## Current verified delta — request security

These results describe the shared worktree after the baseline snapshot. They do
not rewrite the baseline result or establish a release verdict.

| Change | Current evidence | Remaining gate |
|---|---|---|
| Bounded mutating request intake | `app/lib/request-boundary.ts` applies a 256 KiB application limit, 2 MiB provider-webhook limit, and 64 KiB CSP-report limit before React Router parsing. It validates declared and streamed size and route-specific media types while reconstructing the request from the exact bytes consumed. Focused tests cover signed-body byte preservation, declared and streamed overflow, content type, empty bodies, and endpoint-specific limits. | Provider payload/retry replay in staging; confirm the 2 MiB provider limit against observed QBO, Twilio, Resend, and Stripe traffic. |
| CSP rollout | Worker and Node entry points generate per-document nonces. React Router receives the nonce for hydration and streamed scripts; the fixed theme bootstrap also has an exact SHA-256 fallback for loader-error pages. Report-only is the deployment default while the existing enforced `frame-ancestors 'none'` protection remains. `SUPABASE_URL` contributes only its exact HTTP(S) origin and matching WS(S) origin to `connect-src`. `form-action` permits self plus the exact Stripe checkout/billing and Intuit App Center origins used by progressive SSR redirects. | Retained staging observation before `CSP_MODE=enforce`; authenticated enforcement with Supabase Realtime and actual Stripe/QBO redirect flows remains required. `style-src` still permits inline styles. |
| Error and CSP telemetry | Edge/SSR unhandled logs and confirmed notification, invite-email, and provider-webhook failure paths use request or entity correlation. Exception output is reduced to an allowlisted class/code/status without messages, stacks, provider bodies, email addresses, phone numbers, or invite URLs. CSP reports are bounded, deterministically sampled 1-in-16 from server-generated request IDs, and logged from capped allowlisted fields without script samples. | The helper does not prove every pre-existing application log safe; report sampling limits log cost but is not a network-layer rate limit. External log aggregation and alert response remain unverified. |
| Runtime parity | Worker and Render/Node request boundaries and response policies were exercised locally. Wrong Stripe content type returned 415, valid JSON reached the unconfigured route response, and oversize input returned 413. Signed webhook bodies remain byte-for-byte test-covered. | Node mirrors some TypeScript policy in `server.js`; review both entry points together to prevent drift. Real provider signatures and retries remain unverified. |

Current focused verification: `npx vitest run --config vitest.unit.config.ts
tests/security-headers.test.ts tests/request-boundary.test.ts
tests/log-redaction.test.ts tests/worker-observability.test.ts` passed 31/31.
An expanded regression selection including invite and notification error paths
passed 44/44.
`npm run check` passed TypeScript, the production React Router build, deployment
preflight, and Wrangler dry-run in the current shared worktree. A DB-free
Playwright smoke passed 7/7, including an unmatched 404, with no CSP violation
reports after nonce/hash integration. This browser result is public-route CSP
evidence; it is not provider, staging, load, database, or restore evidence.

## Candidate reconciliation — local database execution complete

The following records an uncommitted current-worktree candidate without
changing the baseline table or the coordinator's release decision. It is not a
tested implementation SHA, release artifact, commit, or deployment.

| Area | Candidate source disposition | Remaining gate |
|---|---|---|
| Provider send, status, Stripe checkout, reconciliation, retention, pilot admission, QBO leases, and provider monitor | Independent review found the listed guards resolved in source. QBO realm binding and the personal-auth deletion generated-column guard are implemented and independently reviewed. The monitor requires the new five-minute schedule and an operator-alert webhook, scans only IDs, and alerts before best-effort receipt cleanup. The coordinated local DB suite passed. | Real provider and operator-alert exercise remains pending. |
| Deployment invariants | Independent review found pinned origin/name/domain, environment separation, exact-SHA clean-tree guard, and built/root configuration parity resolved in source/tests. | Clean candidate artifact and an externally authorized deployment remain pending. |
| Authenticated workflow coverage | Current candidate includes authenticated local browser/RLS workflows beyond the baseline inventory. | Provider callbacks, authenticated CSP enforcement with Realtime/redirects, and hosted staging evidence remain pending. |
| Database deletion edge | DELETE-02 is resolved in candidate source: the trigger excludes generated-always SMS normalization columns while retaining exact equality for writable fields and the required non-null-to-null auth deletion transition. Fresh local DB execution passed. | Hosted and operational deletion evidence remains pending. |

The coordinated local database evidence passed 206 files / 1,736 tests after a
fresh reset through `0063`; it also passed a populated upgrade from `0058` to
`0063` and a focused 14-file / 151-test selection. Database lint exited 0; its
only notice was an unused `p_member_count` parameter. Logs are retained outside
the repository at `C:\Users\dasbl\AppData\Local\Temp\nudgepay-final-full-vitest.log`,
`nudgepay-final-fresh-reset.log`, `nudgepay-final-db-lint.log`, and
`nudgepay-upgrade-0058-to-0063-retry.log`. This is local execution evidence,
not hosted staging, provider, alert-response, load, restore, or deployment proof.
