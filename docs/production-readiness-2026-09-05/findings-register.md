# Historical findings register — 2026-09-05

Final local acceptance evidence is in [release evidence](release-evidence.md).
The current source findings listed below were remediated and independently
reviewed; the fresh database suite and final authenticated browser matrix passed.
Historical IDs still require their own closure evidence, and hosted/operational
gates remain open. No production-readiness approval is implied.

This register reconciles the 99 canonical atomic entries in [the 2026-08-20 findings ledger](../audits/2026-08-20-production-readiness/findings.json) and its July aliases. It deliberately does not call the fix-pass `code` labels “fixed”: the current unit command could not run, and provider, browser, database, deployment, and rollback evidence is unavailable.

Status meanings: **unverified** means current source or a fix-pass entry suggests work exists, but closure evidence is incomplete; **open** means a current static or operational gap remains; **superseded** means the original assertion is explicitly no longer applicable or was a non-bug; **fixed** is reserved for independently demonstrated closure (none is claimed by this baseline).

## Disposition

| Historical IDs | Status | Evidence / reason |
|---|---|---|
| NP-AUD-2026-001–007, 010–011, 014–021, 022-AUTH-CSRF, 022-LOGOUT-CSRF, 023–032, 033-POSTAL, 033-UNSUBSCRIBE, 034, 035-EMAIL-RATE, 035-SMS-RATE, 036-INVITE-TOKEN, 036-LEDGER-RLS, 036-QBO-TOKEN, 037, 038-ROSTER, 038-SERVICE-PIN, 039–041, 042, 043–046-FLOAT-MONEY, 046-PAYMENT-SEMANTICS, 047, 048-CSV, 049-CHANNEL-GATE, 049-RETRY, 050–051, 052-CONSENT-TOGGLE, 052-TEST-SMS, 053-CONTRAST, 053-LABELS, 054-BACKOFF, 101–105, 106–112, 113–120, 121, 123–126, 128, 130–132-AGENTS, 132-README, 132-STARTER, 133, 136-MOTION, 136-TABLE, 136-TABS, 137-FIRST-RUN, 137-LIVE-REGIONS, 138, 139, 140, 141, 143-SNOOZE-CONTACT, 143-SUPPRESSED-FOCUS, 143-WAITING-PROMISE, 144, 145, D01, D02, D03, D04, 016-CI, 016-TEST-ENV, 103, 104-EULA, 104-LANDING, 109, 117, 118, 123, 128 | **unverified** | Current tree contains corresponding routes/modules, migrations, or fix-pass entries, but no passing baseline test run or required live evidence. See [workflow coverage](workflow-coverage.md) and [environment baseline](environment-baseline.md). |
| NP-AUD-2026-008 | **open** | `wrangler.toml` still documents environment setup and this run did not inspect production secret/config state. |
| NP-AUD-2026-009 | **open** | Legacy Netlify/Intuit URL cutover is external deployment evidence and was not verified. |
| NP-AUD-2026-012, 013 | **open** | Per-tenant Twilio sender and verified Resend From are provider/account gates; no provider run was performed. |
| NP-AUD-2026-D05, D06, X227 | **open** | Required deep scan, retained staging/provider/database/browser evidence, and authenticated browser coverage remain unavailable. |
| NP-AUD-2026-142, X204, X219 | **superseded** | Prior ledger explicitly labels sender lock as “not a bug”; X204 records desirable production ErrorBoundary behavior; X219 records a harmless current placement. Retain as historical aliases, not release blockers. |

The register intentionally lists grouped IDs to keep this document reviewable; exact titles, aliases, source paths, and the July 107-entry reconciliation remain in the linked machine-readable ledger and `prior-audit-consistency.md`. No historical entry is marked fixed based solely on a source diff. Hosted verification additionally confirms that both Worker `/readyz` responses report all provider flags false, production and staging provider configuration is incomplete, and no isolated staging Supabase project exists because project creation hit the account quota. Supabase advisor warnings about mutable function search paths and disabled leaked-password protection are separate triage items; service-only tables without policies remain expected deny-by-default behavior.

## Current security hardening evidence

The current worktree adds bounded request ingestion, route-specific webhook
media types, byte-preserving webhook forwarding, a nonce-based CSP rollout,
bounded and sanitized CSP reporting, and correlated redacted edge/SSR error
logs. The focused security suite passed 31/31; an expanded selection covering
notification and invite failures passed 44/44. `npm run check` passed, and the
DB-free browser smoke passed 7/7 with no CSP violation reports, including the
unmatched-route ErrorBoundary. These are verified implementation results after
the baseline snapshot. They do not change any historical finding to **fixed**
without its required independent and operational evidence.

The remaining security release gates are explicit:

- The account project quota still prevents an isolated staging Supabase
  project.
- Hosted `/readyz` still showed provider and operator-alert configuration
  absent; no provider secret value was inspected and no QBO, Twilio, Resend, or
  Stripe sandbox exchange or retry replay was run.
- CSP remains in report-only rollout pending retained staging observation and
  authenticated enforcement, including Supabase Realtime and actual
  Stripe/QBO redirect navigation.
- No 60-minute qualification run, 24-hour soak, capacity result, backup restore
  drill, application/database rollback rehearsal, monitoring check, or
  operator-alert response drill is attached.

## Release interpretation

The codebase has substantial implementation and test scaffolding, but neither
the baseline nor the current security delta establishes a production-ready or
pilot-ready verdict. Treat all unverified and open rows as requiring evidence
appropriate to their gate. External operational gates stay **not verified**
until a retained isolated staging deployment, provider sandbox run,
authenticated enforcement pass, migration/RLS run, monitoring and operator
alert check, load/soak qualification, backup/restore drill, and
application/database rollback rehearsal are attached.

