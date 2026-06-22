-- Future tables in public auto-grant DML to app roles (RLS still restricts rows).
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

-- Tenancy root
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index on memberships (user_id);
create index on memberships (org_id);

-- Membership predicate reused by all RLS policies.
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid()
  );
$$;

create table customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  qbo_id text,
  name text not null,
  email text,
  phone text,
  sms_consent boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, qbo_id)
);
create index on customers (org_id);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  qbo_id text,
  qbo_doc_number text,
  customer_id uuid references customers(id) on delete set null,
  amount numeric(12,2) not null default 0,
  balance numeric(12,2) not null default 0,
  due_date date,
  invoice_date date,
  status text not null default 'open',
  qbo_sync_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, qbo_id)
);
create index on invoices (org_id);
create index on invoices (org_id, due_date);

create table contact_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  user_id uuid not null references auth.users(id),
  method text not null,
  outcome text,
  notes text,
  follow_up_at date,
  created_at timestamptz not null default now()
);
create index on contact_logs (org_id);

create table text_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete cascade,
  sent_by_user_id uuid references auth.users(id),
  direction text not null check (direction in ('outbound','inbound')),
  twilio_message_sid text,
  status text,
  error_code text,
  from_number text,
  to_number text,
  body text,
  created_at timestamptz not null default now()
);
create index on text_messages (org_id);

create table qbo_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references organizations(id) on delete cascade,
  realm_id text,
  access_token_enc bytea,
  refresh_token_enc bytea,
  token_expires_at timestamptz,
  last_cdc_time timestamptz,
  last_sync_at timestamptz,
  status text not null default 'disconnected',
  created_at timestamptz not null default now()
);

create table messaging_config (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references organizations(id) on delete cascade,
  messaging_service_sid text,
  sender text,
  created_at timestamptz not null default now()
);
