-- Email unmatched inbound uses the same orphan ledger as SMS. SMS address
-- columns must be nullable so channel='email' rows are not rejected (23502).

alter table inbound_orphans
  add column if not exists channel text not null default 'sms'
    check (channel in ('sms', 'email')),
  add column if not exists from_address text,
  add column if not exists to_address text,
  add column if not exists subject text,
  add column if not exists provider_message_id text;

alter table inbound_orphans alter column from_number drop not null;
alter table inbound_orphans alter column to_number drop not null;

alter table inbound_orphans drop constraint if exists inbound_orphans_address_present;
alter table inbound_orphans add constraint inbound_orphans_address_present check (
  (channel = 'sms' and from_number is not null and to_number is not null)
  or
  (channel = 'email' and from_address is not null and to_address is not null)
);

create unique index if not exists inbound_orphans_provider_message_id_key
  on inbound_orphans (provider_message_id)
  where provider_message_id is not null;

-- Match JS normalizeEmail: extract addr from "Name <addr>", then lower/trim.
create or replace function public.normalize_email(raw text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(lower(btrim(coalesce(substring(raw from '<([^>]+)>'), raw))), '');
$$;

alter table customers drop column if exists email_norm;
alter table customers
  add column email_norm text generated always as (public.normalize_email(email)) stored;
create index if not exists customers_email_norm_idx
  on customers (org_id, email_norm)
  where email_norm is not null;

alter table email_config drop column if exists from_address_norm;
alter table email_config
  add column from_address_norm text
    generated always as (public.normalize_email(from_address)) stored;
