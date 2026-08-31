-- Owner-initiated workspace deletion. CASCADE from organizations is not enough
-- on its own: last-owner membership triggers abort child deletes, and some
-- ledger FKs are ON DELETE RESTRICT. A service_role RPC deletes restricted
-- children, bypasses the last-owner trigger for this transaction, and writes
-- a tombstone (no FK to organizations — the org row is gone).

create table if not exists public.workspace_deletions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  org_name text not null,
  deleted_by uuid,
  member_count int not null default 0,
  deleted_at timestamptz not null default now()
);

alter table public.workspace_deletions enable row level security;
revoke all on public.workspace_deletions from public, anon, authenticated;
grant insert, select on public.workspace_deletions to service_role;

create or replace function public.prevent_last_owner_exit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining int;
begin
  if current_setting('app.deleting_workspace', true) = 'true' then
    return coalesce(new, old);
  end if;
  if old.role is distinct from 'owner' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;
  select count(*) into remaining
    from public.memberships
   where org_id = old.org_id and role = 'owner' and user_id is distinct from old.user_id;
  if remaining < 1 then
    raise exception 'cannot remove or demote the last owner'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.delete_workspace(
  p_org_id uuid,
  p_deleted_by uuid,
  p_org_name text,
  p_member_count int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org_id is null then
    raise exception 'workspace not found';
  end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'workspace not found';
  end if;

  insert into public.workspace_deletions (org_id, org_name, deleted_by, member_count)
  values (p_org_id, coalesce(p_org_name, ''), p_deleted_by, coalesce(p_member_count, 0));

  perform set_config('app.deleting_workspace', 'true', true);

  -- RESTRICT ledger FKs (0046) must be cleared before org CASCADE.
  delete from public.promise_invoices where org_id = p_org_id;
  delete from public.promises where org_id = p_org_id;
  delete from public.email_messages where org_id = p_org_id;
  delete from public.text_messages where org_id = p_org_id;
  delete from public.contact_logs where org_id = p_org_id;
  delete from public.collection_cases where org_id = p_org_id;
  delete from public.payments where org_id = p_org_id;

  delete from public.organizations where id = p_org_id;
end;
$$;

revoke all on function public.delete_workspace(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function public.delete_workspace(uuid, uuid, text, int) to service_role;
