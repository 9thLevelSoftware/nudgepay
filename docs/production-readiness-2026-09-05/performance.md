# Local pilot boundary and performance fixtures

`nudgepay-app/scripts/seed-pilot-load.mjs` prepares a reproducible **local-only** data shape for loader, RLS, and query-plan measurements. Each requested 4,999/5,000/5,001 size applies to every one of ten workspaces, so the default fixture carries 50,000 invoices, 50,000 cases, and 50,000 messages across the cohort. It does not qualify staging or production capacity, and it never calls QuickBooks, Twilio, Resend, Stripe, or any other provider.

The default command is a dry run. It prints the intended ten organizations, fifty users (five per organization), and dataset totals without reading credentials, calling Supabase, or creating sessions.

```powershell
cd D:\nudgepay\nudgepay-app
node scripts/seed-pilot-load.mjs --invoices 4999 --cases 5000 --messages 5001
```

An explicit `--seed` is required for writes. The process accepts only the exact local Supabase API origin `http://127.0.0.1:54321` (or `[::1]` at that port), with no path, credentials, query, or fragment. Hosted URLs, `localhost`, HTTPS, and alternate ports are rejected before any write. It requires both local Supabase keys and performs no table truncate or database reset.

```powershell
$env:SUPABASE_URL = 'http://127.0.0.1:54321'
$env:SUPABASE_ANON_KEY = '<local anon key>'
$env:SUPABASE_SERVICE_KEY = '<local service key>'
node scripts/seed-pilot-load.mjs --seed --credentials-file C:\secure\nudgepay-pilot-local.json --invoices 4999 --cases 5000 --messages 5001
```

Reruns delete only the known fixture organization UUIDs and the fifty exact `pilot-load-20260905-...@local.invalid` auth users, then rebuild them. Fixture cleanup calls the existing workspace-deletion RPC over the local CLI connection so the last-owner guard remains in effect; it has a ten-minute subprocess limit. This local recycler does not alter application timeout behavior or qualify production deletion performance. Public data outside those identities is not selected, modified, truncated, or reset. The fixture gives every synthetic customer an invoice/case/message relationship where that dataset is present; message history includes both inbound and outbound SMS ledger rows but triggers no provider send.

The credentials artifact is intentionally outside the repository and is written mode `0600`. It contains local synthetic passwords for all fifty users. Add `--sessions 50 --cookie-file C:\secure\nudgepay-pilot-local-cookies.json` only when a local browser/app session test needs them; it signs into the validated local Supabase target through the same `@supabase/ssr` server-cookie path used by the app and adds the corresponding local organization cookie. The separate mode-`0600` cookie file uses `nudgepay-pilot-session-fixture/v1`: a local-only provenance manifest with the exact per-workspace dataset counts, opaque `pilot-session-01` through `pilot-session-50` labels, and five sessions for each `pilot-workspace-01` through `pilot-workspace-10`. Credentials and tokens are never printed. Dry runs never create auth tokens.

The existing `scripts/pilot-load.mjs` remains a separate HTTPS staging, read-only runner. Its cookie artifact accepts a raw Cookie header or `{ "cookie": "..." }` / `{ "cookies": ["..."] }`, with one to fifty distinct contexts for diagnostics. The local fixture artifact is deliberately labeled local and is rejected by the staging pilot profile. A staging qualification needs a dedicated isolated staging deployment, an approved traffic window, synthetic staging data, and independently issued staging session fixtures whose `staging-pilot-fixture` provenance is bound to the exact runner origin.

## Local deletion-path measurement — 2026-09-05

The QA-owned local Docker Supabase database was seeded with ten synthetic workspaces and fifty synthetic users. Each workspace contained exactly 5,000 customers, invoices, collection cases, and SMS ledger rows. The measurement ran on the local Windows host through `psql` in the local Postgres container. It used `BEGIN`/`ROLLBACK`, so it preserved the fixture and created no hosted traffic or provider activity.

The measured operation was workspace deletion, not an authenticated loader or a capacity qualification. A rollback-safe `EXPLAIN (ANALYZE, BUFFERS, WAL, VERBOSE)` of `delete_workspace` for one full workspace took **29.919 seconds**, touched 20,418,773 shared buffers, and generated 6.34 MB of WAL. The outer plan is opaque because the deletion is PL/pgSQL, so the explicit deletion sequence was also profiled.

| Variant | Collection-case delete | Final organization cascade | Explicit sequence total | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Current schema | 2.543 s | 20.727 s | about 23.28 s | Does not meet a reasonable interactive deletion expectation at the pilot boundary. |
| All uncovered nested-FK indexes (28, rollback only) | 2.490 s | 4.923 s | about 7.42 s | Confirms missing nested foreign-key indexes materially affect RI trigger work. |
| Five populated-path composite indexes (rollback only) | 0.257 s | 0.682 s | about 0.95 s | The measured, constrained candidate: `invoices(customer_id, org_id)`, `collection_cases(customer_id, org_id)`, and `text_messages` on `(invoice_id, org_id)`, `(customer_id, org_id)`, and `(case_id, org_id)`. |

