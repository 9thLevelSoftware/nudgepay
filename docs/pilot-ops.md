# Design-partner pilot operations

NudgePay is a human-operated QuickBooks collections workspace. It is not
automatic AR reminders and not a payment processor. Staff send each text
and email. Quiet-hours blocks are not queued. A payment portal URL is the
tenant's own page for message templates; NudgePay does not charge customers.

Support: `support@nudgepay-ar.app`.

## Product limits

- Pilot scope is capped at **10 workspaces**. The target is **5 concurrent staff
  per workspace**, subject to load qualification; this is not a membership cap.
  Queue, report, and sync lists are capped at **5,000 rows**;
  truncation must remain visible to operators.
- A user can belong to more than one workspace (`owner` / `admin` / `member`). Switch from the account menu. Admins run settings and reports; only owners delete a workspace or grant owner.
- Staff send each text and email. There is no automatic reminder sequence.
  Quiet-hours blocks are not queued to send later.
- A payment portal URL is the tenant's own page. NudgePay does not process
  payments or charge customers. Workspace owners pay NudgePay (agency
  subscription) from Settings → Billing.
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

## Provider outcome reconciliation

A `sending` or `unknown` message and an `unknown` billing checkout are durable
stop signs. Never delete these rows, clear their keys, create a new key, or send
again merely because no receipt is visible yet. Twilio does not document the
Messages endpoint's `Idempotency-Key` as a deduplication guarantee. Resend keys
are guaranteed for 24 hours. Stripe caches the result for a request key,
including a `500`; retrying checkout with a different key can create a second
session.

Message deduplication uses the UTC send date so a staff member can intentionally
send the same reminder on a later day. A retry of the same submission after UTC
midnight is therefore a known pilot limitation: if the provider accepted the
message and the caller lost the response, a fresh next-day click can create a
second delivery. The application does not automatically retry ambiguous sends.
Operators must reconcile every `sending` or `unknown` receipt before asking the
staff member to try again; do not treat the date change as evidence of failure.

The on-call operator opens an incident or support ticket before reconciliation
and records their identity plus the ticket ID as `operator_reference`. First
inspect the unresolved receipts read-only:

```sql
select id, org_id, created_at, status, to_number, from_number,
       messaging_service_sid, body, provider_idempotency_key
from public.text_messages
where direction = 'outbound' and status in ('sending', 'unknown')
order by created_at;

select id, org_id, created_at, status, to_address, from_address, subject,
       body, provider_idempotency_key
from public.email_messages
where direction = 'outbound' and status in ('sending', 'unknown')
order by created_at;

select id, org_id, created_at, updated_at, state, checkout_session_id,
       checkout_url, expires_at, error_code
from public.billing_checkout_attempts
where state in ('reserved', 'ready', 'unknown')
order by created_at;
```

For SMS, search Twilio Messaging Logs in the correct account by UTC time,
destination, sender or Messaging Service, and body. A matching Message SID is
the receipt. For email, search Resend Logs by `provider_idempotency_key` within
24 hours, then verify UTC time, sender, recipient, subject, and body. For
checkout, retrieve `checkout_session_id` from Stripe, verify its customer and
`metadata.org_id`, and inspect that customer's subscriptions. An expired
session is safe to close only when Stripe shows no completed session or new
subscription for the attempt.

When an ambiguous Stripe response left `checkout_session_id` null, search
Stripe Workbench/API request logs for the exact idempotency key
`billing-checkout:<attempt-uuid>`, then require the returned Session's
`metadata.attempt_id` and `metadata.org_id` to match. Absence from ordinary
Session or subscription lists is not proof that Stripe rejected the request.
If the exact request log cannot prove an expired Session or identify the
created Session/subscription, keep the attempt unknown and escalate; never
create a replacement key.

After provider evidence is attached to the ticket, use the service role in an
interactive transaction. Replace every placeholder below. The block aborts the
transaction unless exactly one row still belongs to the expected workspace and
has an unresolved state; this prevents an audit row from claiming that a stale
or mistyped attempt was reconciled.

```sql
begin;
do $reconcile$
declare
  v_org_id uuid := '<workspace-uuid>';
  v_attempt_id uuid := '<attempt-uuid>';
  v_message_sid text := '<confirmed-message-sid>';
  v_operator_reference text := '<operator-and-ticket>';
  v_updated integer;
begin
  update public.text_messages
     set status = 'sent', twilio_message_sid = v_message_sid,
         error_code = null
   where id = v_attempt_id and org_id = v_org_id
     and direction = 'outbound' and status in ('sending', 'unknown');
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Reconciliation expected one unresolved SMS row, updated %',
      v_updated;
  end if;

  insert into public.provider_reconciliation_audit
    (org_id, channel, attempt_id, outcome, provider_reference, operator_reference)
  values
    (v_org_id, 'sms', v_attempt_id, 'sent', v_message_sid,
     v_operator_reference);
end
$reconcile$;
commit;
```

Use the same guarded block and row-count assertion for email, updating
`email_messages` with
`status = '<confirmed-provider-status>'` and
`provider_message_id = '<confirmed-email-id>'`, and audit with
`channel = 'email'`. When the provider proves it did not accept the request,
set `status = 'failed'` and `error_code = 'operator_confirmed_not_sent'`, keep
all fingerprint/dedupe/provider-key columns unchanged, and audit
`outcome = 'not_sent'`. A later staff send then creates a fresh provider key
while the failed receipt remains in history.

