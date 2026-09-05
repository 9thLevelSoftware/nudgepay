# Pilot release evidence

**Decision: not approved for production promotion.** This package records the
implementation and qualification work for the defined ten-workspace pilot.
Local verification does not replace the outstanding hosted and operational gates.

## Candidate identity

- Baseline commit: `f7ebf21820deeecae95f4b41ba3b5275715e18c6`.
- Implementation branch: `codex/production-readiness`.
- Candidate changes are currently uncommitted; the baseline SHA must not be
  presented as the tested implementation SHA. A 624-file source/test/config
  manifest (excluding Markdown and `docs/`) is retained outside the repository
  at `C:\Users\dasbl\AppData\Local\NudgePay\evidence\candidate-source-manifest.json`.
  Its SHA-256 is `0fd59e894daadc0a2f8d6ded99b473026a5415c607cbda33c3e289e5355aaf6f`.
  This records the local candidate; it does not replace the required clean
  tested commit and deployment artifact before promotion.
- No production deployment, hosted migration, real customer message, or billing
  transaction was performed during implementation.

## Implemented scope

- Shared dialog focus, background interaction, responsive dismissal, navigation
  hydration, and truthful account metric scope.
- Tenant selection, membership changes, personal export pagination, last-owner
  concurrency, and deletion safeguards.
- Bounded requests, SSR CSP rollout, credential/personal-data log protection,
  dependency remediation, and release configuration checks.
- Durable outbound reservations and budgets, Stripe checkout/event integrity,
  conservative ambiguous outcomes, and audited operator reconciliation.
- QuickBooks refresh coordination and credential-preserving disconnect.
- Stale-provider monitoring, isolated authenticated browser fixtures, exclusive
  database test ownership, and reproducible pilot-boundary/load tooling.

The numbered migrations after the inspected production schema are `0059`
through `0063`. They require isolated upgrade and qualification evidence before
hosted application. Existing routes and the human-operated sending model remain.

## Verification

The following commands passed against the implementation worktree:

| Check | Result |
|---|---|
| `npm run test:unit` | 1,350 tests passed across 137 files. |
| `npm run typecheck` | Passed generated Worker/router types and TypeScript. |
| `npm run check` | Passed TypeScript, production Worker build, configuration preflight, and Wrangler dry-run. No deployment occurred. |
| `npm audit --omit=dev --json` | Zero reported production dependency vulnerabilities. |
| `npm run test:e2e` | Seven public browser smoke tests passed, including login, signup, skip-link focus, and the styled not-found boundary. |
| `git diff --check` | Passed. |
| Populated local upgrade from `0058` to `0063` | Passed; retained the synthetic workspace, customer, invoice, and delivered SMS, and admitted the existing workspace into the pilot registry. |
| Focused integration on upgraded schema | 151 tests passed across 14 files. |
| Fresh local reset through `0063`, then `npx vitest run` | 1,736 tests passed across 206 files. This full suite includes the unit tests; counts are not additive. |
| Local database lint | Passed; one nonblocking unused `p_member_count` parameter warning in `delete_workspace`. |
| `node e2e/authenticated/run.mjs` | 37 passed, 23 intentional skips, zero failures in one uninterrupted run across five projects. |

Earlier findings and intermediate results are retained in
[the implementation ledger](implementation-ledger.md); they are not substituted
for a clean final result. Command logs are outside tracked source under
`C:\Users\dasbl\AppData\Local\NudgePay\evidence` (`unit-final-2026-09-05.log`,
`typecheck-final-2026-09-05.log`, `check-final-2026-09-05.log`, and
`smoke-final-2026-09-05.log`).

Upgrade evidence is retained in `C:\Users\dasbl\AppData\Local\Temp`:
`nudgepay-upgrade-0058-to-0063-retry.log` and
`nudgepay-focused-upgrade-integration.log`. Fresh-install evidence is in
`nudgepay-final-fresh-reset.log`, `nudgepay-final-full-vitest.log`, and
`nudgepay-final-db-lint.log` in the same directory. These exercises used only
the isolated local Supabase stack.

Screenshots and traces are stored outside tracked source. CI publishes synthetic
screenshots only; authentication-bearing traces and network captures are excluded.

The authenticated matrix covers desktop Chromium, Firefox and WebKit, 820px
tablet, and 390px mobile. Its 37 executions include ten navigation/ledger cases,
four role/RLS/mutation cases, 21 responsive/focus/history/theme/zoom cases, and
two axe audits of dashboard, settings and selected accounts in both themes.
The 23 skips deliberately avoid repeating shared-state role/mutation cases
(16), limit axe to desktop/mobile Chromium (3), and run reduced-motion/200%
content zoom once (4). These are not 60 passing tests or full WCAG certification.

The suite uses local synthetic tenants and distinct synthetic client IPs; the
real login limiter remains enabled. Shared-IP login bursts are not qualified.
Finite theme transitions finish before the contrast audit. Console checks remain
strict with the narrowly documented WebKit development-manifest exception;
the built Worker preview was separately checked for successful manifest loading.
Provider deliveries and signup-to-sync/payment flows are not simulated by the
seeded ledger checks. See `nudgepay-app/e2e/authenticated/README.md` for coverage.

The final browser log and review screenshots are in
`C:\Users\dasbl\AppData\Local\NudgePay\e2e-evidence`:
`authenticated-final-2026-09-05.log`, `chromium-desktop-dashboard.png`,
`chromium-desktop-dark-dashboard.png`,
`chromium-mobile-selected-account-drawer.png`, and
`chromium-mobile-dark-selected-account.png`. The coordinator visually inspected
the light/dark dashboard and responsive account drawer evidence.

Independent consequential-change review found no unresolved critical, high, or
medium source finding in its assigned provider, tenant, database, QBO, monitoring,
and deployment scope after the fixes and database regressions. This is a scoped
review conclusion, not a certification of the entire product or hosted setup.

## Open release gates

| Gate | Current evidence / blocker |
|---|---|
| Separate staging database | Supabase rejected creation at the account's active-free-project limit. The existing deployed staging configuration shares production's project and is not isolated. |
| Provider readiness | Hosted readiness and secret-name checks show incomplete provider/operator configuration. Controlled QBO, Twilio, Resend, and Stripe end-to-end exercises remain unperformed. |
| Hosted release protections | Existing GitHub checks were verified read-only. Newly added checks must pass and become required; hosted ingress and canonical deployment configuration must be verified on the candidate. |
| Performance and soak | No 60-minute staging load run or 24-hour staging soak has been completed. Fixture and load tools do not establish capacity. |
| Recovery | No isolated production backup/PITR restore or encrypted-token recovery drill has proved the four-hour RTO / one-hour RPO. |
| Monitoring and support | Live alert delivery/acknowledgement and a named release/support operator with coverage hours remain outstanding. |
| Accessibility and complete workflows | Automated/rendered evidence is limited to the flows explicitly tested. Manual screen-reader assessment and complete provider-backed signup-to-payment/report workflows remain separate gates. |

Operational targets remain targets: 99.5% monthly availability, recovery within
four hours, and at most one hour of database loss. Admission begins with one
partner, then three, then ten only after the agreed healthy-operation windows.

## Rollback and continuation

Use [the pilot operations runbook](../pilot-ops.md) for compatible Worker rollback,
forward database repair, provider reconciliation, and release commands. Database
restoration is an incident procedure, not an automatic migration rollback.
Record the tested commit, artifact and Worker version IDs, migration state,
configuration evidence, and last known-good version before promotion.
