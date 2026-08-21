-- Owner can change roles and remove members. Users can leave (except last owner).

drop policy if exists mem_owner_update on memberships;
create policy mem_owner_update on memberships
  for update using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));

drop policy if exists mem_owner_delete on memberships;
create policy mem_owner_delete on memberships
  for delete using (public.is_org_owner(org_id) or user_id = auth.uid());

create or replace function public.prevent_last_owner_exit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining int;
begin
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

drop trigger if exists memberships_prevent_last_owner on memberships;
create trigger memberships_prevent_last_owner
  before update or delete on memberships
  for each row execute function public.prevent_last_owner_exit();

create unique index if not exists invites_pending_email_idx
  on invites (org_id, lower(email))
  where accepted_at is null;
