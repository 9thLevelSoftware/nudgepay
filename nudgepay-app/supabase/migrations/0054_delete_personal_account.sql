-- Personal Auth-user erasure. Workspace rows stay; RESTRICT actor FKs would
-- abort auth.admin.deleteUser. SET NULL on contact/message actor columns,
-- CASCADE personal prefs/reads. Last-owner membership trigger still blocks
-- deleting the only remaining owner.

alter table public.contact_logs
  alter column user_id drop not null;

do $$
declare
  r record;
begin
  for r in
    select n.relname as tbl, c.conname
      from pg_constraint c
      join pg_class n on n.oid = c.conrelid
      join pg_namespace ns on ns.oid = n.relnamespace
     where ns.nspname = 'public'
       and c.contype = 'f'
       and n.relname in ('contact_logs', 'text_messages', 'email_messages')
       and pg_get_constraintdef(c.oid) ilike '%auth.users%'
  loop
    execute format('alter table public.%I drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.contact_logs
  add constraint contact_logs_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

alter table public.text_messages
  add constraint text_messages_sent_by_user_id_fkey
  foreign key (sent_by_user_id) references auth.users(id) on delete set null;

alter table public.email_messages
  add constraint email_messages_sent_by_user_id_fkey
  foreign key (sent_by_user_id) references auth.users(id) on delete set null;

delete from public.user_notification_prefs p
 where not exists (select 1 from auth.users u where u.id = p.user_id);

delete from public.thread_reads t
 where not exists (select 1 from auth.users u where u.id = t.user_id);

alter table public.user_notification_prefs
  add constraint user_notification_prefs_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.thread_reads
  add constraint thread_reads_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
