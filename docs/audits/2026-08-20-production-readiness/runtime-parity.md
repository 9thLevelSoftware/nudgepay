# Runtime parity: Cloudflare Workers and Render Node

Static source/config review plus local build/rehearsal. No provider was contacted and no deploy was performed.

| Concern | Cloudflare Workers (primary) | Render Node (secondary) | Evidence |
|---|---|---|---|
| Entry point | `workers/app.ts` via `wrangler.toml` `main` | `server.js` via `npm start` | Both builds exit 0 |
| Build selection | Default Vite config includes `@cloudflare/vite-plugin`; emits `build/server/wrangler.json` | `BUILD_TARGET=node` drops Cloudflare plugin; emits `build/server/index.js` | Both target builds exit 0 |
| Request context | Worker `cloudflare.env` and execution context | Express handler supplies `{cloudflare:{env:process.env,ctx:{waitUntil,passThroughOnException}}}` | Static source review |
| Static assets | Worker asset binding/generated Wrangler output | Express serves `build/client/assets` immutable and other client files | Node start rehearsal passed |
| Health | `healthz` route registered | Render `healthCheckPath: /healthz` | `GET 127.0.0.1:39127/healthz` returned 200 `{"ok":true}` |
| Webhook body/signature behavior | Worker receives raw Request body | `server.js` deliberately has no `express.json()`/urlencoded parser | Static review; required for HMAC routes |
| Proxy/CSRF | Worker origin is direct request origin | `app.set("trust proxy", true)` is set for Render TLS termination | Static review |
| Cron | Two Wrangler schedules: `*/30 * * * *`, `0 * * * *` | Render cron services are commented out; `render.yaml` documents Cloudflare ownership | Static config review |
| Secrets | Production values/secrets are configured through Wrangler separately; production URL remains placeholder in source | `sync: false` env vars for required Supabase/QBO/Twilio and optional email config | No secret values observed |
| QBO mode | Production `QBO_SANDBOX=false`; top-level local default `true` | Render shared group sets `QBO_SANDBOX=false` | Static config review |

## Parity concerns

1. The two runtimes share route code but have different deployment contracts; a production Node deployment requires all Render `sync: false` values to be entered, and a production Worker requires Wrangler secrets. Source-only audit cannot prove those provider-side values exist.
2. Render is documented as a free, secondary service. Its cold-start caveat makes it unsuitable as the webhook endpoint; the config correctly leaves Cloudflare primary and cron ownership singular.
3. The Cloudflare production `SUPABASE_URL` is still the literal `<your-prod-project-ref>` placeholder in `wrangler.toml`; deployment configuration must be supplied before production deploy.
4. `npm run check` proves the generated Wrangler dry-run, not a live Worker request or scheduled invocation. The only live rehearsal was loopback Node `/healthz`.
5. `app.set("trust proxy", true)` trusts all proxy hops. The adapter also derives its
   request URL from forwarded protocol/host values, while same-origin CSRF validation
   relies on the resulting request origin. Static review cannot prove Render strips
   attacker-supplied forwarding headers; an explicit hop/subnet trust function and a
   deployed hostile-header test are required.
6. `/healthz` always returns `200 {"ok":true}` without checking required
   configuration or Supabase. Render can therefore keep routing callbacks to a
   deployment that cannot perform its core work. Render recommends checking
   operation-critical dependencies, such as a simple database query, in a health
   endpoint ([Render health-check guidance](https://render.com/docs/health-checks)).
7. The Node `waitUntil` compatibility shim observes and logs rejected promises but
   has no bounded shutdown drain or durable task handoff. Process termination can
   abandon webhook background work; this remains unverified under restart/failover.
8. Render documents that free web services spin down after 15 idle minutes, can take
   about a minute to wake, and should not be used for production applications. That
   is incompatible with treating this free service as a callback failover
   ([Render free-instance limits](https://render.com/docs/free)).
9. Blueprint discovery from a non-default path is supported when the path is supplied
   during Blueprint creation, but that dashboard workflow and the nested
   `nudgepay-app/render.yaml` path were not rehearsed
   ([Render Blueprint specification](https://render.com/docs/blueprint-spec)).
