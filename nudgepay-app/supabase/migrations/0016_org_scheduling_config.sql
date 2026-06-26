-- Phase 8 (C7): per-org scheduling config. Engine + storage only; the editing UI
-- lands in Phase 9. Both tables are optional per org — absence => app defaults
-- (grace 2 business days, Mon-Fri working week, no holidays, default cadence).

-- Owner-only write helper, mirroring is_org_member (no owner helper existed before).
create or replace function public.is_org_owner(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

create table org_settings (
  org_id uuid primary key references organizations(id) on delete cascade,
  promise_grace_days int not null default 2 check (promise_grace_days >= 0),
  working_days int[] not null default '{1,2,3,4,5}'
    check (cardinality(working_days) >= 1 and working_days <@ array[0,1,2,3,4,5,6]),
  cadence_critical int not null default 2 check (cadence_critical > 0),
  cadence_high int not null default 3 check (cadence_high > 0),
  cadence_medium int not null default 7 check (cadence_medium > 0),
  cadence_low int not null default 14 check (cadence_low > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table org_holidays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  holiday_date date not null,
  label text,
  created_at timestamptz not null default now(),
  unique (org_id, holiday_date)
);
create index org_holidays_org_idx on org_holidays (org_id);

alter table org_settings enable row level security;
alter table org_holidays enable row level security;

-- Members read; owners write. Multiple permissive policies are OR'd, so an owner
-- (also a member) can both read and write; a plain member can only read.
create policy org_settings_member_read on org_settings
  for select using (is_org_member(org_id));
create policy org_settings_owner_write on org_settings
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));

create policy org_holidays_member_read on org_holidays
  for select using (is_org_member(org_id));
create policy org_holidays_owner_write on org_holidays
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));
