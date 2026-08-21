# Security control matrix

Candidate: `88b9baca35be5b8d9235b2f96863150ef3a67ad1`  
Audited baseline: `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc`

This matrix rechecks the prior static security conclusions against the current
candidate and adds the Render/Express runtime. It records effective evidence,
not intended controls. The mandatory Codex Deep Security Scan is
**environment-blocked**; see `evidence/security/README.md`.

## Effective controls

| Surface | Authentication | CSRF/signature | Authorization/tenant pin | Rate/idempotency | Current evidence | Gate |
|---|---|---|---|---|---|---|
| `POST /login` | Public credentials | None | n/a | None | Current source; prior attack sketch only | blocker |
| `POST /signup` | Public credentials | None | n/a | None | Current source only | blocker |
| `POST /logout` | Session cookie | None | Self-session | None | Current source only | blocker |
| Authenticated `api.*` actions | `requireUser` / membership | Same-origin check inside `requireUser` | Most object writes pre-load or filter `org_id` | Send paths generally none | Current source plus unit tests; no authenticated browser proof | conditional |
| QBO OAuth callback | Session + single-use state | OAuth state | Owner, `org_id`, and `user_id` bind | State consumed once | Source and unit tests; no sandbox run | blocker |
| QBO webhook | HMAC | Provider HMAC | Realm-to-org lookup | Upserts; no durable event replay ledger | Source/unit fixtures only | blocker |
| Twilio inbound/status | Provider HMAC | Twilio signature | Inbound inference or provider SID | Inbound SID unique; status can rewind | Source/unit fixtures only | blocker |
| Resend webhook | Svix signature and timestamp | Provider signature | Provider/message/from mapping | No durable event-id ledger | Source/unit fixtures only | blocker |
| `/unsubscribe` | HMAC bearer token | Token capability | Token pins org and customer | Repeated opt-out is idempotent | Source/unit tests; provider flow unverified | blocker |
| Cloudflare Worker entry | Platform boundary | Request URL supplies CSRF origin | Shared React Router load context | `waitUntil` is platform-managed | Build/static only | blocker |
| Render/Express entry | Public service behind proxy | Request URL is built from trusted forwarded protocol and host | Shared React Router load context | `waitUntil` shim only catches and logs rejection | Static + local rehearsal only | blocker |
| `/healthz` on both runtimes | Public | GET | n/a | n/a | Returns only `{ "ok": true }`; no dependency/config readiness | blocker |

## Database and RLS controls

| Control | Current source result | Effective verification | Gate |
|---|---|---|---|
| RLS enabled on public tables | Present in migrations through `0034` | Static only until an empty local reset and role CRUD matrix run | blocker |
| Anonymous access | No intended anon table policies | Not exercised against PostgREST | blocker |
| Cross-org row reads/writes | App actions usually add `org_id`; RLS policies exist | Prior tests are not a complete CRUD matrix | blocker |
| Composite tenant foreign keys | Added in `0032` | New writes are constrained in tests; historical constraints remain `NOT VALID` | blocker |
| Invite bearer-token visibility | Member `SELECT` can retrieve token columns | Static confirmation; no live JWT reproduction this run | blocker |
| QBO ciphertext visibility | Member `SELECT` can retrieve encrypted token columns | Static confirmation; no live JWT reproduction this run | blocker |
| Append-only ledgers | Member `FOR ALL` remains on contact/SMS/case/promise tables | Static confirmation; DELETE/UPDATE matrix not run | blocker |
| Service-role scoping | Several paths are explicitly org-scoped; prior id-only status/update paths remain | Static inventory only | blocker |
| Roster >1,000 auth users | `listUsers(1000)` remains the lookup shape | No scale fixture or exposure test | blocker |
| Email sender routing | Normalized global uniqueness is absent | No two-tenant collision test | blocker |

## Current candidate runtime findings

### Forwarded origin trust is not bounded

`server.js:20` sets `trust proxy` to `true`. `@react-router/express` 7.9.6
constructs the web `Request` from `req.protocol`, `req.hostname`, and forwarded
headers. `csrf.server.ts` then compares the browser `Origin` to that constructed
origin. The candidate contains no trusted-hop or explicit-host allowlist. Whether
Render overwrites hostile `X-Forwarded-Host` and `X-Forwarded-Proto` values was
not proven in staging, so the CSRF trust boundary is environment-blocked.

### The readiness probe can approve an unusable deployment

`app/routes/healthz.tsx:6-8` returns 200 with `{ ok: true }` without validating
required Supabase configuration or connectivity. Render recommends an
operation-critical check such as a small database query for application-level
readiness. A release with missing secrets or an unreachable database can pass
the configured `healthCheckPath` and receive traffic.

### Free Render service is not callback-safe production capacity

`render.yaml` declares `plan: free`. Render states that free web services are
not for production, sleep after 15 minutes idle, and can take about one minute
to wake. That latency and restart behavior has not been accepted by QBO,
Twilio, or Resend callback tests. The configuration is acceptable only as a
non-production experiment until a paid, monitored staging/failover service is
proven.

### Background work has no shutdown drain

The Node `waitUntil` shim in `server.js:54` observes rejection with
`console.error`, but it does not track pending work, expose failures to
monitoring, or drain promises on `SIGTERM`. Render sends `SIGTERM` during
deploys and can restart free instances. Callback acknowledgement followed by a
restart can therefore lose required work unless downstream persistence and
replay are proven.

## Required adversarial cases still missing

- Authenticated cross-tenant CRUD for every table and view.
- Host/forwarded-header injection on the deployed Render proxy.
- Login, signup, logout, session-swap, and authenticated mutation CSRF on both runtimes.
- Webhook replay, status regression, parser abuse, oversized body, and timeout tests.
- Service-role ID collision and cross-org substitution tests.
- Provider event-id persistence and monotonic status transitions.
- Deep Security Scan canonical artifacts.

No row above is treated as provider-, browser-, or staging-verified.

