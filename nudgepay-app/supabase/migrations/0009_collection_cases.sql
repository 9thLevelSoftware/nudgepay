-- Phase 6a: per-customer collection cases (durable collections state).
create table collection_cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  status text not null default 'new'
    check (status in ('new','working','promised','waiting','on_hold','resolved')),
  next_action_type text
    check (next_action_type in ('contact','follow_up','promise','waiting','exception')),
  next_action_at date,
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz,
  created_at timestamptz not null default now()
);

-- At most ONE open case per customer (auto-open singularity + idempotent reconcile).
create unique index collection_cases_one_open_per_customer
  on collection_cases (customer_id) where closed_at is null;
create index collection_cases_org_status_idx     on collection_cases (org_id, status);
create index collection_cases_org_nextaction_idx on collection_cases (org_id, next_action_at);

-- RLS: gate by org membership (mirror 0002 contact_logs_all).
alter table collection_cases enable row level security;
create policy collection_cases_all on collection_cases
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Interactions link to a case (nullable; historical rows may stay null).
alter table contact_logs  add column case_id uuid references collection_cases(id) on delete set null;
alter table text_messages add column case_id uuid references collection_cases(id) on delete set null;
create index contact_logs_org_case_idx  on contact_logs  (org_id, case_id);
create index text_messages_org_case_idx on text_messages (org_id, case_id);

-- One-time backfill: open a case for every customer with overdue work and no open case.
insert into collection_cases (org_id, customer_id, status, next_action_type, next_action_at)
select distinct i.org_id, i.customer_id, 'new', 'contact', current_date
from invoices i
where i.customer_id is not null
  and i.balance > 0
  and i.due_date < current_date
  and not exists (
    select 1 from collection_cases c
    where c.customer_id = i.customer_id and c.closed_at is null
  );

-- Backfill case_id on existing interactions to the customer's open case.
update contact_logs cl
set case_id = c.id
from collection_cases c
where c.customer_id = cl.customer_id and c.closed_at is null and cl.case_id is null;

update text_messages tm
set case_id = c.id
from collection_cases c
where c.customer_id = tm.customer_id and c.closed_at is null and tm.case_id is null;
