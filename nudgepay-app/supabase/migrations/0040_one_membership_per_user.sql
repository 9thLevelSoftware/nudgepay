-- One membership per user until an org switcher exists. Hosted is new /
-- single-tenant; still keep the oldest row if any duplicates slipped in.

delete from memberships a
using memberships b
where a.user_id = b.user_id
  and (a.created_at, a.id) > (b.created_at, b.id);

drop index if exists memberships_user_id_idx;

create unique index if not exists memberships_user_id_key
  on memberships (user_id);
