# Design-partner pilot operations

NudgePay is a human-operated QuickBooks collections workspace. It is not
automatic AR reminders and not a payment processor. Staff send each text
and email. Quiet-hours blocks are not queued. A payment portal URL is the
tenant's own page for message templates; NudgePay does not charge customers.

Support: `support@nudgepay-ar.app`.

## Product limits

- One workspace per user (`owner` / `member` only).
- Staff send each text and email. There is no automatic reminder sequence.
  Quiet-hours blocks are not queued to send later.
- A payment portal URL is the tenant's own page. NudgePay does not process
  payments or charge customers.
- Queue, reports, and sync pages cap at 5,000 rows per list. Truncation is
  shown; results are not silently complete.
- Leave workspace removes membership and signs out. It does not delete the
  Auth user, the organization, or tenant data.
- Owners can download a JSON copy of workspace customers, invoices, cases,
  promises, and messages from Settings. Lists cap at 5,000 rows each.
- Owners can delete a workspace in Settings by typing its name. That revokes
  QuickBooks tokens, purges tenant rows, and writes `workspace_deletions`.
- Owners can erase a customer's stored name, phone, email, notes, and
  message bodies from the account page. Invoices remain. Sync will not
  restore erased fields.
- Users can download a JSON copy of their login, membership, and
  contact-log activity from Settings (or onboarding with no workspace).
- Users delete their NudgePay login in Settings (or onboarding with no
  workspace) by typing their email or DELETE. Actor columns on kept
  workspace rows are set null. Last owners must delete or transfer the
  workspace first.

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

Promote by deploying production only after the same candidate has been
exercised on staging. There is no automatic promotion pipeline.

## Rollback

```bash
npx wrangler deployments list
npx wrangler rollback
npx wrangler deployments list --env staging
npx wrangler rollback --env staging
```

Rollback restores the previous Worker version. It does not undo a Supabase
migration. If a release includes a migration, restore the database from
backup or PITR first, then roll the Worker back. Confirm `/healthz` and
`/readyz` after rollback.

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
