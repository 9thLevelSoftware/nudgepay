-- Bind each QBO OAuth state nonce to the authenticated user who initiated it.
alter table oauth_states
  add column user_id uuid references auth.users(id) on delete cascade;

-- OAuth states are transient and single-use; legacy unbound rows cannot be
-- safely completed after this migration.
delete from oauth_states where user_id is null;

alter table oauth_states
  alter column user_id set not null;

create index oauth_states_user_id_idx on oauth_states (user_id);
