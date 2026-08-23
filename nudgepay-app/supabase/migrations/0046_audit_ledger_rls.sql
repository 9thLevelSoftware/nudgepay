-- Split FOR ALL on cases/promises so members cannot delete the audit ledger.
-- Cancel is an UPDATE of promises.status, so members keep UPDATE.
-- App email writes go through service_role; JWT is SELECT-only so a member
-- (or owner) token cannot forge or erase email_messages.

drop policy if exists collection_cases_all on collection_cases;
create policy collection_cases_member_read on collection_cases
  for select using (public.is_org_member(org_id));
create policy collection_cases_member_insert on collection_cases
  for insert with check (public.is_org_member(org_id));
create policy collection_cases_member_update on collection_cases
  for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy collection_cases_owner_delete on collection_cases
  for delete using (public.is_org_owner(org_id));

drop policy if exists promises_all on promises;
create policy promises_member_read on promises
  for select using (public.is_org_member(org_id));
create policy promises_member_insert on promises
  for insert with check (public.is_org_member(org_id));
create policy promises_member_update on promises
  for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy promises_owner_delete on promises
  for delete using (public.is_org_owner(org_id));

-- Create-promise writes link rows; deleting them desyncs the ledger.
drop policy if exists promise_invoices_all on promise_invoices;
create policy promise_invoices_member_read on promise_invoices
  for select using (public.is_org_member(org_id));
create policy promise_invoices_member_insert on promise_invoices
  for insert with check (public.is_org_member(org_id));
create policy promise_invoices_owner_delete on promise_invoices
  for delete using (public.is_org_owner(org_id));

drop policy if exists email_messages_owner_write on email_messages;

-- ON DELETE CASCADE from parent tables bypasses child RLS. Restrict so a
-- member cannot erase cases/promises/email by deleting the customer or invoice.
alter table collection_cases
  drop constraint collection_cases_customer_id_fkey,
  add constraint collection_cases_customer_id_fkey
    foreign key (customer_id) references customers(id) on delete restrict;

alter table promises
  drop constraint promises_customer_id_fkey,
  add constraint promises_customer_id_fkey
    foreign key (customer_id) references customers(id) on delete restrict;

alter table promise_invoices
  drop constraint promise_invoices_invoice_id_fkey,
  add constraint promise_invoices_invoice_id_fkey
    foreign key (invoice_id) references invoices(id) on delete restrict;

alter table email_messages
  drop constraint email_messages_invoice_id_fkey,
  add constraint email_messages_invoice_id_fkey
    foreign key (invoice_id) references invoices(id) on delete restrict;

-- 0032 composite tenant FKs still CASCADE; drop/recreate so parent deletes
-- cannot fire those cascades ahead of the single-column RESTRICT constraints.
alter table collection_cases
  drop constraint collection_cases_org_customer_fk,
  add constraint collection_cases_org_customer_fk
    foreign key (org_id, customer_id) references customers (org_id, id)
    on delete restrict;

alter table promises
  drop constraint promises_org_customer_fk,
  add constraint promises_org_customer_fk
    foreign key (org_id, customer_id) references customers (org_id, id)
    on delete restrict;

alter table promise_invoices
  drop constraint promise_invoices_org_invoice_fk,
  add constraint promise_invoices_org_invoice_fk
    foreign key (org_id, invoice_id) references invoices (org_id, id)
    on delete restrict;

alter table email_messages
  drop constraint email_messages_org_invoice_fk,
  add constraint email_messages_org_invoice_fk
    foreign key (org_id, invoice_id) references invoices (org_id, id)
    on delete restrict;

alter table email_messages
  drop constraint email_messages_customer_id_fkey,
  add constraint email_messages_customer_id_fkey
    foreign key (customer_id) references customers(id) on delete restrict;

alter table email_messages
  drop constraint email_messages_case_id_fkey,
  add constraint email_messages_case_id_fkey
    foreign key (case_id) references collection_cases(id) on delete restrict;

alter table email_messages
  drop constraint email_messages_org_customer_fk,
  add constraint email_messages_org_customer_fk
    foreign key (org_id, customer_id) references customers (org_id, id)
    on delete restrict;

alter table email_messages
  drop constraint email_messages_org_case_fk,
  add constraint email_messages_org_case_fk
    foreign key (org_id, case_id) references collection_cases (org_id, id)
    on delete restrict;
