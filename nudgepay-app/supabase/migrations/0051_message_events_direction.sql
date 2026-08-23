-- Messages Realtime ping (in-flight 0044_message_events_broadcast never
-- landed on origin — origin 0044 is inbound_orphans). Payload is
-- content-free: { table, org_id, direction } only. No body / from / to /
-- customer_id. The channel is public (realtime.send 4th arg false; A-005).
-- Clients toast inbound-only; the RLS loader remains source of thread bodies.
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
      json_build_object(
        'table', TG_TABLE_NAME,
        'org_id', NEW.org_id,
        'direction', NEW.direction
      )::jsonb,
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
