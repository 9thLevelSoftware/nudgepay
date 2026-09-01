-- A user may belong to more than one workspace. Unique (org_id, user_id) from
-- 0001 still prevents a duplicate membership in the same org.

drop index if exists memberships_user_id_key;
create index if not exists memberships_user_id_idx on memberships (user_id);

create or replace function public.accept_invite(p_token text, p_user_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invites%rowtype;
  v_already boolean;
begin
  if p_token is null or p_user_id is null then
    raise exception 'Invite not found';
  end if;

  select * into v_inv from public.invites where token = p_token for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_inv.email is null or p_email is null
     or btrim(v_inv.email) = '' or btrim(p_email) = '' then
    raise exception 'Invite email missing';
  end if;
  if lower(v_inv.email) <> lower(p_email) then
    raise exception 'This invite was sent to a different email address';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'Invite already accepted';
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at <= now() then
    raise exception 'Invite expired';
  end if;

  select exists (
    select 1 from public.memberships
    where user_id = p_user_id and org_id = v_inv.org_id
  ) into v_already;

  update public.invites
     set accepted_at = now()
   where id = v_inv.id and accepted_at is null;
  if not found then
    raise exception 'Invite not found';
  end if;

  if not v_already then
    insert into public.memberships (org_id, user_id, role)
    values (v_inv.org_id, p_user_id, 'member');
  end if;

  return v_inv.org_id;
end;
$$;
