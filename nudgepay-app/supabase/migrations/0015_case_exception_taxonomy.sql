-- Phase 8c (C2): widen the case exception taxonomy from the 6c minimal slice
-- (disputed/payment_plan/do_not_contact/other) to the full 9-value set. `other`
-- is retained as a catch-all so existing rows survive the constraint swap.
-- No new columns: next_action_at keeps doubling as the review date; terminal
-- states (legal_agency, do_not_contact) leave it null.
alter table collection_cases
  drop constraint collection_cases_exception_reason_check,
  add constraint collection_cases_exception_reason_check
    check (exception_reason in (
      'disputed', 'incorrect_amount', 'work_incomplete', 'documentation_requested',
      'wrong_contact', 'payment_plan', 'legal_agency', 'do_not_contact', 'other'
    ));

-- Normalize legacy terminal holds: rows created under 0011 may carry a review
-- date, but terminal states must have next_action_at = null so they never
-- surface in follow-ups-due / viewCounts. Clear it for the two terminal reasons.
update collection_cases
  set next_action_at = null
  where exception_reason in ('legal_agency', 'do_not_contact')
    and next_action_at is not null;
