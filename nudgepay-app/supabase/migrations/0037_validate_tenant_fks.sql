-- Validate composite tenant FKs introduced as NOT VALID in 0032.
-- Hosted first-run orgs have no legacy mismatched rows.

alter table invoices validate constraint invoices_org_customer_fk;
alter table collection_cases validate constraint collection_cases_org_customer_fk;
alter table contact_logs validate constraint contact_logs_org_invoice_fk;
alter table contact_logs validate constraint contact_logs_org_customer_fk;
alter table contact_logs validate constraint contact_logs_org_case_fk;
alter table text_messages validate constraint text_messages_org_invoice_fk;
alter table text_messages validate constraint text_messages_org_customer_fk;
alter table text_messages validate constraint text_messages_org_case_fk;
alter table promises validate constraint promises_org_case_fk;
alter table promises validate constraint promises_org_customer_fk;
alter table promises validate constraint promises_org_replacement_promise_fk;
alter table promises validate constraint promises_org_contact_log_fk;
alter table promise_invoices validate constraint promise_invoices_org_promise_fk;
alter table promise_invoices validate constraint promise_invoices_org_invoice_fk;
alter table payments validate constraint payments_org_customer_fk;
alter table email_messages validate constraint email_messages_org_invoice_fk;
alter table email_messages validate constraint email_messages_org_customer_fk;
alter table email_messages validate constraint email_messages_org_case_fk;
