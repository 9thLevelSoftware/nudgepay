-- Broadcast a minimal "new message" ping per org so the Messages inbox can
-- update instantly via Supabase Realtime instead of relying only on polling.
-- Payload is intentionally content-free (table + org_id) — clients revalidate
-- through the RLS-protected loader, so no message data crosses the channel.
--
-- RESILIENCE: any broadcast failure (older realtime versions lacking
-- realtime.send, transient realtime outages) is downgraded to a WARNING.
-- A delivery ping must never fail the underlying message INSERT.

create or replace function public.notify_message_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(
      json_build_object('table', TG_TABLE_NAME, 'org_id', NEW.org_id)::jsonb,
      'change',
      'org:messages:' || NEW.org_id::text,
      false
    );
  exception when others then
    raise warning 'message broadcast ping failed: %', sqlerrm;
  end;
  return NEW;
end;
$$;

drop trigger if exists message_event_broadcast on text_messages;
create trigger message_event_broadcast
  after insert on text_messages
  for each row execute function public.notify_message_event();

drop trigger if exists message_event_broadcast on email_messages;
create trigger message_event_broadcast
  after insert on email_messages
  for each row execute function public.notify_message_event();
