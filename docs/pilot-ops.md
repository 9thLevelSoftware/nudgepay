# Design-partner pilot operations

NudgePay is a human-operated QuickBooks collections workspace. It is not
automatic AR reminders and not a payment processor.

Support: `support@nudgepay-ar.app`.

## Product limits

- One workspace per user (`owner` / `member` only).
- Queue, reports, and sync pages cap at 5,000 rows per list. Truncation is
  shown; results are not silently complete.
- Leave workspace removes membership and signs out. It does not delete the
  Auth user, the organization, or tenant data. Workspace deletion is support-only.

## Health

- `/healthz` — process liveness (JSON `{ ok: true }`).
- `/readyz` — database plus minimum config. `503` on URL/placeholder/db/config
  failure. JSON also includes `providers: { qbo, twilio, email, operatorAlert }`
  for secret presence. Probes never send SMS or email.

## Operator paging

Set secret `OPERATOR_ALERT_WEBHOOK` to an HTTPS URL (Slack incoming webhook,
PagerDuty, etc.). A scheduled CDC/digest/retention throw POSTs:

```json
{ "source": "nudgepay", "event": "unhandled_worker_error", "handler": "scheduled", "cron": "…", "message": "…" }
```

Missing or failing pager is fail-open. Cloudflare Workers Logs remain the
structured log trail.

## Staging

```bash
npx wrangler deploy --env staging
npx wrangler secret put <NAME> --env staging
```

Use a separate Supabase project, Intuit sandbox (`QBO_SANDBOX=true`), and
Twilio/Resend credentials pointed at owned destinations only.

## Backup

Supabase project backups and point-in-time recovery live in the Supabase
dashboard for the production project. A restore is not proven until a drill
has been run against an isolated project. `QBO_ENCRYPTION_KEY` cannot be
rotated without re-encrypting stored tokens.

## Incidents

1. Check `/healthz` then `/readyz` (including `providers`).
2. Cloudflare Workers Logs: `unhandled_worker_error` and cron messages.
3. In-app Settings → sync issues.
4. Pause sending (Twilio/Resend consoles) if a provider is looping.
5. Notify design partners at `support@nudgepay-ar.app` with scope and ETA.
