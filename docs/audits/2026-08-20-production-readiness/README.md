# NudgePay production-readiness audit

## Verdict: NO-GO

Candidate `88b9baca35be5b8d9235b2f96863150ef3a67ad1` is **not ready for public GA**. The ledger contains 56 open release blockers, and mandatory database, staging, provider, authenticated-browser, accessibility, resilience, rollback, and deep-security evidence is unavailable.

## Generated counts

| Measure | Count |
|---|---:|
| Atomic findings | 168 |
| Severity: critical | 0 |
| Severity: high | 56 |
| Severity: medium | 46 |
| Severity: low | 64 |
| Severity: informational | 2 |
| Gate: blocker | 56 |
| Gate: conditional | 46 |
| Gate: non-blocking | 66 |
| Evidence: static-only | 152 |
| Evidence: automated-tested | 0 |
| Evidence: browser-verified | 1 |
| Evidence: provider-verified | 0 |
| Evidence: environment-blocked | 15 |

Counts are generated from `findings.json`; they are not maintained independently.

## Top release risks

- NP-AUD-2026-001: No password reset / forgot-password flow
- NP-AUD-2026-002: No /auth/confirm; signup confirm branch drops Set-Cookie
- NP-AUD-2026-003: Account-profile Save preferences silently re-subscribes unsubscribed customers
- NP-AUD-2026-004: Unmatched inbound SMS, including STOP, is dropped with HTTP 200
- NP-AUD-2026-005: QBO OAuth callback never runs the overdue backfill
- NP-AUD-2026-009: Intuit compliance URLs 404; Netlify redirects are placeholders
- NP-AUD-2026-010: No member removal, role change, leave-org; memberships RLS is SELECT-only
- NP-AUD-2026-011: Consent has no provenance; STOP is one-click reversible
- NP-AUD-2026-012: All tenants share one operator-owned Twilio sender
- NP-AUD-2026-013: Per-org From is unverified free text on the shared Resend key
- NP-AUD-2026-014: Inbound email mapping cannot work against the real Resend API
- NP-AUD-2026-021: Session cookies are not HttpOnly, not Secure, max-age 400 days
- NP-AUD-2026-022-AUTH-CSRF: Login and signup lack same-origin CSRF protection
- NP-AUD-2026-022-LOGOUT-CSRF: Logout lacks same-origin CSRF protection
- NP-AUD-2026-033-POSTAL: Customer email sends do not enforce or always render a postal address

## Evidence achieved

- Exact baseline/candidate freeze and SHA-256 manifest.
- All 398 prior source entries mapped into the atomic ledger.
- All 56 high findings independently second-reviewed: 55 supported open, one hosted-configuration reproduction blocked, none contradicted.
- Clean install; two target builds; typecheck; cron bundle; Wrangler dry-run; loopback Node health rehearsal.
- Static route/module/migration/RLS/workflow/UX coverage matrices.
- Fresh supplemental Playwright screenshots for public pages at 1440x900 and 390x844.

## Evidence limitations

- Vitest ran twice but collected no tests because `.env.test` is missing.
- Docker/local Supabase was unavailable, so migrations and effective RLS were not executed.
- No Cloudflare or Render staging deployment, provider sandbox, production configuration, backup/restore, rollback, failover, load, or authenticated browser session was available.
- The in-app Browser service was unavailable; Playwright screenshots are supplemental, not accepted in-app Browser proof.
- The required Codex Deep Security Scan could not start because the host lacked a managed filesystem permission profile.

## Navigation

- `findings.json` — source-of-truth atomic ledger
- `findings.md` — generated human-readable cards
- `source-disposition.md` — every prior ID mapped
- `prior-audit-consistency.md` — count/ID/severity repair
- `coverage-matrix.md`, `workflow-matrix.md`, `security-matrix.md`, `ux-a11y-matrix.md`
- `runtime-parity.md`, `provider-evidence.md`
- `fix-pass-backlog.md`, `release-checklist.md`
- `evidence/index.md`

