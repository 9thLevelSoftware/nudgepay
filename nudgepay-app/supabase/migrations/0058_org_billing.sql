-- Agency SaaS billing for the workspace (the owner pays NudgePay).
-- This is not debtor payments. Writes go through the service role webhook.

create table public.org_billing (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  status text not null default 'none'
    check (status in ('none','incomplete','trialing','active','past_due','canceled','unpaid')),
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.org_billing enable row level security;

create policy org_billing_member_read on public.org_billing
  for select using (public.is_org_member(org_id));
