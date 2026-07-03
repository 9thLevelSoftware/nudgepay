-- Org-configurable SMS send window ("quiet hours", Phase 7). Same-day windows
-- only — overnight windows make no sense for collections SMS. Columns live on
-- org_settings so 0016's RLS (members read / owners write via is_org_owner)
-- covers them unchanged.

alter table org_settings
  add column sms_send_start_hour int not null default 8
    check (sms_send_start_hour between 0 and 23),
  add column sms_send_end_hour int not null default 21
    check (sms_send_end_hour between 1 and 24),
  add constraint sms_send_window_valid check (sms_send_start_hour < sms_send_end_hour);
