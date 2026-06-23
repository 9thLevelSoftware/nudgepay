-- Phase 6b: promise-to-pay state machine + payment/credit sync.

-- Promises: authoritative promise state (contact_logs.promised_* stays as log snapshot).
create table promises (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  case_id uuid not null references collection_cases(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','kept','partially_kept','broken','renegotiated','cancelled')),
  promised_amount numeric(12,2) not null check (promised_amount > 0),
  promised_date date not null,
  grace_until date not null,
  baseline_balance numeric(12,2) not null,
  amount_received numeric(12,2) not null default 0,
  replacement_promise_id uuid references promises(id) on delete set null,
  contact_log_id uuid references contact_logs(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index promises_one_active_per_case on promises (case_id) where status = 'pending';
create index promises_org_case_idx   on promises (org_id, case_id);
create index promises_org_status_idx on promises (org_id, status);

alter table promises enable row level security;
create policy promises_all on promises
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Multi-invoice linkage (B1). Baseline snapshot per invoice at creation.
create table promise_invoices (
  promise_id uuid not null references promises(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  baseline_balance numeric(12,2) not null,
  primary key (promise_id, invoice_id)
);
create index promise_invoices_org_invoice_idx on promise_invoices (org_id, invoice_id);

alter table promise_invoices enable row level security;
create policy promise_invoices_all on promise_invoices
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Payment / CreditMemo events (B3 re-pull driver + audit). Not consumed by the classifier.
create table payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  qbo_id text not null,
  type text not null check (type in ('payment','credit_memo')),
  amount numeric(12,2) not null,
  txn_date date,
  qbo_sync_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (org_id, qbo_id, type)
);
create index payments_org_customer_idx on payments (org_id, customer_id);

alter table payments enable row level security;
create policy payments_all on payments
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Backfill one promise per legacy contact_log that recorded a promise. Historical
-- baselines are unreconstructable, so baseline = the linked invoice's current
-- balance (best effort) and status is by date rule. grace_until = promised_date.
-- Among multiple promise logs per case, only the most recent may become pending;
-- older ones are treated as renegotiated so the one-active index holds.
-- (Implemented by marking all-but-latest as 'renegotiated' in the status expression.)
insert into promises (org_id, case_id, customer_id, status, promised_amount,
                      promised_date, grace_until, baseline_balance, contact_log_id, created_by, created_at)
select org_id, case_id, customer_id,
       case
         when rn > 1 then 'renegotiated'
         when promised_date < current_date then 'broken'
         else 'pending'
       end,
       promised_amount, promised_date, promised_date, baseline_balance, log_id, user_id, created_at
from (
  select cl.org_id, cl.case_id, cl.customer_id, cl.promised_amount, cl.promised_date,
         coalesce(i.balance, 0) as baseline_balance, cl.id as log_id, cl.user_id, cl.created_at,
         row_number() over (partition by cl.case_id order by cl.created_at desc) as rn
  from contact_logs cl
  left join invoices i on i.id = cl.invoice_id
  where cl.promised_amount is not null and cl.case_id is not null and cl.customer_id is not null
) ranked;

-- Link backfilled promises to their originating invoice when present.
insert into promise_invoices (promise_id, invoice_id, org_id, baseline_balance)
select p.id, cl.invoice_id, p.org_id, coalesce(i.balance, 0)
from promises p
join contact_logs cl on cl.id = p.contact_log_id
left join invoices i on i.id = cl.invoice_id
where cl.invoice_id is not null;
