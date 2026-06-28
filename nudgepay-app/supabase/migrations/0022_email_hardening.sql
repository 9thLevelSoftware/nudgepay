-- Phase 15-17 hardening (post-implementation review findings):
--  * email_messages.provider_message_id made unique so the Resend inbound webhook
--    is idempotent — retries (a 2xx lost to a network blip) and in-window replays
--    must not create duplicate inbound rows. Partial: only non-null, non-empty ids
--    participate, so a missing/empty provider id never collides.
--  * email_config.postal_address: the sender's physical mailing address, appended to
--    the outbound footer to satisfy CAN-SPAM (a valid postal address is legally
--    required on every commercial email).
create unique index email_messages_provider_message_id_key
  on email_messages (provider_message_id)
  where provider_message_id is not null and provider_message_id <> '';

alter table email_config add column postal_address text;
