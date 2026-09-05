-- Harden app-owned database functions flagged by the hosted advisors, cache
-- auth.uid() once per statement in the flagged RLS policies, and serialize
-- owner exits so concurrent requests cannot remove every workspace owner.

-- Generated-column and trigger helpers do not need caller-controlled schemas.
alter function public.phone_last10(text) set search_path = '';
alter function public.normalize_email(text) set search_path = '';
alter function public.set_updated_at() set search_path = '';

-- The remaining hosted findings are platform-owned: gen_random_bytes belongs
-- to pgcrypto and rls_auto_enable belongs to Supabase. This app migration does
-- not replace or change privileges on extension/platform functions.

-- RLS predicates are internal authorization helpers. Authenticated requests
-- need EXECUTE because policies call them; anonymous requests do not.
revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.is_org_owner(uuid) from public, anon;
revoke execute on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;

-- Staff membership management changes roles only. Keeping authenticated
-- UPDATE on identity columns would let an admin in two workspaces move a
-- membership across orgs after both RLS predicates passed, or replace its
-- user_id. Service-role provisioning retains its table-level UPDATE grant.
revoke update on table public.memberships from public, anon, authenticated;
grant update (role) on table public.memberships to authenticated;

-- Trigger functions run through their triggers and are not RPC endpoints.
-- PostgreSQL checks trigger-function privileges when the trigger is created,
-- so revoking direct calls does not affect existing trigger execution.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.prevent_member_customer_source_edits() from public, anon, authenticated;
revoke execute on function public.prevent_last_owner_exit() from public, anon, authenticated;

