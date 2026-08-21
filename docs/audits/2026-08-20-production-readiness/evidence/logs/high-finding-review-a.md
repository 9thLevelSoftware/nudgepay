# Independent high-finding review A

Second-reviewer static review of the assigned high-severity findings. Review was
performed from the written reproduction, current candidate source, and existing
audit evidence. No provider, destructive, authenticated live, or database tests
were run. `PASS` means the open finding is independently supported; it does not
mean the product behavior passes.

Sorted high-finding population: 56. Assignment rule: zero-based sorted index is
even. Assigned total: 28. Results: 28 PASS, 0 FAIL, 0 BLOCKED.

| Sorted index | Finding | Result | Independent source/evidence check |
|---:|---|---|---|
| 0 | NP-AUD-2026-001 | PASS | `app/routes.ts` has no recovery route and `app/routes/login.tsx` contains only email/password sign-in; no `resetPasswordForEmail` appears under `app/`. |
| 2 | NP-AUD-2026-003 | PASS | `AccountProfile.tsx:125-140` submits only call/text preferences; `api.comm-prefs.tsx:20-22` derives omitted `do_not_email` as false, while the account loader does not select that field. |
| 4 | NP-AUD-2026-005 | PASS | `auth.qbo.callback.tsx:32-34` stores the connection and redirects to `?qbo=connected`; `syncOverdueInvoices` is called by `api.qbo.refresh.tsx`, not the callback. |
| 6 | NP-AUD-2026-007-RECONCILIATION | PASS | `supabase/config.toml:18` sets `max_rows = 1000`; `case-lifecycle.server.ts:10-30` performs unbounded invoice/open-case reads and reconciles based on the returned overdue set. |
| 8 | NP-AUD-2026-008 | PASS | `wrangler.toml:26` still contains `https://<your-prod-project-ref>.supabase.co`; the release manifest records that production secret/config access was unavailable. |
| 10 | NP-AUD-2026-010 | PASS | `0002_rls_policies.sql:23-24` defines only `mem_select`; repository routes contain no member removal, role-change, or leave-org mutation. |
| 12 | NP-AUD-2026-012 | PASS | `twilio-messaging.server.ts:42-52` always returns the environment default sender; `api.org-settings.tsx` rejects sender changes. |
| 14 | NP-AUD-2026-014 | PASS | `email-events.ts:40-43` handles `inbound.email.received`/`email.inbound` and coerces `d.to` through a string-only helper; no current provider verification exists. |
| 16 | NP-AUD-2026-016-CI | PASS | `package.json` has no `test` script or CI workflow; `tests/global-setup.ts` requires `.env.test`, and the release log records Vitest collection failure because it was absent. |
| 18 | NP-AUD-2026-021 | PASS | `supabase.server.ts:7-29` supplies no cookie options; installed `@supabase/ssr` defaults set `httpOnly: false`, omit `secure`, and use a 400-day `maxAge`. |
| 20 | NP-AUD-2026-022-LOGOUT-CSRF | PASS | `routes/logout.tsx:5-10` calls `createSupabaseUserClient` directly and never calls `requireSameOrigin`; `session.server.ts` applies that check only inside `requireUser`. |
| 22 | NP-AUD-2026-028 | PASS | `qbo-sync.server.ts:28` defines `QUERY_LIMIT = 1000`, uses `maxresults ${QUERY_LIMIT}`, and `syncOverdueInvoices` returns `truncated` without the refresh route surfacing it. |
| 24 | NP-AUD-2026-031 | PASS | `webhooks.qbo.tsx:24-76` verifies then performs connection lookup, QBO reads, database mutations, and notifications before returning; only cron paths use `waitUntil` in the runtime adapter. |
| 26 | NP-AUD-2026-033-UNSUBSCRIBE | PASS | `email-settings.ts:27-39` allows enabled email with an empty postal address; no `List-Unsubscribe` or `List-Unsubscribe-Post` header construction appears in email send code, while `unsubscribe.tsx` is a human confirmation POST flow. |
| 28 | NP-AUD-2026-035-SMS-RATE | PASS | No rate-limit or idempotency implementation appears in `api.text.send.tsx`, `api.bulk-sms.tsx`, or `twilio-messaging.server.ts`; the test-send route similarly has no destination ownership/rate ledger. |
| 30 | NP-AUD-2026-036-LEDGER-RLS | PASS | `0002_rls_policies.sql` gives `contact_logs` and `text_messages` `FOR ALL` membership policies; `0003_invites.sql:12` exposes invite rows to members and `0032_security_hardening.sql` does not replace that select policy. |
| 32 | NP-AUD-2026-037 | PASS | `0032_security_hardening.sql` adds every composite tenant FK with `NOT VALID` and contains no later `VALIDATE CONSTRAINT`; the release manifest confirms no local database was available to validate it. |
| 34 | NP-AUD-2026-040 | PASS | Current `package.json` pins `react-router`, `@react-router/express`, and `@react-router/dev` to 7.9.6; fresh `npm audit` reports 14 high vulnerabilities including the affected React Router ranges. |
| 36 | NP-AUD-2026-046-PAYMENT-SEMANTICS | PASS | `promises.ts:27-35` computes `received = max(0, baselineBalance - currentLinkedBalance)` with no payment/credit-memo type distinction; `promise-evaluation.server.ts` feeds only linked invoice balances. |
| 38 | NP-AUD-2026-052-TEST-SMS | PASS | `provider-status.ts` validates only phone syntax; `api.test-message.tsx:40-58` sends any syntactically valid destination after owner auth, without owned-destination, consent, or audit controls. |
| 40 | NP-AUD-2026-053-LABELS | PASS | Some controls have labels, but `AccountsDirectory.tsx:55-66` has a search input with placeholder only, `focus/SendTextMiniForm.tsx` has an unlabeled textarea, and the late-fee toggle has no accessible name. |
| 42 | NP-AUD-2026-122 | PASS | `twilio-messaging.server.ts:25-38,110-114` loads one org settings timezone and applies `isWithinSendWindow`; customer records provide no recipient timezone in this send gate. |
| 44 | NP-AUD-2026-139 | PASS | `twilio-messaging.server.ts:153-154,214-217` recognizes STOP/START variants only; `webhooks.twilio.inbound.tsx:34` always returns an empty TwiML response, with no HELP/INFO support response. |
| 46 | NP-AUD-2026-141 | PASS | `privacy.tsx:48-50` lists Intuit, Twilio, Supabase, and Cloudflare but not Resend; `eula.tsx` has no Resend/inbound-email disclosure. |
| 48 | NP-AUD-2026-D01 | PASS | `server.js:20` sets `app.set("trust proxy", true)` and `csrf.server.ts` derives the expected origin from the request URL; no bounded proxy or host allowlist is present in the candidate. |
| 50 | NP-AUD-2026-D03 | PASS | `render.yaml:33` declares `plan: free`; the existing runtime-parity evidence records that production callback/failover suitability was not proven. |
| 52 | NP-AUD-2026-D05 | PASS | `evidence/security/README.md` records the exact managed-filesystem-permission-profile failure and TAC connector login blocker for the mandatory deep scan. |
| 54 | NP-AUD-2026-X227 | PASS | The current evidence contains only unauthenticated public-page screenshots; no browser evidence covers login cookie flow, real-form Origin CSRF, Focus send, QBO connect, or unsubscribe confirmation. |

## Exact reviewed ID list

`NP-AUD-2026-001`, `NP-AUD-2026-003`, `NP-AUD-2026-005`,
`NP-AUD-2026-007-RECONCILIATION`, `NP-AUD-2026-008`, `NP-AUD-2026-010`,
`NP-AUD-2026-012`, `NP-AUD-2026-014`, `NP-AUD-2026-016-CI`,
`NP-AUD-2026-021`, `NP-AUD-2026-022-LOGOUT-CSRF`, `NP-AUD-2026-028`,
`NP-AUD-2026-031`, `NP-AUD-2026-033-UNSUBSCRIBE`, `NP-AUD-2026-035-SMS-RATE`,
`NP-AUD-2026-036-LEDGER-RLS`, `NP-AUD-2026-037`, `NP-AUD-2026-040`,
`NP-AUD-2026-046-PAYMENT-SEMANTICS`, `NP-AUD-2026-052-TEST-SMS`,
`NP-AUD-2026-053-LABELS`, `NP-AUD-2026-122`, `NP-AUD-2026-139`,
`NP-AUD-2026-141`, `NP-AUD-2026-D01`, `NP-AUD-2026-D03`,
`NP-AUD-2026-D05`, `NP-AUD-2026-X227`.

