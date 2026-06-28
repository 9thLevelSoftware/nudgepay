-- Phase 15 (subsystem #3a): outbound email channel.
--  * customers.do_not_email: CAN-SPAM per-customer opt-out. Email is now a
--    NudgePay channel (supersedes the 0017 "Email is not a NudgePay channel" note).
--  * email_messages: outbound (and, in #3b, inbound) email log. Mirrors
--    text_messages (0001) plus email-specific columns.
alter table customers add column do_not_email boolean not null default false;

create table email_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  case_id uuid references collection_cases(id) on delete set null,
  sent_by_user_id uuid references auth.users(id),
  direction text not null check (direction in ('outbound','inbound')),
  provider_message_id text,
  status text,
  error_code text,
  from_address text,
  to_address text,
  subject text,
  body text,
  created_at timestamptz not null default now()
);
alter table email_messages enable row level security;
create policy email_messages_member_read on email_messages
  for select using (is_org_member(org_id));
create policy email_messages_owner_write on email_messages
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));
create index email_messages_org_customer_idx on email_messages (org_id, customer_id, created_at);
