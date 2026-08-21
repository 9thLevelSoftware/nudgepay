# Ops, secrets, Intuit, CI

HEAD `820fb1ba`. Live: Netlify probed; Cloudflare production secrets **not** listed (no account in this environment).

## Production env (`wrangler.toml`)

| Item | State |
|---|---|
| `[env.production.vars] SUPABASE_URL` | **placeholder** `https://<your-prod-project-ref>.supabase.co` → NP-2026-008 |
| `QBO_SANDBOX` | `"false"` in production vars (correct once secrets exist) |
| Crons production | `*/30` CDC + `0 * * * *` digest (mirrored) |
| Secrets required | `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENCRYPTION_KEY`, `QBO_WEBHOOK_VERIFIER_TOKEN`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` **or** `TWILIO_FROM_NUMBER`, `TWILIO_PUBLIC_BASE_URL` |
| Secrets optional (degrade) | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `UNSUBSCRIBE_SECRET`, `APP_PUBLIC_BASE_URL` — unsubscribe page needs `UNSUBSCRIBE_SECRET` alone |

`npx wrangler secret put <NAME> --env production` for each. Then replace the SUPABASE_URL placeholder.

## Intuit checklist (`docs/intuit-production-checklist.md`)

Every URL is still `WORKER_PROD_URL_PLACEHOLDER`. **Not started.**

| Field | Required | This run |
|---|---|---|
| Privacy Policy URL | Worker `/privacy` | Worker route exists; Netlify host **404** |
| EULA URL | Worker `/eula` | same |
| Launch URL | `/dashboard` | — |
| Disconnect URL | `/api/qbo/disconnect` (GET landing, no mutate — solid) | — |
| Redirect URI | `/auth/qbo/callback` exact match | — |
| Webhook | `/webhooks/qbo` Invoice, Customer, Payment, CreditMemo | — |

**Live:** `https://nudgepay-ar.netlify.app/privacy` 404, `/eula` 404, `/` 200 title `NudgePay - Chancey AR`.

Fix: `netlify/_redirects` real origin; `netlify deploy --prod --dir netlify`; submit Worker URLs in the Intuit portal (NP-2026-009).

## CI / tests

| Item | State | ID |
|---|---|---|
| `.github/` | missing | NP-2026-016 |
| `package.json` `"test"` | missing | NP-2026-016 |
| `.env.test` | missing (required by `tests/global-setup.ts`) | NP-2026-016 |
| `nudgepay-app/README.md` | Cloudflare starter; `"publish": true` | NP-2026-132 |
| Root README | 24 migrations, lists deleted frontend/backend | NP-2026-132 |
| AGENTS.md | migrations 0001–0024 (disk 0034); table `orgs` | NP-2026-132 |
| LICENSE | none | NP-2026-133 |
| Monitoring | `console.error` only | NP-2026-042 |
| Security headers | none | NP-2026-039 |
| Retention cron | none | NP-2026-120 |

This run: `npm run typecheck` **pass**; `npm run check` **pass**.

## npm audit (nudgepay-app, after local install)

16 vulnerabilities (2 low, 1 moderate, **13 high**). Highest product impact: **`react-router@7.9.6`** (XSS, CSRF, turbo-stream RCE, DoS) → NP-2026-040. Also: nanoid, postcss, vite, ws, undici, brace-expansion, sharp, esbuild (Windows), @babel/core.

Fix: upgrade RR to ≥ 7.12 / 7.18.x, then audit remaining toolchain. Do not `npm audit fix --force` as the only step.

## Headers / Worker

`workers/app.ts` returns the React Router response unmodified. No CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy (NP-2026-039).

## Legacy

- `nudgepay-frontend/` / `nudgepay-backend/`: **absent** from tree.
- Git history still contains a hardcoded anon key (`AGENTS.md:98`) → rotate (NP-2026-135).

## This environment’s limits (not product bugs)

- No Docker → no `supabase start` → no Vitest integration, no authenticated Playwright.
- No Cloudflare account in-session → cannot `wrangler secret list --env production`.
- `node_modules/` was installed locally for typecheck; do not commit.