The temporary index experiments were rolled back and are **not** evidence that the production schema has been changed. A separate reviewed migration and fresh local upgrade/test run are required before treating the final variant as fixed. Raw local-only artifacts are outside tracked source:

- `%LOCALAPPDATA%\\NudgePay\\evidence\\pilot-boundary-delete-workspace-5000-explain-2026-09-05.txt`
- `%LOCALAPPDATA%\\NudgePay\\evidence\\pilot-boundary-delete-segments-5000-2026-09-05.txt`
- `%LOCALAPPDATA%\\NudgePay\\evidence\\pilot-boundary-all-uncovered-fk-indexes-5000-2026-09-05.txt`
- `%LOCALAPPDATA%\\NudgePay\\evidence\\pilot-boundary-populated-fk-indexes-5000-2026-09-05.txt`

This is local database integrity/performance evidence only. It does not establish the p95 authenticated-read target, 50-session staging load result, a 60-minute load run, or a 24-hour staging soak.

### Applied migration and expanded workload

The first five-index candidate passed actual local PostgREST `delete_workspace`
calls at 5,001 rows (997.358 ms) and 5,000 rows (1,009.398 ms). The deleted tenant
was removed and the control tenant retained its counts. These are individual
measurements, not a p95 latency result.

Independent review required coverage of additional current workflows. A target
and control workspace were each populated with 5,000 contact logs, email
messages, promises (including replacement/contact links), promise-invoice links,
and payments, alongside the existing base data. The initial candidate timed out
through PostgREST at 8,005.768 ms; the failed transaction preserved both tenants.
Trigger profiling demonstrated additional scans in those foreign-key paths.

Final migration `0064` adds 17 measured ID-leading composite indexes, retaining
all deletion functions, tenant constraints, and authorization rules. The expanded
deletion then passed through PostgREST in **892.297 ms**, with the target removed,
the expected deletion tombstone, and all nine control-table counts unchanged.
This extends the tested workload beyond the original SMS-only fixture.

The migration uses a five-second lock wait limit and a sixty-second limit per
index statement. Initial boundary index builds measured 13–18 ms each; hosted
lock acquisition and build duration still require staging verification. Normal
index creation can block writes while the migration holds its locks.

A fresh local reset through `0064` and five focused integration files / 24 tests
passed. The external logs are `deletion-0064-fresh-reset-2026-09-05.log` and
`deletion-0064-focused-regression-2026-09-05.log` in
`%LOCALAPPDATA%\\NudgePay\\evidence`. Independent Sol re-review found no remaining
critical, high, or medium code finding in the migration and catalog test.
The expanded performance fixture was executed as a one-off SQL exercise; it is
not an automated, routinely repeated performance regression test.
Its retained result is
`workspace-deletion-full-ledger-agent-execution-record-2026-09-05.json` in the
same evidence directory (SHA-256
`B8039F0F8308EF6104CEBDFE0096A9AFECCD8D251808EBF6A78D70A2353C45C0`).
This is an agent execution record: the original one-off SQL and raw output were
not retained. Treat that as weaker evidence than a reproducible captured run.
Before staging qualification, retain a reproducible fixture and raw endpoint
results. Owner: release coordinator; review by 2026-09-12 or before staging
qualification, whichever comes first. This evidence limitation is acceptable
for committing the measured fix, not for waiving the staging release gate.

## Rendered list-boundary evidence — 2026-09-05

Using the existing local authenticated Playwright harness, a synthetic workspace was signed in through the normal login form and loaded through the real local app routes. No authentication bypass or provider call was used. The same deterministic workspace was reduced only by its final one, then final two, linked synthetic customer/invoice/case/SMS rows between runs.

| Rows per source | `/accounts` | `/messages` |
| ---: | --- | --- |
| 5,001 | Exact incomplete-data banner visible; synthetic account content visible | Exact incomplete-data banner visible; synthetic message content visible |
| 5,000 | No incomplete-data banner; synthetic content visible | No incomplete-data banner; synthetic content visible |
| 4,999 | No incomplete-data banner; synthetic content visible | No incomplete-data banner; synthetic content visible |

Chromium desktop passed all three runs. Screenshots are stored outside tracked source at `%LOCALAPPDATA%\\NudgePay\\e2e-evidence\\pilot-5001-{accounts,messages}-truncated.png`, `%LOCALAPPDATA%\\NudgePay\\e2e-evidence\\pilot-5000-{accounts,messages}-complete.png`, and `%LOCALAPPDATA%\\NudgePay\\e2e-evidence\\pilot-4999-{accounts,messages}-complete.png`.

The initial 5,001-row Accounts run logged `presence read failed (degrading to no presence): URI too long`; the list still rendered its explicit incomplete state. The presence reader was then fixed to batch large case-ID sets. A repeated 4,999-row real-login render passed without that warning, with complete-state content intact. This closes the reproduced local URI-length failure, while leaving staging/browser-matrix/capacity qualification outstanding.
