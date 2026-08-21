# Wave 1 — Tenancy / RLS / IDOR

- **Auditor:** Security Engineer (Wave 1)
- **Repo:** `D:\nudgepay`
- **App:** `D:\nudgepay\nudgepay-app`
- **HEAD:** `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc`
- **Migrations on disk:** `0001`–`0034`
- **Scope:** public-schema RLS, tenant FKs, API org pins, IDOR on object ids, service-role inventory, oauth_states binding, audit-table policies, `*rls*.test.ts` holes
- **Live DB:** not queried. `Evidence (live):` is empty unless a test already proves the behavior.

Policy files that `CREATE POLICY` (complete list): `0002`, `0003`, `0009`, `0010`, `0013`, `0014`, `0016`, `0020`, `0021`, `0024`, `0025`, `0026`, `0032`. `0004` enables RLS on `oauth_states` with **no** policies. `0034` binds `oauth_states.user_id` but does not add policies.

Helpers: `is_org_member` (`0001_tenancy_schema.sql:24-35`, `SECURITY DEFINER`, `search_path = public`); `is_org_owner` (`0016_org_scheduling_config.sql:6-17`, same). Both are membership predicates, not grants of DML.

Grants: `0001_tenancy_schema.sql:1-3` default-privileges DML on future `public` tables to `authenticated, service_role` (not `anon`). `0002_rls_policies.sql:3-6` explicit DML on the original eight tables to `service_role, authenticated`. Later tables inherit the `0001` default. No `REVOKE`, no `FORCE ROW LEVEL SECURITY` anywhere.

---

## 1. Public table × RLS × policy matrix

Effective policies after `0001`–`0034` (dropped policies are **not** listed). `FOR ALL` is SELECT+INSERT+UPDATE+DELETE. PostgreSQL ORs multiple permissive policies.

| Table | RLS | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|---|---|---|---|---|---|
| `organizations` | on (`0002:9`) | `org_select` `is_org_member(id)` (`0002:19-20`) | **none** (service-role) | `org_owner_update` `is_org_owner(id)` (`0025:6-7`) | **none** (service-role) | Created in onboarding via service role. |
| `memberships` | on (`0002:10`) | `mem_select` `is_org_member(org_id)` (`0002:23-24`) | **none** (service-role) | **none** (service-role) | **none** (service-role) | Role changes cannot go through user JWT. |
| `customers` | on (`0002:11`) | `customers_member_read` `is_org_member` (`0032:52-53`) | `customers_owner_insert` `is_org_owner` (`0032:56-57`) | `customers_member_update` `is_org_member` (`0032:54-55`) | `customers_owner_delete` `is_org_owner` (`0032:58-59`) | `customers_all` dropped (`0032:51`). Source-field trigger (`0032:61-89`). Unique `(org_id, id)` (`0014:8`). |
| `invoices` | on (`0002:12`) | `invoices_member_read` `is_org_member` (`0032:37-38`) | owner via `invoices_owner_write` `FOR ALL` `is_org_owner` (`0032:39-40`) | owner `FOR ALL` | owner `FOR ALL` | `invoices_all` dropped (`0032:36`). Members cannot write QBO facts. Unique `(org_id, id)` (`0032:111-113`). |
| `contact_logs` | on (`0002:13`) | `contact_logs_all` `FOR ALL` `is_org_member` (`0002:31-32`) | member | member | member | **Unchanged by 0032.** Audit table still member-writable. |
| `text_messages` | on (`0002:14`) | `text_messages_all` `FOR ALL` `is_org_member` (`0002:33-34`) | member | member | member | **Unchanged by 0032.** SMS ledger still member-writable. |
| `qbo_connections` | on (`0002:15`) | `qbo_connections_member_read` `is_org_member` (`0032:30-31`) | owner via `qbo_connections_owner_write` `FOR ALL` (`0032:32-33`) | owner `FOR ALL` | owner `FOR ALL` | `qbo_connections_all` dropped (`0032:29`). Member SELECT includes `access_token_enc` / `refresh_token_enc`. |
| `messaging_config` | on (`0002:16`) | `messaging_config_member_read` `is_org_member` (`0020:13-14`) | owner `FOR ALL` (`0020:15-16`) | owner `FOR ALL` | owner `FOR ALL` | `messaging_config_all` dropped (`0020:12`). |
| `invites` | on (`0003:11`) | `invites_select` `is_org_member` (`0003:12-13`) | owner via `invites_owner_write` `FOR ALL` (`0032:24-25`) | owner `FOR ALL` | owner `FOR ALL` | `invites_write` dropped (`0032:23`). **Member SELECT still returns `token`.** |
| `oauth_states` | on (`0004:10`) | **no policy** | **no policy** | **no policy** | **no policy** | Service-role only (RLS deny for `authenticated`). `user_id NOT NULL` (`0034:9-10`). |
| `collection_cases` | on (`0009:23`) | `collection_cases_all` `FOR ALL` `is_org_member` (`0009:24-25`) | member | member | member | **Unchanged by 0032.** Unique `(org_id, id)` (`0032:114-116`). |
| `promises` | on (`0010:26`) | `promises_all` `FOR ALL` `is_org_member` (`0010:27-28`) | member | member | member | **Unchanged by 0032.** Unique `(org_id, id)` (`0032:120-122`). |
| `promise_invoices` | on (`0010:40`) | `promise_invoices_all` `FOR ALL` `is_org_member` (`0010:41-42`) | member | member | member | **Unchanged by 0032.** |
| `payments` | on (`0010:59`) | `payments_member_read` `is_org_member` (`0032:43-44`) | owner `FOR ALL` (`0032:45-46`) | owner `FOR ALL` | owner `FOR ALL` | `payments_all` dropped (`0032:42`). |
| `sync_errors` | on (`0013:17`) | `sync_errors_member_read` `is_org_member` (`0013:21-22`) | **none** (service-role) | `sync_errors_member_update` `is_org_member` (`0013:23-24`) — **any column** | **none** (service-role) | Inserts from sync/cron. Dismiss path is a column-unlimited UPDATE. |
| `case_presence` | on (`0014:23`) | `case_presence_member_read` `is_org_member` (`0014:25-26`) | `is_org_member AND user_id = auth.uid()` (`0014:28-29`) | same, USING+CHECK (`0014:30-32`) | **none** | Composite FK `(org_id, customer_id)` is **VALID** (`0014:19`). |
| `org_settings` | on (`0016:42`) | `org_settings_member_read` `is_org_member` (`0016:47-48`) | owner `FOR ALL` (`0016:49-50`) | owner `FOR ALL` | owner `FOR ALL` | |
| `org_holidays` | on (`0016:43`) | `org_holidays_member_read` `is_org_member` (`0016:52-53`) | owner `FOR ALL` (`0016:54-55`) | owner `FOR ALL` | owner `FOR ALL` | |
| `email_config` | on (`0020:27`) | `email_config_member_read` `is_org_member` (`0020:28-29`) | owner `FOR ALL` (`0020:30-31`) | owner `FOR ALL` | owner `FOR ALL` | |
| `email_messages` | on (`0021:25`) | `email_messages_member_read` `is_org_member` (`0021:26-27`) | owner `FOR ALL` (`0021:28-29`) | owner `FOR ALL` | owner `FOR ALL` | Members cannot insert; outbound send uses service role. |
| `user_notification_prefs` | on (`0024:18`) | own row: `user_id = auth.uid() AND is_org_member` (`0024:21-25`) | own (`0024:27-31`) | own USING, no explicit WITH CHECK — PG copies USING (`0024:33-37`) | **none** | `user_id` has **no FK** to `auth.users` (`0024:10`). |
| `notification_log` | on (`0024:52`) | **no policy** | **no policy** | **no policy** | **no policy** | Service-role only. Comment at `0024:54-55`. |
| `message_templates` | on (`0026:20`) | `message_templates_member_read` `is_org_member` (`0026:22-23`) | owner `FOR ALL` (`0026:24-25`) | owner `FOR ALL` | owner `FOR ALL` | |

