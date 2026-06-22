-- A QBO company (realm) maps to exactly one org. Webhooks arrive keyed by
-- realmId; this lets the webhook route resolve the org with .maybeSingle().
-- Partial + nullable: many rows may have realm_id NULL (disconnected); only
-- non-null realm_ids must be unique. Two orgs cannot claim the same realm.
create unique index qbo_connections_realm_id_uniq
  on qbo_connections (realm_id)
  where realm_id is not null;
