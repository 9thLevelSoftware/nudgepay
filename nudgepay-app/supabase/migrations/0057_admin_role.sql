-- Add workspace admin: owner | admin | member.
-- Admin can run settings, invites, reports, and STOP override.
-- Only owners can delete the workspace or grant/revoke owner.

alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships
  add constraint memberships_role_check
  check (role in ('owner', 'admin', 'member'));

create or replace function public.is_org_admin(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

-- Operational writes: admin or owner.
drop policy if exists org_settings_owner_write on org_settings;
create policy org_settings_owner_write on org_settings
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists org_holidays_owner_write on org_holidays;
create policy org_holidays_owner_write on org_holidays
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists messaging_config_owner_write on messaging_config;
create policy messaging_config_owner_write on messaging_config
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists email_config_owner_write on email_config;
create policy email_config_owner_write on email_config
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists message_templates_owner_write on message_templates;
create policy message_templates_owner_write on message_templates
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists org_owner_update on organizations;
create policy org_owner_update on organizations
  for update using (is_org_admin(id)) with check (is_org_admin(id));

drop policy if exists invites_owner_write on invites;
create policy invites_owner_write on invites
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists qbo_connections_owner_write on qbo_connections;
create policy qbo_connections_owner_write on qbo_connections
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists invoices_owner_write on invoices;
create policy invoices_owner_write on invoices
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists payments_owner_write on payments;
create policy payments_owner_write on payments
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists customers_owner_insert on customers;
create policy customers_owner_insert on customers
  for insert with check (is_org_admin(org_id));

drop policy if exists customers_owner_delete on customers;
create policy customers_owner_delete on customers
  for delete using (is_org_admin(org_id));

drop policy if exists contact_logs_owner_update on contact_logs;
create policy contact_logs_owner_update on contact_logs
  for update using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists contact_logs_owner_delete on contact_logs;
create policy contact_logs_owner_delete on contact_logs
  for delete using (is_org_admin(org_id));

drop policy if exists text_messages_owner_update on text_messages;
create policy text_messages_owner_update on text_messages
  for update using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists text_messages_owner_delete on text_messages;
create policy text_messages_owner_delete on text_messages
  for delete using (is_org_admin(org_id));

drop policy if exists collection_cases_owner_insert on collection_cases;
create policy collection_cases_owner_insert on collection_cases
  for insert with check (public.is_org_admin(org_id));

drop policy if exists collection_cases_owner_delete on collection_cases;
create policy collection_cases_owner_delete on collection_cases
  for delete using (public.is_org_admin(org_id));

drop policy if exists promises_owner_delete on promises;
create policy promises_owner_delete on promises
  for delete using (public.is_org_admin(org_id));

drop policy if exists promise_invoices_owner_delete on promise_invoices;
create policy promise_invoices_owner_delete on promise_invoices
  for delete using (public.is_org_admin(org_id));

-- Admins may invite/remove members and change admin/member roles.
-- Owner rows stay owner-gated by prevent_non_owner_role_change.
drop policy if exists mem_owner_update on memberships;
create policy mem_owner_update on memberships
  for update using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop policy if exists mem_owner_delete on memberships;
create policy mem_owner_delete on memberships
  for delete using (public.is_org_admin(org_id) or user_id = auth.uid());

create or replace function public.prevent_non_owner_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and old.user_id = auth.uid() then
    return old;
  end if;
  if (tg_op = 'UPDATE' and (old.role = 'owner' or new.role = 'owner'))
     or (tg_op = 'DELETE' and old.role = 'owner') then
    if not public.is_org_owner(old.org_id) then
      raise exception 'only owners can change owner memberships'
        using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists memberships_prevent_non_owner_role_change on memberships;
create trigger memberships_prevent_non_owner_role_change
  before update or delete on memberships
  for each row execute function public.prevent_non_owner_role_change();

-- Admin may edit QBO-sourced customer identity and consent the same as owner.
create or replace function public.prevent_member_customer_source_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.is_org_admin(old.org_id) then
    return new;
  end if;

  if new.org_id is distinct from old.org_id
    or new.qbo_id is distinct from old.qbo_id
    or new.name is distinct from old.name
    or new.email is distinct from old.email
    or new.phone is distinct from old.phone
    or new.created_at is distinct from old.created_at then
    raise exception 'customer source fields are owner-only'
      using errcode = '42501';
  end if;

  if new.sms_consent is distinct from old.sms_consent
    or new.sms_consent_source is distinct from old.sms_consent_source
    or new.sms_consent_at is distinct from old.sms_consent_at
    or new.sms_consent_actor is distinct from old.sms_consent_actor
    or new.sms_consent_reason is distinct from old.sms_consent_reason then
    raise exception 'customer consent fields are not member-writable'
      using errcode = '42501';
  end if;

  if old.sms_consent_source is not distinct from 'inbound_stop'
     and new.do_not_text is false then
    raise exception 'STOP-sourced do_not_text cannot be cleared by a member'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_inbound_stop_unlock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if TG_OP = 'INSERT' then
    if new.sms_consent_source is not distinct from 'inbound_stop' then
      raise exception 'inbound STOP can only be set by the inbound webhook'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.sms_consent_source is not distinct from 'inbound_stop'
     and old.sms_consent_source is distinct from 'inbound_stop' then
    raise exception 'inbound STOP can only be set by the inbound webhook'
      using errcode = '42501';
  end if;
  if old.sms_consent_source is distinct from 'inbound_stop' then
    return new;
  end if;

  if public.is_org_admin(new.org_id)
     and new.sms_consent is true
     and new.sms_consent_reason is not null
     and length(btrim(new.sms_consent_reason, E' \t\n\r\v\f')) >= 3
     and new.sms_consent_at is not distinct from old.sms_consent_at then
    new.sms_consent := true;
    new.do_not_text := false;
    new.sms_consent_source := 'staff';
    new.sms_consent_actor := auth.uid();
    new.sms_consent_at := now();
    new.sms_consent_reason := btrim(new.sms_consent_reason, E' \t\n\r\v\f');
    return new;
  end if;

  if new.sms_consent is distinct from old.sms_consent
     or new.sms_consent_source is distinct from old.sms_consent_source
     or new.do_not_text is distinct from old.do_not_text
     or new.sms_consent_reason is distinct from old.sms_consent_reason
     or new.sms_consent_actor is distinct from old.sms_consent_actor
     or new.sms_consent_at is distinct from old.sms_consent_at then
    raise exception 'inbound STOP can only be overridden by an owner or admin with a reason'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
