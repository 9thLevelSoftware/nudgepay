-- Production pilot workspace admission. Existing workspaces are preserved and
-- enrolled. Test fixtures and operator migrations may still provision rows via
-- service_role directly; the user-facing onboarding path must use the atomic
-- RPC below so concurrent requests cannot oversubscribe the ten-workspace pilot.

create table public.pilot_workspace_admissions (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  admitted_by_user_id uuid references auth.users(id) on delete set null,
  admitted_at timestamptz not null default now()
);

alter table public.pilot_workspace_admissions enable row level security;
revoke all on table public.pilot_workspace_admissions from anon, authenticated;
grant select, insert, delete on table public.pilot_workspace_admissions to service_role;

insert into public.pilot_workspace_admissions (org_id, admitted_at)
select id, created_at
from public.organizations
on conflict (org_id) do nothing;

create or replace function public.assert_pilot_workspace_capacity()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count bigint;
begin
  select count(*) into v_count from public.pilot_workspace_admissions;
  if v_count > 10 then
    raise exception 'Pilot workspace capacity exceeded: % existing workspaces (maximum 10)', v_count
      using errcode = 'P0001';
  end if;
end;
$$;

select public.assert_pilot_workspace_capacity();

create or replace function public.create_pilot_workspace(
  p_user_id uuid,
  p_name text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  if p_user_id is null then
    raise exception 'Workspace owner is required';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Organization name is required';
  end if;

  -- Serialize only pilot admission transactions. The count and all inserts are
  -- committed atomically, so two concurrent requests cannot both claim slot 10.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nudgepay:pilot-workspace-admission', 0)
  );

  if (select count(*) from public.pilot_workspace_admissions) >= 10 then
    raise exception 'Pilot workspace capacity reached' using errcode = 'P0001';
  end if;

  insert into public.organizations (name)
  values (btrim(p_name))
  returning id into v_org_id;

  insert into public.memberships (org_id, user_id, role)
  values (v_org_id, p_user_id, 'owner');

  insert into public.pilot_workspace_admissions (org_id, admitted_by_user_id)
  values (v_org_id, p_user_id);

  return v_org_id;
end;
$$;

revoke all on function public.create_pilot_workspace(uuid, text)
  from public, anon, authenticated;
revoke all on function public.assert_pilot_workspace_capacity()
  from public, anon, authenticated;
grant execute on function public.create_pilot_workspace(uuid, text)
  to service_role;
grant execute on function public.assert_pilot_workspace_capacity()
  to service_role;
