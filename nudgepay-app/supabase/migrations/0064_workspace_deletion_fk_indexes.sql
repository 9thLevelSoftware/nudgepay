-- Parent-row deletion runs PostgreSQL's referential-integrity checks once per
-- deleted row. These ID-leading indexes keep both the legacy single-column
-- foreign keys and the tenant-preserving composite foreign keys from scanning
-- other workspaces' rows while deleting a workspace at the pilot boundary.
--
-- On the isolated 10-workspace / 5,000-row fixture, the existing deletion
-- sequence took about 23.3 seconds. The same sequence with exactly these five
-- indexes took about 0.95 seconds in a rolled-back comparison.
-- A second fixture populated contact, email, promise, promise-invoice, and
-- payment ledgers to 5,000 rows in both a target and control workspace. That
-- workload hit the local PostgREST 8-second statement timeout until the
-- remaining measured indexes below were present; its direct deletion sequence
-- then completed in about 0.96 seconds.

-- At the bounded pilot fixture the initial base-table builds completed in
-- 13-18ms, and the later ledger-table builds in 3.6-7.3ms. Fail the deployment
-- instead of waiting indefinitely behind live writes, and cap each index build
-- so an unexpectedly larger database requires a planned retry.
set lock_timeout = '5s';
set statement_timeout = '60s';

create index if not exists invoices_customer_org_fk_idx
  on public.invoices (customer_id, org_id);

create index if not exists collection_cases_customer_org_fk_idx
  on public.collection_cases (customer_id, org_id);

create index if not exists text_messages_invoice_org_fk_idx
  on public.text_messages (invoice_id, org_id);

create index if not exists text_messages_customer_org_fk_idx
  on public.text_messages (customer_id, org_id);

create index if not exists text_messages_case_org_fk_idx
  on public.text_messages (case_id, org_id);

create index if not exists contact_logs_invoice_org_fk_idx
  on public.contact_logs (invoice_id, org_id);

create index if not exists contact_logs_customer_org_fk_idx
  on public.contact_logs (customer_id, org_id);

create index if not exists contact_logs_case_org_fk_idx
  on public.contact_logs (case_id, org_id);

create index if not exists email_messages_invoice_org_fk_idx
  on public.email_messages (invoice_id, org_id);

create index if not exists email_messages_customer_org_fk_idx
  on public.email_messages (customer_id, org_id);

create index if not exists email_messages_case_org_fk_idx
  on public.email_messages (case_id, org_id);

create index if not exists promises_case_org_fk_idx
  on public.promises (case_id, org_id);

create index if not exists promises_customer_org_fk_idx
  on public.promises (customer_id, org_id);

create index if not exists promises_replacement_org_fk_idx
  on public.promises (replacement_promise_id, org_id);

create index if not exists promises_contact_log_org_fk_idx
  on public.promises (contact_log_id, org_id);

create index if not exists promise_invoices_invoice_org_fk_idx
  on public.promise_invoices (invoice_id, org_id);

create index if not exists payments_customer_org_fk_idx
  on public.payments (customer_id, org_id);

reset statement_timeout;
reset lock_timeout;