-- Membership row triggers lock membership -> organization. Workspace deletion
-- must use the same order or an offboarding request can deadlock with the RPC.
create or replace function public.delete_workspace(
  p_org_id uuid,
  p_deleted_by uuid,
  p_org_name text,
  p_member_count int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_name text;
  locked_members int;
begin
  if p_org_id is null then
    raise exception 'workspace not found';
  end if;

  -- Provider mutations in 0060 acquire their per-workspace advisory lock
  -- before reading memberships. Take the same locks first, in a fixed order,
  -- so deletion cannot race a checkout/webhook/send reservation or invert the
  -- advisory -> membership lock order.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nudgepay:org-billing:' || p_org_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nudgepay:sms-budget:' || p_org_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nudgepay:email-budget:' || p_org_id::text, 0)
  );

  -- Serialize membership exits/role changes before taking the organization
  -- row lock. This matches prevent_last_owner_exit's lock order.
  perform 1
    from public.memberships
   where org_id = p_org_id
   for update;

  select name into locked_name
    from public.organizations
   where id = p_org_id
   for update;
  if not found then
    raise exception 'workspace not found';
  end if;

  if btrim(coalesce(p_org_name, '')) = ''
     or btrim(coalesce(locked_name, '')) = ''
     or lower(btrim(p_org_name)) is distinct from lower(btrim(locked_name)) then
    raise exception 'workspace name mismatch';
  end if;

  if p_deleted_by is null then
    raise exception 'not an owner';
  end if;
  perform 1
    from public.memberships
   where org_id = p_org_id
     and user_id = p_deleted_by
     and role = 'owner';
  if not found then
    raise exception 'not an owner';
  end if;

  -- Do not erase provider state that still requires an external cancellation
  -- or an internal reconciliation. PT409 makes the RPC a conflict while the
  -- stable message lets the app show the owner the required next step.
  perform 1
    from public.org_billing
   where org_id = p_org_id
     and (
       status in ('incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'paused')
       or (
         stripe_subscription_id is not null
         and status not in ('canceled', 'incomplete_expired')
       )
     )
   for update;
  if found then
    raise exception 'workspace deletion blocked by billing subscription'
      using errcode = 'PT409';
  end if;

  perform 1
    from public.billing_checkout_attempts
   where org_id = p_org_id
     and state in ('reserved', 'ready', 'unknown')
   for update;
  if found then
    raise exception 'workspace deletion blocked by pending provider work'
      using errcode = 'PT409';
  end if;

  perform 1
    from public.text_messages
   where org_id = p_org_id
     and direction = 'outbound'
     and status in ('sending', 'unknown')
   for update;
  if found then
    raise exception 'workspace deletion blocked by pending provider work'
      using errcode = 'PT409';
  end if;

  perform 1
    from public.email_messages
   where org_id = p_org_id
     and direction = 'outbound'
     and status in ('sending', 'unknown')
   for update;
  if found then
    raise exception 'workspace deletion blocked by pending provider work'
      using errcode = 'PT409';
  end if;

  select count(*)::int into locked_members
    from public.memberships
   where org_id = p_org_id;

  insert into public.workspace_deletions (org_id, org_name, deleted_by, member_count)
  values (p_org_id, locked_name, p_deleted_by, coalesce(locked_members, 0));

  perform set_config('app.deleting_workspace', 'true', true);

  delete from public.promise_invoices where org_id = p_org_id;
  delete from public.promises where org_id = p_org_id;
  delete from public.email_messages where org_id = p_org_id;
  delete from public.text_messages where org_id = p_org_id;
  delete from public.contact_logs where org_id = p_org_id;
  delete from public.collection_cases where org_id = p_org_id;
  delete from public.payments where org_id = p_org_id;

  delete from public.organizations where id = p_org_id;
end;
$$;

revoke all on function public.delete_workspace(uuid, uuid, text, int)
  from public, anon, authenticated;
grant execute on function public.delete_workspace(uuid, uuid, text, int)
  to service_role;
revoke execute on function public.prevent_inbound_stop_unlock() from public, anon, authenticated;
revoke execute on function public.protect_text_message_sender_identity() from public, anon, authenticated;
revoke execute on function public.prevent_member_promise_money_edits() from public, anon, authenticated;
revoke execute on function public.notify_message_event() from public, anon, authenticated;
revoke execute on function public.freeze_erased_customer_pii() from public, anon, authenticated;
revoke execute on function public.reject_write_on_erased_customer() from public, anon, authenticated;
revoke execute on function public.prevent_non_owner_role_change() from public, anon, authenticated;

drop policy if exists case_presence_member_insert on public.case_presence;
create policy case_presence_member_insert on public.case_presence
  for insert with check (
    public.is_org_member(org_id)
    and user_id = (select auth.uid())
  );

drop policy if exists case_presence_member_update on public.case_presence;
create policy case_presence_member_update on public.case_presence
  for update using (
    public.is_org_member(org_id)
    and user_id = (select auth.uid())
  ) with check (
    public.is_org_member(org_id)
    and user_id = (select auth.uid())
  );

drop policy if exists notification_prefs_select_own on public.user_notification_prefs;
create policy notification_prefs_select_own on public.user_notification_prefs
  for select using (
    user_id = (select auth.uid())
    and public.is_org_member(org_id)
  );

drop policy if exists notification_prefs_insert_own on public.user_notification_prefs;
create policy notification_prefs_insert_own on public.user_notification_prefs
  for insert with check (
    user_id = (select auth.uid())
    and public.is_org_member(org_id)
  );

drop policy if exists notification_prefs_update_own on public.user_notification_prefs;
create policy notification_prefs_update_own on public.user_notification_prefs
  for update using (
    user_id = (select auth.uid())
    and public.is_org_member(org_id)
  );

drop policy if exists thread_reads_select on public.thread_reads;
create policy thread_reads_select on public.thread_reads
  for select using (
    public.is_org_member(org_id)
    and user_id = (select auth.uid())
  );

drop policy if exists thread_reads_upsert on public.thread_reads;
create policy thread_reads_upsert on public.thread_reads
  for insert with check (
    public.is_org_member(org_id)
    and user_id = (select auth.uid())
  );

drop policy if exists thread_reads_update on public.thread_reads;
create policy thread_reads_update on public.thread_reads
  for update using (
    public.is_org_member(org_id)
    and user_id = (select auth.uid())
  ) with check (
    public.is_org_member(org_id)
    and user_id = (select auth.uid())
  );

drop policy if exists mem_owner_delete on public.memberships;
create policy mem_owner_delete on public.memberships
  for delete using (
    public.is_org_admin(org_id)
    or user_id = (select auth.uid())
  );

create or replace function public.prevent_last_owner_exit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining int;
begin
  if current_setting('app.deleting_workspace', true) = 'true' then
    return coalesce(new, old);
  end if;
  if old.role is distinct from 'owner' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;

  -- All owner exits for a workspace take the same row lock. Once a waiter
  -- acquires it, the count below sees the prior exit and preserves one owner.
  perform 1
    from public.organizations
   where id = old.org_id
   for update;

  select count(*) into remaining
    from public.memberships
   where org_id = old.org_id
     and role = 'owner'
     and user_id is distinct from old.user_id;
  if remaining < 1 then
    raise exception 'cannot remove or demote the last owner'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function public.prevent_last_owner_exit() from public, anon, authenticated;
