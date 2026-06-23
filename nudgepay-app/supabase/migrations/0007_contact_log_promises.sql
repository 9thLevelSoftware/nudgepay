-- Phase 5b: promise-to-pay tracking on contact logs.
-- contact_logs already exists (0001) with RLS (contact_logs_all) and grants;
-- this only adds two nullable columns and a lookup index. No RLS/grant change.
alter table contact_logs
  add column promised_amount numeric(12,2),
  add column promised_date   date;

-- The dashboard loader reads contact logs filtered by (org_id, invoice_id in (...)).
create index contact_logs_org_invoice_idx on contact_logs (org_id, invoice_id);
