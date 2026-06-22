-- Grant DML to roles that PostgREST uses (missing from 0001).
-- service_role: bypasses RLS for admin/seeding; authenticated: subject to RLS.
grant select, insert, update, delete on
  organizations, memberships, customers, invoices,
  contact_logs, text_messages, qbo_connections, messaging_config
to service_role, authenticated;

-- Enable RLS everywhere.
alter table organizations    enable row level security;
alter table memberships      enable row level security;
alter table customers        enable row level security;
alter table invoices         enable row level security;
alter table contact_logs     enable row level security;
alter table text_messages    enable row level security;
alter table qbo_connections  enable row level security;
alter table messaging_config enable row level security;

-- organizations: visible if the user is a member.
create policy org_select on organizations
  for select using (public.is_org_member(id));

-- memberships: a user sees membership rows for orgs they belong to.
create policy mem_select on memberships
  for select using (public.is_org_member(org_id));

-- Domain tables: full CRUD gated by membership of the row's org.
create policy customers_all on customers
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy invoices_all on invoices
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy contact_logs_all on contact_logs
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy text_messages_all on text_messages
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy qbo_connections_all on qbo_connections
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy messaging_config_all on messaging_config
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
