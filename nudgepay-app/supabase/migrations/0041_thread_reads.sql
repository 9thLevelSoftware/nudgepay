-- Per-user last-read watermark for inbox threads (customer + channel).

create table if not exists thread_reads (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null,
  customer_id uuid not null references customers(id) on delete cascade,
  channel text not null check (channel in ('sms', 'email')),
  last_read_at timestamptz not null default now(),
  primary key (org_id, user_id, customer_id, channel)
);

alter table thread_reads enable row level security;

create policy thread_reads_select on thread_reads
  for select using (public.is_org_member(org_id) and user_id = auth.uid());

create policy thread_reads_upsert on thread_reads
  for insert with check (public.is_org_member(org_id) and user_id = auth.uid());

create policy thread_reads_update on thread_reads
  for update using (public.is_org_member(org_id) and user_id = auth.uid())
  with check (public.is_org_member(org_id) and user_id = auth.uid());