No other `public` tables exist in migrations `0001`–`0034`.

---

## 2. What 0032 actually changed (and what it left)

Dropped and replaced:

- `invites_write` → `invites_owner_write` (`0032:23-25`)
- `qbo_connections_all` → member SELECT + owner FOR ALL (`0032:29-33`)
- `invoices_all` → member SELECT + owner FOR ALL (`0032:36-40`)
- `payments_all` → member SELECT + owner FOR ALL (`0032:42-46`)
- `customers_all` → member SELECT/UPDATE + owner INSERT/DELETE + source-field trigger (`0032:51-89`)

**Not touched by 0032** (still `is_org_member` `FOR ALL`): `contact_logs`, `text_messages`, `collection_cases`, `promises`, `promise_invoices`.

`email_messages` was already member-read / owner-write in `0021:26-29` — 0032 did not convert it to member FOR ALL.

---

## 3. Finding cards

### [TEMP-RLS-001] Composite tenant FKs from 0032 are still NOT VALID

- **Severity:** major
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** `nudgepay-app/supabase/migrations/0032_security_hardening.sql:7-8` (comment: NOT VALID skips historical scans); `0032:129-226` (every `foreign key … not valid`); later migrations `0033_text_message_phone_norm.sql` and `0034_oauth_state_user_binding.sql` contain **zero** `VALIDATE CONSTRAINT`. Workspace grep for `VALIDATE CONSTRAINT` returns only the 0032 comment.
- **Evidence (live):**
- **User / legal impact:** New inserts/updates are enforced (proven by `tests/rls.test.ts:124-145` and `tests/presence.test.ts:102-117`). Any pre-0032 row that paired `org_id` A with a child id from org B is still loadable and joinable. Collections/PII from tenant B could render inside tenant A's case/timeline if dirty history exists. Cannot certify production data is clean from disk alone.
- **Fix recipe:** files: new migration `0035_validate_tenant_fks.sql`. Behavior: `ALTER TABLE … VALIDATE CONSTRAINT` for each of `invoices_org_customer_fk`, `collection_cases_org_customer_fk`, `contact_logs_org_invoice_fk`, `contact_logs_org_customer_fk`, `contact_logs_org_case_fk`, `text_messages_org_invoice_fk`, `text_messages_org_customer_fk`, `text_messages_org_case_fk`, `promises_org_case_fk`, `promises_org_customer_fk`, `promises_org_replacement_promise_fk`, `promises_org_contact_log_fk`, `promise_invoices_org_promise_fk`, `promise_invoices_org_invoice_fk`, `payments_org_customer_fk`, `email_messages_org_invoice_fk`, `email_messages_org_customer_fk`, `email_messages_org_case_fk`. Tests: fail the migration (or a precheck query) if any constraint is `NOT VALID` in `pg_constraint.convalidated`. Verify: `\d+` / `convalidated = true`.
- **Do not:** ship production with these FKs unvalidated; do not assume “empty prod” without a live count.

### [TEMP-RLS-002] Member FOR ALL remains on audit and case tables after 0032

- **Severity:** major
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** `0002_rls_policies.sql:31-34` (`contact_logs_all`, `text_messages_all`); `0009_collection_cases.sql:24-25`; `0010_promise_payment_loop.sql:27-28,41-42`. 0032 does not `DROP POLICY` any of these. `FOR ALL` USING+CHECK is only `is_org_member(org_id)`.
- **Evidence (live):**
- **User / legal impact:** Any org member can UPDATE or DELETE another member's contact logs, SMS rows, promises, promise-invoice links, and collection cases via PostgREST (JWT + anon key). That is audit-tampering (TCPA/CAN-SPAM evidence, promise ledger, case history). A **multi-org** member (possible: `acceptInvite` at `orgs.server.ts:24-25` inserts a second membership; `onboarding.tsx` action `28-37` does not re-check existing org before `createOrgForUser`) can `UPDATE … SET org_id = <other membership org>` because USING passes on the old row and WITH CHECK passes on the new row. Composite FKs stop mismatched pairs, but a rewrite that also retargets `customer_id`/`case_id` to objects in the destination org **moves** the row across tenants.
- **Fix recipe:** files: new policy migration. Behavior: `contact_logs` / `text_messages` / `email_messages` → member SELECT + INSERT (optionally self-only) + deny UPDATE/DELETE for `authenticated` (service-role still bypasses for webhooks). `collection_cases` / `promises` / `promise_invoices` → member SELECT + constrained UPDATE of workflow columns; deny DELETE; deny `org_id` mutation (trigger or column-compare, same pattern as `prevent_member_customer_source_edits`). Tests: member cannot DELETE a teammate's `contact_logs`/`text_messages` row; multi-org member cannot `UPDATE collection_cases SET org_id = orgB`. Verify: `*rls*.test.ts`.
- **Do not:** leave FOR ALL on ledgers because “the UI does not expose delete”.

