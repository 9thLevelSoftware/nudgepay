-- Durable, service-only health signals for Cloudflare scheduled jobs.
-- Rows contain operational timestamps only: no tenant, customer, or error data.

create table public.system_job_health (
  job text primary key check (job in ('provider_monitor', 'cdc', 'digest', 'retention')),
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_alert_attempted_at timestamptz,
  last_alert_succeeded_at timestamptz,
  last_alert_failed_at timestamptz,
  last_alert_succeeded_destination_hash text
    check (last_alert_succeeded_destination_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

alter table public.system_job_health enable row level security;
revoke all on table public.system_job_health from anon, authenticated;
grant select, insert, update, delete on table public.system_job_health to service_role;

-- GREATEST makes late-finishing or overlapping invocations monotonic. The
-- application records one event at a time and cannot erase another event.
create or replace function public.record_system_job_event(
  p_job text,
  p_event text,
  p_at timestamptz default now(),
  p_alert_destination_hash text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_job not in ('provider_monitor', 'cdc', 'digest', 'retention')
     or p_event not in ('started', 'succeeded', 'failed', 'alert_succeeded', 'alert_failed')
     or p_at is null
     or (p_event = 'alert_succeeded' and (
       p_alert_destination_hash is null or p_alert_destination_hash !~ '^[0-9a-f]{64}$'
     ))
     or (p_event <> 'alert_succeeded' and p_alert_destination_hash is not null) then
    raise exception 'Invalid system job event';
  end if;

  insert into public.system_job_health as existing (
    job,
    last_started_at,
    last_succeeded_at,
    last_failed_at,
    last_alert_attempted_at,
    last_alert_succeeded_at,
    last_alert_failed_at,
    last_alert_succeeded_destination_hash,
    updated_at
  ) values (
    p_job,
    case when p_event = 'started' then p_at end,
    case when p_event = 'succeeded' then p_at end,
    case when p_event = 'failed' then p_at end,
    case when p_event in ('alert_succeeded', 'alert_failed') then p_at end,
    case when p_event = 'alert_succeeded' then p_at end,
    case when p_event = 'alert_failed' then p_at end,
    case when p_event = 'alert_succeeded' then p_alert_destination_hash end,
    p_at
  )
  on conflict (job) do update set
    last_started_at = case
      when excluded.last_started_at is null then existing.last_started_at
      else greatest(existing.last_started_at, excluded.last_started_at)
    end,
    last_succeeded_at = case
      when excluded.last_succeeded_at is null then existing.last_succeeded_at
      else greatest(existing.last_succeeded_at, excluded.last_succeeded_at)
    end,
    last_failed_at = case
      when excluded.last_failed_at is null then existing.last_failed_at
      else greatest(existing.last_failed_at, excluded.last_failed_at)
    end,
    last_alert_attempted_at = case
      when excluded.last_alert_attempted_at is null then existing.last_alert_attempted_at
      else greatest(existing.last_alert_attempted_at, excluded.last_alert_attempted_at)
    end,
    last_alert_succeeded_at = case
      when excluded.last_alert_succeeded_at is null then existing.last_alert_succeeded_at
      else greatest(existing.last_alert_succeeded_at, excluded.last_alert_succeeded_at)
    end,
    last_alert_failed_at = case
      when excluded.last_alert_failed_at is null then existing.last_alert_failed_at
      else greatest(existing.last_alert_failed_at, excluded.last_alert_failed_at)
    end,
    last_alert_succeeded_destination_hash = case
      when excluded.last_alert_succeeded_at is null then existing.last_alert_succeeded_destination_hash
      when existing.last_alert_succeeded_at is null
        or excluded.last_alert_succeeded_at >= existing.last_alert_succeeded_at
        then excluded.last_alert_succeeded_destination_hash
      else existing.last_alert_succeeded_destination_hash
    end,
    updated_at = greatest(existing.updated_at, excluded.updated_at);
end;
$$;

revoke all on function public.record_system_job_event(text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_system_job_event(text, text, timestamptz, text)
  to service_role;
