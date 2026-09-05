-- Stable browser operation identity for customer SMS/email sends. The 0060
-- RPC signatures stay in place so an older Worker can run during rollback.

alter table public.text_messages
  add column submission_id text
  constraint text_messages_submission_id_valid check (
    submission_id is null
    or (char_length(submission_id) between 1 and 128 and submission_id ~ '^[A-Za-z0-9._:-]+$')
  );

alter table public.email_messages
  add column submission_id text
  constraint email_messages_submission_id_valid check (
    submission_id is null
    or (char_length(submission_id) between 1 and 128 and submission_id ~ '^[A-Za-z0-9._:-]+$')
  );

create unique index text_messages_org_submission_key
  on public.text_messages (org_id, submission_id)
  where direction = 'outbound' and submission_id is not null;

create unique index email_messages_org_submission_key
  on public.email_messages (org_id, submission_id)
  where direction = 'outbound' and submission_id is not null;

-- Authenticated clients cannot attach operation identities to inbound rows or
-- rewrite an existing identity. The provider-attempt triggers from 0060 retain
-- their broader outbound-ledger protections.
create or replace function public.protect_message_submission_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if TG_OP = 'INSERT' then
    new.submission_id := null;
    return new;
  end if;
  if new.submission_id is distinct from old.submission_id then
    raise exception 'message submission identity is service-written' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_text_message_submission_identity
before insert or update on public.text_messages
for each row execute function public.protect_message_submission_identity();

create trigger protect_email_message_submission_identity
before insert or update on public.email_messages
for each row execute function public.protect_message_submission_identity();

create or replace function public.reserve_sms_send(
  p_org_id uuid,
  p_invoice_id uuid,
  p_customer_id uuid,
  p_case_id uuid,
  p_sent_by_user_id uuid,
  p_to_number text,
  p_body text,
  p_from_number text,
  p_messaging_service_sid text,
  p_send_fingerprint text,
  p_send_dedupe_key text,
  p_provider_idempotency_key text,
  p_now timestamptz,
  p_submission_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.text_messages%rowtype;
  v_result jsonb;
  v_result_id uuid;
  v_terminal_submission_row_id uuid;
begin
  if p_submission_id is null
     or char_length(p_submission_id) not between 1 and 128
     or p_submission_id !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'Valid SMS submission identity is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nudgepay:sms-budget:' || p_org_id::text, 0)
  );

  perform 1
  from public.memberships
  where org_id = p_org_id and user_id = p_sent_by_user_id
  for key share;
  if not found then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;

  select * into v_existing
  from public.text_messages
  where org_id = p_org_id
    and direction = 'outbound'
    and submission_id = p_submission_id
  limit 1;

  if found then
    if v_existing.send_fingerprint is distinct from p_send_fingerprint
       or v_existing.invoice_id is distinct from p_invoice_id
       or v_existing.customer_id is distinct from p_customer_id
       or v_existing.case_id is distinct from p_case_id
       or v_existing.sent_by_user_id is distinct from p_sent_by_user_id
       or v_existing.to_number is distinct from p_to_number
       or v_existing.body is distinct from p_body
       or v_existing.from_number is distinct from p_from_number
       or v_existing.messaging_service_sid is distinct from p_messaging_service_sid then
      return jsonb_build_object('state', 'mismatch', 'id', v_existing.id);
    end if;
    if v_existing.status in ('sending', 'unknown') then
      return jsonb_build_object('state', 'unknown', 'id', v_existing.id);
    end if;
    if v_existing.status in ('failed', 'undelivered', 'canceled') then
      -- A provider-confirmed failure is safe to retry as the same operation.
      -- The 0060 RPC retires its old dedupe key and issues a fresh provider key.
      v_terminal_submission_row_id := v_existing.id;
    else
      return jsonb_build_object(
        'state', 'recorded', 'id', v_existing.id,
        'provider_id', v_existing.twilio_message_sid,
        'provider_status', v_existing.status
      );
    end if;
  end if;

  v_result := public.reserve_sms_send(
    p_org_id, p_invoice_id, p_customer_id, p_case_id, p_sent_by_user_id,
    p_to_number, p_body, p_from_number, p_messaging_service_sid,
    p_send_fingerprint, p_send_dedupe_key, p_provider_idempotency_key, p_now
  );

  if v_result->>'state' = 'reserved' then
    v_result_id := (v_result->>'id')::uuid;
    if v_terminal_submission_row_id is not null then
      update public.text_messages
         set submission_id = null
       where org_id = p_org_id
         and id = v_terminal_submission_row_id
         and submission_id = p_submission_id
         and status in ('failed', 'undelivered', 'canceled');
      if not found then
        raise exception 'SMS terminal submission identity changed during retry';
      end if;
    end if;
    update public.text_messages
       set submission_id = p_submission_id
     where org_id = p_org_id and id = v_result_id and direction = 'outbound';
    if not found then
      raise exception 'SMS reservation identity could not be persisted';
    end if;
  end if;
  return v_result;