### [TEMP-RLS-003] Invite bearer tokens are SELECT-visible to every member

- **Severity:** major
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** `0003_invites.sql:12-13` `invites_select` `FOR SELECT USING (is_org_member(org_id))` — not dropped in 0032. Table includes `token text not null unique` (`0003:5`). Owner-only write is `0032:24-25`. `invite.tsx:37-39` inserts via service role and returns `/accept/${token}` to the owner UI; any member can `select token from invites` directly.
- **Evidence (live):**
- **User / legal impact:** Invite tokens are capability URLs. A member (or malware on a member session) can enumerate outstanding tokens, forward `/accept/<token>`, and — if they can use the invited email — join as that invitee. Token leak is a membership-control failure. `rls.test.ts:35-48` only asserts members cannot INSERT invites, not that they cannot SELECT `token`.
- **Fix recipe:** files: migration replacing `invites_select`. Behavior: SELECT restricted to `is_org_owner(org_id)` **or** a view that omits `token` for members. Accept path already uses service role (`accept.$token.tsx:26-31`, `orgs.server.ts:12-13`) so invitees do not need a user-JWT SELECT. Tests: member `select token` returns empty; owner can still list. Verify: `tests/rls.test.ts`.
- **Do not:** hash tokens at rest without also updating `acceptInvite` and the accept route together.

### [TEMP-RLS-004] Members can SELECT encrypted QBO OAuth tokens

- **Severity:** major
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** `0032:30-31` `qbo_connections_member_read FOR SELECT USING (is_org_member(org_id))` with no column list. Ciphertext columns created in `0001:102-103`, converted to text in `0004:15-17`. AES-GCM is a **single process-wide** `QBO_ENCRYPTION_KEY` (`crypto.server.ts:16-30`, `qbo-connection.server.ts:8-9`). `tests/rls.test.ts:50-68` asserts members cannot UPDATE status; it selects only `status`, never asserts token columns are invisible.
- **Evidence (live):**
- **User / legal impact:** Every member can exfiltrate `access_token_enc` / `refresh_token_enc` for their org. Combined with a leaked worker encryption key (or a future key-handling bug) this is a full QBO company-data breach (Intuit security review item). Ciphertext-at-rest is not a substitute for column privileges.
- **Fix recipe:** files: migration + optional view `qbo_connection_status`. Behavior: member SELECT allowed only on `org_id, status, realm_id, last_sync_at, last_cdc_time, token_expires_at`. Token columns: no GRANT to `authenticated`, or a security-barrier view. Owner write stays. Tests: member `select access_token_enc` errors or returns null; owner/service still function. Verify: `tests/rls.test.ts` + `tests/qbo-connection.test.ts`.
- **Do not:** put the encryption key in the client; do not “fix” this by switching loaders to service role while leaving the table SELECT open.

### [TEMP-RLS-005] Service-role mutators omit `.eq("org_id")` on id-keyed writes

- **Severity:** major
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):**
  - `app/lib/promise-evaluation.server.ts:68-71` `from("promises").update(…).eq("id", op.promiseId).eq("status", "pending")` — no `org_id`.
  - `app/lib/promise-evaluation.server.ts:81-83` `from("collection_cases").update(…).eq("id", caseId)` — no `org_id`.
  - `app/lib/case-lifecycle.server.ts:44-47` resolve branch `from("collection_cases").update(…).eq("id", op.caseId)` — no `org_id` (insert path at `:36-38` **does** set `org_id`).
  - `app/lib/notifications.server.ts:53-56` `from("collection_cases").select("customer_id").eq("id", detail.caseId)` — no `org_id`.
  - `app/lib/notifications.server.ts:62-66` `from("customers").select("name, owner").eq("id", customerId)` — no `org_id`.
  - Callers use `createSupabaseServiceClient` (`api.qbo.refresh.tsx:22-44`, `qbo-cron.server.ts:17-45`, `webhooks.qbo.tsx:23-68`), which **bypasses RLS**.
- **Evidence (live):**
- **User / legal impact:** IDs currently come from an earlier org-scoped SELECT, so this is not a known live IDOR. Under service role a single mixed-up UUID writes **any** tenant's promise/case/customer. That is the exact failure mode 0032's composite FKs and the API `org_id` pins exist to prevent. Broken-promise emails could also name the wrong customer if `caseId` is wrong.
- **Fix recipe:** files: `promise-evaluation.server.ts`, `case-lifecycle.server.ts`, `notifications.server.ts`. Behavior: every service-role read/write adds `.eq("org_id", orgId)` (and case updates in eval should also `.eq("org_id", orgId)`). Tests: pass a foreign `caseId`/`promiseId` with service client + wrong org and assert 0 rows updated. Verify: `tests/promise-evaluation-rls.test.ts`, `tests/cases-rls.test.ts`.
- **Do not:** “rely on UUID uniqueness” as the tenant boundary for service role.

### [TEMP-RLS-006] `listOrgMembers` dumps the entire `auth.users` directory

- **Severity:** major
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** `app/lib/orgs.server.ts:78-90` — service client `memberships` filtered by `org_id` (`:82-83`), then `service.auth.admin.listUsers({ perPage: 1000 })` (`:88`) which returns **every user in the project**, then filters in memory (`:92-97`). Callers: `case-queue.server.ts:148`, `accounts.$id.tsx:214`, `accounts.tsx` (roster), `messages.tsx`, `promises.tsx`, `reports.tsx:39`, `notifications.server.ts:44,202`.
- **Evidence (live):**
- **User / legal impact:** Service-role admin list is a cross-tenant PII read (emails, `user_metadata`) of every workspace on the instance. A log, exception dump, or future caller that returns `list.users` instead of the filtered `members` array is a GDPR/CCPA incident. `perPage: 1000` also silently truncates large projects so roster labels go missing — availability, not IDOR.
- **Fix recipe:** files: `orgs.server.ts`. Behavior: for each membership `user_id`, `auth.admin.getUserById` (or a constrained RPC). Never `listUsers` unbounded. Tests: two orgs' users exist; `listOrgMembers(orgA)` must not observe org B emails even if the mock admin list contains them. Verify: unit test with a fake admin client.
- **Do not:** pass `list.users` to a loader `data()` payload.

