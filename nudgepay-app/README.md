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

The normal release path is automated: a successful `CI` push run on `main`
triggers `Deploy staging`, which verifies all eight required CI jobs, seals one
artifact, deploys and qualifies staging, and retains artifact and staging
evidence. `Promote production` is an explicit protected dispatch that accepts
the retained staging identity, requalifies the same sealed artifact, requires
operator attestation of remaining gates, and deploys production only when the
promotion guard is enabled. See [`docs/pilot-ops.md`](../docs/pilot-ops.md) for
the operator procedure and dispatch inputs.

The commands below remain an operator fallback for controlled recovery or
diagnosis; they are not the ordinary promotion path:

```bash
npx wrangler secret put <NAME> --env=""
npx wrangler secret put <NAME> --env production

export EXPECTED_DEPLOY_SHA="<approved-clean-commit-sha>"
export STAGING_SUPABASE_URL="https://<isolated-staging-project>.supabase.co"
export RELEASE_ARTIFACT="<external-retained-directory>"
export RELEASE_RECEIPTS="<external-receipt-directory>"
npm run release:prepare -- --artifact-dir "$RELEASE_ARTIFACT"
npm run deploy:staging -- \
  --artifact-dir "$RELEASE_ARTIFACT" \
  --receipt-dir "$RELEASE_RECEIPTS" \
  --expected-manifest-sha "<recorded-manifest-sha256>" \
  --expected-config-sha "<recorded-staging-config-sha256>"
# Run release:qualify with the staging receipt and the manifest/config digests
# printed by release:prepare, then promote the same sealed directory:
npm run deploy -- \
  --artifact-dir "$RELEASE_ARTIFACT" \
  --receipt-dir "$RELEASE_RECEIPTS" \
  --expected-manifest-sha "<recorded-manifest-sha256>" \
  --expected-config-sha "<recorded-production-config-sha256>"
```

`release:prepare` builds once, strips `build/server/.dev.vars`, and seals the
server/client files plus production and staging configs into a hashed manifest.
Both deploy commands require that explicit artifact. They refuse plaintext
provider bindings, verify the exact target and configured secret names, upload
without rebuilding, map the artifact/config digests to the active Worker
version, and write an external receipt only after Cloudflare query-string
redaction passes readback. `release:qualify` separately verifies the receipt,
active version, expected migration, `/readyz`, and provider configuration,
including Stripe. It also requires a locally supplied `MONITOR_TOKEN` to read
the protected `/monitorz` status without printing or persisting the token; it
does not claim live provider integration.

The live Worker is `nudgepay-app` on `nudgepay.9thlevelsoftware.com`. Staging is
`nudgepay-app-staging` on workers.dev. Cloudflare Workers Builds triggers remain
disabled so they cannot create a duplicate raw-Wrangler deployment path alongside
the sealed-artifact workflows. Direct `npx wrangler deploy` remains blocked by
the root build hook.

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
