-- Phase 8b (C1): poll-based presence. One heartbeat row per (org, customer, user),
-- upserted in place so the table is bounded by distinct user×customer view pairs.
-- "Live" is derived at read time from last_seen_at freshness — no background job,
-- no pruning required (a stale row simply fails the freshness check).

-- case_presence references (org_id, customer_id) compositely so a row's customer
-- must belong to the SAME org — this needs a matching unique key on customers.
alter table customers add constraint customers_org_id_id_key unique (org_id, id);

create table case_presence (
  org_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (org_id, customer_id, user_id),
  -- Composite FK: (org_id, customer_id) must match a real customer in THAT org, so
  -- a member cannot pair their own org_id with another org's customer_id (closes a
  -- cross-tenant orphan-row hole the membership RLS check alone does not cover).
  foreign key (org_id, customer_id) references customers (org_id, id) on delete cascade
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