### [TEMP-RLS-007] `sync_errors` member UPDATE is not column-constrained

- **Severity:** minor
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** `0013_sync_errors.sql:23-24` `FOR UPDATE USING (is_org_member) WITH CHECK (is_org_member)` — no column list. Route `api.sync-errors.dismiss.tsx:20-22` only sets `resolved_at`/`resolved_by` and pins `org_id`, but PostgREST accepts `message`/`source`/`scope`/`org_id` changes. Multi-org member can WITH CHECK-move a row to another membership org.
- **Evidence (live):**
- **User / legal impact:** Members can rewrite or scrub sync-error text (operator visibility / Intuit debugging). Cross-org move is the same class as TEMP-RLS-002.
- **Fix recipe:** files: migration. Behavior: UPDATE allowed only when `resolved_at IS NULL` transitioning to non-null, or a trigger that rejects changes to `message, source, scope, org_id, occurred_at`. Tests: member `update({ message: "x" })` fails; dismiss still works. Verify: `tests/api-sync-errors-dismiss.test.ts`.
- **Do not:** add member INSERT/DELETE while tightening UPDATE.

### [TEMP-RLS-008] FORCE ROW LEVEL SECURITY is never set

- **Severity:** minor
- **Bars:** polish
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** workspace grep `FORCE ROW LEVEL` = no matches. Every table uses `ENABLE ROW LEVEL SECURITY` only (e.g. `0002:9-16`, `0004:10`, `0024:18,52`).
- **Evidence (live):**
- **User / legal impact:** Table owner (`postgres` / migrator) bypasses RLS. `authenticated` is not the owner, so PostgREST is fine. A mis-granted `BYPASSRLS` role or a SQL editor session as owner reads every tenant. Defense in depth for operators.
- **Fix recipe:** files: migration `ALTER TABLE … FORCE ROW LEVEL SECURITY` on all public tenant tables. Tests: none required in Vitest (cannot assert owner bypass from JWT). Verify: live `\d` shows `Force RLS`.
- **Do not:** FORCE RLS on tables the migrator must still seed without `SET row_security = off` in the migration.

### [TEMP-RLS-009] Owner/assignee columns are not membership-constrained

- **Severity:** minor
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** `0008_customer_owner.sql:4-5` `customers.owner uuid references auth.users(id)` — not `memberships`. `api.assign.tsx:26-29` and `api.bulk-assign.tsx:39-42` check membership in the **app**. RLS `customers_member_update` (`0032:54-55`) allows a raw JWT update of `owner` to any `auth.users` id. `user_notification_prefs.user_id` (`0024:10`) has **no FK at all**. `case_presence.user_id` is FK to `auth.users` (`0014:13`) with RLS `user_id = auth.uid()` on write, but SELECT is any org member (`0014:25-26`).
- **Evidence (live):**
- **User / legal impact:** Direct PostgREST can assign a customer to a user who is not in the org (broken routing of broken-promise alerts in `notifications.server.ts:71-75`, which emails `members.filter(m => m.userId === ownerId)` and otherwise falls through). Not cross-tenant data disclosure by itself.
- **Fix recipe:** files: migration adding composite FK `(org_id, owner) → memberships(org_id, user_id)` (requires unique on memberships which already exists `0001:18`) and `user_notification_prefs.user_id → auth.users`. Tests: assign outsider user_id fails at DB even via service role. Verify: `tests/api-assign.test.ts`.
- **Do not:** rely only on the route guard.

### [TEMP-RLS-010] Loaders/helpers that omit `.eq("org_id")` and rely on RLS or global uniqueness

- **Severity:** minor
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):**
  - `app/routes/dashboard.tsx:331-332` selected customer `from("customers").select(…).eq("id", customerId)` — **no** `org_id`. Sibling queries on the same batch **do** pin `org_id` (`:320-340`). `customerId` comes from org-scoped `sel`, so this is RLS-only defense in depth.
  - `app/lib/email-messaging.server.ts:166-174` last outbound invoice: `from("email_messages").select("invoice_id").eq("customer_id", match.id)` — no `org_id` (service role). Contrast `twilio-messaging.server.ts:230-235` which **does** pin `org_id`.
  - `app/lib/email-messaging.server.ts:91-100` `updateEmailStatus` keys only `provider_message_id`.
  - `app/lib/twilio-messaging.server.ts:261-267` `updateMessageStatus` keys only `twilio_message_sid`.
  - `app/lib/twilio-messaging.server.ts:169-173` inbound org resolution queries `text_messages` globally (intentional).
  - `app/lib/email-messaging.server.ts:142-151` inbound org resolution reads **all** `email_config.from_address` (intentional) — see TEMP-RLS-011.
  - `app/lib/session.server.ts:34-40` `memberships` by `user_id` only (intentional; first membership wins).
  - `app/lib/presence.server.ts:11-19` heartbeat upsert pins `org_id` in the row but does not SELECT the customer first (FK is the backstop; VALID at `0014:19`).
- **Evidence (live):**
- **User / legal impact:** Dashboard customer fetch could, for a multi-org user, return another org's customer if UUIDs were ever copied (they should not be). Webhook status updates are globally keyed by provider ids — correct if those ids are globally unique and the webhook is signed; a SID collision would write the wrong tenant's row under service role.
- **Fix recipe:** files: `dashboard.tsx`, `email-messaging.server.ts`. Behavior: add `.eq("org_id", …)` on every tenant-table query except the two inbound-routing lookups, which must stay global **and** require unique sender identity (TEMP-RLS-011). Tests: multi-org user, dashboard `?case=` of org A must not read org B customer columns. Verify: dashboard/email inbound tests.
- **Do not:** remove inbound global lookup without a unique sender inventory.

### [TEMP-RLS-011] `email_config.from_address` is not globally unique

