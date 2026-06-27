-- supabase/migrations/0019_account_notes.sql
-- NudgePay-only customer notes (Accounts tab). Additive; NOT in the QBO upsert
-- column set (name/email/phone/qbo_id/org_id), so customer sync never clobbers
-- these. RLS already governs `customers` via the existing customers_all policy.
alter table customers add column notes text;
alter table customers add column notes_updated_at timestamptz;
alter table customers add column notes_updated_by uuid;
