-- Org-configurable high-value and priority level thresholds (Phase 4). Columns
-- live on org_settings so 0016's RLS (members read / owners write via
-- is_org_owner) covers them unchanged. Priority is computed at read time (no
-- persisted scores), so there is no backfill.

alter table org_settings
  add column high_value_threshold numeric not null default 5000
    check (high_value_threshold > 0),
  add column priority_critical_min int not null default 80,
  add column priority_high_min int not null default 50,
  add column priority_medium_min int not null default 25,
  add constraint priority_thresholds_ordered check
    (priority_critical_min > priority_high_min and priority_high_min > priority_medium_min and priority_medium_min > 0);