- **Severity:** major
- **Bars:** P0-public (inbound webhook) / P0-managed (settings write)
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** `0020_channel_settings.sql:18-26` PK is `org_id` only. `recordInboundEmail` (`email-messaging.server.ts:142-151`) loads every non-null `from_address`, normalizes, requires `matchingConfigs.length === 1` else drops. Owner upsert at `api.org-settings.tsx:128-132` does not check uniqueness across orgs. `api.org-settings.tsx:25-26` is owner-gated.
- **Evidence (live):**
- **User / legal impact:** If two orgs set the same from-address, inbound email is dropped (availability). If org A sets B's from-address **before** B inserts `email_config`, Resend events addressed to that mailbox attach to org A (`:151-163` then looks up customers **inside A**). That is cross-tenant inbound routing under a signed webhook.
- **Fix recipe:** files: migration unique index on `lower(trim(from_address))` where not null; settings action precheck. Tests: second org upsert of the same from_address fails; inbound with two matches returns unmatched. Verify: `tests/email-inbound-status.test.ts`, `tests/save-email.action.test.ts`.
- **Do not:** case-sensitive unique on the raw column.

### [TEMP-RLS-012] User-facing loaders mint service-role clients for RLS-readable rows

- **Severity:** minor
- **Bars:** polish
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** `workspace.server.ts:26-32` `createSupabaseServiceClient` then `getConnectionStatus(service, org.org_id)` and `service.from("qbo_connections").select("last_sync_at").eq("org_id", …)` — members already have SELECT (`0032:30-31`). Same pattern: `dashboard.tsx:170-193`, `accounts.$id.tsx:100-110`, `focus.tsx:49-50`, `api.qbo.refresh.tsx:22` (refresh **does** need service role for token decrypt + invoice upsert). `invite.tsx:37-39` service-role INSERT even though `invites_owner_write` would allow the user client.
- **Evidence (live):**
- **User / legal impact:** Extra blast radius: a missed `eq("org_id")` on a service client is cross-tenant. Not an exploit by itself today (these calls pin `org_id`).
- **Fix recipe:** files: `workspace.server.ts`, `dashboard.tsx`, `accounts.$id.tsx`, `focus.tsx`, `invite.tsx`. Behavior: user client for connection **status** and invite insert; keep service role only for `listOrgMembers` (until TEMP-RLS-006) and token decrypt / QBO write / webhooks / cron.
- **Do not:** use service role “because chrome is shared”.

### [TEMP-RLS-013] Any member can trigger service-role QBO financial rewrite

- **Severity:** minor
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** `api.qbo.refresh.tsx:16-17` requires org membership, **not** owner. `:22-44` `syncOverdueInvoices(deps, org.org_id)` via service client, which upserts customers/invoices/payments (`qbo-sync.server.ts:30-44`) — rows members are forbidden to write under `0032:36-46`. Connect/disconnect **are** owner-gated (`api.qbo.connect.tsx:13-14`, `api.qbo.disconnect.tsx:19`).
- **Evidence (live):**
- **User / legal impact:** A member can fire Intuit API traffic and rewrite the org's financial snapshot. Aligns with “members cannot write invoices” in RLS only for the REST path, not the app path. Intuit review may treat this as a control-plane privilege bug.
- **Fix recipe:** files: `api.qbo.refresh.tsx`. Behavior: `org.role !== "owner"` → forbidden (or a dedicated `sync` capability). Tests: member POST refresh does not call sync. Verify: new `tests/api-qbo-refresh.test.ts`.
- **Do not:** leave a member-facing button that bypasses owner-write RLS without documenting it as intended.

### [TEMP-RLS-014] Onboarding action can create unbounded extra orgs

- **Severity:** minor
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** loader `onboarding.tsx:23-24` redirects if `resolveOrg` hits a membership. Action `:28-37` does **not** re-check; it always `createOrgForUser(service, user.id, name)` (`orgs.server.ts:35-45`) via service role (required: no INSERT policy on `organizations`/`memberships`). `resolveOrg` (`session.server.ts:34-40`) then permanently binds the UI to the **oldest** membership.
- **Evidence (live):**
- **User / legal impact:** Repeat POST creates extra tenants the UI never shows. Combined with TEMP-RLS-002, those hidden memberships expand the RLS `is_org_member` set and the org_id-rewrite surface. Not a cross-tenant read of *other people's* data.
- **Fix recipe:** files: `onboarding.tsx` action. Behavior: if `resolveOrg` non-null, redirect; unique index one-owner-org-per-user optional. Tests: second onboarding POST does not insert. Verify: `tests/onboarding.test.ts`.
- **Do not:** delete extra orgs from a GET.

### [TEMP-RLS-015] RLS / IDOR test coverage holes

- **Severity:** major
- **Bars:** polish (tests) — tracks untested production risk in TEMP-RLS-002/003/004
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** Existing `*rls*` files: `tests/rls.test.ts`, `tests/cases-rls.test.ts`, `tests/email-messages.rls.test.ts`, `tests/messaging-config-rls.test.ts`, `tests/org-settings-rls.test.ts`, `tests/promise-evaluation-rls.test.ts`. See §7 for the hole list.
- **Evidence (live):**
- **User / legal impact:** Several 0032 controls and the remaining FOR ALL tables are untested; regressions will not fail CI.
- **Fix recipe:** files: extend the `*rls*.test.ts` set as listed in §7. Verify: `npx vitest run tests/rls.test.ts tests/cases-rls.test.ts tests/email-messages.rls.test.ts tests/messaging-config-rls.test.ts tests/org-settings-rls.test.ts tests/promise-evaluation-rls.test.ts tests/oauth-state.test.ts`.
- **Do not:** add tests that use the service client to “prove” RLS.

### [TEMP-RLS-016] `prevent_member_customer_source_edits` is the only member UPDATE column gate

- **Severity:** minor (control itself is solid; fragility is the finding)
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** reconfirmed
- **Evidence (code):** `0032:61-89` `SECURITY DEFINER` trigger, `search_path = public`. Bypass: `auth.role() = 'service_role'` or `is_org_owner(new.org_id)` (`:68-70`). Blocked columns: `org_id, qbo_id, name, email, phone, created_at` (`:72-77`). RLS `customers_member_update` (`0032:54-55`) still allows UPDATE of every column; the trigger is the only source-field backstop. Covered by `tests/rls.test.ts:99-122`.
- **Evidence (live):**
- **User / legal impact:** If the trigger is dropped, members can overwrite QBO identity/contact fields (wrong phone/email → TCPA/CAN-SPAM mis-sends). Members **can** still set `sms_consent` (`api.sms-consent.tsx:44-48`) — intended app path, but also via raw UPDATE.
- **Fix recipe:** files: optional generated-column / `BEFORE UPDATE` keep-old-values, or split `customers` into `customers_source` (owner/service) + `customers_local` (member). Tests already exist; add a test that dropping-equivalent (update `qbo_id`) fails. Verify: `tests/rls.test.ts`.
- **Do not:** move consent writes into the trigger-blocked set without updating STOP/START (`twilio-messaging.server.ts:215-226`).

