-- inbound_stop is a legal lock. Members must not lift it (or rewrite source to
-- staff) via the customers UPDATE policy; owners override with a reason.

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

  if public.is_org_owner(new.org_id)
     and new.sms_consent is true
     and new.sms_consent_reason is not null
     and length(btrim(new.sms_consent_reason)) >= 3
     and new.sms_consent_at is not distinct from old.sms_consent_at then
    new.sms_consent := true;
    new.do_not_text := false;
    new.sms_consent_source := 'staff';
    new.sms_consent_actor := auth.uid();
    new.sms_consent_at := now();
    new.sms_consent_reason := btrim(new.sms_consent_reason);
    return new;
  end if;

  if new.sms_consent is distinct from old.sms_consent
     or new.sms_consent_source is distinct from old.sms_consent_source
     or new.do_not_text is distinct from old.do_not_text
     or new.sms_consent_reason is distinct from old.sms_consent_reason
     or new.sms_consent_actor is distinct from old.sms_consent_actor
     or new.sms_consent_at is distinct from old.sms_consent_at then
    raise exception 'inbound STOP can only be overridden by an owner with a reason'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_inbound_stop_unlock on customers;
create trigger prevent_inbound_stop_unlock
before insert or update on customers
for each row execute function public.prevent_inbound_stop_unlock();
