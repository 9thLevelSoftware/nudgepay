-- Phase 6c: minimal exception placeholder on collection cases.
-- next_action_at doubles as the review date for waiting/on_hold; no review_at column.
alter table collection_cases
  add column exception_reason text
    check (exception_reason in ('disputed','payment_plan','do_not_contact','other')),
  add column exception_note text;