---

## 4. API routes — org pin before mutate / IDOR

All mutating `api.*` routes call `requireUser` + `resolveOrg` (or redirect/204). CSRF: `requireUser` → `requireSameOrigin` (`session.server.ts:26`). Object ids from the form are rebound to `org.org_id` **except** where noted.

| Route | Client | Org pin | Object-id IDOR notes |
|---|---|---|---|
| `api.account-notes.tsx:21-31` | user | `eq("org_id", org.org_id).eq("id", customerId)` SELECT then UPDATE | Solid. Comment at `:19-20` documents multi-org RLS hole. |
| `api.assign.tsx:21-33` | user | same + membership check `:26-29` | Solid. Outsider covered `tests/api-assign.test.ts:41-43`; multi-org pin `72-78`. |
| `api.bulk-assign.tsx:39-56` | user | cases `.eq("org_id").in("id", caseIds)` then customers `.eq("org_id").in("id", customerIds)` | Foreign case ids drop out of the SELECT (0 updates). Unknown case ids in the batch are silently skipped (not a cross-tenant write). |
| `api.comm-prefs.tsx:46-72` | user | customer / case / invoice all `.eq("org_id")` then UPDATE pinned | Solid. |
| `api.contact-logs.tsx:24-60` | user | case `.eq("org_id").eq("id", caseId)`; invoice extra `.eq("customer_id")`; insert `org_id: org.org_id` | Solid. Cross-org case `tests/api-contact-logs.test.ts:159-178,357+`. Promise create also org-pins (`promise-create.server.ts:22-28`). |
| `api.sms-consent.tsx:25-48` | user | invoice or customer `.eq("org_id")` then UPDATE pinned | Solid. |
| `api.promises.cancel.tsx:27-29` | user | `cancelPromise(…, org.org_id)` SELECT/UPDATE `.eq("org_id", orgId)` (`promise-cancel.server.ts:16-38`) | Solid. Multi-org test `tests/api-promises-cancel.test.ts:46-70`. |
| `api.priority-override.tsx:22-38` | user | case SELECT+UPDATE `.eq("org_id")` | Solid. |
| `api.sync-errors.dismiss.tsx:20-22` | user | `.eq("org_id").eq("id", errorId)` | Org pin solid; column scope is TEMP-RLS-007. |
| `api.presence.heartbeat.tsx:20-21` | user | `recordHeartbeat` upserts `org_id: org.org_id` (`presence.server.ts:11-19`); RLS `user_id = auth.uid()`; VALID composite FK `0014:19` | Cannot pair own org with foreign customer (`tests/presence.test.ts:102-117`). No extra SELECT of the customer. |
| `api.notification-prefs.tsx:17-34` | user | rejects `orgId !== org.org_id`; upsert `org_id` + `user_id: user.id` | Solid. RLS also self-only. |
| `api.org-settings.tsx` | user | owner gate `:26`; every upsert/delete uses `org.org_id` | Solid for tenancy. `save_sms_sender` locked `:56-61`. |
| `api.profile.tsx` | user | `auth.updateUser` self only | N/A (no org row). |
| `api.text.send.tsx:19-49` | **service** | `sendInvoiceText` invoice `.eq("org_id").eq("id", invoiceId)` (`twilio-messaging.server.ts:85-86`) then customer `.eq("org_id")` | Foreign invoiceId → empty SELECT → throw → `sms=error`. No cross-tenant send. |
| `api.email.send.tsx:12-32` | **service** | same pattern `email-messaging.server.ts:23-31` | Same. Member send bypasses `email_messages_owner_write` (justified insert). |
| `api.bulk-sms.tsx:41-86` | **service** | `runBulkSms` cases `.eq("org_id").in("id", ids)` (`bulk-send.server.ts:32-33`); each send re-pins | Foreign case ids omitted from `caseRows`. |
| `api.test-message.tsx:31-54` | **service** | owner gate; `email_config.eq("org_id")` (`test-message.server.ts:63-67`); SMS uses env sender not tenant From | Owner can SMS an arbitrary `to` number on the **shared** Twilio account (`:39-55`) — not IDOR; operator-abuse. |
| `api.qbo.connect.tsx:12-17` | **service** | owner + `createOAuthState(service, org.org_id, user.id)` | Solid. |
| `api.qbo.disconnect.tsx:18-24` | **service** | owner + `disconnectConnection(…, org.org_id)` | GET loader is confirm-HTML only (`:32-48`). |
| `api.qbo.refresh.tsx:16-44` | **service** | member (not owner) + `syncOverdueInvoices(deps, org.org_id)` | Org-scoped; privilege TEMP-RLS-013. |

Non-API mutators:

| Route | Client | Notes |
|---|---|---|
| `onboarding.tsx:28-37` | service | `createOrgForUser` — TEMP-RLS-014. |
| `invite.tsx:31-39` | service | owner check then insert `org_id: org.org_id`. Could use user client (TEMP-RLS-012). |
| `accept.$token.tsx:51-57` | service | token lookup + email match + expiry (`orgs.server.ts:12-22`). Bearer token unguessable (`0003:5` 16 random bytes). |
| `unsubscribe.tsx:21-33` | service | HMAC token → `eq("org_id", parsed.orgId).eq("id", parsed.customerId)`. GET does not mutate (`:14-18`). |
| `auth.qbo.callback.tsx:24-33` | service | See §6. |
| `webhooks.qbo.tsx` | service | signature then `qbo_connections.eq("realm_id")` (`:46-57`). Unknown realm ignored. |
| `webhooks.twilio.*` / `webhooks.resend.tsx` | service | signature first; status keyed by provider id (TEMP-RLS-010). |

