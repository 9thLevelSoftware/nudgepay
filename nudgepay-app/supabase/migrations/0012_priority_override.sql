-- Phase 7b: manual priority override on collection cases.
-- The override pins the EFFECTIVE level (up or down); the computed multi-factor
-- score is unaffected and still shown. Override never touches financial data.
alter table collection_cases
  add column priority_override text
    check (priority_override in ('critical','high','medium','low')),
  add column priority_override_reason text,
  add column priority_override_by uuid,
  add column priority_override_at timestamptz;
