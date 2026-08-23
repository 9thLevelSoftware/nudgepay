-- IQ-7: members cannot PATCH payment-validated promise status or inject links.
-- Create/supersede is create_promise (SECURITY DEFINER); cancel stays pending→cancelled.
-- Number is 0050: origin already has 0045_accept_invite through 0048;
-- sibling PR 3 uses 0049_cases_and_consent_rls.

drop policy if exists promises_all on promises;
drop policy if exists promises_member_read on promises;
drop policy if exists promises_member_insert on promises;
drop policy if exists promises_member_update on promises;
drop policy if exists promises_owner_delete on promises;
create policy promises_member_read on promises
  for select using (public.is_org_member(org_id));
-- no member INSERT: leftover JWT rows would skip the evaluator
create policy promises_member_update on promises
  for update
  using (public.is_org_member(org_id) and status = 'pending')
  with check (public.is_org_member(org_id) and status = 'cancelled');
create policy promises_owner_delete on promises
  for delete using (public.is_org_owner(org_id));

drop policy if exists promise_invoices_all on promise_invoices;
drop policy if exists promise_invoices_member_read on promise_invoices;
drop policy if exists promise_invoices_member_insert on promise_invoices;
drop policy if exists promise_invoices_owner_delete on promise_invoices;
create policy promise_invoices_member_read on promise_invoices
  for select using (public.is_org_member(org_id));
-- no member INSERT: leftover JWT links would move eval math
create policy promise_invoices_owner_delete on promise_invoices
  for delete using (public.is_org_owner(org_id));

-- SECURITY INVOKER (default). current_user — not auth.role() — is the gate.
-- create_promise is SECURITY DEFINER owned by postgres; its UPDATEs run as
-- current_user = postgres. Eval uses the service_role client.
-- PostgREST as authenticated (member or owner) cannot change money/identity.
-- Do not copy 0032 (auth.role() stays 'authenticated' inside create_promise).
create or replace function public.prevent_member_promise_money_edits()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if new.promised_amount is distinct from old.promised_amount
    or new.baseline_balance is distinct from old.baseline_balance
    or new.amount_received is distinct from old.amount_received
    or new.grace_until is distinct from old.grace_until
    or new.promised_date is distinct from old.promised_date
    or new.case_id is distinct from old.case_id
    or new.customer_id is distinct from old.customer_id
    or new.org_id is distinct from old.org_id
    or new.replacement_promise_id is distinct from old.replacement_promise_id then
    raise exception 'promise money/identity fields are not member-writable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_member_promise_money_edits on promises;
create trigger prevent_member_promise_money_edits
before update on promises
for each row execute function public.prevent_member_promise_money_edits();

-- Owner MUST remain postgres (migration default). Do not ALTER OWNER TO authenticated.
create or replace function public.create_promise(
  p_org_id uuid,
  p_case_id uuid,
  p_customer_id uuid,
  p_user_id uuid,
  p_contact_log_id uuid,
  p_promised_amount numeric,
  p_promised_date date,
  p_grace_until date
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior uuid;
  v_id uuid;
  v_baseline numeric(12,2);
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not an org member'
      using errcode = '42501';
  end if;

  perform 1
    from public.collection_cases
   where id = p_case_id
     and org_id = p_org_id
     and customer_id = p_customer_id
     for update;
  if not found then
    raise exception 'case not found for org/customer'
      using errcode = '42501';
  end if;

  -- Snapshot in SQL so create is not subject to PostgREST max_rows.
  select coalesce(sum(balance), 0)
    into v_baseline
    from public.invoices
   where org_id = p_org_id
     and customer_id = p_customer_id
     and balance > 0;

  update public.promises
     set status = 'renegotiated', resolved_at = now()
   where org_id = p_org_id
     and case_id = p_case_id
     and status = 'pending'
  returning id into v_prior;

  insert into public.promises (
    org_id, case_id, customer_id, status,
    promised_amount, promised_date, grace_until, baseline_balance,
    contact_log_id, created_by
  ) values (
    p_org_id, p_case_id, p_customer_id, 'pending',
    p_promised_amount, p_promised_date, p_grace_until, v_baseline,
    p_contact_log_id, p_user_id
  ) returning id into v_id;

  insert into public.promise_invoices (promise_id, invoice_id, org_id, baseline_balance)
  select v_id, i.id, p_org_id, i.balance
    from public.invoices i
   where i.org_id = p_org_id
     and i.customer_id = p_customer_id
     and i.balance > 0;

  if v_prior is not null then
    update public.promises
       set replacement_promise_id = v_id
     where id = v_prior
       and org_id = p_org_id;
  end if;

  update public.collection_cases
     set status = 'promised',
         next_action_type = 'promise',
         next_action_at = p_grace_until,
         exception_reason = null,
         exception_note = null
   where id = p_case_id
     and org_id = p_org_id;

  return v_id;
end;
$$;

revoke all on function public.create_promise(uuid, uuid, uuid, uuid, uuid, numeric, date, date) from public;
grant execute on function public.create_promise(uuid, uuid, uuid, uuid, uuid, numeric, date, date) to authenticated;