Page loaders (`dashboard`, `focus`, `accounts`, `accounts.$id`, `messages`, `promises`, `reports`, `settings`) consistently `.eq("org_id", org.org_id)` on list queries. Exception: `dashboard.tsx:331-332` (TEMP-RLS-010). `accounts.$id.tsx:135-145` pins org+id and 404s. `reports.tsx:26` owner-only chrome.

---

## 5. Service-role inventory (production `app/` + `workers/`)

`createSupabaseServiceClient` is `app/lib/supabase.server.ts:33-37` (service key, no session).

| Location | Why it exists | Verdict |
|---|---|---|
| `orgs.server.ts:12-32` `acceptInvite` | Invitee is not yet a member; `invites` SELECT RLS would hide the row; `memberships` has no INSERT policy | Justified |
| `orgs.server.ts:35-69` `createOrgForUser` | `organizations`/`memberships` have no INSERT policy | Justified (add action re-check — TEMP-RLS-014) |
| `orgs.server.ts:78-90` `listOrgMembers` | `auth.users` is not RLS-readable | Justified **need**, unjustified **shape** (TEMP-RLS-006) |
| `oauth-state.server.ts:12-34` | `oauth_states` RLS on, no policies | Justified |
| `qbo-connection.server.ts:5-65` | Decrypt tokens; owner-write table; webhook/cron have no user JWT | Justified for token I/O; **not** for status-only reads |
| `qbo-sync.server.ts` + `qbo-cron.server.ts:17` | CDC/upsert invoices-payments-customers (member cannot write) | Justified |
| `webhooks.qbo.tsx:23` | No user session | Justified |
| `webhooks.twilio.inbound.tsx:26` / `.status.tsx:24` | No user session; inbound/status | Justified |
| `webhooks.resend.tsx:26` | No user session | Justified |
| `digest-cron.server.ts:31` + `notifications.server.ts` | Cron; `notification_log` has no user policies | Justified; pin holes TEMP-RLS-005 |
| `twilio-messaging.server.ts` send/inbound/status | Twilio + ledger; inbound must search across orgs | Justified; pin `org_id` on org-scoped branches (already done except status-by-SID) |
| `email-messaging.server.ts` send/inbound/status | `email_messages` member cannot INSERT | Justified |
| `api.text.send.tsx:38` / `api.email.send.tsx:23` / `api.bulk-sms.tsx:41` | Provider + ledger | Justified after org resolve |
| `api.test-message.tsx:34` | Owner test send | Justified |
| `api.qbo.connect.tsx:16` / `disconnect.tsx:23` / `refresh.tsx:22` / `auth.qbo.callback.tsx:26` | OAuth state + tokens | Justified (refresh privilege TEMP-RLS-013) |
| `invite.tsx:37` | Owner invite insert | **Replaceable** with user client (TEMP-RLS-012) |
| `unsubscribe.tsx:29` | Public HMAC opt-out; no JWT | Justified |
| `workspace.server.ts:26` / `dashboard.tsx:170` / `accounts.$id.tsx:100` / `focus.tsx:49` | Connection status + `listOrgMembers` | Status **replaceable** with user client; roster needs service until TEMP-RLS-006 |
| `onboarding.tsx:35` | Org bootstrap | Justified |
| `workers/app.ts:26-34` | Scheduled CDC + digest | Justified |

Test-only service clients (`tests/helpers.ts:15`, `tests/global-setup.ts:27`) are out of production scope.

---

## 6. `oauth_states`

- Table: `0004_qbo_oauth.sql:2-10`. Comment at `:8-9`: “RLS on, no policies. Only the service role.”
- `0034_oauth_state_user_binding.sql:1-12`: `user_id uuid references auth.users(id) NOT NULL` after deleting unbound rows; index `oauth_states_user_id_idx`.
- **Still no policies after 0034.** Authenticated DML is granted by `0001` default privileges but RLS denies every row. That is the correct “service-role only” pattern (same as `notification_log`).
- Write: `oauth-state.server.ts:17` insert `{ state, org_id, user_id, expires_at }`.
- Consume: `oauth-state.server.ts:22-34` SELECT by `state` (PK), DELETE, then expiry check. Returns `{ orgId, userId }`.
- Callback binding: `auth.qbo.callback.tsx:24-30`:

```24:30:nudgepay-app/app/routes/auth.qbo.callback.tsx
  const { supabase, headers, user } = await requireUser(request, env);
  try {
    const service = createSupabaseServiceClient(env);
    const oauthState = await consumeOAuthState(service, state); // throws on invalid/expired/replay
    const org = await resolveOrg(supabase, user.id);
    if (!org || org.role !== "owner" || org.org_id !== oauthState.orgId || user.id !== oauthState.userId) {
      return redirect("/dashboard?qbo=forbidden", { headers });
```

`user.id !== oauthState.userId` **is** checked. Stolen `state` cannot attach QBO to the attacker's org. Consume-before-authz (`delete` at `oauth-state.server.ts:29` happens before the callback's user check) can **burn** a victim nonce (DoS), not steal the connection.

Tests: `tests/oauth-state.test.ts` covers create/consume/single-use/expiry; **does not** assert authenticated client SELECT returns []. **Does not** assert callback rejects mismatched `user_id` (that lives only in the route).

Connect start: `api.qbo.connect.tsx:13-17` owner + `createOAuthState(service, org.org_id, user.id)`.

---

## 7. `*rls*.test.ts` coverage vs holes

Present:

| File | What it proves |
|---|---|
| `tests/rls.test.ts` | Cross-org customer isolation (`:20-33`); member cannot INSERT invites (`:35-48`); member cannot mutate `qbo_connections` (`:50-68`); member cannot write invoices/payments (`:70-97`); member cannot edit customer source fields, can edit notes/consent (`:99-122`); composite FK rejects cross-org `contact_logs` even for service role (`:124-145`) |
| `tests/cases-rls.test.ts` | One-open-case index; member sees only own org's cases (`:30-49`); reconciliation lifecycle |
| `tests/email-messages.rls.test.ts` | Member SELECT isolation (`:5-57`); **not** member write deny |
| `tests/messaging-config-rls.test.ts` | Owner write / member read on `messaging_config` + `email_config` |
| `tests/org-settings-rls.test.ts` | Owner write / member read / outsider deny; CHECK constraints |
| `tests/promise-evaluation-rls.test.ts` | Promise SELECT isolation + one-active index (`:5-41`); evaluator behavior (service client) |

