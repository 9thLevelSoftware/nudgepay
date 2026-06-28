-- Phase 14 (subsystem #2): per-org channel config.
--  * messaging_config gains sms_enabled (default true => existing behavior preserved)
--  * messaging_config RLS tightened from member-write to members-read / owners-write,
--    matching org_settings (fixes a pre-existing member-write looseness).
--  * email_config created as disabled groundwork for the future email backend
--    (subsystem #3). No secret/API-key column — provider credentials are a #3 decision.

alter table messaging_config add column sms_enabled boolean not null default true;

-- Retighten messaging_config RLS: replace the member read+write policy with
-- members-read / owners-write (is_org_owner exists from 0016).
drop policy if exists messaging_config_all on messaging_config;
create policy messaging_config_member_read on messaging_config
  for select using (is_org_member(org_id));
create policy messaging_config_owner_write on messaging_config
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));

create table email_config (
  org_id uuid primary key references organizations(id) on delete cascade,
  email_enabled boolean not null default false,
  from_address text,
  from_name text,
  provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now() -- not auto-updated; #3 adds a set_updated_at trigger if needed
);
alter table email_config enable row level security;
create policy email_config_member_read on email_config
  for select using (is_org_member(org_id));
create policy email_config_owner_write on email_config
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));
