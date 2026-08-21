# Security matrix

HEAD `820fb1ba`. Full write-up: `wave-3/security.md` and `wave-1/tests-and-mutations.md` Part B. RLS table matrix: `wave-1/rls-tenancy.md`.

## Solid

- App-layer IDOR: mutating `api.*` binds `.eq("org_id")` (or compares form org to session org). No confirmed cross-tenant write.
- Webhook HMAC + empty-sig reject (QBO SHA256, Twilio SHA1, Resend/Svix + 5min skew).
- AES-256-GCM QBO tokens. OAuth `state` single-use + `user_id` bind (PR #43). Intuit GET disconnect does not clear tokens.
- `safeReturnTo`. `requireSameOrigin` on `requireUser` POSTs.
- No `dangerouslySetInnerHTML`.

## Mutation × controls

CSRF: `Origin` = `requireSameOrigin` via `requireUser`. Rate limit: none in-app unless noted.

| Endpoint | Method | Auth | CSRF | Owner | org_id pin | Rate | Idempotent | Notes |
|---|---|---|---|---|---|---|---|---|
| `/login` | POST | public | **none** | n/a | n/a | none | no | NP-2026-022 |
| `/signup` | POST | public | **none** | n/a | n/a | none | email unique | NP-2026-022 |
| `/logout` | POST | cookie | **none** | n/a | n/a | n/a | yes | GET loader does not sign out |
| `/onboarding` | POST | user | Origin | creates owner | new org | none | **no** | NP-2026-044; service `createOrgForUser` |
| `/invite` | POST | owner | Origin | yes | insert org | none | no | service insert; NP-2026-018, 126, 130 |
| `/accept/:token` | POST | user | Origin | n/a | via invite | none | yes | email match + expiry |
| `/auth/qbo/callback` | GET mutates | user | OAuth state | owner + user bind | state.orgId | none | single-use state | NP-2026-005 no sync |
| `/api/qbo/connect` | POST | owner | Origin | yes | state org | none | new state | |
| `/api/qbo/disconnect` | POST | owner | Origin | yes | session org | none | yes | GET = landing only (solid) |
| `/api/qbo/refresh` | POST | owner | Origin | yes | session org | none | no | |
| `/api/contact-logs` | POST | member | Origin | no | pre-load | none | no | |
| `/api/assign` | POST | member | Origin | no | pre-load | none | yes | |
| `/api/bulk-assign` | POST | member | Origin | no | in() org | batch clamp | no | |
| `/api/account-notes` | POST | member | Origin | no | pre-load | none | yes | |
| `/api/sms-consent` | POST | member | Origin | no | pre-load | none | no | NP-2026-011 |
| `/api/comm-prefs` | POST | member | Origin | no | pre-load | none | no | **NP-2026-003** |
| `/api/priority-override` | POST | member | Origin | no | pre-load | none | yes | |
| `/api/org-settings` | POST | **owner** | Origin | yes | session org | none | per intent | 14 intents |
| `/api/promises/cancel` | POST | member | Origin | no | lib org pin | none | yes | |
| `/api/text/send` | POST | member | Origin | no | send path | **none** | **none** | NP-2026-035 |
| `/api/email/send` | POST | member | Origin | no | send path | **none** | **none** | |
| `/api/bulk-sms` | POST | member | Origin | no | cases org | batch clamp | none | |
| `/api/test-message` | POST | **owner** | Origin | yes | session org | **none** | none | no consent; NP-2026-052 |
| `/api/profile` | POST | user | Origin | n/a | self | none | yes | display_name only |
| `/api/notification-prefs` | POST | user | Origin | n/a | form org == session | none | yes | |
| `/api/sync-errors/dismiss` | POST | member | Origin | no | update eq org+id | none | yes | no pre-select |
| `/api/presence/heartbeat` | POST | member | Origin | no | upsert org + composite FK | none | yes | |
| `/webhooks/qbo` | POST | HMAC | HMAC | n/a | realm → org | none | upsert | NP-2026-031 sync-before-200 |
| `/webhooks/twilio/inbound` | POST | HMAC | HMAC | n/a | last-10 match | none | inbound SID unique | **NP-2026-004** |
| `/webhooks/twilio/status` | POST | HMAC | HMAC | n/a | SID | none | last write | no replay window |
| `/webhooks/resend` | POST | svix | svix | n/a | message id | none | provider id unique | NP-2026-014 inbound |
| `/unsubscribe` | POST | HMAC token | token | n/a | token claims | none | yes | GET does not mutate |

## RLS hotspots (not IDOR, still findings)

| Issue | ID |
|---|---|
| Member FOR ALL DELETE on contact_logs, text_messages, cases, promises | NP-2026-036 |
| Members SELECT invite `token` | NP-2026-036 |
| Members SELECT qbo `*_enc` columns (if requested) | NP-2026-036 |
| Composite FKs `NOT VALID` | NP-2026-037 |
| `listUsers(1000)` service-role every dashboard load | NP-2026-038 |
| No memberships DELETE policy | NP-2026-010 |

## Headers / cookies / deps

| Issue | ID |
|---|---|
| No CSP/HSTS/XFO/nosniff/Referrer-Policy | NP-2026-039 |
| Cookies `httpOnly: false`, no `Secure`, 400d | NP-2026-021 |
| `react-router@7.9.6` HIGH CVEs | NP-2026-040 |
| Legacy anon key in git history | NP-2026-135 |
