-- 0024: Notification preferences and idempotency ledger for team alert emails.
-- Two new tables: user_notification_prefs (per-member opt-in/out) and
-- notification_log (deduplication of sent emails — service-role only).

-- ---------------------------------------------------------------------------
-- user_notification_prefs — per-user per-org notification opt-in/out
-- ---------------------------------------------------------------------------
create table if not exists user_notification_prefs (
  org_id    uuid not null references organizations(id) on delete cascade,
  user_id   uuid not null,
  broken_promise_email boolean not null default true,
  daily_digest_email   boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

alter table user_notification_prefs enable row level security;

-- Members can read/write their own prefs only.
create policy "notification_prefs_select_own" on user_notification_prefs
  for select using (
    user_id = auth.uid()
    and is_org_member(org_id)
  );

create policy "notification_prefs_insert_own" on user_notification_prefs
  for insert with check (
    user_id = auth.uid()
    and is_org_member(org_id)
  );

create policy "notification_prefs_update_own" on user_notification_prefs
  for update using (
    user_id = auth.uid()
    and is_org_member(org_id)
  );

-- ---------------------------------------------------------------------------
-- notification_log — idempotency ledger for sent alert emails
-- ---------------------------------------------------------------------------
create table if not exists notification_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  kind        text not null check (kind in ('broken_promise', 'daily_digest')),
  dedupe_key  text not null,
  recipient_email text not null,
  sent_at     timestamptz not null default now(),
  unique (org_id, kind, dedupe_key)
);

alter table notification_log enable row level security;

-- Service-role only — no user-facing policies. The table is written/read
-- exclusively from server-side code running with the service-role key.
