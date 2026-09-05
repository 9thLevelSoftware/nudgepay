# NudgePay

React Router 7 SSR app on Cloudflare Workers (primary) with an optional Node/Render target. Backed by Supabase (Postgres + Auth + RLS).

Active development is this directory (`nudgepay-app/`). Do not deploy the deprecated `nudgepay-frontend/` or `nudgepay-backend/` prototypes.

## Local development

```bash
npm install
npx supabase start
npm run dev
```

The dev server is at `http://localhost:5173`. Local Supabase API is `http://127.0.0.1:54321`.

### Tests

```bash
# Pure unit tests — no Docker, no .env.test
npm run test:unit

# Full suite (needs local Supabase)
cp .env.test.example .env.test
npx supabase start
npx vitest run          # or: npm test

# Browser smoke (starts `npm run dev`)
npx playwright install chromium
npm run test:e2e
```

`.env.test` is gitignored. Copy it from `.env.test.example` (local-demo JWT keys from `npx supabase status`).

Integration tests share one local database and run serially. `tests/global-setup.ts` truncates test data before the suite.

GitHub Actions PR CI runs four jobs:

1. `npm run typecheck` and `npm run test:unit` (no Docker)
2. `npm run check` (tsc + production build + Wrangler dry-run)
3. `npx supabase start` then `npx vitest run` (RLS, migrations, QBO/Twilio fakes)
4. Playwright smoke against `/healthz`, `/login`, and `/signup`

A green PR is not real-provider or staging proof. No coverage thresholds.

### Typecheck and production dry-run

```bash
npm run typecheck
npm run check           # tsc + build + wrangler deploy --dry-run
```

## Deploy

Cloudflare Workers is production and owns both cron schedules (`wrangler.toml`).

```bash
npx wrangler secret put <NAME> --env=""
npx wrangler secret put <NAME> --env production
npm run deploy
npm run deploy:staging
```

`npm run deploy` strips `build/server/.dev.vars` so local Supabase keys are not
uploaded, then enables Cloudflare's platform query-string redaction and reads
the setting back. The live Worker is `nudgepay-app` on
`nudgepay.9thlevelsoftware.com`. Staging is `nudgepay-app-staging` on
workers.dev. Cloudflare Workers Builds must use `npm run deploy` as its deploy
command; direct `npx wrangler deploy` does not perform the post-upload check.
Keep non-production branch builds disabled until their upload command has an
equivalent post-upload verifier.

Design-partner limits, `/readyz` provider flags, and operator paging: [`docs/pilot-ops.md`](../docs/pilot-ops.md).

Enabling workspace email also requires `RESEND_ALLOWED_FROM` (comma-separated verified From addresses; `email` or `orgId:email` to bind a sender to one workspace). Enabling email fails closed if it is unset or empty.

Render (`render.yaml`) is a secondary Node target. It is not a production webhook failover on the free plan.

## Layout

```
app/lib/           Pure modules (*.ts) and server I/O (*.server.ts)
app/components/    UI only
app/routes/        Route modules + API actions
workers/app.ts     Worker fetch + scheduled handlers
supabase/migrations/
tests/
```

See the repo-root `AGENTS.md` for module conventions, RLS rules, and the ViewId/OrgConfig patterns.
