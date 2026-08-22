-- Peek / contact-rate / collision recheck page email_messages by case.
create index email_messages_org_case_idx on email_messages (org_id, case_id, created_at);
