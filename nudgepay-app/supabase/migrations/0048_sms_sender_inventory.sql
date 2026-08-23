-- Per-org SMS sender inventory: outbound From/SID and inbound To routing.

create table sms_sender_inventory (
  org_id uuid primary key references organizations(id) on delete cascade,
  messaging_service_sid text,
  from_number text,
  from_number_last10 text generated always as (public.phone_last10(from_number)) stored,
  messaging_service_sid_norm text generated always as (
    nullif(lower(btrim(messaging_service_sid)), '')
  ) stored,
  status text not null default 'active'
    check (status in ('active', 'pending', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_sender_inventory_sender_present
    check (
      (messaging_service_sid is not null and btrim(messaging_service_sid) <> '')
      or (from_number is not null and btrim(from_number) <> '')
    )
);

create unique index sms_sender_inventory_from_number_key
  on sms_sender_inventory (from_number)
  where from_number is not null;

create unique index sms_sender_inventory_from_number_last10_key
  on sms_sender_inventory (from_number_last10)
  where from_number_last10 is not null;

-- Unique on the trimmed SID so "MG… " and "MG…" cannot provision two orgs
-- onto the same Twilio sender (resolveSender trims before send).
create unique index sms_sender_inventory_messaging_service_sid_key
  on sms_sender_inventory (messaging_service_sid_norm)
  where messaging_service_sid_norm is not null;

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

-- Persist the outbound Messaging Service SID so fallback-SID inbound history
-- can filter to that service instead of treating every null-from send as a match.
alter table text_messages
  add column if not exists messaging_service_sid text;
alter table text_messages
  add column if not exists messaging_service_sid_norm text
    generated always as (nullif(lower(btrim(messaging_service_sid)), '')) stored;
create index if not exists text_messages_outbound_sid_idx
  on text_messages (to_number_norm, messaging_service_sid_norm)
  where direction = 'outbound' and messaging_service_sid_norm is not null;

-- Inbound SID/From routing treats outbound history as sender evidence. JWT
-- members/owners may insert ledger rows, but they must not stamp, relabel,
-- or delete Twilio SID/From identity that could redirect a signed reply.
create or replace function public.protect_text_message_sender_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if auth.role() = 'service_role' then
      return old;
    end if;
    if old.direction is not distinct from 'outbound'
       or old.messaging_service_sid is not null
       or old.twilio_message_sid is not null
       or old.from_number is not null then
      raise exception 'SMS sender identity is service-written'
        using errcode = '42501';
    end if;
    return old;
  end if;
  if auth.role() = 'service_role' then
    return new;
  end if;
  if TG_OP = 'INSERT' then
    if new.direction is not distinct from 'outbound' then
      raise exception 'outbound SMS is service-written'
        using errcode = '42501';
    end if;
    new.messaging_service_sid := null;
    new.twilio_message_sid := null;
    new.from_number := null;
    return new;
  end if;
  if new.org_id is distinct from old.org_id
     or new.messaging_service_sid is distinct from old.messaging_service_sid
     or new.twilio_message_sid is distinct from old.twilio_message_sid
     or new.from_number is distinct from old.from_number
     or new.to_number is distinct from old.to_number
     or new.direction is distinct from old.direction then
    raise exception 'SMS sender identity is service-written'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_text_message_sender_identity on text_messages;
create trigger protect_text_message_sender_identity
before insert or update or delete on text_messages
for each row execute function public.protect_text_message_sender_identity();
