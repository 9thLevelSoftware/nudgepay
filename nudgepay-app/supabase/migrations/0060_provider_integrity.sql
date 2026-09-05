-- Durable provider boundaries for billing webhooks, checkout initiation, and
-- outbound email/SMS. All mutation functions are service-role only.

alter table public.org_billing
  add column last_stripe_event_id text,
  add column last_stripe_event_created_at timestamptz;

alter table public.org_billing drop constraint org_billing_status_check;
alter table public.org_billing add constraint org_billing_status_check
  check (status in (
    'none', 'incomplete', 'trialing', 'active', 'past_due', 'canceled',
    'unpaid', 'paused', 'incomplete_expired'
  ));

create table public.stripe_webhook_events (
  event_id text primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  event_created_at timestamptz not null,
  stripe_subscription_id text,
  applied boolean not null default false,
  received_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
revoke all on table public.stripe_webhook_events from anon, authenticated;
grant select, insert, update, delete on table public.stripe_webhook_events to service_role;

create table public.billing_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  state text not null check (state in ('reserved', 'ready', 'unknown', 'failed', 'completed')),
  checkout_url text,
  checkout_session_id text,
  expires_at timestamptz,
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index billing_checkout_attempts_org_created_idx
  on public.billing_checkout_attempts (org_id, created_at desc);
create unique index billing_checkout_attempts_active_org_key
  on public.billing_checkout_attempts (org_id)
  where state in ('reserved', 'ready', 'unknown');

alter table public.billing_checkout_attempts enable row level security;
revoke all on table public.billing_checkout_attempts from anon, authenticated;
grant select, insert, update, delete on table public.billing_checkout_attempts to service_role;

create or replace function public.reserve_billing_checkout(p_org_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_billing public.org_billing%rowtype;
  v_attempt public.billing_checkout_attempts%rowtype;
  v_role text;
begin
  if p_org_id is null or p_user_id is null then
    raise exception 'Workspace and actor are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nudgepay:org-billing:' || p_org_id::text, 0)
  );

  select role into v_role
  from public.memberships
  where org_id = p_org_id and user_id = p_user_id
  for key share;
  if not found or v_role <> 'owner' then
    raise exception 'Workspace billing permission denied' using errcode = '42501';
  end if;

  select * into v_billing
  from public.org_billing
  where org_id = p_org_id;

  if found and (
    v_billing.status in ('incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'paused')
    or (v_billing.stripe_subscription_id is not null and v_billing.status not in ('canceled', 'incomplete_expired'))
  ) then
    return jsonb_build_object('state', 'blocked_subscription');
  end if;

  select * into v_attempt
  from public.billing_checkout_attempts
  where org_id = p_org_id
    and state in ('reserved', 'ready', 'unknown')
  order by created_at desc
  limit 1
  for update;

  if found then
    if v_attempt.state = 'ready' then
      if v_attempt.checkout_url is not null
         and v_attempt.expires_at is not null
         and v_attempt.expires_at > now() then
        return jsonb_build_object(
          'state', 'ready',
          'attempt_id', v_attempt.id,
          'checkout_url', v_attempt.checkout_url,
          'expires_at', v_attempt.expires_at
        );
      end if;
      if v_attempt.expires_at is null then
        update public.billing_checkout_attempts
           set state = 'unknown', error_code = 'missing_provider_expiry', updated_at = now()
         where id = v_attempt.id;
        return jsonb_build_object('state', 'unknown', 'attempt_id', v_attempt.id);
      end if;
      update public.billing_checkout_attempts
         set state = 'unknown', error_code = 'provider_expired_unreconciled', updated_at = now()
       where id = v_attempt.id;
      return jsonb_build_object('state', 'unknown', 'attempt_id', v_attempt.id);
    end if;
    if v_attempt.state = 'reserved' then
      if v_attempt.lease_expires_at is not null and v_attempt.lease_expires_at > now() then
        return jsonb_build_object('state', 'in_progress', 'attempt_id', v_attempt.id);
      end if;
      update public.billing_checkout_attempts
         set lease_expires_at = now() + interval '2 minutes', updated_at = now()
       where id = v_attempt.id;
      return jsonb_build_object('state', 'reserved', 'attempt_id', v_attempt.id);
    end if;
    if v_attempt.state = 'unknown' then
      return jsonb_build_object('state', 'unknown', 'attempt_id', v_attempt.id);
    end if;
  end if;

  insert into public.billing_checkout_attempts (org_id, state, lease_expires_at)
  values (p_org_id, 'reserved', now() + interval '2 minutes')
  returning * into v_attempt;

  return jsonb_build_object('state', 'reserved', 'attempt_id', v_attempt.id);
end;
$$;

create or replace function public.finish_billing_checkout(
  p_org_id uuid,
  p_attempt_id uuid,
  p_state text,
  p_checkout_url text default null,
  p_checkout_session_id text default null,
  p_expires_at timestamptz default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_state not in ('ready', 'unknown', 'failed') then
    raise exception 'Invalid checkout attempt state';
  end if;
  if p_state = 'ready' and (
    p_checkout_url is null or btrim(p_checkout_url) = ''
    or p_checkout_session_id is null or btrim(p_checkout_session_id) = ''
    or p_expires_at is null or p_expires_at <= now()
  ) then
    raise exception 'Unexpired checkout URL is required';
  end if;

  update public.billing_checkout_attempts
     set state = p_state,
         checkout_url = case when p_state = 'ready' then p_checkout_url else checkout_url end,
         checkout_session_id = case when p_state = 'ready' then p_checkout_session_id else checkout_session_id end,
         expires_at = case when p_state = 'ready' then p_expires_at else expires_at end,
         lease_expires_at = null,
         error_code = p_error_code,
         updated_at = now()
   where id = p_attempt_id
     and org_id = p_org_id
     and state = 'reserved';
  return found;
end;
$$;

create or replace function public.set_billing_customer_if_unsubscribed(
  p_org_id uuid,
  p_user_id uuid,
  p_stripe_customer_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_billing public.org_billing%rowtype;
  v_role text;
begin
  if p_org_id is null or p_user_id is null
     or p_stripe_customer_id is null or btrim(p_stripe_customer_id) = '' then
    raise exception 'Workspace, actor, and Stripe customer are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nudgepay:org-billing:' || p_org_id::text, 0)
  );

  select role into v_role
  from public.memberships
  where org_id = p_org_id and user_id = p_user_id
  for key share;
  if not found or v_role <> 'owner' then
    raise exception 'Workspace billing permission denied' using errcode = '42501';
  end if;

  select * into v_billing
  from public.org_billing
  where org_id = p_org_id
  for update;

  if found and (
    v_billing.status in ('incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'paused')
    or (v_billing.stripe_subscription_id is not null and v_billing.status not in ('canceled', 'incomplete_expired'))
  ) then
    return false;
  end if;

  if found and v_billing.stripe_customer_id is not null
     and v_billing.stripe_customer_id <> p_stripe_customer_id then
    raise exception 'Workspace is already linked to another Stripe customer';
  end if;

  insert into public.org_billing (org_id, stripe_customer_id, status, updated_at)
  values (p_org_id, p_stripe_customer_id, 'none', now())
  on conflict (org_id) do update set
    stripe_customer_id = excluded.stripe_customer_id,
    updated_at = excluded.updated_at;

  return true;
end;
$$;

create or replace function public.apply_stripe_billing_event(
  p_event_id text,
  p_event_created_at timestamptz,
  p_event_type text,
  p_org_id uuid,
  p_status text,
  p_stripe_customer_id text default null,
  p_stripe_subscription_id text default null,
  p_current_period_end timestamptz default null,
  p_checkout_attempt_id uuid default null,
  p_checkout_session_id text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.org_billing%rowtype;
begin
  if p_event_id is null or btrim(p_event_id) = '' or p_event_created_at is null then
    raise exception 'Stripe event identity is required';
  end if;
  if p_event_type in (
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted'
  ) and (p_stripe_subscription_id is null or btrim(p_stripe_subscription_id) = '') then
    raise exception 'Stripe subscription identity is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nudgepay:org-billing:' || p_org_id::text, 0)
  );

  insert into public.stripe_webhook_events (
    event_id, org_id, event_type, event_created_at, stripe_subscription_id
  ) values (
    p_event_id, p_org_id, p_event_type, p_event_created_at, p_stripe_subscription_id
  ) on conflict (event_id) do nothing;
  if not found then
    return false;
  end if;

  select * into v_current
  from public.org_billing
  where org_id = p_org_id
  for update;

  if found and v_current.last_stripe_event_created_at is not null and
     p_event_created_at < v_current.last_stripe_event_created_at then
    return false;
  end if;

  if found
     and v_current.stripe_customer_id is not null
     and p_stripe_customer_id is not null
     and p_stripe_customer_id <> v_current.stripe_customer_id then
    raise exception 'Stripe customer does not match workspace billing record';
  end if;

  -- An event for a retired subscription must not overwrite the current one,
  -- even when Stripe creates/delivers that retirement event later.
  if found
     and v_current.stripe_subscription_id is not null
     and p_stripe_subscription_id is distinct from v_current.stripe_subscription_id
     and not (
       p_event_type in ('checkout.session.completed', 'customer.subscription.created')
       and v_current.status in ('none', 'canceled', 'incomplete_expired')
     ) then
    return false;
  end if;

  insert into public.org_billing (
    org_id, stripe_customer_id, stripe_subscription_id, status,
    current_period_end, updated_at,
    last_stripe_event_id, last_stripe_event_created_at
  ) values (
    p_org_id, p_stripe_customer_id, p_stripe_subscription_id, p_status,
    p_current_period_end, now(), p_event_id, p_event_created_at
  )
  on conflict (org_id) do update set
    stripe_customer_id = coalesce(excluded.stripe_customer_id, org_billing.stripe_customer_id),
    stripe_subscription_id = coalesce(excluded.stripe_subscription_id, org_billing.stripe_subscription_id),
    status = excluded.status,
    current_period_end = coalesce(excluded.current_period_end, org_billing.current_period_end),
    updated_at = excluded.updated_at,
    last_stripe_event_id = excluded.last_stripe_event_id,
    last_stripe_event_created_at = excluded.last_stripe_event_created_at;

  update public.stripe_webhook_events set applied = true where event_id = p_event_id;

  if p_event_type = 'checkout.session.completed'
     and p_checkout_attempt_id is not null
     and p_checkout_session_id is not null
     and btrim(p_checkout_session_id) <> '' then
    update public.billing_checkout_attempts
       set state = 'completed', updated_at = now()
     where id = p_checkout_attempt_id
       and org_id = p_org_id
       and state in ('reserved', 'ready', 'unknown')
       and (checkout_session_id is null or checkout_session_id = p_checkout_session_id);
  elsif p_event_type = 'customer.subscription.created'
        and p_checkout_attempt_id is not null then
    update public.billing_checkout_attempts
       set state = 'completed', updated_at = now()
     where id = p_checkout_attempt_id
       and org_id = p_org_id
       and state in ('reserved', 'ready', 'unknown');
  end if;

  return true;
end;
$$;

revoke all on function public.reserve_billing_checkout(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.finish_billing_checkout(uuid, uuid, text, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.set_billing_customer_if_unsubscribed(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.apply_stripe_billing_event(text, timestamptz, text, uuid, text, text, text, timestamptz, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reserve_billing_checkout(uuid, uuid) to service_role;
grant execute on function public.finish_billing_checkout(uuid, uuid, text, text, text, timestamptz, text) to service_role;
grant execute on function public.set_billing_customer_if_unsubscribed(uuid, uuid, text) to service_role;
grant execute on function public.apply_stripe_billing_event(text, timestamptz, text, uuid, text, text, text, timestamptz, uuid, text)
  to service_role;

alter table public.text_messages
  add column send_fingerprint text,
  add column send_dedupe_key text,
  add column provider_idempotency_key text;
alter table public.email_messages
  add column send_fingerprint text,
  add column send_dedupe_key text,
  add column provider_idempotency_key text;

-- Outbound delivery records are a service-owned integrity boundary. Authenticated
-- workspace roles may read them but cannot forge, clear, backdate, or relabel
-- provider attempts to bypass dedupe and rate limits.
create or replace function public.protect_text_message_sender_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    if auth.role() = 'service_role' then return old; end if;
    if old.direction is not distinct from 'outbound'
       or old.messaging_service_sid is not null
       or old.twilio_message_sid is not null
       or old.from_number is not null then
      raise exception 'SMS sender identity is service-written' using errcode = '42501';
    end if;
    return old;
  end if;
  if auth.role() = 'service_role' then return new; end if;
  -- GoTrue's database-side ON DELETE SET NULL has no request JWT. Permit only
  -- that exact actor anonymization so personal-account deletion keeps working;
  -- authenticated Data API callers still cannot rewrite ledger attribution.
  if TG_OP = 'UPDATE'
     and auth.role() is null
     and old.sent_by_user_id is not null
     and new.sent_by_user_id is null
     and (
       to_jsonb(new) - array[
         'sent_by_user_id', 'from_number_norm', 'to_number_norm', 'messaging_service_sid_norm'
       ]::text[]
     ) = (
       to_jsonb(old) - array[
         'sent_by_user_id', 'from_number_norm', 'to_number_norm', 'messaging_service_sid_norm'
       ]::text[]
     ) then
    return new;
  end if;
  if TG_OP = 'INSERT' then
    if new.direction is not distinct from 'outbound' then
      raise exception 'outbound SMS is service-written' using errcode = '42501';
    end if;
    new.messaging_service_sid := null;
    new.twilio_message_sid := null;
    new.from_number := null;
    new.send_fingerprint := null;
    new.send_dedupe_key := null;
    new.provider_idempotency_key := null;
    return new;
  end if;
  if old.direction = 'outbound' then
    raise exception 'outbound SMS is service-written' using errcode = '42501';
  end if;
  if new.org_id is distinct from old.org_id
     or new.messaging_service_sid is distinct from old.messaging_service_sid
     or new.twilio_message_sid is distinct from old.twilio_message_sid
     or new.from_number is distinct from old.from_number
     or new.to_number is distinct from old.to_number
     or new.direction is distinct from old.direction
     or new.status is distinct from old.status
     or new.error_code is distinct from old.error_code
     or new.created_at is distinct from old.created_at
     or new.send_fingerprint is distinct from old.send_fingerprint
     or new.send_dedupe_key is distinct from old.send_dedupe_key
     or new.provider_idempotency_key is distinct from old.provider_idempotency_key then
    raise exception 'SMS provider attempt is service-written' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.protect_email_message_provider_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'service_role' then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;
  -- Match the narrow GoTrue FK anonymization exception used for SMS above.
  if TG_OP = 'UPDATE'
     and auth.role() is null
     and old.sent_by_user_id is not null
     and new.sent_by_user_id is null
     and (to_jsonb(new) - 'sent_by_user_id') = (to_jsonb(old) - 'sent_by_user_id') then
    return new;
  end if;
  if TG_OP = 'DELETE' and old.direction = 'outbound' then
    raise exception 'outbound email is service-written' using errcode = '42501';
  end if;
  if TG_OP = 'INSERT' and new.direction = 'outbound' then
    raise exception 'outbound email is service-written' using errcode = '42501';
  end if;
  if TG_OP = 'UPDATE' and (
    old.direction = 'outbound'
    or new.direction is distinct from old.direction
    or new.org_id is distinct from old.org_id
    or new.provider_message_id is distinct from old.provider_message_id
    or new.status is distinct from old.status
    or new.error_code is distinct from old.error_code
    or new.from_address is distinct from old.from_address
    or new.to_address is distinct from old.to_address
    or new.created_at is distinct from old.created_at
    or new.send_fingerprint is distinct from old.send_fingerprint
    or new.send_dedupe_key is distinct from old.send_dedupe_key
    or new.provider_idempotency_key is distinct from old.provider_idempotency_key
  ) then
    raise exception 'email provider attempt is service-written' using errcode = '42501';
  end if;
  return case when TG_OP = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists protect_email_message_provider_attempt on public.email_messages;
create trigger protect_email_message_provider_attempt
before insert or update or delete on public.email_messages
for each row execute function public.protect_email_message_provider_attempt();

create unique index text_messages_active_send_fingerprint_key
  on public.text_messages (send_fingerprint)
  where direction = 'outbound'
    and send_fingerprint is not null
    and status in ('sending', 'unknown');
create unique index text_messages_send_dedupe_key
  on public.text_messages (send_dedupe_key)
  where direction = 'outbound' and send_dedupe_key is not null;

create unique index email_messages_active_send_fingerprint_key
  on public.email_messages (send_fingerprint)
  where direction = 'outbound'
    and send_fingerprint is not null
    and status in ('sending', 'unknown');
create unique index email_messages_send_dedupe_key
  on public.email_messages (send_dedupe_key)
  where direction = 'outbound' and send_dedupe_key is not null;

create or replace function public.reserve_sms_send(
  p_org_id uuid,
  p_invoice_id uuid,
  p_customer_id uuid,
  p_case_id uuid,
  p_sent_by_user_id uuid,
  p_to_number text,
  p_body text,
  p_from_number text,
  p_messaging_service_sid text,
  p_send_fingerprint text,
  p_send_dedupe_key text,
  p_provider_idempotency_key text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.text_messages%rowtype;
  v_id uuid;
  v_org_count bigint;
  v_customer_count bigint;
  v_terminal_id uuid;
  v_provider_key text;
begin
  if p_org_id is null or p_customer_id is null
     or p_send_fingerprint is null or btrim(p_send_fingerprint) = ''
     or p_send_dedupe_key is null or btrim(p_send_dedupe_key) = ''
     or p_provider_idempotency_key is null or btrim(p_provider_idempotency_key) = '' then
    raise exception 'SMS send identity is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nudgepay:sms-budget:' || p_org_id::text, 0)
  );

  perform 1
  from public.memberships
  where org_id = p_org_id and user_id = p_sent_by_user_id
  for key share;
  if not found then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;

  select * into v_existing
  from public.text_messages
  where direction = 'outbound' and send_dedupe_key = p_send_dedupe_key
  limit 1;
  if found then
    if v_existing.status in ('sending', 'unknown') then
      return jsonb_build_object('state', 'unknown', 'id', v_existing.id);
    end if;
    if v_existing.status in ('failed', 'undelivered', 'canceled') then
      v_terminal_id := v_existing.id;
    else
      return jsonb_build_object(
        'state', 'recorded', 'id', v_existing.id,
        'provider_id', v_existing.twilio_message_sid,
        'provider_status', v_existing.status
      );
    end if;
  end if;

  select * into v_existing
  from public.text_messages
  where direction = 'outbound'
    and send_fingerprint = p_send_fingerprint
    and status in ('sending', 'unknown')
  limit 1;
  if found then
    return jsonb_build_object('state', 'unknown', 'id', v_existing.id);
  end if;

  select count(*) into v_org_count
  from public.text_messages
  where org_id = p_org_id and direction = 'outbound'
    and created_at >= p_now - interval '1 hour';
  if v_org_count >= 120 then
    return jsonb_build_object('state', 'org_cap');
  end if;

  select count(*) into v_customer_count
  from public.text_messages
  where org_id = p_org_id and customer_id = p_customer_id
    and direction = 'outbound'
    and created_at >= p_now - interval '24 hours';
  if v_customer_count >= 8 then
    return jsonb_build_object('state', 'customer_cap');
  end if;

  v_id := gen_random_uuid();
  v_provider_key := p_provider_idempotency_key;
  if v_terminal_id is not null then
    update public.text_messages
       set send_dedupe_key = left(p_send_dedupe_key, 70) || ':terminal:' || replace(v_terminal_id::text, '-', '')
     where id = v_terminal_id;
    v_provider_key := left(p_provider_idempotency_key, 80) || ':retry:' || replace(v_id::text, '-', '');
  end if;

  insert into public.text_messages (
    id,
    org_id, invoice_id, customer_id, case_id, sent_by_user_id,
    direction, status, from_number, messaging_service_sid, to_number, body,
    send_fingerprint, send_dedupe_key, provider_idempotency_key, created_at
  ) values (
    v_id,
    p_org_id, p_invoice_id, p_customer_id, p_case_id, p_sent_by_user_id,
    'outbound', 'sending', p_from_number, p_messaging_service_sid, p_to_number, p_body,
    p_send_fingerprint, p_send_dedupe_key, v_provider_key, p_now
  );

  return jsonb_build_object('state', 'reserved', 'id', v_id, 'provider_key', v_provider_key);
end;
$$;

create or replace function public.reserve_email_send(
  p_org_id uuid,
  p_invoice_id uuid,
  p_customer_id uuid,
  p_case_id uuid,
  p_sent_by_user_id uuid,
  p_from_address text,
  p_to_address text,
  p_subject text,
  p_body text,
  p_send_fingerprint text,
  p_send_dedupe_key text,
  p_provider_idempotency_key text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.email_messages%rowtype;
  v_id uuid;
  v_org_count bigint;
  v_customer_count bigint;
  v_terminal_id uuid;
  v_provider_key text;
begin
  if p_org_id is null or p_customer_id is null
     or p_send_fingerprint is null or btrim(p_send_fingerprint) = ''
     or p_send_dedupe_key is null or btrim(p_send_dedupe_key) = ''
     or p_provider_idempotency_key is null or btrim(p_provider_idempotency_key) = '' then
    raise exception 'Email send identity is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nudgepay:email-budget:' || p_org_id::text, 0)
  );

  perform 1
  from public.memberships
  where org_id = p_org_id and user_id = p_sent_by_user_id
  for key share;
  if not found then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;

  select * into v_existing
  from public.email_messages
  where direction = 'outbound' and send_dedupe_key = p_send_dedupe_key
  limit 1;
  if found then
    if v_existing.status in ('sending', 'unknown') then
      return jsonb_build_object('state', 'unknown', 'id', v_existing.id);
    end if;
    if v_existing.status in ('failed', 'bounced', 'complained', 'canceled') then
      v_terminal_id := v_existing.id;
    else
      return jsonb_build_object(
        'state', 'recorded', 'id', v_existing.id,
        'provider_id', v_existing.provider_message_id,
        'provider_status', v_existing.status
      );
    end if;
  end if;

  select * into v_existing
  from public.email_messages
  where direction = 'outbound'
    and send_fingerprint = p_send_fingerprint
    and status in ('sending', 'unknown')
  limit 1;
  if found then
    return jsonb_build_object('state', 'unknown', 'id', v_existing.id);
  end if;

  select count(*) into v_org_count
  from public.email_messages
  where org_id = p_org_id and direction = 'outbound'
    and created_at >= p_now - interval '1 hour';
  if v_org_count >= 120 then
    return jsonb_build_object('state', 'org_cap');
  end if;

  select count(*) into v_customer_count
  from public.email_messages
  where org_id = p_org_id and customer_id = p_customer_id
    and direction = 'outbound'
    and created_at >= p_now - interval '24 hours';
  if v_customer_count >= 8 then
    return jsonb_build_object('state', 'customer_cap');
  end if;

  v_id := gen_random_uuid();
  v_provider_key := p_provider_idempotency_key;
  if v_terminal_id is not null then
    update public.email_messages
       set send_dedupe_key = left(p_send_dedupe_key, 70) || ':terminal:' || replace(v_terminal_id::text, '-', '')
     where id = v_terminal_id;
    v_provider_key := left(p_provider_idempotency_key, 80) || ':retry:' || replace(v_id::text, '-', '');
  end if;

  insert into public.email_messages (
    id,
    org_id, invoice_id, customer_id, case_id, sent_by_user_id,
    direction, status, from_address, to_address, subject, body,
    send_fingerprint, send_dedupe_key, provider_idempotency_key, created_at
  ) values (
    v_id,
    p_org_id, p_invoice_id, p_customer_id, p_case_id, p_sent_by_user_id,
    'outbound', 'sending', p_from_address, p_to_address, p_subject, p_body,
    p_send_fingerprint, p_send_dedupe_key, v_provider_key, p_now
  );

  return jsonb_build_object('state', 'reserved', 'id', v_id, 'provider_key', v_provider_key);
end;
$$;

revoke all on function public.reserve_sms_send(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.reserve_email_send(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.reserve_sms_send(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, timestamptz
) to service_role;
grant execute on function public.reserve_email_send(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, timestamptz
) to service_role;

create table public.provider_reconciliation_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null check (channel in ('sms', 'email', 'stripe_checkout')),
  attempt_id uuid not null,
  outcome text not null check (outcome in ('sent', 'not_sent', 'completed', 'expired')),
  provider_reference text,
  operator_reference text not null check (btrim(operator_reference) <> ''),
  reconciled_at timestamptz not null default now()
);

alter table public.provider_reconciliation_audit enable row level security;
revoke all on table public.provider_reconciliation_audit from anon, authenticated;
grant select, insert, delete on table public.provider_reconciliation_audit to service_role;
