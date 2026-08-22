-- Operator-provisioned per-org SMS sender inventory. Tenant messaging_config
-- sender columns are not trusted for outbound or inbound; this table is.
-- FK is organizations (not orgs) to match 0001/0035/0038.

create table sms_sender_inventory (
  org_id uuid primary key references organizations(id) on delete cascade,
  messaging_service_sid text,
  from_number text,
  from_number_last10 text generated always as (public.phone_last10(from_number)) stored,
  status text not null default 'active'
    check (status in ('active', 'pending', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_sender_inventory_sender_present
    check (messaging_service_sid is not null or from_number is not null)
);

create unique index sms_sender_inventory_from_number_key
  on sms_sender_inventory (from_number)
  where from_number is not null;

create unique index sms_sender_inventory_from_number_last10_key
  on sms_sender_inventory (from_number_last10)
  where from_number_last10 is not null;

create unique index sms_sender_inventory_messaging_service_sid_key
  on sms_sender_inventory (messaging_service_sid)
  where messaging_service_sid is not null;

create trigger sms_sender_inventory_set_updated_at
  before update on sms_sender_inventory
  for each row
  execute function public.set_updated_at();

alter table sms_sender_inventory enable row level security;

create policy sms_sender_inventory_member_read on sms_sender_inventory
  for select using (public.is_org_member(org_id));

-- Writes are operator/service_role only; authenticated is select-only.
grant select, insert, update, delete on sms_sender_inventory to service_role;
revoke insert, update, delete on sms_sender_inventory from authenticated;
