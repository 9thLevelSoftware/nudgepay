# Pilot release evidence

**Decision: not approved for production promotion.** This package records the
implementation and qualification work for the defined ten-workspace pilot.
Local verification does not replace the outstanding hosted and operational gates.

## Candidate identity

- Baseline commit: `f7ebf21820deeecae95f4b41ba3b5275715e18c6`.
- Implementation branch: `codex/production-readiness`.
- The verified implementation was committed as
  `2d99e8c218515ca843ff2a30af376aef44b208ce` on the implementation branch.
  Follow-on qualification changes are recorded separately; the baseline SHA must
  not be presented as the tested implementation SHA. A 624-file source/test/config
  manifest (excluding Markdown and `docs/`) is retained outside the repository
  at `C:\Users\dasbl\AppData\Local\NudgePay\evidence\candidate-source-manifest.json`.
  Its SHA-256 is `0fd59e894daadc0a2f8d6ded99b473026a5415c607cbda33c3e289e5355aaf6f`.
  This records the original local candidate; a recorded deployment artifact is
  still required before promotion.
- No production deployment, hosted migration, real customer message, or billing
  transaction was performed during implementation.
- Follow-on deployment safeguards: `ba7ca75` verifies query redaction after
  canonical Worker uploads. Focused review and 74 tests passed; the follow-on
  full unit run passed 138 files / 1,357 tests, with typecheck and production
  build/dry-run passing. Logs are `followon-unit.log`, `followon-typecheck.log`,
  and `followon-check.log` under the external evidence directory above. These
  checks do not repeat or extend the original authenticated browser evidence.
- Presence boundary fix: `9acfbd2` bounds each lookup to 100 customer IDs and
  four concurrent requests, preserving tenant scope and stopping new dispatch
  after failure. Independent review and five focused tests passed; the complete
  unit suite passed 139 files / 1,362 tests. Final typecheck/build/dry-run logs
  are `boundary-final-typecheck.log` and `boundary-final-check.log` in the same
  external evidence directory. A real-login Chromium recheck at 4,999 rows
  passed with no presence URI-length warning.
- The continuation baseline is `0dcea80ffffdbbd7e32b0bdcb7d48991f0293fae`,
  including migration `0064`. The resulting committed candidate and evidence
  hashes are recorded in external `candidate-remaining-gates.json`. Its local
  verification is listed separately below; earlier totals do not qualify later
  changes.

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
through `0066`. They require isolated upgrade and qualification evidence before
hosted application. Existing routes and the human-operated sending model remain.

## Verification

### Remaining-gate implementation verification

The continuation after `0dcea80` adds stable send-operation identities and
backward-compatible RPC overloads (`0065`), durable scheduled-job health and
the protected `/monitorz` probe (`0066`), strict load-response qualification,
reproducible deletion evidence, and sealed artifact/deployment verification.
Sends require JavaScript and working session storage: forms remain disabled
before hydration, and failed persistence prevents submission. This is needed
to retain an uncertain operation across reloads without blindly resending.
Correlated success stores a new generation across composer remounts.

Independent reviews cleared the final send lifecycle, database bindings,
monitoring, load markers, artifact workflow, and deletion fixture. Rendered
qualification caught and corrected a React Router `.client.ts` SSR export
failure; the hook now uses a server-renderable module with browser work confined
to effects and submission handlers.

Coordinator evidence for this continuation is retained in the external evidence
directory:

Hosted GitHub branch-protection readback now confirms that `main` requires all
eight `REQUIRED_PR_CHECKS`, each tied to the GitHub Actions app (`15368`), with
strict status checks and administrator enforcement enabled. The before/after
readbacks are `branch-protection-before.json` and `branch-protection-after.json`
in the external evidence directory. This proves the protection configuration,
not that a candidate has passed it.

