-- Consent provenance + unmatched inbound persistence (NP-AUD-2026-004 / 011).
-- phone_last10 reuses public.phone_last10 from 0033.

alter table customers
  add column if not exists sms_consent_source text
    check (sms_consent_source is null or sms_consent_source in
      ('inbound_stop', 'inbound_start', 'staff', 'import', 'unknown')),
  add column if not exists sms_consent_at timestamptz,
  add column if not exists sms_consent_actor uuid,
  add column if not exists sms_consent_reason text;

alter table customers
  add column if not exists phone_last10 text
    generated always as (public.phone_last10(phone)) stored;

create index if not exists customers_phone_last10_idx
  on customers (phone_last10)
  where phone_last10 is not null;

create table if not exists inbound_orphans (
  id uuid primary key default gen_random_uuid(),
  from_number text not null,
  to_number text not null,
  body text,
  twilio_message_sid text unique,
  keyword text,
  created_at timestamptz not null default now()
);

alter table inbound_orphans enable row level security;
grant select, insert, update, delete on inbound_orphans to service_role;

-- Unique From on enabled email configs (NP-AUD-2026-013 Bar A).
create unique index if not exists email_config_from_address_unique
  on email_config (lower(from_address))
  where email_enabled is true and coalesce(from_address, '') <> '';
