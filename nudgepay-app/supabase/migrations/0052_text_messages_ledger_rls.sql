-- Outbound SID / from-number history is how inbound SMS is routed. JWT owners
-- must not relabel org_id or erase rows. App sends go through service_role.

drop policy if exists text_messages_owner_update on text_messages;
drop policy if exists text_messages_owner_delete on text_messages;