Holes (no test found):

- `oauth_states`: authenticated SELECT/INSERT/DELETE denied
- `notification_log`: authenticated denied
- `memberships`: authenticated INSERT/UPDATE/DELETE denied (cannot self-promote to owner, cannot join org)
- `organizations`: authenticated INSERT/DELETE denied
- member cannot INSERT/DELETE `customers` (0032 owner-only)
- member cannot UPDATE/DELETE `email_messages`
- member cannot DELETE `contact_logs` / `text_messages` / `collection_cases` / `promises`
- member cannot SELECT `invites.token` (TEMP-RLS-003)
- member cannot SELECT `qbo_connections.access_token_enc` (TEMP-RLS-004)
- `user_notification_prefs`: cannot read/write a teammate's row; cannot set `user_id` to someone else
- `sync_errors`: member cannot INSERT; cannot UPDATE `message`
- `case_presence`: cannot INSERT with `user_id <> auth.uid()`; no DELETE policy
- `message_templates` member write deny
- service-role updates in `applyPromiseEvaluation` / `applyCaseReconciliation` with a foreign id + omitted org pin (TEMP-RLS-005)
- `VALIDATE CONSTRAINT` / `convalidated`
- callback `user_id` mismatch
- `email_config.from_address` uniqueness
- `FORCE ROW LEVEL SECURITY`

API IDOR tests that **do** exist (good): assign, account-notes, comm-prefs, sms-consent, contact-logs, priority-override, sync-errors dismiss, promises cancel (multi-org), presence heartbeat.

API IDOR tests **missing**: `api.text.send` / `api.email.send` / `api.bulk-sms` with a foreign `invoiceId`/`caseIds` (logic is org-pinned; tests are pure helpers only — `tests/api-text-send.test.ts` does not touch the DB).

---

## 8. What IS solid

- **Every public table has RLS enabled.** No table created in `0001`–`0034` is left `DISABLE ROW LEVEL SECURITY`.
- **`oauth_states` and `notification_log` are service-role-only** (RLS on, zero policies) — `0004:8-10`, `0024:52-55`.
- **`is_org_member` / `is_org_owner` are `SECURITY DEFINER` with `search_path = public`** — closes search-path hijack on the predicate (`0001:24-29`, `0016:6-11`).
- **QBO OAuth start+callback bind `user_id` and `org_id` and require owner** (`api.qbo.connect.tsx:13-17`, `auth.qbo.callback.tsx:28-29`, `0034:1-10`). Replay: consume deletes the nonce (`oauth-state.server.ts:27-30`). Tests: `tests/oauth-state.test.ts`.
- **0032 owner-write on invoices, payments, qbo_connections, invites** plus customer source-field trigger — covered by `tests/rls.test.ts:35-122`.
- **`case_presence` composite FK is VALID** (`0014:8,19`) and tested (`tests/presence.test.ts:6-35,102-117`). Writes require `user_id = auth.uid()` (`0014:28-32`).
- **API mutators that take `customerId` / `caseId` / `invoiceId` / `promiseId` pin `org.org_id` before write** (table in §4). Comments in those files explicitly call out “RLS permits every member org”. Multi-org cancel: `tests/api-promises-cancel.test.ts:46-70`.
- **`createPromiseForLog` / `cancelPromise` / `applyNextStep` use the user client and pin `org_id`** (`promise-create.server.ts:22-89`, `promise-cancel.server.ts:16-38`, `next-step.server.ts:24-56`).
- **`sendInvoiceText` / `sendInvoiceEmail` / `runBulkSms` resolve the invoice/customer under `args.orgId`** (`twilio-messaging.server.ts:85-94`, `email-messaging.server.ts:23-32`, `bulk-send.server.ts:32-48`). A foreign UUID does not send as another tenant.
- **Inbound SMS org resolution requires an unambiguous outbound ledger match** (`twilio-messaging.server.ts:156-177`); inbound email requires exactly one `from_address` match then scopes customers to that org (`email-messaging.server.ts:142-158`).
- **Unsubscribe is HMAC + POST-only + org+customer pin** (`unsubscribe.tsx:10-33`).
- **Webhooks verify signatures before service-role I/O** (`webhooks.qbo.tsx:16-20`, `webhooks.twilio.inbound.tsx:19-22`, `webhooks.twilio.status.tsx:17-20`, `webhooks.resend.tsx:11-16`).
- **`memberships` has no user write policy** — users cannot self-join or self-promote (`0002:23-24` SELECT only). Role is only set in `createOrgForUser` (owner) and `acceptInvite` (member) (`orgs.server.ts:25,45`).
- **Default privileges do not include `anon`** (`0001:2-3`, `0002:3-6`). Live still must confirm Supabase's own grants did not add `anon`.
- **`requireOrgUser` + workspace chrome** (`session.server.ts:48-53`, `workspace.server.ts:19-24`) gate pages on membership; reports additionally require owner (`workspace.server.ts:22-24`, `reports.tsx:26`).
- **New 0032 FKs *do* reject cross-org pairing on new writes**, including service role (`tests/rls.test.ts:124-145`).
- **SMS sender impersonation was closed:** `resolveSender` ignores `messaging_config.sender` (`twilio-messaging.server.ts:42-51`); `save_sms_sender` is locked (`api.org-settings.tsx:56-61`).
- **Invite accept enforces email match + expiry + single use** (`orgs.server.ts:16-22`, `0032:10-20`).

---

## 9. Suggested fix order

1. Validate 0032 FKs (TEMP-RLS-001) after a live orphan query.
2. Close member SELECT of invite tokens and QBO ciphertext (TEMP-RLS-003, TEMP-RLS-004).
3. Replace member FOR ALL on ledgers/cases with member SELECT (+ INSERT where the UI must write) and freeze `org_id` (TEMP-RLS-002).
4. Pin `org_id` on every service-role id-keyed write (TEMP-RLS-005) and unique `email_config.from_address` (TEMP-RLS-011).
5. Replace `listUsers` (TEMP-RLS-006); add the test holes (TEMP-RLS-015).
6. Polish: FORCE RLS, owner FK, onboarding re-check, stop minting service clients for status reads.
