-- Atomic invite claim + membership insert. A crash between those two writes
-- used to leave accepted_at set with no membership.

create or replace function public.accept_invite(p_token text, p_user_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invites%rowtype;
  v_existing uuid;
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

  select org_id into v_existing from public.memberships where user_id = p_user_id;
  if v_existing is not null and v_existing is distinct from v_inv.org_id then
    raise exception 'already in a workspace';
  end if;

  update public.invites
     set accepted_at = now()
   where id = v_inv.id and accepted_at is null;
  if not found then
    raise exception 'Invite not found';
  end if;

  if v_existing is null then
    insert into public.memberships (org_id, user_id, role)
    values (v_inv.org_id, p_user_id, 'member');
  end if;

  return v_inv.org_id;
end;
$$;

revoke all on function public.accept_invite(text, uuid, text) from public, anon, authenticated;
grant execute on function public.accept_invite(text, uuid, text) to service_role;
