-- C6: per-customer communication preferences. A single preferred channel plus
-- per-channel opt-outs. These are PREFERENCES, distinct from the legal
-- sms_consent record (TCPA/A2P) which STOP/START continues to govern. RLS is
-- unchanged: the existing customers_all policy already gates read and write by
-- org membership.
alter table customers
  add column preferred_channel text
    check (preferred_channel in ('call', 'text', 'email')),
  add column do_not_call  boolean not null default false,
  add column do_not_email boolean not null default false,
  add column do_not_text  boolean not null default false;
