# Provider evidence and release concerns

Audit-only static review of Cloudflare and Render configuration/source. No deploy, provider login, API call, or non-loopback database connection was attempted.

## Cloudflare Workers

- `nudgepay-app/wrangler.toml` declares `nudgepay-app`, `main = "./workers/app.ts"`, `nodejs_compat`, and two schedules (`*/30 * * * *` CDC catch-up and `0 * * * *` digest gate).
- Top-level non-secret defaults point at loopback Supabase and `QBO_SANDBOX=true`. The production environment changes QBO mode to false but still contains `https://<your-prod-project-ref>.supabase.co` as a source placeholder.
- The source comments enumerate required production secrets for Supabase, QBO, and Twilio; email/alert values are explicitly optional in the code/config. No secret values were read or recorded.
- `npm run check` passed, including Wrangler deploy dry-run. The dry-run showed only the two non-secret bindings (`SUPABASE_URL`, `QBO_SANDBOX`); it does not prove production secrets or provider state.

## Render

- `nudgepay-app/render.yaml` is a secondary Node service, `rootDir: nudgepay-app`, `branch: main`, free Oregon plan, `buildCommand: npm ci --include=dev && npm run build && npm run build:cron`, `startCommand: npm start`, and `healthCheckPath: /healthz`.
- The shared environment sets `NODE_ENV=production`, `BUILD_TARGET=node`, and `QBO_SANDBOX=false`; provider secrets are `sync: false`. Static review confirms the service declares required Supabase, QBO, and Twilio keys and optional email keys.
- Render cron definitions are intentionally commented out. The config documents that enabling them without removing Wrangler schedules would double-run CDC; Cloudflare remains the single cron owner.
- `BUILD_TARGET=node npm run build` passed. `npm start` on loopback served `/healthz` with HTTP 200 and `{"ok":true}` without provider access.

## Release blockers / concerns

1. Required provider-side secrets and actual production Supabase URL are unverified; the source placeholder must not reach a production Worker deployment.
2. Full Vitest is environment-blocked by missing `.env.test`; no test assertion or RLS/migration reset result is available.
3. Local Supabase is unavailable because Docker is not installed/running in this environment; `supabase start`/`db reset` were intentionally not run.
4. `npm audit --json` reports 17 vulnerabilities (14 high). This is a dependency release concern independent of the successful build.
5. Render free-tier cold starts are documented in source as unsuitable for third-party webhook endpoints; keep webhook traffic on the Worker unless the hosting plan/timeout behavior is deliberately changed.

## Contract checks still requiring live evidence

- **Supabase:** Local development and migration workflows require the local stack;
  this host could not reach Docker, so no empty-state migration, policy, grant,
  constraint-validation, or role-by-role CRUD result exists. RLS must be enabled and
  tested as the database authorization boundary, not inferred from route filters
  ([Supabase local development](https://supabase.com/docs/guides/local-development),
  [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)).
- **Twilio:** The shared sender configuration has not been validated against a
  tenant-owned Messaging Service, inbound-number routing, opt-out behavior, or owned
  test destinations. Messaging Services centrally configure senders and inbound
  handling, which makes the actual service/sender association material evidence
  ([Twilio Messaging Services](https://www.twilio.com/docs/messaging/services)).
- **Resend:** The real `email.received` contract is asynchronous and identifies the
  received email for subsequent retrieval; the current source-derived mapping and
  body assumptions require a signed, controlled callback and API retrieval test
  ([Resend receiving webhook](https://resend.com/docs/webhooks/emails/received)).
- **One-click unsubscribe:** RFC 8058 requires the list header opt-in marker and an
  HTTPS POST carrying the list-unsubscribe form field. The customer token POST,
  empty success response, immediate opt-out, replay, and human confirmation GET all
  remain untested ([RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.html)).
- **QBO/Intuit, Cloudflare, Render, and Netlify:** No sandbox realm, signed webhook,
  callback registration, production URL, redirect, DNS/TLS, deploy, rollback, or
  provider-side secret was observed. All corresponding mandatory cells stay blocked.

## Evidence boundaries

The checks establish reproducible local build/config parity and a loopback health rehearsal. They do not establish live Cloudflare/Render deployment state, DNS/TLS, Supabase connectivity, QBO/Twilio/Resend credentials, provider webhook registration, or production cron execution.
