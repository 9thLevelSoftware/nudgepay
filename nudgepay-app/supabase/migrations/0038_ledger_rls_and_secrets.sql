-- Members may insert/read contact logs and SMS, but cannot rewrite or delete
-- the audit ledger. Invite tokens and QBO ciphertext are not selectable by
-- the authenticated role.

drop policy if exists contact_logs_all on contact_logs;
create policy contact_logs_member_read on contact_logs
  for select using (public.is_org_member(org_id));
create policy contact_logs_member_insert on contact_logs
  for insert with check (public.is_org_member(org_id));
create policy contact_logs_owner_update on contact_logs
  for update using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));
create policy contact_logs_owner_delete on contact_logs
  for delete using (public.is_org_owner(org_id));

drop policy if exists text_messages_all on text_messages;
create policy text_messages_member_read on text_messages
  for select using (public.is_org_member(org_id));
create policy text_messages_member_insert on text_messages
  for insert with check (public.is_org_member(org_id));
create policy text_messages_owner_update on text_messages
  for update using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));
create policy text_messages_owner_delete on text_messages
  for delete using (public.is_org_owner(org_id));

grant insert, update, delete on invites to authenticated;
revoke select on invites from authenticated;
grant select (id, org_id, email, accepted_at, expires_at, created_at) on invites to authenticated;

revoke select on qbo_connections from authenticated;
grant select (
  id, org_id, realm_id, status, last_sync_at, last_cdc_time, token_expires_at, created_at
) on qbo_connections to authenticated;
