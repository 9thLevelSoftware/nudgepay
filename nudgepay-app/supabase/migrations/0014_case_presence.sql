-- Phase 8b (C1): poll-based presence. One heartbeat row per (org, customer, user),
-- upserted in place so the table is bounded by distinct user×customer view pairs.
-- "Live" is derived at read time from last_seen_at freshness — no background job,
-- no pruning required (a stale row simply fails the freshness check).
create table case_presence (
  org_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (org_id, customer_id, user_id)
);
create index case_presence_org_customer_idx on case_presence (org_id, customer_id);

alter table case_presence enable row level security;
-- Members read their own org's presence (dashboard loader uses the user/RLS client).
create policy case_presence_member_read on case_presence
  for select using (is_org_member(org_id));
-- Members upsert only their own heartbeat in an org they belong to.
create policy case_presence_member_insert on case_presence
  for insert with check (is_org_member(org_id) and user_id = auth.uid());
create policy case_presence_member_update on case_presence
  for update using (is_org_member(org_id) and user_id = auth.uid())
  with check (is_org_member(org_id) and user_id = auth.uid());
