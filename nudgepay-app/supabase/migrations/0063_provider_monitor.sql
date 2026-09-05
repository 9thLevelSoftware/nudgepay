-- Bounded service-only receipts for stale provider-attempt operator alerts.
-- Each claim is leased so a failed pager post can be retried by a later cron
-- without concurrent Worker invocations posting duplicate alerts.

create table public.provider_monitor_alert_receipts (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('sms', 'email', 'stripe_checkout')),
  attempt_id uuid not null,
  hour_bucket timestamptz not null,
  state text not null default 'pending' check (state in ('pending', 'sent')),
  claim_token uuid,
  lease_expires_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, attempt_id, hour_bucket)
);

create index provider_monitor_alert_receipts_retention_idx
  on public.provider_monitor_alert_receipts (created_at);

alter table public.provider_monitor_alert_receipts enable row level security;
revoke all on table public.provider_monitor_alert_receipts from anon, authenticated;
grant select, insert, update, delete on table public.provider_monitor_alert_receipts to service_role;

create or replace function public.claim_provider_monitor_alert(
  p_channel text,
  p_attempt_id uuid,
  p_hour_bucket timestamptz,
  p_claim_token uuid,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_channel not in ('sms', 'email', 'stripe_checkout')
     or p_attempt_id is null
     or p_hour_bucket is null
     or p_claim_token is null then
    raise exception 'Invalid provider monitor alert claim';
  end if;

  insert into public.provider_monitor_alert_receipts (
    channel, attempt_id, hour_bucket, claim_token, lease_expires_at, updated_at
  ) values (
    p_channel, p_attempt_id, date_trunc('hour', p_hour_bucket), p_claim_token,
    p_now + interval '4 minutes', p_now
  )
  on conflict (channel, attempt_id, hour_bucket) do update
     set claim_token = excluded.claim_token,
         lease_expires_at = excluded.lease_expires_at,
         updated_at = excluded.updated_at
   where public.provider_monitor_alert_receipts.state = 'pending'
     and public.provider_monitor_alert_receipts.lease_expires_at <= p_now;
  return found;
end;
$$;

create or replace function public.complete_provider_monitor_alert(
  p_channel text,
  p_attempt_id uuid,
  p_hour_bucket timestamptz,
  p_claim_token uuid,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.provider_monitor_alert_receipts
     set state = 'sent', sent_at = p_now, lease_expires_at = null, updated_at = p_now
   where channel = p_channel
     and attempt_id = p_attempt_id
     and hour_bucket = date_trunc('hour', p_hour_bucket)
     and state = 'pending'
     and claim_token = p_claim_token;
  return found;
end;
$$;

revoke all on function public.claim_provider_monitor_alert(text, uuid, timestamptz, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.complete_provider_monitor_alert(text, uuid, timestamptz, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_provider_monitor_alert(text, uuid, timestamptz, uuid, timestamptz)
  to service_role;
grant execute on function public.complete_provider_monitor_alert(text, uuid, timestamptz, uuid, timestamptz)
  to service_role;

-- One ordered, identifier-only page across channels. Sent receipt rows are
-- excluded for the current hour, so each successful page makes progress
-- instead of a permanent SMS backlog hiding email or checkout candidates.
create or replace function public.list_provider_monitor_candidates(
  p_now timestamptz default now(),
  p_limit integer default 26
)
returns table(channel text, attempt_id uuid, observed_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 51 then
    raise exception 'Provider monitor limit must be between 1 and 51';
  end if;

  return query
  with stale_attempts(channel, attempt_id, observed_at) as (
    select 'sms'::text, tm.id, tm.created_at
      from public.text_messages tm
     where tm.direction = 'outbound'
       and tm.status in ('sending', 'unknown')
       and tm.created_at <= p_now - interval '5 minutes'
    union all
    select 'email'::text, em.id, em.created_at
      from public.email_messages em
     where em.direction = 'outbound'
       and em.status in ('sending', 'unknown')
       and em.created_at <= p_now - interval '5 minutes'
    union all
    select 'stripe_checkout'::text, bca.id, bca.updated_at
      from public.billing_checkout_attempts bca
     where bca.state in ('reserved', 'unknown')
       and bca.updated_at <= p_now - interval '5 minutes'
    union all
    select 'stripe_checkout'::text, bca.id, bca.updated_at
      from public.billing_checkout_attempts bca
     where bca.state = 'ready'
       and bca.expires_at <= p_now - interval '5 minutes'
       and bca.updated_at <= p_now - interval '5 minutes'
  )
  select sa.channel, sa.attempt_id, sa.observed_at
    from stale_attempts sa
   where not exists (
     select 1
       from public.provider_monitor_alert_receipts receipt
      where receipt.channel = sa.channel
        and receipt.attempt_id = sa.attempt_id
        and receipt.hour_bucket = date_trunc('hour', p_now)
        and (
          receipt.state = 'sent'
          or (receipt.state = 'pending' and receipt.lease_expires_at > p_now)
        )
   )
   order by sa.observed_at asc, sa.attempt_id asc
   limit p_limit;
end;
$$;

revoke all on function public.list_provider_monitor_candidates(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_provider_monitor_candidates(timestamptz, integer)
  to service_role;