For a Stripe session proven expired with no subscription, update only its exact
attempt from `ready` or `unknown` to `failed`, set
`error_code = 'operator_confirmed_expired'`, and audit
`channel = 'stripe_checkout'`, `outcome = 'expired'`, and the Checkout Session
ID as `provider_reference`. Use the same guarded block: require the attempt ID,
workspace ID, and current state to match, raise unless the update count is one,
then insert the audit row in that transaction. If Stripe shows completion or a subscription,
request replay of the original signed webhook and do not edit `org_billing`
manually. If provider evidence is missing or conflicts, leave the row unknown,
pause that workspace's sends or checkout, and escalate.

Completed/failed checkout attempts, Stripe webhook deduplication receipts, and
operator reconciliation audit records are retained for 90 days as an
operational pilot policy. The retention job never purges `reserved`, `ready`,
or `unknown` checkout attempts. Message ledgers follow the workspace/customer
retention and erasure rules above; unresolved delivery rows are never cleared
by the provider-receipt retention job. Deleting a workspace also deletes its
provider reconciliation audit rows so the privacy deletion contract remains
complete.

## Branch protection

The workflow defines eight PR candidate checks: secret scan, CodeQL,
typecheck + unit tests, production check, Supabase integration, browser smoke,
npm audit, and authenticated browser flows. Hosted `main` still requires the
five established checks until the three new checks have completed on a
candidate. This pending state is not equivalent to enforcement.

After the new checks have completed successfully, update hosted branch
protection without removing the established checks, then verify the exact names
read-only from `nudgepay-app/`:

```bash
npm run verify:required-checks
```

The command exits nonzero and lists missing checks until all eight are required.
Hosted branch protection rejects force-pushes and branch deletion. Merge still
uses a merge commit after required checks are green.

## Staging

```bash
npx wrangler secret put <NAME> --env staging
npm run deploy:staging
```

Staging Worker: `https://nudgepay-app-staging.dasblueeyeddevil.workers.dev`.
`QBO_SANDBOX=true`. Hosted inspection found no separate staging Supabase
project; the deployed shared-database state is not independently certified.
Staging isolation is required before real customer-like data. Twilio/Resend
credentials should point at owned destinations only.

Promote by deploying production only after the same candidate has been
exercised on staging. There is no automatic promotion pipeline.

Production deploy commands require `EXPECTED_DEPLOY_SHA` to equal the checked
out `HEAD` and reject any tracked or untracked worktree change before reading
the Worker secret inventory or building. Record the tested candidate or tag
commit SHA independently, check out that exact commit, then set
`EXPECTED_DEPLOY_SHA` to the recorded value; do not derive it from the current
checkout. Cloudflare Workers Builds uses its supplied commit SHA when
`WORKERS_CI=1`. The production Supabase origin is pinned in deploy preflight; a
caller-supplied value cannot replace it. Staging deploys remain iterative but
still reject the pinned production Supabase origin.

```bash
export EXPECTED_DEPLOY_SHA="<recorded-tested-candidate-or-tag-commit-sha>"
git checkout "$EXPECTED_DEPLOY_SHA"
npm run deploy
```

Pull requests and pushes run the authenticated Chromium desktop suite. The
nightly schedule and manual workflow dispatch run all configured desktop,
tablet, and mobile browser projects. Failure uploads contain only screenshots
of synthetic local data. Playwright traces, videos, network dumps, storage
state, cookies, and text attachments are excluded from CI artifacts.

## Releases

Pushing a `v*` tag (for example `v0.1.0`) creates a GitHub Release with
generated notes. Tagging is not a production deploy.

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Rollback

Record the candidate and last known-good Worker deployment IDs and migration
set before every production deployment. Pause provider sends first when the
incident concerns messages. Select the known-good version from the deployment
list, verify the installed CLI syntax with `npx wrangler rollback --help`, and
record the selected ID in the incident log.

```bash
npx wrangler deployments list --env production
npx wrangler deployments list --env staging
npx wrangler rollback <known-good-version-id> --env production --message "rollback to the recorded previous deployment"
npx wrangler rollback <known-good-staging-version-id> --env staging --message "rollback to the recorded previous deployment"
```

`rollback` takes a Worker version ID (confirmed by Wrangler 4.88.0 help); do
not omit the ID. Worker rollback restores application code only. It does
not undo a Supabase migration. Prefer forward-compatible migrations; if data
recovery is required, use an approved PITR/backup restore against an isolated
target and record schema/data checks. Never run a destructive down migration as
an emergency shortcut. Confirm `/healthz`, `/readyz`, login, queue read, and a
provider-send pause after rollback before resuming traffic.

## Pilot service objectives

The pilot target is **99.5% monthly availability** for authenticated workspace
traffic, measured across the entire month with `/readyz` and synthetic
login/queue checks. The business-hours operator target is acknowledgement
within **1 business hour** and service restoration within **4 hours**; an
incident update may describe degraded mode but does not replace restoration.
The recovery point objective is **1 hour** for accepted workspace data.
These are targets, not measured results. Monitoring, backup/PITR setup,
restore rehearsal, and business-hour operator coverage remain external gates
until evidence is attached.

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
