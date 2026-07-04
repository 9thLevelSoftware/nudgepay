-- Normalize text message phone numbers in Postgres so inbound reply routing can
-- query by the replying customer's phone before considering candidate orgs.
create or replace function public.phone_last10(value text)
returns text
language sql
immutable
parallel safe
returns null on null input
as $$
  select nullif(right(regexp_replace(value, '\D', '', 'g'), 10), '');
$$;

alter table text_messages
  add column if not exists from_number_norm text
    generated always as (public.phone_last10(from_number)) stored,
  add column if not exists to_number_norm text
    generated always as (public.phone_last10(to_number)) stored;

create index if not exists text_messages_outbound_to_number_norm_idx
  on text_messages (to_number_norm, from_number_norm, created_at desc)
  where direction = 'outbound'
    and to_number_norm is not null;
