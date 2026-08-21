# NudgePay production-readiness audit — executive summary

- **Date:** 2026-08-20
- **HEAD:** `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc` (2026-07-28, PR #43 QBO OAuth user-bind)
- **App:** `nudgepay-app/` at that SHA
- **Prior seed:** `docs/codebase-audit-2026-07-13.md` (107 findings) — **re-verified, not copied**
- **Product code changed by this run:** none
- **Live browser e2e:** blocked (no Docker, no `.env.test`, no local Supabase). Public Netlify URLs were hit. Typecheck and `npm run check` ran.

---

## Dual-bar verdict

| Bar | Verdict | Why |
|---|---|---|
| **Managed production** (one operator-run tenant, Chancey-scale) | **NO-GO** | CAN-SPAM unsubscribe can be silently undone by staff (`NP-2026-003`). Inbound STOP can be dropped with HTTP 200 (`NP-2026-004`). Production Worker URL and secrets are still placeholders (`NP-2026-008`, `NP-2026-009`). A dead QuickBooks connection stays green (`NP-2026-006`). First connect never backfills (`NP-2026-005`). A terminated employee cannot be removed (`NP-2026-010`). Intuit `/privacy` and `/eula` on the legacy domain 404. |
| **Public SaaS** | **NO-GO** | Everything in the managed bar, plus: no password reset, no email-confirm landing, shared Twilio sender, unverified From on a shared Resend key, inbound email mapper cannot work, no org switcher, 1,000-row truncation that auto-resolves live cases, no CI, React Router 7.9.6 HIGH CVEs, JS-readable 400-day session cookies. |

The collections core (queue → contact → promise → payment-validated broken detection → gated SMS/email) is real and heavily unit-tested. This is not a prototype. It is also not configured or legally safe to run in production as of this HEAD.

---

## Objective signals this run

| Check | Result |
|---|---|
| `npm run typecheck` (from `nudgepay-app/`) | **pass** |
| `npm run check` (tsc + build + wrangler dry-run) | **pass** (SSR worker ~1.1 MB) |
| `npx vitest run` | **blocked** — `.env.test` missing; `package.json` has no `test` script; `globalSetup` `readFileSync`s it |
| Docker / local Supabase | **absent** in this environment |
| `https://nudgepay-ar.netlify.app/privacy` | **404** (no redirect) |
| `https://nudgepay-ar.netlify.app/eula` | **404** |
| `https://nudgepay-ar.netlify.app/` | **200**, title `NudgePay - Chancey AR` |
| `npm audit` | **16** issues (13 high), including `react-router@7.9.6` XSS/RCE/CSRF/DoS |
| `.github/` CI | **missing** |
| Legacy `nudgepay-frontend/` / `-backend/` | **absent** from tree (README still lists them) |
| July 13 findings | **104 still-open, 3 partial, 0 fixed** |

---

## Counts (de-duplicated catalog)

| Severity | Count | Notes |
|---|---|---|
| Blocker | 16 | 12 July 13 blockers reconfirmed + 4 promotions (offboarding, consent provenance, swallowed errors as data-honesty, tests/CI as release process) |
| Major | 42 | Includes new: cookie flags, RR CVEs, postal unenforced, login CSRF, invite-token SELECT, QBO ciphertext readable by members |
| Minor | 58 | July 13 minors minus the 2 partials that were split; plus a few new polish items |
| **Prior IDs with a disposition** | **107 / 107** | `02-id-index.md` |

Exact NP IDs live in `01-findings.md` and `02-id-index.md`. Wave notes (raw, longer) are under `wave-*/`.

---

## Top 15 (fix these first)

| ID | Sev | Bars | Title |
|---|---|---|---|
| [NP-2026-003](01-findings.md#np-2026-003) | blocker | P0-managed | Account-profile Save preferences wipes `do_not_email` (CAN-SPAM) |
| [NP-2026-004](01-findings.md#np-2026-004) | blocker | P0-managed | Unmatched inbound SMS, including STOP, is dropped with HTTP 200 |
| [NP-2026-011](01-findings.md#np-2026-011) | blocker | P0-managed | `sms_consent` has no provenance; UI one-click reverses STOP |
| [NP-2026-008](01-findings.md#np-2026-008) | blocker | P0-managed | Production `SUPABASE_URL` is a placeholder; secrets unset |
| [NP-2026-009](01-findings.md#np-2026-009) | blocker | P0-managed | Netlify `/privacy` `/eula` 404; Intuit checklist still TODO |
| [NP-2026-005](01-findings.md#np-2026-005) | blocker | P0-managed | QBO OAuth callback never runs the overdue backfill |
| [NP-2026-006](01-findings.md#np-2026-006) | blocker | P0-managed | Dead QBO token still shows Connected |
| [NP-2026-010](01-findings.md#np-2026-010) | blocker | P0-managed | No member removal / role change; memberships RLS is SELECT-only |
| [NP-2026-015](01-findings.md#np-2026-015) | blocker | P0-managed | Loader DB errors render as a healthy empty queue |
| [NP-2026-001](01-findings.md#np-2026-001) | blocker | P0-public | No password reset |
| [NP-2026-002](01-findings.md#np-2026-002) | blocker | P0-public | No `/auth/confirm`; signup drops Set-Cookie on the confirm branch |
| [NP-2026-007](01-findings.md#np-2026-007) | blocker | P0-public | 1,000-row cap + reconciliation auto-resolves live cases |
| [NP-2026-012](01-findings.md#np-2026-012) | blocker | P0-public | All tenants share one Twilio sender |
| [NP-2026-013](01-findings.md#np-2026-013) | blocker | P0-public | Unverified From on the shared Resend key |
| [NP-2026-014](01-findings.md#np-2026-014) | blocker | P0-public | Inbound email mapper cannot work against Resend |

---

## What is verified solid (do not undo)

- **Tenancy at the app layer.** Mutating `api.*` handlers pin `.eq("org_id", org.org_id)` (or equivalent) before write. No confirmed cross-tenant IDOR on those routes. RLS is on for all 23 tables.
- **CSRF on authenticated mutations.** `requireUser` → Origin-then-Referer fail-closed (`csrf.server.ts`). Login/signup/logout are the exception.
- **Open redirects.** `safeReturnTo` rejects `//`, backslash, and C0 controls. Server `returnTo` redirects go through it.
- **Webhook signatures.** QBO HMAC-SHA256, Twilio HMAC-SHA1, Resend/Svix — all timing-safe, empty-sig rejected, DB work after verify.
- **QBO token crypto.** AES-256-GCM `v1:iv:ct`, 32-byte key check. Intuit GET disconnect does **not** clear tokens. PR #43 binds `oauth_states.user_id` and the callback checks `user.id === oauthState.userId`.
- **Send-path gating (outbound).** Quiet hours, workspace SMS toggle, exception contact-block, consent, do-not-text, and do-not-email are re-checked **server-side** on customer sends (single, bulk, focus). Tenant sender overrides are **locked** (correct, given the shared number).
- **Unsubscribe HMAC.** GET is confirm-only; POST mutates. Prefetch-safe. Tests cover invalid tokens.
- **Promise machine.** Supersede, cancel write-order, business-day grace, payment via balance-delta. Cancel API exists (dashboard uses it; `/promises` page does not).
- **No `dangerouslySetInnerHTML`.** Notes/templates/SMS bodies render as text.
- **Typecheck + production build dry-run pass** at this HEAD.

---

## Coverage this run actually achieved

| Wave | What ran | Gap |
|---|---|---|
| 0 | HEAD freeze, live surface map, every July 13 ID re-read | — |
| 1 | Auth, RLS, QBO, cases/focus/promises, SMS, email, settings/UX/ops, tests/mutations | Code-only |
| 2 | Static walk of W1–W12 via loaders/actions/components | **No authenticated browser.** Public Netlify hit. |
| 3 | Headers, CSRF, cookies, IDOR matrix, npm audit, webhook replay | No live exploit against a running app |
| 4 | Merge, de-dupe, dual-bar, fix-pass slices | Blockers re-verified in code this session (not a second live pass) |

Cells that are `not tested: no local Supabase/Docker` are **not passing**. They are listed in `04-workflow-matrix.md`.

---

## Fix-pass backlog (slices, no implementation in this run)

**Slice A — ship-or-don't (P0-managed).** `NP-2026-003`, `004`, `011`, `008`, `009`, `005`, `006`, `010`, `015`. Plus Intuit URL cutover and wrangler secrets. Without these, do not point Chancey (or Intuit review) at production.

**Slice B — account & trust.** `001` password reset, `002` confirm landing, `016` invite email, `017` org switcher or single-org guard, `018` change-password/email/delete, cookie HttpOnly/Secure.

**Slice C — messaging legal.** STOP persistence + TwiML confirm, consent provenance, STOP language on templates, List-Unsubscribe, postal required, inbound email mapper, `email.failed`/`suppressed`.

**Slice D — scale/honesty.** Paginate every unbounded PostgREST read; recon by count not set-difference; surface `truncated`; QBO query paging; loader errors must not look like $0; email-as-contact.

**Slice E — public SaaS.** Per-org SMS senders, verified From domains, rate limits, CI + `.env.test.example`, RR 7.12+, security headers, monitoring, member RLS on audit tables.

**Slice F — polish.** A11y (copper/Focus contrast, labels, reduced-motion), CSV export, USD-only gate, Focus collision, avatar menu, minors in `01-findings.md`.

A follow-up implementer should pick an NP ID, follow that card’s **Fix recipe**, add the named tests, and re-run the matching row in `04-workflow-matrix.md`.

---

## How to read the rest of this folder

| File | Use |
|---|---|
| `01-findings.md` | Canonical cards with fix recipes |
| `02-id-index.md` | NP-2026-NNN ↔ July 13 B/M/minor ↔ wave file |
| `03-surface-map.md` | Routes, tables, intents, crons as of HEAD |
| `04-workflow-matrix.md` | W1–W12 step results |
| `05-security-matrix.md` | Every mutation × auth × CSRF × owner × org pin |
| `06-ux-a11y-matrix.md` | Pages × empty/error × a11y × viewport |
| `07-ops-intuit.md` | Secrets, Netlify, Intuit, CI, npm audit |
| `08-test-coverage-gaps.md` | What Vitest covers vs what only live e2e can catch |
| `wave-*/` | Raw specialist notes (audit trail; longer than the catalog) |
