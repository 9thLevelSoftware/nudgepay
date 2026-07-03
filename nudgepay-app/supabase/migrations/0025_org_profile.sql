-- Phase 2: Company profile — org rename, website, phone, payment portal, timezone.
-- Adds an UPDATE policy on organizations (previously SELECT-only) for owner rename,
-- and extends org_settings with the profile columns.

-- Owners can rename the org. Members and non-members are still denied by RLS.
create policy org_owner_update on organizations
  for update using (is_org_owner(id)) with check (is_org_owner(id));

alter table org_settings
  add column company_website text,
  add column company_phone text,
  add column payment_portal_url text,
  add column timezone text not null default 'America/New_York' check (timezone <> '');
