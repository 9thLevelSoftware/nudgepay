# Remaining production execution gates

Execution began at `0dcea80` (including migration `0064`); the continuation adds
migrations `0065` and `0066`. This register records what must still be executed and
retained before pilot or production promotion. Local source, test, and fixture
results do not close a hosted gate.

Human owner: **unknown**. Assign a named operator before hosted qualification
and partner admission. All complete release gates remain **pending**.

Hosted recheck on 2026-09-05: Supabase now has a separate active staging project
(`ajffjukmvltqxxtkkplq`, east1) alongside production
(`epjumsnmpvilgasycpau`). All migrations `0001`–`0066` are applied to staging,
all public tables have RLS enabled, and the staging database currently has zero
organizations. Cloudflare's newly connected API integration successfully
read Workers Builds settings (HTTP 200), resolving the CLI-only 403 blocker.
Both production build triggers were inspected and their configuration retained
before removal: non-production preview uploads and automatic main-branch
deployments are now disabled. Production promotion will use the explicit sealed
artifact workflow after qualification. The live Worker was not redeployed.

GitHub branch-protection readback now confirms all eight `REQUIRED_PR_CHECKS`
on `main`, tied to GitHub Actions app `15368`, with strict status checks and
administrator enforcement enabled. Retained evidence is
`branch-protection-before.json` and `branch-protection-after.json`. This is a
configuration result only. Its predecessor for `c6f8ae5` had seven planned checks pass and two Linux-only
database test parser failures; test-only parser normalization is commit
`3c2aff3458c327b0a0fbb051f83e77db0208f053`, with local parser and affected
database test evidence. [CI run 33986502649](https://github.com/9thLevelSoftware/nudgepay/actions/runs/33986502649)
completed successfully with all eight planned checks on that exact commit; the
nightly authenticated cross-browser job was skipped by design. Retained external
evidence is `ci-3c2aff3.json` and `ci-3c2aff3.log`. Draft PR [#140](https://github.com/9thLevelSoftware/nudgepay/pull/140)
and this documentation-only follow-up are separate SHAs and are not promotion decisions.

Production `workers.dev` and preview ingress are disabled with readback
confirmation; the canonical hostname's health and login pages still return 200.
Staging schedules remain empty and both Workers retain query-string redaction.
External evidence: `hosted-gates-recheck-2026-09-05.json`,
`production-ingress-hardening-2026-09-05.json`,
`cloudflare-build-triggers-before-2026-09-05.json`, and
`cloudflare-build-triggers-disabled-2026-09-05.json` under
`%LOCALAPPDATA%\NudgePay\evidence`.

| ID | Owner role | Prerequisites | Pass criteria | Evidence to retain | Status |
|---|---|---|---|---|---|
| GATE-01 Staging isolation | Supabase/platform operator | A separate staging Supabase project, exact staging origin, isolated secrets, and staging Worker with schedules deliberately configured | Staging database, auth, storage, secrets, Worker, and schedules are isolated from production; all 66 migrations are applied and RLS is enabled on all public tables | Project/config identifiers, migration output, RLS results, `/readyz`, and schedule read-back | **Partial** — separate staging project `ajffjukmvltqxxtkkplq` is active and all 66 migrations are applied with RLS enabled on all public tables; staging Worker secrets point to it. Schedules remain removed pending a new artifact deployment, and schedule read-back plus authenticated isolation verification remain open |
| GATE-02 Provider readiness | Provider/integration operator | Isolated staging; configured QBO, Twilio, Resend, Stripe, and operator-alert sandbox credentials; approved synthetic fixtures | Each provider completes send/callback/status/retry or checkout flow with signature and idempotency checks; no real customer message or charge | Redacted request/result logs, provider IDs, retry/replay results, and `/readyz` configuration evidence | **Pending** — hosted readiness and controlled provider exercises remain unperformed |
| GATE-03 Hosted release protections | Release/platform operator | Candidate commit, clean checkout, canonical deployment wrapper, protected branch, immutable artifact store, and hosted Workers/GitHub access | Required checks include secret scan, CodeQL, and authenticated browser flows; non-production branch builds are disabled; ingress/query-redaction/CSP settings and exact candidate SHA are verified after deployment | Branch-protection read-back, build settings, deployment output, post-upload config read-back, and immutable artifact manifest | **Partial** — all eight required GitHub Actions checks are now strict and admin-enforced on `main`; automatic build triggers and alternate production ingress are disabled. [CI run 33986502649](https://github.com/9thLevelSoftware/nudgepay/actions/runs/33986502649) passed all eight planned checks on `3c2aff3458c327b0a0fbb051f83e77db0208f053`; final candidate, artifact promotion, deployed configuration, and enforced CSP evidence remain outstanding |
| GATE-04 Performance and soak | QA/performance operator | Isolated staging, reproducible ten-workspace/full-ledger fixture, 50 distinct staging sessions, exact origin allowlist, and approved traffic window | Per-route/session identity remains tenant-correct; 60-minute pilot load meets p95 < 2,000 ms and error rate < 1%; 24-hour soak completes without retry/ledger drift; deletion and read boundaries remain healthy | Fixture manifest and seed output, raw endpoint results, per-route/session matrix, latency/error report, and soak logs | **Pending** — only local one-off measurements and local browser evidence exist |
| GATE-05 Recovery | Database/platform operator | Isolated backup/PITR target, encrypted-token recovery material, tested application/database rollback plan, and named incident operator | Restore drill meets the four-hour RTO and one-hour RPO; recovered app passes health, auth, RLS, and ledger checks; rollback/forward-repair rehearsal is recorded | Timestamped backup/restore transcript, data-loss calculation, migration state, rollback decision log, and verification results | **Pending** — no isolated restore or rollback rehearsal is attached |
| GATE-06 Monitoring and support | Monitoring/support operator | Production-like alert destinations, five-minute provider monitor, on-call coverage, and acknowledged runbook | Alert is delivered, acknowledged, and resolved; stable midnight retry and failure/retry reconciliation complete without duplicate sends or ledger ambiguity; coverage hours and escalation path are named | Alert delivery/ack records, monitor and retry logs, reconciliation record, and support roster | **Pending** — live alert delivery, acknowledgement, and operator ownership remain unverified |
| GATE-07 Accessibility and complete workflows | QA/accessibility/provider operator | Isolated staging, synthetic provider accounts, authenticated sessions, screen-reader test setup, and approved workflow script | Manual screen-reader review passes; authenticated CSP enforcement passes with Supabase Realtime and Stripe/QBO redirects; signup-to-sync, messaging, payment, report, and erasure workflows complete end to end | Screen-reader findings, CSP report/enforce captures, provider workflow traces, and retained screenshots/results | **Pending** — local/public evidence is limited to tested flows; complete provider-backed workflows remain unperformed |

## Candidate and evidence reconciliation

- `0dcea80` is the execution baseline. The continuation has local populated
  upgrade and fresh-reset evidence through `0066`, independent reviews,
  typecheck/build/dry-run, and authenticated browser checks. Final commit and
  detailed results belong in the release evidence package. These observations
  do not change any hosted row above to passed.
- Full-ledger local deletion now has retained seed and measurement JSON from
  the independently reviewed fixture on migration `0066`: actual RPC 204,
  830.41 ms, target cleanup, unchanged control, and actual migration ledger.
  See `pilot-deletion-final-0066-{seed,measure}.json` in the external evidence
  directory. Staging qualification still requires a representative latency
  distribution; this individual local observation proves integrity only.
- Staging load must use independently issued sessions whose provenance is bound
  to the exact allowed origin. The runner must assert strict per-route/session
  identity and tenant isolation, rather than treating workspace labels or a
  declared fixture manifest as proof that the server selected that workspace.
- Shared-NAT authentication remains unqualified. Include a bounded shared-IP
  login burst in the staging auth exercise and retain rate-limit, success, and
  isolation results without weakening the real-login limiter.
- CSP remains report-only pending retained staging observation. Promotion
  requires authenticated `CSP_MODE=enforce` evidence covering Realtime and the
  actual Stripe/QBO redirect origins, plus a clean violation review.
- The release artifact must map immutably to the tested source SHA, migration
  set (`0001`–`0066`), built Worker digest/version, and verified configuration.
  A source manifest or local build log alone is not deployment identity.
- Cloudflare integration access now resolves the earlier CLI Workers Builds
  403 blocker. A subsequent read-only recheck returned HTTP 200 for Workers,
  build triggers (empty), and production subdomain settings (both disabled).
  The former staging-quota blocker is superseded: staging project
  `ajffjukmvltqxxtkkplq` is active in east1. Remaining GATE-01 work is schedule
  restoration through the new artifact pipeline, plus schedule read-back and
  authenticated isolation verification.
  The removed/recreated raw Cloudflare trigger configuration is retained
  externally as `cloudflare-trigger-before-canonical-pipeline.json`.
