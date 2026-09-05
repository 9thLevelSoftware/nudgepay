# Pilot qualification record — 2026-09-05

## Scope and safety controls

Integration-test cleanup can only target `http://127.0.0.1:54321` or
`http://[::1]:54321`. The guard rejects hosted URLs, `localhost`, credentials
embedded in URLs, paths, query strings, fragments, non-HTTP schemes, and every
port other than `54321`. The guard also requires both local Supabase keys before
the setup can truncate tables or delete test users.

`scripts/pilot-load.mjs` is an authenticated, read-only qualification tool. It
only requests `/dashboard`, `/accounts`, `/promises`, and `/messages` with GET.
It requires an exact HTTPS origin in `PILOT_LOAD_ALLOWED_ORIGINS`, rejects the
production hostname `nudgepay.9thlevelsoftware.com`, reads cookie contexts from
an external file, and never emits those cookies in logs or its report. It uses
manual redirects and requires the authenticated application shell's main-content
marker, so login redirects, login pages, blank HTML, and unexpected
status/content responses are errors. It accepts only safe bounded values:
duration is 1–86,400 seconds, concurrency is 1–50, and timeouts are
100–120,000 ms. A run fails qualification at p95 ≥ 2,000 ms or error rate ≥
1%; individual errors below that rate are reported but do not by themselves
fail the threshold outcome.

The default `diagnostic` profile is a small smoke: 30 seconds, concurrency 1,
and a 10-second request timeout. It is diagnostic evidence only, never a pilot
qualification. The explicit `pilot` profile runs for at least 3,600 seconds at
concurrency 50. It requires exactly 50 uniquely labeled session contexts, five
sessions for each of ten opaque workspace labels, an operator-declared fixture
manifest for 10 workspaces/50 users, and one successful request for every route
× expected-session pair. Each workspace must carry every configured 4,999–5,001
boundary dataset; aggregate totals therefore sum to ten times those sizes. Those
labels and manifest validate fixture scope;
they do not prove a server selected the claimed workspace. The authenticated
HTML and route response checks remain the server-side evidence recorded by the
runner.

The default report path is a user temporary directory outside the repository.
It contains request counts, per-route totals, actual observed/successful session
counts, error rate, p50/p95 latency, and a capped redacted failure list. Metrics
use a bounded histogram and retain at most 100 failures, so 24-hour use does
not grow memory with request count. Nothing in this repository invokes long
hosted traffic automatically.

## Operator commands

Create a cookie fixture outside the repository. It may contain a raw `Cookie`
header value for a single session, JSON such as `{ "cookie": "session=..." }`,
or `{ "cookies": ["session=a", "session=b"] }` for up to 50 distinct session
contexts. These legacy forms are diagnostic-only. The JSON shape is intentionally
strict. A staging pilot fixture uses `nudgepay-pilot-session-fixture/v1` with
`localOnly: false` and `source: { "kind": "staging-pilot-fixture", "origin":
"https://the-exact-allowed-staging-origin", ... }`; the origin must equal the
runner's `--origin`. It declares its prefix and dataset totals, and supplies
`sessions: [{ "session": "pilot-session-01", "workspace":
"pilot-workspace-01", "cookie": "..." }]`. The report never includes cookie
values. Restrict fixture permissions because it is an authenticated credential.

```powershell
$env:PILOT_LOAD_ALLOWED_ORIGINS = "https://staging.example.invalid"
node scripts/pilot-load.mjs --origin https://staging.example.invalid --cookie-file C:\secure\nudgepay-pilot-cookie.txt --dry-run

# Short authenticated smoke; writes a JSON artifact under the user temp directory.
node scripts/pilot-load.mjs --origin https://staging.example.invalid --cookie-file C:\secure\nudgepay-pilot-cookie.txt

# 60-minute pilot qualification: requires the 50-session staging envelope.
node scripts/pilot-load.mjs --profile pilot --origin https://staging.example.invalid --cookie-file C:\secure\nudgepay-pilot-cookie.txt --duration-seconds 3600 --concurrency 50 --output C:\qualification\pilot-60m.json

# 24-hour diagnostic soak: records behavior but never qualifies the pilot profile.
node scripts/pilot-load.mjs --profile diagnostic --origin https://staging.example.invalid --cookie-file C:\secure\nudgepay-pilot-cookie.txt --duration-seconds 86400 --concurrency 1 --output C:\qualification\diagnostic-24h.json
```

The local seeder's labeled cookie artifact is intentionally `localOnly: true`
and is rejected by the staging pilot profile. After staging isolation is in
place, seed only synthetic staging data, issue 50 synthetic staging sessions,
and write a separate mode-`0600` staging envelope using the template above and
the exact allowlisted staging origin. Do not copy local cookies, credentials, or
provenance into that artifact. Do not treat a declared label or manifest as a
substitute for authenticated route evidence.

## Evidence recorded in this change

Completed locally: static guard and metric tests; CLI help and production-origin
rejection. No authenticated staging traffic, 60-minute qualification,
24-hour diagnostic soak, or provider qualification was run as part of this
change. Those require a real isolated staging origin and synthetic staging sessions.
