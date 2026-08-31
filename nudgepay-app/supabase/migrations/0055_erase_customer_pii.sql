-- Owner-initiated customer PII erasure. Invoices and the customer row stay
-- (QBO financial history). Name/phone/email/notes and message bodies are
-- redacted. A trigger freezes those columns after erased_at is set so CDC
-- upserts cannot restore PII.

alter table public.customers
  add column if not exists erased_at timestamptz,
  add column if not exists erased_by uuid;

create or replace function public.freeze_erased_customer_pii()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.erased_at is not null then
    new.name := old.name;
    new.email := old.email;
    new.phone := old.phone;
    new.notes := old.notes;
    new.erased_at := old.erased_at;
    new.erased_by := old.erased_by;
  end if;
  return new;
end;
$$;

drop trigger if exists freeze_erased_customer_pii on public.customers;
create trigger freeze_erased_customer_pii
  before update on public.customers
  for each row
  execute function public.freeze_erased_customer_pii();

create or replace function public.erase_customer_pii(
  p_org_id uuid,
  p_customer_id uuid,
  p_erased_by uuid,
  p_customer_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_name text;
  locked_erased timestamptz;
begin
  if p_org_id is null or p_customer_id is null then
    raise exception 'customer not found';
  end if;
  if p_erased_by is null then
    raise exception 'not an owner';
  end if;

  perform 1
    from public.memberships
   where org_id = p_org_id
     and user_id = p_erased_by
     and role = 'owner'
   for update;
  if not found then
    raise exception 'not an owner';
  end if;

  select name, erased_at into locked_name, locked_erased
    from public.customers
   where id = p_customer_id
     and org_id = p_org_id
   for update;
  if not found then
    raise exception 'customer not found';
  end if;
  if locked_erased is not null then
    raise exception 'already erased';
  end if;
  if lower(btrim(coalesce(locked_name, ''))) is distinct from lower(btrim(coalesce(p_customer_name, '')))
     or btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'name mismatch';
  end if;

  update public.customers
     set name = 'Erased customer',
         email = null,
         phone = null,
         notes = null,
         do_not_call = true,
         do_not_text = true,
         do_not_email = true,
         sms_consent = false,
         erased_at = now(),
         erased_by = p_erased_by
   where id = p_customer_id
     and org_id = p_org_id;

  update public.text_messages
     set body = '[erased]',
         to_number = null,
         from_number = null
   where org_id = p_org_id
     and (
       customer_id = p_customer_id
       or invoice_id in (select id from public.invoices where org_id = p_org_id and customer_id = p_customer_id)
       or case_id in (select id from public.collection_cases where org_id = p_org_id and customer_id = p_customer_id)
     );

  update public.email_messages
     set body = '[erased]',
         subject = '[erased]',
         to_address = null,
         from_address = null
   where org_id = p_org_id
     and (
       customer_id = p_customer_id
       or invoice_id in (select id from public.invoices where org_id = p_org_id and customer_id = p_customer_id)
       or case_id in (select id from public.collection_cases where org_id = p_org_id and customer_id = p_customer_id)
     );

  update public.contact_logs
     set notes = null
   where org_id = p_org_id
     and (
       customer_id = p_customer_id
       or invoice_id in (select id from public.invoices where org_id = p_org_id and customer_id = p_customer_id)
       or case_id in (select id from public.collection_cases where org_id = p_org_id and customer_id = p_customer_id)
     );
end;
$$;

revoke all on function public.erase_customer_pii(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.erase_customer_pii(uuid, uuid, uuid, text) to service_role;

-- Block new PII writes after erasure (contact logs / messages, including
-- invoice- or case-linked rows whose customer_id is null).
create or replace function public.reject_write_on_erased_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
  erased timestamptz;
begin
  cid := new.customer_id;
  if cid is null and new.invoice_id is not null then
    select customer_id into cid from public.invoices where id = new.invoice_id;
  end if;
  if cid is null and new.case_id is not null then
    select customer_id into cid from public.collection_cases where id = new.case_id;
  end if;
  if cid is null then
    return new;
  end if;
  select erased_at into erased from public.customers where id = cid;
  if erased is not null then
    raise exception 'customer erased';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_write_on_erased_customer on public.contact_logs;
create trigger reject_write_on_erased_customer
  before insert on public.contact_logs
  for each row
  execute function public.reject_write_on_erased_customer();

drop trigger if exists reject_write_on_erased_customer on public.text_messages;
create trigger reject_write_on_erased_customer
  before insert on public.text_messages
  for each row
  execute function public.reject_write_on_erased_customer();

drop trigger if exists reject_write_on_erased_customer on public.email_messages;
create trigger reject_write_on_erased_customer
  before insert on public.email_messages
  for each row
  execute function public.reject_write_on_erased_customer();
