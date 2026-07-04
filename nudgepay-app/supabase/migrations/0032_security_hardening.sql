-- Post-scan security hardening:
--   * owner-only invite and QBO connection writes
--   * bounded invite token lifetime
--   * member-readable but source-protected financial/customer data
--   * inbound SMS idempotency
--   * composite tenant FKs so child rows cannot pair one org_id with another
--     org's object id. NOT VALID skips historical scans but still checks new
--     inserts and updates.

-- Invite tokens expire after 14 days.
alter table invites add column if not exists expires_at timestamptz;
update invites
set expires_at = created_at + interval '14 days'
where expires_at is null;
alter table invites
  alter column expires_at set default (now() + interval '14 days'),
  alter column expires_at set not null;
create index if not exists invites_pending_expires_at_idx
  on invites (expires_at)
  where accepted_at is null;

-- RLS: invites create memberships, so direct table writes must be owner-only.
drop policy if exists invites_write on invites;
create policy invites_owner_write on invites
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));

-- RLS: QBO connection state is control-plane state. Members may read status;
-- owners mutate through app routes; service role handles OAuth/sync.
drop policy if exists qbo_connections_all on qbo_connections;
create policy qbo_connections_member_read on qbo_connections
  for select using (is_org_member(org_id));
create policy qbo_connections_owner_write on qbo_connections
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));

-- RLS: QBO-sourced financial facts are member-readable and owner/service-writable.
drop policy if exists invoices_all on invoices;
create policy invoices_member_read on invoices
  for select using (is_org_member(org_id));
create policy invoices_owner_write on invoices
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));

drop policy if exists payments_all on payments;
create policy payments_member_read on payments
  for select using (is_org_member(org_id));
create policy payments_owner_write on payments
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));

-- Customers also carry local workflow fields (owner, notes, comm prefs, consent),
-- so members keep update rights but cannot create/delete customers or edit the
-- QBO-sourced identity/contact fields.
drop policy if exists customers_all on customers;
create policy customers_member_read on customers
  for select using (is_org_member(org_id));
create policy customers_member_update on customers
  for update using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy customers_owner_insert on customers
  for insert with check (is_org_owner(org_id));
create policy customers_owner_delete on customers
  for delete using (is_org_owner(org_id));

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

  return new;
end;
$$;

drop trigger if exists prevent_member_customer_source_edits on customers;
create trigger prevent_member_customer_source_edits
before update on customers
for each row execute function public.prevent_member_customer_source_edits();

-- Inbound Twilio MessageSid is the provider idempotency key. Clean up any
-- existing duplicate inbound rows before adding the unique backstop.
delete from text_messages a
using text_messages b
where a.direction = 'inbound'
  and b.direction = 'inbound'
  and a.twilio_message_sid is not null
  and a.twilio_message_sid <> ''
  and a.twilio_message_sid = b.twilio_message_sid
  and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists text_messages_inbound_twilio_sid_key
  on text_messages (twilio_message_sid)
  where direction = 'inbound'
    and twilio_message_sid is not null
    and twilio_message_sid <> '';

-- Composite tenant keys needed by tenant-preserving FKs.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_org_id_id_key') then
    alter table invoices add constraint invoices_org_id_id_key unique (org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'collection_cases_org_id_id_key') then
    alter table collection_cases add constraint collection_cases_org_id_id_key unique (org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_logs_org_id_id_key') then
    alter table contact_logs add constraint contact_logs_org_id_id_key unique (org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promises_org_id_id_key') then
    alter table promises add constraint promises_org_id_id_key unique (org_id, id);
  end if;
end $$;

-- Tenant-preserving FKs. Names are explicit so future migrations can validate
-- them after any legacy data cleanup.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_org_customer_fk') then
    alter table invoices add constraint invoices_org_customer_fk
      foreign key (org_id, customer_id) references customers (org_id, id)
      on delete set null (customer_id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'collection_cases_org_customer_fk') then
    alter table collection_cases add constraint collection_cases_org_customer_fk
      foreign key (org_id, customer_id) references customers (org_id, id)
      on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'contact_logs_org_invoice_fk') then
    alter table contact_logs add constraint contact_logs_org_invoice_fk
      foreign key (org_id, invoice_id) references invoices (org_id, id)
      on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_logs_org_customer_fk') then
    alter table contact_logs add constraint contact_logs_org_customer_fk
      foreign key (org_id, customer_id) references customers (org_id, id)
      on delete set null (customer_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_logs_org_case_fk') then
    alter table contact_logs add constraint contact_logs_org_case_fk
      foreign key (org_id, case_id) references collection_cases (org_id, id)
      on delete set null (case_id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'text_messages_org_invoice_fk') then
    alter table text_messages add constraint text_messages_org_invoice_fk
      foreign key (org_id, invoice_id) references invoices (org_id, id)
      on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'text_messages_org_customer_fk') then
    alter table text_messages add constraint text_messages_org_customer_fk
      foreign key (org_id, customer_id) references customers (org_id, id)
      on delete set null (customer_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'text_messages_org_case_fk') then
    alter table text_messages add constraint text_messages_org_case_fk
      foreign key (org_id, case_id) references collection_cases (org_id, id)
      on delete set null (case_id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'promises_org_case_fk') then
    alter table promises add constraint promises_org_case_fk
      foreign key (org_id, case_id) references collection_cases (org_id, id)
      on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promises_org_customer_fk') then
    alter table promises add constraint promises_org_customer_fk
      foreign key (org_id, customer_id) references customers (org_id, id)
      on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promises_org_replacement_promise_fk') then
    alter table promises add constraint promises_org_replacement_promise_fk
      foreign key (org_id, replacement_promise_id) references promises (org_id, id)
      on delete set null (replacement_promise_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promises_org_contact_log_fk') then
    alter table promises add constraint promises_org_contact_log_fk
      foreign key (org_id, contact_log_id) references contact_logs (org_id, id)
      on delete set null (contact_log_id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'promise_invoices_org_promise_fk') then
    alter table promise_invoices add constraint promise_invoices_org_promise_fk
      foreign key (org_id, promise_id) references promises (org_id, id)
      on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promise_invoices_org_invoice_fk') then
    alter table promise_invoices add constraint promise_invoices_org_invoice_fk
      foreign key (org_id, invoice_id) references invoices (org_id, id)
      on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'payments_org_customer_fk') then
    alter table payments add constraint payments_org_customer_fk
      foreign key (org_id, customer_id) references customers (org_id, id)
      on delete set null (customer_id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'email_messages_org_invoice_fk') then
    alter table email_messages add constraint email_messages_org_invoice_fk
      foreign key (org_id, invoice_id) references invoices (org_id, id)
      on delete set null (invoice_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'email_messages_org_customer_fk') then
    alter table email_messages add constraint email_messages_org_customer_fk
      foreign key (org_id, customer_id) references customers (org_id, id)
      on delete set null (customer_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'email_messages_org_case_fk') then
    alter table email_messages add constraint email_messages_org_case_fk
      foreign key (org_id, case_id) references collection_cases (org_id, id)
      on delete set null (case_id) not valid;
  end if;
end $$;
