-- Per-customer ownership: assign an account to a team member. Nullable; an owner
-- who leaves the org has their assignments cleared (on delete set null). No RLS
-- change needed — customers access is already gated by is_org_member(org_id).
alter table customers
  add column owner uuid references auth.users(id) on delete set null;

create index customers_org_owner_idx on customers (org_id, owner);
