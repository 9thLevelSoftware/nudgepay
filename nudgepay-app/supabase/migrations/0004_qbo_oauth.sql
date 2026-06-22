-- Single-use CSRF nonce carrying the connecting org across the OAuth redirect.
create table oauth_states (
  state text primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
-- Transient + privileged: RLS on, no policies. Only the service role (which
-- bypasses RLS) reads/writes this table from server code.
alter table oauth_states enable row level security;

-- Store AES-GCM ciphertext as base64 text (supabase-js handles text cleanly;
-- bytea over PostgREST is error-prone). Columns are empty in all envs, so the
-- bytea->text change is safe.
alter table qbo_connections
  alter column access_token_enc type text using null,
  alter column refresh_token_enc type text using null;
