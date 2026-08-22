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
