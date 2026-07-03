-- Org-configurable workflow knobs (Phase 5): coming-due lookahead window,
-- promise due-soon business-day window, and bulk-op batch-size cap. Columns
-- live on org_settings so 0016's RLS (members read / owners write via
-- is_org_owner) covers them unchanged.

alter table org_settings
  add column coming_due_days int not null default 7
    check (coming_due_days between 1 and 60),
  add column due_soon_business_days int not null default 3
    check (due_soon_business_days between 1 and 30),
  add column sms_batch_limit int not null default 50
    check (sms_batch_limit between 1 and 200);
