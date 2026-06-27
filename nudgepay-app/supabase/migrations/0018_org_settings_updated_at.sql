-- Phase 9 (C7 write path): auto-maintain org_settings.updated_at on UPDATE.
-- 0016 added the column with a default of now() for inserts, but nothing advanced
-- it on update. This trigger does. No data change; backward-compatible.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger org_settings_set_updated_at
  before update on org_settings
  for each row
  execute function public.set_updated_at();
