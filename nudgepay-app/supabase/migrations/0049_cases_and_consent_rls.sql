-- Split collection_cases INSERT/DELETE from member UPDATE (KD-6).
-- Members keep SELECT + UPDATE (assign / exception / next_action / priority).
-- INSERT + DELETE are owner or service-role (recon bypasses RLS).
-- Number is 0049: 0046_audit_ledger_rls / 0047_inbound_stop_lock / 0048 already exist.

drop policy if exists collection_cases_all on collection_cases;
drop policy if exists collection_cases_member_read on collection_cases;
drop policy if exists collection_cases_member_insert on collection_cases;
drop policy if exists collection_cases_member_update on collection_cases;
drop policy if exists collection_cases_owner_insert on collection_cases;
drop policy if exists collection_cases_owner_delete on collection_cases;

create policy collection_cases_member_read on collection_cases
  for select using (public.is_org_member(org_id));
create policy collection_cases_member_update on collection_cases
  for update
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy collection_cases_owner_insert on collection_cases
  for insert with check (public.is_org_owner(org_id));
create policy collection_cases_owner_delete on collection_cases
  for delete using (public.is_org_owner(org_id));

-- Members cannot write sms_consent* and cannot clear STOP-sourced do_not_text.
-- Owners + service-role remain exempt (staff restore route and inbound START).
create or replace function public.prevent_member_customer_source_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.is_org_owner(new.org_id) then
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

  -- Members may set do_not_text = true (collector opt-out).
  if old.sms_consent_source is not distinct from 'inbound_stop'
     and new.do_not_text is false then
    raise exception 'STOP-sourced do_not_text cannot be cleared by a member'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_member_customer_source_edits on customers;
create trigger prevent_member_customer_source_edits
before update on customers
for each row execute function public.prevent_member_customer_source_edits();