The CI run for `c6f8ae5` had seven planned checks pass but failed two database
integration tests because Linux Supabase CLI JSON returned a direct row array
where the tests expected a `{ rows }` wrapper. Test-only normalization was
committed as `3c2aff3458c327b0a0fbb051f83e77db0208f053`; its local parser unit
tests and the eight affected database tests passed. [CI run 33986502649](https://github.com/9thLevelSoftware/nudgepay/actions/runs/33986502649)
completed successfully with all eight planned checks on that exact commit; the
nightly authenticated cross-browser job was skipped by design. Retained external
evidence is `ci-3c2aff3.json` and `ci-3c2aff3.log`. Draft PR [#140](https://github.com/9thLevelSoftware/nudgepay/pull/140)
contains this follow-up. This documentation-only follow-up is a different SHA
and has not thereby inherited the CI result. The earlier local full-suite
evidence remains separate and does not close hosted readiness.

| Check | Result / artifact |
|---|---|
| Final unit suite | 149 files / 1,434 tests passed; `remaining-gates-final-unit.log`. |
| Typecheck | Passed; `remaining-gates-final-typecheck.log`. |
| Production build and Worker dry-run | Passed after the SSR correction; `remaining-gates-final-check.log`. |
| Public and send-lifecycle browser checks | Ten passed, including storage denial, lost-response reload, success redirect/remount, and deliberate new sends; `remaining-gates-final-public-browser.log`. |
| Authenticated rendered matrix | 37 passed / 28 intentional skips across five projects; `remaining-gates-final-authenticated-browser.log`. The five additional skips are the separately opt-in 4,999/5,000/5,001 fixture checks, whose prior evidence remains historical. |
| Populated local `0064` → `0066` upgrade | Passed; 5,000 rows in each of nine tables for both tenants preserved. `populated-0064-0066-upgrade.{json,log}`. |
| Focused upgraded-schema integration | Four files / 73 tests passed; `upgrade-0066-focused-integration.log`. |
| Fresh local migration reset | Passed through `0066`; `fresh-0066-reset.log`. |
| Final full suite on fresh `0066` schema | 220 files / 1,835 tests passed; `fresh-0066-final-full-integration.log`. This includes the unit suite; counts are not additive. |
| Production dependency audit | Zero advisories; `remaining-gates-production-audit.json`. |
| Pinned gitleaks working-tree export | 737 source/documentation/test/config files, zero findings; `remaining-gates-secret-scan.log`. Synthetic monitor test tokens were rewritten without broadening scanner exceptions. |

Screenshots in the existing external `e2e-evidence` directory were refreshed by
the authenticated run. The coordinator inspected the desktop dashboard and dark
mobile selected-account drawer. These are synthetic local observations; provider
delivery, staging CSP enforcement, and a real screen-reader review remain open.

### Earlier implementation verification

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
| Pinned gitleaks `v8.30.0` at digest ending `574d9` | Full committed tree and baseline-to-candidate commit range passed, zero findings. |

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

Continuation after the implementation commit: the Cloudflare API confirmed the
deployed staging Worker still shared production's database and had hourly plus
half-hourly schedules. At `2026-09-05T16:52:45Z`, its schedules were removed and
the empty schedule list was verified. Production's two schedules were verified
unchanged. This is a staging configuration safety change, not a code deployment
or proof of full staging isolation. The evidence is retained at
`C:\Users\dasbl\AppData\Local\NudgePay\evidence\staging-cron-isolation-2026-09-05.json`.
Do not restore staging schedules until its database is isolated.

The same hosted recheck found production `workers.dev` and preview ingress
enabled, and platform `redact_query_string` disabled. Query redaction was then
enabled and read-back verified for production and staging at `2026-09-05T16:58Z`,
preserving existing log/sampling/trace settings. Evidence is retained at
`C:\Users\dasbl\AppData\Local\NudgePay\evidence\hosted-query-redaction-2026-09-05.json`.
Canonical production/staging deployment wrappers now apply redaction after
upload and verify both the flag and preservation of existing observability
settings. The Windows credential-resolution smoke, 74 focused tests, TypeScript
checks, production build/dry-run, and independent Sol review passed. This remains
a post-upload check; failure leaves the deployment incomplete and requires repair.
The CLI credential initially returned HTTP 403 for Workers Builds. The newly
connected Cloudflare integration resolved that access blocker with HTTP 200.
The production preview-upload trigger was removed at `2026-09-05T18:08:27.319Z`
and the automatic main-branch deployment trigger at `2026-09-05T18:10:10.462Z`,
after retaining their configuration. Both bypassed the required sealed-artifact
promotion contract. Readback confirms no production build triggers. Promotion
will use the explicit artifact workflow after qualification; automatic Builds
require a reviewed artifact transport contract before restoration. Evidence:
`cloudflare-build-triggers-before-2026-09-05.json` and
`cloudflare-build-triggers-disabled-2026-09-05.json` in the external evidence
directory. At the time of that trigger readback, the branch had not yet been
pushed and no Worker code was redeployed.

Production `workers.dev` and preview ingress were disabled at
`2026-09-05T17:59:10.506Z`. Readback confirms both disabled; canonical health
and login remained HTTP 200, while the alternate production health URL returned
404. See `production-ingress-hardening-2026-09-05.json`. Staging's Worker URL
remains its entry point, with schedules disabled pending database isolation.

The required-check verifier then reported three checks missing from `main`
protection: secret scan, CodeQL, and authenticated browser flows. This is
historical evidence superseded by the later branch-protection readback that
confirms all eight required checks, strict mode, and administrator enforcement.

The follow-on local boundary exercise exposed a workspace-deletion performance
issue near the list cap: API cleanup timed out and a direct local deletion took
about 29 seconds for one fixture workspace. Migration `0064` now adds 17 measured
foreign-key indexes. After extending the workload to email, contacts, promises,
promise-invoice links, and payments, an actual local endpoint deletion passed in
892.297 ms, preserving the control tenant. Fresh migration application and five
focused integration files / 24 tests passed, with independent review finding no
remaining critical/high/medium code issue. The expanded timing is retained as an
agent execution record; its original SQL/raw output were not retained. See
[performance evidence](performance.md) for that limitation and required
reproducible staging follow-up. Individual local timings do not prove pilot p95.

A reproducible scoped rerun at `2026-09-05T18:24:48.482Z` now retains raw
sanitized JSON: `pilot-deletion-seed-2026-09-05.json`,
`pilot-deletion-measure-2026-09-05.json`, and
`pilot-deletion-migration-ledger-2026-09-05.json` in the external evidence
directory. It held one local database lock across seeding and measurement.
The actual RPC returned 204 in 829.63 ms; all nine target tables and the target
workspace were empty afterward, all nine control tables retained 5,000 rows,
and a fresh matching deletion tombstone was recorded. The actual local ledger
reported migration `0064`. Measurement JSON SHA-256:
`53b5fe91f7d11c816fbf64658c1f0403e9961d93c003f5c41b2fb263a8c65766`.
An earlier unretained run took 1,101.96 ms. Neither individual timing establishes
the required staging latency distribution; this closes raw local integrity
evidence retention only. The then-pending independent source review was
superseded by the reviewed `0066` fixture and final source-review conclusion
recorded above; neither local result establishes staging performance.

After independent fixture review and fixes, the coordinator regenerated evidence
from the frozen implementation on local migration `0066` at
`2026-09-05T18:38:30.409Z`: `pilot-deletion-final-0066-seed.json` and
`pilot-deletion-final-0066-measure.json`. The measurement records actual RPC 204,
830.41 ms, complete target removal, unchanged 5,000-row control tables, a fresh
matching tombstone, the full actual `0001`–`0066` migration ledger, and fixture
code digest `447227ccfe70e872bcae75bf9f0e2b5b21e06a33a8d461361923fe31f0e770db`.
Measurement artifact SHA-256:
`ba81d3d9f72d19cfd157af981c44eea890713b7a317e35af3b53c238b9c7251a`.
This supersedes the earlier fixture run for final-code integrity evidence;
it still does not establish staging p95 or pilot capacity.

Real-login Chromium runs also verified Accounts and Messages at 4,999, 5,000,
and 5,001 rows: visible synthetic content in every case and an incomplete-data
warning only above the cap. Screenshots are retained outside tracked source.
The initial presence URI failure was fixed and the final large-fixture rerun
passed without it. These supplement the original browser evidence with local
boundary behavior only.

| Gate | Current evidence / blocker |
|---|---|
| Separate staging database | Supabase rejected creation at the account's active-free-project limit. The existing deployed staging configuration shares production's project and is not isolated. |
| Provider readiness | Hosted readiness and secret-name checks show incomplete provider/operator configuration. Controlled QBO, Twilio, Resend, and Stripe end-to-end exercises remain unperformed. |
| Hosted release protections | `main` now has all eight required GitHub Actions checks with strict and administrator enforcement, evidenced by before/after readbacks. [CI run 33986502649](https://github.com/9thLevelSoftware/nudgepay/actions/runs/33986502649) passed all eight planned checks on `3c2aff3458c327b0a0fbb051f83e77db0208f053`; candidate artifact promotion, deployed configuration, and enforced CSP evidence remain outstanding. |
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
