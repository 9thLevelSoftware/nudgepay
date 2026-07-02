-- Display-only late fees (C2 gap closure). Never written to QBO; QBO balance
-- stays the source of truth. Columns live on org_settings so 0016's RLS
-- (members read / owners write via is_org_owner) covers them unchanged.

alter table org_settings
  add column late_fee_enabled boolean not null default false,
  add column late_fee_grace_days int not null default 0
    check (late_fee_grace_days >= 0),
  add column late_fee_monthly_percent numeric(5,2) not null default 0
    check (late_fee_monthly_percent >= 0 and late_fee_monthly_percent <= 100),
  add column late_fee_flat_amount numeric(12,2) not null default 0
    check (late_fee_flat_amount >= 0);
