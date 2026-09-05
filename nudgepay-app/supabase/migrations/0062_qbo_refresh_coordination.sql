-- Serialize QuickBooks refresh-token rotation per workspace. A short durable
-- lease prevents parallel Workers from posting the same refresh token, while a
-- monotonic generation makes provider completions conditional on the exact
-- connection they observed before leaving the database transaction.

alter table public.qbo_connections
  add column connection_generation bigint not null default 1,
  add column refresh_lease_id uuid,
  add column refresh_lease_expires_at timestamptz;

create or replace function public.bump_qbo_connection_generation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.realm_id is distinct from old.realm_id
     or new.access_token_enc is distinct from old.access_token_enc
     or new.refresh_token_enc is distinct from old.refresh_token_enc
     or new.token_expires_at is distinct from old.token_expires_at
     or new.status is distinct from old.status then
    new.connection_generation := old.connection_generation + 1;
    new.refresh_lease_id := null;
    new.refresh_lease_expires_at := null;
  else
    -- Callers cannot manufacture a generation without changing connection
    -- state. Lease-only writes intentionally preserve the generation.
    new.connection_generation := old.connection_generation;
  end if;
  return new;
end;
$$;

drop trigger if exists bump_qbo_connection_generation on public.qbo_connections;
create trigger bump_qbo_connection_generation
before update on public.qbo_connections
for each row execute function public.bump_qbo_connection_generation();

-- Store an OAuth token pair without allowing two callbacks to bind the same
-- workspace to different QuickBooks companies. The unique insert conflict and
-- row lock serialize first-connect and reconnect attempts per organization.
create or replace function public.store_qbo_connection(
  p_org_id uuid,
  p_realm_id text,
  p_access_token_enc text,
  p_refresh_token_enc text,
  p_token_expires_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_realm_id text;
begin
  if nullif(pg_catalog.btrim(p_realm_id), '') is null
     or pg_catalog.length(p_realm_id) > 255
     or nullif(pg_catalog.btrim(p_access_token_enc), '') is null
     or pg_catalog.length(p_access_token_enc) > 16384
     or nullif(pg_catalog.btrim(p_refresh_token_enc), '') is null
     or pg_catalog.length(p_refresh_token_enc) > 16384
     or p_token_expires_at is null
     or p_token_expires_at <= pg_catalog.now()
     or p_token_expires_at > pg_catalog.now() + interval '24 hours' then
    return false;
  end if;

  insert into public.qbo_connections (
    org_id, realm_id, access_token_enc, refresh_token_enc, token_expires_at, status
  ) values (
    p_org_id, p_realm_id, p_access_token_enc, p_refresh_token_enc, p_token_expires_at, 'connected'
  )
  on conflict (org_id) do nothing;
  if found then
    return true;
  end if;

  select realm_id into v_realm_id
    from public.qbo_connections
   where org_id = p_org_id
   for update;
  if not found then
    return false;
  end if;
  if v_realm_id is not null and v_realm_id is distinct from p_realm_id then
    return false;
  end if;

  update public.qbo_connections
     set realm_id = p_realm_id,
         access_token_enc = p_access_token_enc,
         refresh_token_enc = p_refresh_token_enc,
         token_expires_at = p_token_expires_at,
         status = 'connected'
   where org_id = p_org_id;
  return found;
end;
$$;

create or replace function public.claim_qbo_token_refresh(
  p_org_id uuid,
  p_lease_id uuid,
  p_expected_generation bigint,
  p_expected_realm_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_connection public.qbo_connections%rowtype;
begin
  select * into v_connection
    from public.qbo_connections
   where org_id = p_org_id
   for update;

  if not found
     or v_connection.status <> 'connected'
     or v_connection.realm_id is null
     or v_connection.refresh_token_enc is null then
    return jsonb_build_object('state', 'unavailable');
  end if;

  if v_connection.connection_generation <> p_expected_generation
     or v_connection.realm_id is distinct from p_expected_realm_id then
    return jsonb_build_object('state', 'stale');
  end if;

  if v_connection.token_expires_at > pg_catalog.now() + interval '60 seconds' then
    return jsonb_build_object('state', 'ready');
  end if;

  if v_connection.refresh_lease_id is not null
     and v_connection.refresh_lease_expires_at > pg_catalog.now() then
    return jsonb_build_object(
      'state', 'wait',
      'lease_expires_at', v_connection.refresh_lease_expires_at
    );
  end if;

  update public.qbo_connections
     set refresh_lease_id = p_lease_id,
         refresh_lease_expires_at = pg_catalog.now() + interval '30 seconds'
   where org_id = p_org_id;

  return jsonb_build_object('state', 'owner');
end;
$$;

create or replace function public.finish_qbo_token_refresh(
  p_org_id uuid,
  p_lease_id uuid,
  p_expected_generation bigint,
  p_expected_realm_id text,
  p_access_token_enc text,
  p_refresh_token_enc text,
  p_token_expires_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.qbo_connections
     set access_token_enc = p_access_token_enc,
         refresh_token_enc = p_refresh_token_enc,
         token_expires_at = p_token_expires_at,
         status = 'connected',
         refresh_lease_id = null,
         refresh_lease_expires_at = null
   where org_id = p_org_id
     and status = 'connected'
     and connection_generation = p_expected_generation
     and realm_id is not distinct from p_expected_realm_id
     and refresh_lease_id = p_lease_id;
  return found;
end;
$$;

create or replace function public.fail_qbo_token_refresh(
  p_org_id uuid,
  p_lease_id uuid,
  p_expected_generation bigint,
  p_expected_realm_id text,
  p_definitive boolean
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.qbo_connections
     set status = case when p_definitive then 'error' else status end,
         refresh_lease_id = null,
         refresh_lease_expires_at = null
   where org_id = p_org_id
     and status = 'connected'
     and connection_generation = p_expected_generation
     and realm_id is not distinct from p_expected_realm_id
     and refresh_lease_id = p_lease_id;
  return found;
end;
$$;

revoke all on function public.claim_qbo_token_refresh(uuid, uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function public.store_qbo_connection(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.finish_qbo_token_refresh(uuid, uuid, bigint, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.fail_qbo_token_refresh(uuid, uuid, bigint, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.bump_qbo_connection_generation()
  from public, anon, authenticated;

grant execute on function public.claim_qbo_token_refresh(uuid, uuid, bigint, text)
  to service_role;
grant execute on function public.store_qbo_connection(uuid, text, text, text, timestamptz)
  to service_role;
grant execute on function public.finish_qbo_token_refresh(uuid, uuid, bigint, text, text, text, timestamptz)
  to service_role;
grant execute on function public.fail_qbo_token_refresh(uuid, uuid, bigint, text, boolean)
  to service_role;
