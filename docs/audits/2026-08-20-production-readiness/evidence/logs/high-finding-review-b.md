# Independent HIGH-finding review B

Second-review pass for the HIGH-severity findings at odd zero-based indexes in
the lexicographically sorted HIGH finding ID list from `findings.json`. I used
the ledger reproduction text, current candidate source, and retained audit
evidence only. No provider, destructive, or live staging tests were run.

Verdict meanings: `PASS` means the written finding is independently supported
as open by current source/evidence; `FAIL` means current source contradicts the
finding; `BLOCKED` means the claim requires unavailable environment or hosted
configuration evidence.

Reviewed: 28 findings — PASS 27, FAIL 0, BLOCKED 1.

| Sorted index | Finding | Verdict | Independent support |
|---:|---|---|---|
| 1 | `NP-AUD-2026-002` | PASS | `app/routes/signup.tsx:39-41` returns the confirmation state without the `headers` from `createSupabaseUserClient`; route registry has no `/auth/confirm`. `auth-flow.server.ts` documents confirmation-enabled production behavior. |
| 3 | `NP-AUD-2026-004` | PASS | `twilio-messaging.server.ts:196-197,211` returns `{ matched:false, optOut:false }` when routing/customer matching fails; `webhooks.twilio.inbound.tsx:34` returns empty TwiML 200. STOP handling occurs only after a match. |
| 5 | `NP-AUD-2026-006` | PASS | `qbo-connection.server.ts:26-45` refreshes a connected row but has no failure transition to `disconnected`; `storeConnection` only writes `connected`, while explicit disconnect is the other status path. |
| 7 | `NP-AUD-2026-007-TRUNCATION` | PASS | `supabase/config.toml:18` sets `max_rows = 1000`; `case-queue.server.ts:137-147` and `case-lifecycle.server.ts:10-24` issue unbounded list reads and do not detect pagination/truncation. |
| 9 | `NP-AUD-2026-009` | PASS | `netlify/_redirects:5-10` and `docs/intuit-production-checklist.md:5-14` still contain `WORKER_PROD_URL_PLACEHOLDER`, so public compliance URLs are not deployable as written. |
| 11 | `NP-AUD-2026-011` | PASS | `api.sms-consent.tsx:44-49` directly toggles `customers.sms_consent`; there is no provenance/source/timestamp field in this path. `twilio-messaging.server.ts:214-216` treats STOP as a boolean toggle and START can restore it. |
| 13 | `NP-AUD-2026-013` | PASS | `app/lib/email-settings.ts:2,29-39` performs only an RFC-lite address check and explicitly calls domain verification an operator concern; `email-client.server.ts` sends through the single configured Resend API key. |
| 15 | `NP-AUD-2026-015` | PASS | `case-queue.server.ts:131-147` destructures only `data` from the invoice/case reads. Query errors are not retained or thrown, allowing empty arrays and healthy-looking derived metrics. |
| 17 | `NP-AUD-2026-016-TEST-ENV` | PASS | `tests/global-setup.ts:13-23` unconditionally reads `../.env.test`; `package.json` has no test script or checked-in `.env.test.example`. Retained build/test evidence records Vitest collection failure before tests ran. |
| 19 | `NP-AUD-2026-022-AUTH-CSRF` | PASS | `app/lib/csrf.server.ts` is called by `requireUser` in `session.server.ts:26`, but `login.tsx:24-29` and `signup.tsx:26-31` use `createSupabaseUserClient` directly and never call `requireSameOrigin`. |
| 21 | `NP-AUD-2026-027` | PASS | `qbo-connection.server.ts:8-15` upserts on `org_id`, replacing `realm_id` and encrypted tokens without purging or reconciling prior-book facts. |
| 23 | `NP-AUD-2026-030` | PASS | `qbo-sync.server.ts` CDC/webhook paths map and upsert returned entities; deleted/unreadable customer/invoice entities return without a local delete/void transition (`applyCustomerWebhook:239-241`, `applyInvoiceWebhook:250-263`). |
| 25 | `NP-AUD-2026-033-POSTAL` | PASS | `email-settings.ts:27-39` accepts an empty postal address; `email-messaging.server.ts:53-58` appends the address only when non-empty. No List-Unsubscribe header is present in the email client. |
| 27 | `NP-AUD-2026-035-EMAIL-RATE` | PASS | `api.email.send.tsx` and `email-messaging.server.ts:19-68` have no rate-limit or request-id/idempotency check before calling `sendEmail`; `email-client.server.ts` performs a direct provider POST. |
| 29 | `NP-AUD-2026-036-INVITE-TOKEN` | PASS | `0003_invites.sql:1-14` exposes the full `invites` row to members via `invites_select`, including `token`; `0032_security_hardening.sql:22-25` replaces write policy only and leaves member SELECT. |
| 31 | `NP-AUD-2026-036-QBO-TOKEN` | PASS | `0001_tenancy_schema.sql:98-110` stores encrypted token columns in `qbo_connections`; `0032_security_hardening.sql:29-33` grants members SELECT on the entire row, with no column-level protection. |
| 33 | `NP-AUD-2026-039` | PASS | `workers/app.ts:14-39` returns the React Router handler directly and adds no CSP, HSTS, XFO, Referrer-Policy, Permissions-Policy, or X-Content-Type-Options headers. |
| 35 | `NP-AUD-2026-046-FLOAT-MONEY` | PASS | `app/lib/promises.ts:23-36` converts amounts to JavaScript numbers and compares `baselineBalance - currentLinkedBalance` against `promisedAmount`, retaining floating-point currency arithmetic. |
| 37 | `NP-AUD-2026-052-CONSENT-TOGGLE` | PASS | `api.sms-consent.tsx:44-49` accepts a staff-provided boolean and updates `sms_consent` without requiring STOP/START evidence or any provenance record. |
| 39 | `NP-AUD-2026-053-CONTRAST` | PASS | `app/app.css:12,23` defines copper `#cf8136` and muted `#5b6474`; calculated contrast is approximately 3.02:1 against `#fffdf9` and 2.76:1 against `#16202b`, below normal-text WCAG AA 4.5:1. |
| 41 | `NP-AUD-2026-121` | PASS | `app/lib/sms-templates.ts:23-54` starter SMS bodies contain no STOP/opt-out language, and there is no template/send-path enforcement that appends it. |
| 43 | `NP-AUD-2026-135` | BLOCKED | The retained July finding and `AGENTS.md` describe legacy anon-key rotation as pending, but rotation state is hosted Supabase configuration and no current production project/configuration access is available. Source inspection cannot prove rotated/not rotated. |
| 45 | `NP-AUD-2026-140` | PASS | `twilio-messaging.server.ts:38-40` defines `normalizePhone` as digits followed by `.slice(-10)`, and inbound matching compares that lossy value at lines 206-210. |
| 47 | `NP-AUD-2026-144` | PASS | `FocusCard.tsx:126-132` enables Log call without a DNC/contact-block guard; `focus.tsx:367-384` mounts `LogCallMiniForm`; `api.contact-logs.tsx` and `next-step.server.ts` do not reject terminal `do_not_contact` before recording/applying the next step. |
| 49 | `NP-AUD-2026-D02` | PASS | `app/routes/healthz.tsx:5-11` always returns `Response.json({ ok: true })` with no configuration, Supabase, or readiness check; `render.yaml` uses it as `healthCheckPath`. |
| 51 | `NP-AUD-2026-D04` | PASS | `server.js:54` implements `waitUntil` as `void Promise.resolve(p).catch(console.error)`, with no pending-work registry, shutdown drain, or durable queue handoff. |
| 53 | `NP-AUD-2026-D06` | PASS | Existing release/build evidence records Vitest blocked by missing `.env.test`, Docker/local Supabase unavailable, and no authenticated in-app Browser/provider/staging evidence. The supplemental standalone public-page screenshots do not satisfy those mandatory gates. |
| 55 | `NP-AUD-2026-X228` | PASS | The cited wave card records that tests cover pure helpers rather than route actions. Current `login.tsx`, `signup.tsx`, `onboarding.tsx`, and `accept.$token.tsx` remain unrepresented by route-action tests, so green unit coverage can miss the listed CSRF/duplicate-org/invite mismatch cases. |

## Review conclusion

The assigned pass independently supports 27 open HIGH findings. The one
configuration-only legacy key finding remains BLOCKED, not cleared. No assigned
finding is contradicted by current source, and none can be closed from this
review alone.
