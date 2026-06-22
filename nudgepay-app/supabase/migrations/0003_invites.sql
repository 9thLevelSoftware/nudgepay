create table invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index on invites (org_id);

alter table invites enable row level security;
create policy invites_select on invites
  for select using (public.is_org_member(org_id));
create policy invites_write on invites
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
