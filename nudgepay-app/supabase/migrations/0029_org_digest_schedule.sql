-- Timezone-aware daily digest (Phase 6): configurable org-local send hour and
-- last-sent date, used by the hourly digest cron to gate per-org sends.
-- Columns live on org_settings so 0016's RLS (members read / owners write via
-- is_org_owner) covers them unchanged.

alter table org_settings
  add column digest_hour_local int not null default 8
    check (digest_hour_local between 0 and 23),
  add column last_digest_date date;
