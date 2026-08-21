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
```

`.env.test` is gitignored. Copy it from `.env.test.example` (local-demo JWT keys from `npx supabase status`).

Integration tests share one local database and run serially. `tests/global-setup.ts` truncates test data before the suite.

### Typecheck and production dry-run

```bash
npm run typecheck
npm run check           # tsc + build + wrangler deploy --dry-run
```

## Deploy

Cloudflare Workers is production and owns both cron schedules (`wrangler.toml`).

```bash
npx wrangler secret put <NAME> --env production
npm run deploy
```

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
