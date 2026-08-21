alter table invoices add column paid_date date;
comment on column invoices.paid_date is
  'Org-local calendar day the invoice first transitioned to balance <= 0 after tracking began. Null if still open, or if it was already paid before this column existed.';