## Current independently confirmed findings

These findings were confirmed against the current worktree during this readiness
pass. The table preserves the baseline discovery state; the candidate source
dispositions below distinguish static remediation and completed local database
execution from still-pending external execution.

| Severity | Finding | Evidence area | Owner |
|---|---|---|---|
| High | Unmatched STOP handling can disclose globally sourced stop records through settings/messages list views. | Candidate source has a scoped service path and regression coverage; fresh local DB execution passed. | `tenant_boundary_fixes` |
| High | Leaving a workspace can remove all memberships for the user. | Candidate source scopes the membership mutation; fresh local DB/concurrency execution passed. | `tenant_boundary_fixes` |
| High | Stripe checkout can create duplicate customer/subscription state without an idempotency lock or ordering guard. | Candidate source has reservation, lease, metadata binding, and ordering guards; fresh local DB execution passed. | `backend_integrity` |
| Medium | A stale organization cookie can fall back to another organization and retarget unsafe actions. | Candidate source rejects stale selection for unsafe actions; local DB execution passed; authenticated/browser evidence remains separate. | `tenant_boundary_fixes` |
| Medium | `api.members` service-role authorization has a time-of-check/time-of-use gap. | Candidate source rechecks authorization at write time; fresh local DB execution passed. | `tenant_boundary_fixes` |
| Medium | Last-owner checks are vulnerable to concurrent write skew. | Candidate migration serializes the owner mutation; fresh local DB/concurrency execution passed. | `database_hardening` |
| Medium | Personal export uses `.maybeSingle()` and fails for users with multiple workspaces. | Candidate source handles multiple workspaces; fresh local DB execution passed. | `tenant_boundary_fixes` |

The historical statement that `0061` was only reserved remains true for the
baseline. The candidate now contains migrations through `0063`; their presence
is static evidence only and does not mark a finding fixed.

## Candidate review disposition

Independent source review reports SEND-01/02/03, PROV-STATUS-01, STRIPE-01/02/04,
RECON-01, PRIV-RET-01, PILOT-01, QBO-01/02/04/05, PMON-01/02, DEPLOY-01, and
DELETE-02 as resolved in source. The coordinated local database execution
passed from a fresh `0063` reset and an upgraded populated `0058`→`0063`
database, including focused provider/QBO/deletion coverage. QBO-05 and
DELETE-02 remain historical **unverified** IDs until their required external
evidence exists; the local result does not replace the historical register
status or its external gates.

Supabase performance advisors also reported 114 notices: 33 unindexed foreign
keys, 9 auth RLS init-plan notices, 18 unused indexes, and 54 multiple
permissive-policy notices. These are inventory signals, not evidence of slow
queries or a mandate to remove indexes. Query measurements and workload context
are required before changing indexes or policies.

## Follow-on capacity finding

**PERF-DELETE-01 — High, fixed in the local candidate.** On the isolated
ten-workspace fixture, deleting one workspace with 5,000 customers, invoices,
cases, and messages exceeded the API statement timeout; a direct RPC took
29.919 seconds. This blocks reliable workspace deletion at the agreed pilot
boundary. Owner: `deletion_performance` (Sol), with independent Sol review.

Rollback-only measurements traced the dominant cost to foreign-key checks.
Five targeted composite indexes reduced the explicit deletion sequence from
about 23.28 seconds to 0.95 seconds. Migration `0064` is the candidate fix;
acceptance requires applying it to the populated local database, successful
actual deletion through the API at 5,000 and 5,001 rows, preserved unrelated
tenant data, and passing deletion/authorization regressions. See
[performance evidence](performance.md). This experiment alone does not close
the finding or qualify staging capacity.

Expanded verification reproduced an 8,005.768 ms PostgREST timeout with 5,001
base rows plus 5,000 contact logs, email messages, promises, promise-invoice
links, and payments. The failed transaction preserved the target and control
tenants. The initial five-index fix is therefore insufficient to close this
finding; the migration must cover the measured full-ledger paths and repeat
successful deletion and control-tenant checks.

Final disposition: `0064` contains 17 measured indexes. The expanded PostgREST
deletion passed in 892.297 ms, with the target deleted, its tombstone verified,
and all nine control-table counts unchanged. Fresh migration application and
five focused integration files / 24 tests passed. Independent Sol re-review
found no remaining critical/high/medium code finding. The one-off performance
fixture and individual timings do not prove staging capacity; see the explicit
limitations in [performance evidence](performance.md). Hosted rollout and
catalog verification remain release requirements, including checking that
`IF NOT EXISTS` did not preserve a mismatched pre-existing index definition.

**PERF-PRESENCE-01 — Medium, fixed in the local candidate.** The authenticated
boundary run logged `presence read failed ... URI too long`: the queue supplied
approximately 5,000 customer IDs in one PostgREST URL and degraded to no presence.
Owner: `presence_boundary` (Terra), with independent Sol review. The candidate
uses deduplicated 100-ID batches with four concurrent reads, explicit tenant
scope, and failure propagation. Acceptance requires unit proof of concurrency,
no further dispatch after failure, and a large-fixture rendered rerun without
the URI failure. Independent Sol review and five focused tests passed, including
deferred concurrency and failure checks. The final real-login Chromium run on
4,999 rows passed Accounts/Messages rendering without the presence warning.
Full unit verification passed 139 files / 1,362 tests. Hosted rollout remains
part of the release gates, not evidence supplied by this local check.
