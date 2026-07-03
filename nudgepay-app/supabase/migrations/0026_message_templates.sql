-- Phase 3: org-editable message templates with company tokens.

create table message_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  channel text not null check (channel in ('sms','email')),
  slug text not null check (slug ~ '^[a-z0-9-]{1,60}$'),
  label text not null check (length(label) between 1 and 80),
  subject text,                -- email only
  body text not null check (length(body) between 1 and 2000),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, channel, slug)
);

create index message_templates_org_channel_sort_idx
  on message_templates (org_id, channel, sort);

alter table message_templates enable row level security;

create policy message_templates_member_read on message_templates
  for select using (is_org_member(org_id));
create policy message_templates_owner_write on message_templates
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));

-- Reuse the set_updated_at() trigger function from 0018
create trigger message_templates_set_updated_at
  before update on message_templates
  for each row
  execute function public.set_updated_at();

-- Seed existing orgs with 4 SMS + 4 email starters using {company} token
-- (replaces hardcoded "Chancey Heating & Cooling"). New orgs get seeded
-- at creation time (app code, not migration).
insert into message_templates (org_id, channel, slug, label, subject, body, sort)
select o.id, 'sms', s.slug, s.label, null, s.body, s.sort
from organizations o
cross join (values
  ('friendly-reminder', 'Friendly reminder',
   'Hi {customer}, a friendly reminder that invoice {invoice} for {balance} was due {dueDate}. Reply with any questions. — {company}', 0),
  ('past-due', 'Past due',
   'Hi {customer}, invoice {invoice} ({balance}) is now past due as of {dueDate}. Please let us know when we can expect payment. — {company}', 1),
  ('final-notice', 'Final notice',
   '{customer}, invoice {invoice} for {balance} remains unpaid and is now seriously past due. Please contact us promptly to avoid further action. — {company}', 2),
  ('payment-received', 'Payment received',
   'Thanks {customer}! We''ve received payment for invoice {invoice}. We appreciate your business. — {company}', 3)
) as s(slug, label, body, sort);

insert into message_templates (org_id, channel, slug, label, subject, body, sort)
select o.id, 'email', s.slug, s.label, s.subject, s.body, s.sort
from organizations o
cross join (values
  ('friendly-reminder', 'Friendly reminder', 'Reminder: invoice {invoice} from {company}',
   E'Hi {customer},\n\nThis is a friendly reminder that invoice {invoice} for {balance} was due {dueDate}. If you have already sent payment, thank you — please disregard this note. Otherwise, reply with any questions and we''ll be glad to help.\n\nThank you,\n{company}', 0),
  ('past-due', 'Past due', 'Past due: invoice {invoice}',
   E'Hi {customer},\n\nInvoice {invoice} for {balance} is now past due as of {dueDate}. Please let us know when we can expect payment, or reply if there is anything we can help resolve.\n\nThank you,\n{company}', 1),
  ('final-notice', 'Final notice', 'Final notice: invoice {invoice}',
   E'{customer},\n\nInvoice {invoice} for {balance} remains unpaid and is now seriously past due. Please contact us promptly to arrange payment and avoid further action.\n\n{company}', 2),
  ('payment-received', 'Payment received', 'Payment received — thank you',
   E'Thanks {customer}!\n\nWe''ve received payment for invoice {invoice}. We appreciate your business.\n\n{company}', 3)
) as s(slug, label, subject, body, sort);
