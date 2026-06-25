-- Phase 7c (B6): durable record of failed QBO syncs so the dashboard can show an
-- unresolved-error count. A successful sync auto-resolves; a user can also
-- manually dismiss. The `truncated` (>1000 invoices) warning stays a separate
-- flag and is intentionally NOT recorded here.
create table sync_errors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  source text not null check (source in ('manual','webhook','cron')),
  scope text not null,
  message text not null,
  occurred_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index sync_errors_org_unresolved_idx on sync_errors (org_id) where resolved_at is null;

alter table sync_errors enable row level security;
-- Members read their own org's errors (dashboard loader uses the user/RLS client).
-- Inserts + auto-resolution run via the service client (bypasses RLS) from sync
-- paths. Manual dismiss runs through an org-scoped resource route (user client).
create policy sync_errors_member_read on sync_errors
  for select using (is_org_member(org_id));
create policy sync_errors_member_update on sync_errors
  for update using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Root-cause fix groundwork: migration 0009 added text_messages.case_id and
-- backfilled it once, but sendInvoiceText never set it for new sends, so every
-- text since 0009 has case_id = null. Re-backfill stragglers to the customer's
-- currently-open case (one open case per customer, enforced by the partial
-- unique index in 0009). Going-forward stamping is Task 6.
update text_messages tm
  set case_id = c.id
  from collection_cases c
  where c.customer_id = tm.customer_id
    and c.closed_at is null
    and tm.case_id is null;
