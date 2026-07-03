-- Phase 8 cleanup: drop the dead email_config.provider column. It was added in
-- migration 0020 as groundwork for a future email backend decision, but no app
-- code ever read or wrote it (from_address/from_name/email_enabled/postal_address
-- fully describe the current email config).
alter table email_config drop column provider;
