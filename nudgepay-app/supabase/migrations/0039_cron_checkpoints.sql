-- Durable resume cursor for scheduled jobs that iterate connected orgs
-- (CDC catch-up). Cloudflare Workers may kill a scheduled handler mid-batch;
-- the next tick starts at next_org_id and wraps. Service-role only.
create table cron_checkpoints (
  job text primary key,
  next_org_id uuid,
  updated_at timestamptz not null default now()
);

alter table cron_checkpoints enable row level security;
-- No user-facing policies: only the service role (bypasses RLS) reads/writes.

grant select, insert, update, delete on cron_checkpoints to service_role;
