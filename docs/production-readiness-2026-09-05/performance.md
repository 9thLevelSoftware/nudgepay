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

Reruns delete only the known fixture organization UUIDs and the fifty exact `pilot-load-20260905-...@local.invalid` auth users, then rebuild them. Public data outside those identities is not selected, modified, truncated, or reset. The fixture gives every synthetic customer an invoice/case/message relationship where that dataset is present; message history includes both inbound and outbound SMS ledger rows but triggers no provider send.

The credentials artifact is intentionally outside the repository and is written mode `0600`. It contains local synthetic passwords for all fifty users. Add `--sessions 50 --cookie-file C:\secure\nudgepay-pilot-local-cookies.json` only when a local browser/app session test needs them; it signs into the validated local Supabase target through the same `@supabase/ssr` server-cookie path used by the app and adds the corresponding local organization cookie. The separate mode-`0600` cookie file uses `nudgepay-pilot-session-fixture/v1`: a local-only provenance manifest with the exact per-workspace dataset counts, opaque `pilot-session-01` through `pilot-session-50` labels, and five sessions for each `pilot-workspace-01` through `pilot-workspace-10`. Credentials and tokens are never printed. Dry runs never create auth tokens.

The existing `scripts/pilot-load.mjs` remains a separate HTTPS staging, read-only runner. Its cookie artifact accepts a raw Cookie header or `{ "cookie": "..." }` / `{ "cookies": ["..."] }`, with one to fifty distinct contexts for diagnostics. The local fixture artifact is deliberately labeled local and is rejected by the staging pilot profile. A staging qualification needs a dedicated isolated staging deployment, an approved traffic window, synthetic staging data, and independently issued staging session fixtures whose `staging-pilot-fixture` provenance is bound to the exact runner origin.

No query `EXPLAIN`, loader timing, concurrency result, index recommendation, or capacity result is recorded here. Capture those only during the QA-owned local database window with the exact selected dataset sizes, record the command/context and raw result location, and keep any resulting optimization proposal separate from this fixture contract.
