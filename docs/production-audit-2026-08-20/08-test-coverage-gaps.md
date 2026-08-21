# Test coverage vs production audit gaps

HEAD `820fb1ba`. Detail: `wave-1/tests-and-mutations.md`.

## Inventory

- **109** `tests/*.test.ts` files (plus `helpers.ts`, `fd.ts`, `global-setup.ts`).
- Roughly **59** pure unit (no I/O) and **50** integration (local Supabase).
- **Zero** Playwright/Cypress test specs. Playwright is used only by `scripts/shoot-*.mjs` and `scripts/demo-record*.mjs`.
- `vitest.config.ts`: `fileParallelism: false` (shared DB); `globalSetup` always loads `.env.test`.

## What the suite actually hits

Strong: priority, cases/exceptions, promises, comm-prefs parsers, SMS/email **gates**, webhook **signature reject**, unsubscribe GET vs POST, RLS on a subset of tables, OAuth state consume, org-config, templates resolve, quiet hours math, bulk eligibility partition.

Weak / missing (fix pass should add — also named on finding cards):

| Gap | Why it matters | Add with |
|---|---|---|
| No `action()` test for `api.comm-prefs` missing `do_not_email` | Locks in CAN-SPAM wipe today | NP-2026-003 |
| No callback test that sync is invoked | First-run empty | NP-2026-005 |
| No recon test with >1000 overdue invoices | Destructive B2 | NP-2026-007 |
| No inbound STOP unmatched-store test (tests **assert drop**) | TCPA | NP-2026-004 |
| Few routes invoke the actual `action` (contact-logs, 3 org-settings intents, unsubscribe, webhook 401s) | `api-*` files are often RLS-only | NP-2026-016 |
| No CSRF tests on login/logout | Session swap | NP-2026-022 |
| No cookie-flag tests | HttpOnly | NP-2026-021 |
| No browser e2e | Hydration, mobile, j/k, drawers, first-run | Wave 2 not-tested rows |
| `email-events.test.ts` encodes **wrong** Resend event names | Freezes B7 | NP-2026-014 |
| No CI | PRs unguarded | NP-2026-016 |

## Behaviors only live e2e can prove

- Intuit OAuth redirect + real CDC webhook payload shape (CloudEvents comment admits unverified).
- Twilio signature against `TWILIO_PUBLIC_BASE_URL` + Messaging Service From = null routing.
- Resend `email.received` array `to` + receiving API body fetch.
- Confirmation email click (`site_url`).
- Hydration date mismatch (UTC vs org-local).
- Mobile 390px overflow, Focus hidden, avatar logout.
- Origin header from a real browser on login CSRF.

## Fix-pass test minimum (Slice A)

1. `.env.test.example` + `"test"` script + GitHub Action typecheck + unit.
2. `parseCommPrefsUpdate` / account-profile: missing field does **not** write `do_not_email: false`.
3. Inbound STOP unmatched is **persisted**.
4. Callback triggers `syncOverdueInvoices` (injected deps).
5. `getValidAccessToken` refresh 400 → status `error`.
6. Recon with truncated invoice list **does not** resolve extra cases.
7. Loader error is not empty metrics.

Do not treat a green local suite as production-ready until those exist and CI runs them.