end;
$$;

create or replace function public.reserve_email_send(
  p_org_id uuid,
  p_invoice_id uuid,
  p_customer_id uuid,
  p_case_id uuid,
  p_sent_by_user_id uuid,
  p_from_address text,
  p_to_address text,
  p_subject text,
  p_body text,
  p_send_fingerprint text,
  p_send_dedupe_key text,
  p_provider_idempotency_key text,
  p_now timestamptz,
  p_submission_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.email_messages%rowtype;
  v_result jsonb;
  v_result_id uuid;
  v_terminal_submission_row_id uuid;
begin
  if p_submission_id is null
     or char_length(p_submission_id) not between 1 and 128
     or p_submission_id !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'Valid email submission identity is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nudgepay:email-budget:' || p_org_id::text, 0)
  );

  perform 1
  from public.memberships
  where org_id = p_org_id and user_id = p_sent_by_user_id
  for key share;
  if not found then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;

  select * into v_existing
  from public.email_messages
  where org_id = p_org_id
    and direction = 'outbound'
    and submission_id = p_submission_id
  limit 1;

  if found then
    if v_existing.send_fingerprint is distinct from p_send_fingerprint
       or v_existing.invoice_id is distinct from p_invoice_id
       or v_existing.customer_id is distinct from p_customer_id
       or v_existing.case_id is distinct from p_case_id
       or v_existing.sent_by_user_id is distinct from p_sent_by_user_id
       or v_existing.from_address is distinct from p_from_address
       or v_existing.to_address is distinct from p_to_address
       or v_existing.subject is distinct from p_subject
       or v_existing.body is distinct from p_body then
      return jsonb_build_object('state', 'mismatch', 'id', v_existing.id);
    end if;
    if v_existing.status in ('sending', 'unknown') then
      return jsonb_build_object('state', 'unknown', 'id', v_existing.id);
    end if;
    if v_existing.status in ('failed', 'bounced', 'complained', 'canceled') then
      v_terminal_submission_row_id := v_existing.id;
    else
      return jsonb_build_object(
        'state', 'recorded', 'id', v_existing.id,
        'provider_id', v_existing.provider_message_id,
        'provider_status', v_existing.status
      );
    end if;
  end if;

  v_result := public.reserve_email_send(
    p_org_id, p_invoice_id, p_customer_id, p_case_id, p_sent_by_user_id,
    p_from_address, p_to_address, p_subject, p_body,
    p_send_fingerprint, p_send_dedupe_key, p_provider_idempotency_key, p_now
  );

  if v_result->>'state' = 'reserved' then
    v_result_id := (v_result->>'id')::uuid;
    if v_terminal_submission_row_id is not null then
      update public.email_messages
         set submission_id = null
       where org_id = p_org_id
         and id = v_terminal_submission_row_id
         and submission_id = p_submission_id
         and status in ('failed', 'bounced', 'complained', 'canceled');
      if not found then
        raise exception 'Email terminal submission identity changed during retry';
      end if;
    end if;
    update public.email_messages
       set submission_id = p_submission_id
     where org_id = p_org_id and id = v_result_id and direction = 'outbound';
    if not found then
      raise exception 'Email reservation identity could not be persisted';
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.reserve_sms_send(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
revoke all on function public.protect_message_submission_identity()
  from public, anon, authenticated;
revoke all on function public.reserve_email_send(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.reserve_sms_send(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, timestamptz, text
) to service_role;
grant execute on function public.protect_message_submission_identity()
  to service_role;
grant execute on function public.reserve_email_send(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, timestamptz, text
) to service_role;
