# Wave 0 — Live surface map

**HEAD:** `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc`  
**Audit date:** 2026-08-20  
**Source of truth:** files as of HEAD under `nudgepay-app/` (not July 13 docs).

There is **no** named `requireOwner` helper in `app/lib/session.server.ts`. Owner gates are:

- `loadWorkspaceChrome(..., { requireOwner: true })` (`app/lib/workspace.server.ts:17–23`)
- inline `org.role !== "owner"` / `org.role === "owner"` in route modules

CSRF: `requireUser` always calls `requireSameOrigin` (`app/lib/session.server.ts:26` → `app/lib/csrf.server.ts:25–28`). `hasSameOriginProof` returns `true` for safe methods (`GET`/`HEAD`); unsafe methods (`POST`/`PUT`/`PATCH`/`DELETE`) need `Origin` or `Referer` matching the request origin (`csrf.server.ts:1–23`). `getOptionalUser` does **not** call `requireSameOrigin`.

React Router 7: `loader` handles GET/HEAD; `action` handles POST/PUT/PATCH/DELETE. Forms in this app POST. Resource routes that export `loader()` typically redirect GET away from the action URL.

---

## 1. Routes (`app/routes.ts`)

Registration table: `nudgepay-app/app/routes.ts` (47 entries, lines 3–47).

| Path | File | Methods | Auth gate | CSRF |
|---|---|---|---|---|
| `/` | `app/routes/home.tsx` | GET component only (no loader/action) | **public** | N/A (GET) |
| `/signup` | `app/routes/signup.tsx` | GET component; POST `action` L21 | **public** | **bypass** (no `requireSameOrigin`) |
| `/login` | `app/routes/login.tsx` | GET component; POST `action` L22 | **public** | **bypass** |
| `/logout` | `app/routes/logout.tsx` | GET `loader` L12 → `/login`; POST `action` L5 (`signOut`) | **public** (no session required) | **bypass** on POST |
| `/onboarding` | `app/routes/onboarding.tsx` | GET `loader` L20; POST `action` L28 | **requireUser** (loader redirects to `/dashboard` if org exists L24) | via `requireUser` |
| `/invite` | `app/routes/invite.tsx` | GET `loader` L19; POST `action` L28 | **requireOwner** (`requireUser` + `resolveOrg` + `org.role !== "owner"` → `/dashboard` L24 / error L32) | via `requireUser` |
| `/accept/:token` | `app/routes/accept.$token.tsx` | GET `loader` L23; POST `action` L51 | **requireUser** (invitee may have no org yet) | via `requireUser` |
| `/dashboard` | `app/routes/dashboard.tsx` | GET `loader` L161 | **requireOrgUser** L163 + QBO `connected` else `/settings?tab=integrations` L198 | via `requireOrgUser` → `requireUser` (GET N/A) |
| `/focus` | `app/routes/focus.tsx` | GET `loader` L44 | **requireOrgUser** L46 + QBO connected L51 | via `requireOrgUser` (GET N/A) |
| `/accounts` | `app/routes/accounts.tsx` | GET `loader` L35 | **requireOrgUser** via `loadWorkspaceChrome` L40 (default `requireQbo: true`) | via chrome → `requireOrgUser` (GET N/A) |
| `/accounts/:id` | `app/routes/accounts.$id.tsx` | GET `loader` L81 | **requireUser** + `resolveOrg` L84–86 (org-less → `/onboarding`) + QBO connected L103 | via `requireUser` (GET N/A) |
| `/promises` | `app/routes/promises.tsx` | GET `loader` L29 | **requireOrgUser** via chrome L34 | via chrome (GET N/A) |
| `/messages` | `app/routes/messages.tsx` | GET `loader` L46 | **requireOrgUser** via chrome L51 | via chrome (GET N/A) |
| `/reports` | `app/routes/reports.tsx` | GET `loader` L21 | **requireOwner** via `loadWorkspaceChrome(..., { requireQbo: false, requireOwner: true })` L26; non-owner → `/dashboard?denied=reports` | via chrome (GET N/A) |
| `/settings` | `app/routes/settings.tsx` | GET `loader` L28 | **requireOrgUser** via chrome `{ requireQbo: false }` L33 (members may view; writes are owner-gated on actions) | via chrome (GET N/A) |
| `/privacy` | `app/routes/privacy.tsx` | GET component only | **public** | N/A |
| `/eula` | `app/routes/eula.tsx` | GET component only | **public** | N/A |
| `/api/contact-logs` | `app/routes/api.contact-logs.tsx` | POST `action` L9; **no loader** | **requireUser** + `resolveOrg` (no org → `/onboarding` L13) | via `requireUser` |
| `/api/sms-consent` | `app/routes/api.sms-consent.tsx` | POST `action` L6; GET `loader` L54 → `/dashboard` | **requireUser** + `resolveOrg` L8–10 | via `requireUser` |
| `/api/comm-prefs` | `app/routes/api.comm-prefs.tsx` | POST `action` L26; GET `loader` L80 → redirect | **requireUser** + `resolveOrg` L28–30 | via `requireUser` |
| `/api/org-settings` | `app/routes/api.org-settings.tsx` | POST `action` L17; GET `loader` L185 → `/settings` | **requireOwner** (`requireUser` + `resolveOrg`; non-owner redirects `returnTo` L26) | via `requireUser` |
| `/api/assign` | `app/routes/api.assign.tsx` | POST `action` L6; GET `loader` L40 → `/dashboard` | **requireUser** + `resolveOrg` L8–10 | via `requireUser` |
| `/api/bulk-assign` | `app/routes/api.bulk-assign.tsx` | POST `action` L21; GET `loader` L62 → redirect | **requireUser** + `resolveOrg` L23–25 | via `requireUser` |
| `/api/priority-override` | `app/routes/api.priority-override.tsx` | POST `action` L8; GET `loader` L46 → redirect | **requireUser** + `resolveOrg` L10–12 | via `requireUser` |
| `/api/sync-errors/dismiss` | `app/routes/api.sync-errors.dismiss.tsx` | POST `action` L6; GET `loader` L28 → redirect | **requireUser** + `resolveOrg` L8–10 | via `requireUser` |
| `/api/presence/heartbeat` | `app/routes/api.presence.heartbeat.tsx` | POST `action` L8; GET `loader` L28 → redirect | **requireUser** + `resolveOrg` (no org → 204 L12) | via `requireUser` |
| `/api/promises/cancel` | `app/routes/api.promises.cancel.tsx` | POST `action` L14; **no loader** | **requireUser** + `resolveOrg` L16–18 | via `requireUser` |
| `/api/qbo/connect` | `app/routes/api.qbo.connect.tsx` | POST `action` L8; GET `loader` L26 → `/dashboard` | **requireOwner** (`requireUser` + `resolveOrg`; non-owner `/dashboard?qbo=forbidden` L13–15) | via `requireUser` |
| `/api/qbo/disconnect` | `app/routes/api.qbo.disconnect.tsx` | POST `action` L14; GET `loader` L32 | **POST: requireOwner** L17–19. **GET: public-ish** — `getOptionalUser` L37 (Intuit My Apps landing; no login redirect; does not mutate) | POST via `requireUser`; GET N/A (`getOptionalUser` skips CSRF) |
| `/api/qbo/refresh` | `app/routes/api.qbo.refresh.tsx` | POST `action` L11; GET `loader` L65 → `/dashboard` | **requireUser** + `resolveOrg` (any member; no owner check) L14–16 | via `requireUser` |
| `/auth/qbo/callback` | `app/routes/auth.qbo.callback.tsx` | GET `loader` L9 (OAuth redirect) | **requireOwner** + oauth-state bind: `requireUser` L24; then `org.role === "owner"` **and** `org.org_id === oauthState.orgId` **and** `user.id === oauthState.userId` else `/dashboard?qbo=forbidden` L29–30. Missing `code`/`realmId`/`state` redirects `/dashboard?qbo=error` **before** auth L18–20 | via `requireUser` (GET N/A) |
| `/webhooks/qbo` | `app/routes/webhooks.qbo.tsx` | POST `action` L12; **no loader** | **webhook-sig** `intuit-signature` vs `QBO_WEBHOOK_VERIFIER_TOKEN` L16–20 (401 on fail) | **bypass** (signature, not Origin) |
| `/api/text/send` | `app/routes/api.text.send.tsx` | POST `action` L15; GET `loader` L57 → `/dashboard` | **requireUser** + `resolveOrg` L18–20 | via `requireUser` |
| `/api/email/send` | `app/routes/api.email.send.tsx` | POST `action` L8; GET `loader` L44 → `/dashboard` | **requireUser** + `resolveOrg` L11–13 | via `requireUser` |
| `/unsubscribe` | `app/routes/unsubscribe.tsx` | GET `loader` L14; POST `action` L21 | **public** + HMAC `verifyUnsubscribeToken` (GET renders confirm; POST mutates) | **bypass** (token, not Origin) |
| `/api/account-notes` | `app/routes/api.account-notes.tsx` | POST `action` L6; GET `loader` L38 → redirect | **requireUser** + `resolveOrg` L8–10 | via `requireUser` |
| `/api/bulk-sms` | `app/routes/api.bulk-sms.tsx` | POST `action` L31; GET `loader` L94 → redirect | **requireUser** + `resolveOrg` L34–36 | via `requireUser` |
| `/webhooks/twilio/inbound` | `app/routes/webhooks.twilio.inbound.tsx` | POST `action` L13; **no loader** | **webhook-sig** `X-Twilio-Signature` L19–22 (403) | **bypass** |
| `/webhooks/twilio/status` | `app/routes/webhooks.twilio.status.tsx` | POST `action` L11; **no loader** | **webhook-sig** `X-Twilio-Signature` L17–20 (403) | **bypass** |
| `/webhooks/resend` | `app/routes/webhooks.resend.tsx` | POST `action` L8; **no loader** | **webhook-sig** Svix `svix-id`/`svix-timestamp`/`svix-signature` L11–16 (401) | **bypass** |
| `/api/profile` | `app/routes/api.profile.tsx` | POST `action` L6; **no loader** | **requireUser** + `resolveOrg` L8–10 | via `requireUser` |
| `/api/notification-prefs` | `app/routes/api.notification-prefs.tsx` | POST `action` L10; **no loader** | **requireUser** + `resolveOrg` L12–14 (self-only prefs) | via `requireUser` |
| `/api/test-message` | `app/routes/api.test-message.tsx` | POST `action` L22; GET `loader` L87 → `/settings` | **requireOwner** (`requireUser` + `resolveOrg`; non-owner redirects `returnTo` L31) | via `requireUser` |

**Root:** `app/root.tsx` has Layout/ErrorBoundary only — no auth loader.

**Auth-gate helpers (file:line):**

- `getOptionalUser` — `app/lib/session.server.ts:7`
- `requireUser` — `session.server.ts:13` (auth cookie + `requireSameOrigin`)
- `resolveOrg` — `session.server.ts:30` (first membership by `created_at`)
- `requireOrgUser` — `session.server.ts:48` (`requireUser` + org else `/onboarding`)
- `loadWorkspaceChrome` — `app/lib/workspace.server.ts:14` (`requireOrgUser` + optional owner + optional QBO)

---

## 2. Settings intents (`app/routes/api.org-settings.tsx`)

Single POST `action` (`L17`). After `requireUser` + `resolveOrg`, **owner-only** at `L26`. `intent = form.get("intent")` (`L28`).

| `intent` | Lines | Effect |
|---|---|---|
| `save_company_profile` | L30–44 | Parse `parseCompanyProfileUpdate`; upsert `org_settings`; update `organizations.name` |
| `save_channels` | L46–54 | Parse `parseChannelSettingsUpdate`; upsert `messaging_config` (`sms_enabled` only) |
| `save_sms_sender` | L56–62 | **Locked.** Always redirect `error=sms_sender_locked` (no tenant write of Twilio sender) |
| `save_quiet_hours` | L64–71 | Parse `parseQuietHoursUpdate`; upsert `org_settings` |
| `save_rules` | L73–80 | Parse `parseOrgSettingsUpdate`; upsert `org_settings` (grace/working days/cadence) |
| `add_holiday` | L82–90 | Parse date/label; upsert `org_holidays` on `(org_id, holiday_date)` |
| `remove_holiday` | L92–99 | Delete `org_holidays` row for date |
| `save_late_fees` | L101–108 | Parse `parseLateFeeSettingsUpdate`; upsert `org_settings` |
| `save_priority_thresholds` | L110–117 | Parse `parsePriorityThresholdsUpdate`; upsert `org_settings` |
| `save_workflow` | L119–126 | Parse `parseWorkflowKnobsUpdate`; upsert `org_settings` |
| `save_email` | L128–138 | Parse `parseEmailSettingsUpdate`; upsert `email_config`; success flag `email_saved=1` |
| `save_template` | L140–149 | Parse `parseTemplateUpsert`; upsert `message_templates` on `(org_id, channel, slug)` |
| `delete_template` | L151–161 | Parse `parseTemplateDelete`; delete matching template |
| `reset_templates` | L163–180 | `channel` must be `sms` or `email`; delete all org templates for channel; re-insert `DEFAULT_SMS_TEMPLATES` / `DEFAULT_EMAIL_TEMPLATES` |
| *(unknown / missing)* | L182 | Redirect `returnTo` with no save |

GET `loader` L185 redirects to `/settings`.

Related owner-only settings POST (not this file): `/api/test-message` intents `test_sms` / `test_email` (`api.test-message.tsx:33–82`).

---

## 3. `ViewId` and `SortId` (`app/lib/worklist.ts`)

**`ViewId`** (`worklist.ts:38`):

```
"all-open" | "30-plus" | "high-value" | "never-contacted" | "follow-ups-due"
| "broken-promises" | "waiting" | "on-hold" | "my-work" | "coming-due"
```

**`SortId`** (`worklist.ts:39`):

```
"recommended" | "most-overdue" | "highest-balance" | "customer"
```

`applyView` (`worklist.ts:156–171`) implements invoice-level filters for: `30-plus`, `high-value`, `never-contacted`, `follow-ups-due`, `broken-promises`, `my-work`. `coming-due` returns `[]` (separate dataset). `waiting` / `on-hold` / `all-open` fall through to all items at this layer (case-level filtering lives in `cases.ts`).

Live UI mirrors (not in `worklist.ts`):

- `ALL_VIEWS` — `app/routes/dashboard.tsx:68` (same 10 ids)
- `VALID_VIEWS` — `dashboard.tsx:220` (same 10)
- `VALID_SORTS` — `dashboard.tsx:221` (same 4)
- `SAVED_VIEWS` — `app/components/WorkQueue.tsx:110–121` (same 10 with labels)
- `SORT_OPTIONS` — `WorkQueue.tsx:123–128`

---

## 4. Crons

### `nudgepay-app/wrangler.toml`

Top-level `[triggers]` L17–20:

```
crons = ["*/30 * * * *", "0 * * * *"]
```

Production env `[env.production.triggers]` L29–31: **same two expressions**.

Comment L18–19: CDC catch-up every 30 min + hourly digest gate.

### `nudgepay-app/workers/app.ts`

`scheduled` handler L25–35:

| Cron | Dispatch | Handler |
|---|---|---|
| `0 * * * *` | `controller.cron === "0 * * * *"` L27 | `runScheduledDigest(envRecord)` — `app/lib/digest-cron.server.ts` (per-org local `digest_hour_local`) |
| anything else (i.e. `*/30 * * * *`) | `else` L31–33 | `runScheduledCdc(envRecord)` — `app/lib/qbo-cron.server.ts` (bounded CDC catch-up for connected orgs) |

Both wrapped in `ctx.waitUntil`.

---

## 5. Tables (`supabase/migrations` 0001–0034)

23 application tables. RLS is the security boundary unless noted (service role bypasses RLS).

| Table | Created | Later alterations | RLS |
|---|---|---|---|
| `organizations` | **0001** L6–10 | **0025** L6–7: owner UPDATE policy `org_owner_update` | **0002** L9 `enable row level security` |
| `memberships` | **0001** L12–19 | none in 0003–0034 | **0002** L10 |
| `customers` | **0001** L37–47 | **0008** L4–5 `owner`; **0014** L8 unique `(org_id, id)`; **0017** L6–10 `preferred_channel`, `do_not_call`, `do_not_text`; **0019** L5–7 `notes`, `notes_updated_at`, `notes_updated_by`; **0021** L6 `do_not_email`; **0032** L51–89: drop `customers_all`; member read/update, owner insert/delete; trigger `prevent_member_customer_source_edits` | **0002** L11 |
| `invoices` | **0001** L50–64 | **0032** L111–112 unique `(org_id, id)`; L130–132 composite FK to customers | **0002** L12; policies retightened **0032** L36–40 member-read / owner-write |
| `contact_logs` | **0001** L68–79 | **0007** L4–6 `promised_amount`, `promised_date`; **0009** L28 `case_id`; **0032** L117–118 unique `(org_id, id)`; L141–154 composite FKs | **0002** L13 |
| `text_messages` | **0001** L82–95 | **0006** L4–5 `customer_id`; **0009** L29 `case_id`; **0032** L102–106 unique inbound `twilio_message_sid`; L157–170 composite FKs; **0033** L13–17 generated `from_number_norm` / `to_number_norm` | **0002** L14 |
| `qbo_connections` | **0001** L98–109 | **0004** L15–17 token columns `bytea` → `text`; **0005** unique partial index on `realm_id`; **0032** L29–33 member-read / owner-write | **0002** L15; policies replaced **0032** L29–33 |
| `messaging_config` | **0001** L111–117 | **0020** L8 `sms_enabled`; L12–16 policies member-read / owner-write | **0002** L16; policies replaced **0020** L12–16 |
| `invites` | **0003** L1–8 | **0032** L11–17 `expires_at` (14-day default, NOT NULL); L22–25 owner-write (drop `invites_write`) | **0003** L11 |
| `oauth_states` | **0004** L2–7 | **0034** L2–10 `user_id` NOT NULL (legacy unbound rows deleted) | **0004** L10 **enabled; no policies** (service-role only) |
| `collection_cases` | **0009** L2–14 | **0011** L3–6 `exception_reason` (4 values) + `exception_note`; **0012** L4–9 priority override columns; **0015** L6–12 widen `exception_reason` to 9 values; L17–20 null `next_action_at` for terminal states; **0032** L114–115 unique `(org_id, id)`; L135–138 composite FK | **0009** L23 |
| `promises` | **0010** L4–21 | **0032** L120–121 unique `(org_id, id)`; L173–191 composite FKs | **0010** L26 |
| `promise_invoices` | **0010** L31–37 | **0032** L194–202 composite FKs | **0010** L40 |
| `payments` | **0010** L45–56 | **0032** L42–46 member-read / owner-write; L205–208 composite FK | **0010** L59; policies replaced **0032** L42–46 |
| `sync_errors` | **0013** L5–14 | none | **0013** L17 (member select + update) |
| `case_presence` | **0014** L10–20 | none | **0014** L23 (member read; insert/update own `user_id`) |
| `org_settings` | **0016** L19–30 | **0018** L15–18 `updated_at` trigger; **0023** L5–12 late-fee columns; **0025** L9–13 profile columns (`company_website`, `company_phone`, `payment_portal_url`, `timezone`); **0027** L6–13 priority thresholds; **0028** L6–12 workflow knobs; **0029** L6–9 digest schedule; **0030** L6–11 quiet hours | **0016** L42 (member read / owner write) |
| `org_holidays` | **0016** L32–39 | none | **0016** L43 |
| `email_config` | **0020** L18–26 | **0022** L13 `postal_address`; **0031** L5 drop `provider` | **0020** L27 |
| `email_messages` | **0021** L8–24 | **0022** L9–11 unique partial `provider_message_id`; **0032** L211–224 composite FKs | **0021** L25 (member read / owner write) |
| `user_notification_prefs` | **0024** L8–16 | none | **0024** L18 (own-row select/insert/update) |
| `notification_log` | **0024** L42–50 | none | **0024** L52 **enabled; no user policies** (service-role only) |
| `message_templates` | **0026** L3–15 | **0026** L28–31 `set_updated_at` trigger; seed inserts L36–62 | **0026** L20 |

**Not tables:** SQL functions `is_org_member` (0001), `is_org_owner` (0016), `set_updated_at` (0018), `prevent_member_customer_source_edits` (0032), `phone_last10` (0033). `auth.users` is Supabase Auth, not an app migration.

Default DML grants: 0001 L2–3 `alter default privileges`; 0002 L3–6 explicit grants on the original eight tables.

---

## 6. `createSupabaseServiceClient` call sites

Factory: `app/lib/supabase.server.ts:33` — `createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)` with `persistSession: false`. Bypasses RLS.

| File:line | Why |
|---|---|
| `app/lib/supabase.server.ts:33` | Factory definition |
| `app/lib/workspace.server.ts:26` | Chrome: `getConnectionStatus` + `qbo_connections.last_sync_at` (comment: connection metadata) |
| `app/lib/qbo-cron.server.ts:17` | Scheduled CDC: list connected orgs, decrypt tokens, write invoices/payments, `sync_errors` |
| `app/lib/digest-cron.server.ts:31` | Scheduled digest: no user session; read `qbo_connections` / `org_settings`; send + `notification_log` |
| `app/routes/dashboard.tsx:170` | Comment L169: connection-status + roster. Passed into `loadCaseQueueSource` (`listOrgMembers` needs `auth.users`) and `getConnectionStatus` / `last_sync_at` |
| `app/routes/focus.tsx:49` | QBO connection gate + `loadCaseQueueSource` (roster via service) |
| `app/routes/accounts.$id.tsx:100` | Comment L99: connection status + `last_sync_at` (“no RLS needed for own org's connection”) |
| `app/routes/onboarding.tsx:35` | `createOrgForUser`: insert `organizations` + owner `memberships` + seed templates (bootstrap before membership exists for RLS) |
| `app/routes/invite.tsx:37` | Insert `invites` and return token (service-role write) |
| `app/routes/accept.$token.tsx:26` | Loader: read invite by token (invitee is not yet a member; RLS would hide the row) |
| `app/routes/accept.$token.tsx:54` | Action: `acceptInvite` inserts `memberships` and stamps `accepted_at` |
| `app/routes/api.qbo.connect.tsx:16` | `createOAuthState` — `oauth_states` has RLS and **no policies** |
| `app/routes/auth.qbo.callback.tsx:26` | `consumeOAuthState` + `storeConnection` (encrypted tokens on `qbo_connections`) |
| `app/routes/api.qbo.disconnect.tsx:23` | `disconnectConnection`: decrypt/revoke tokens, clear connection (owner POST) |
| `app/routes/api.qbo.refresh.tsx:22` | Manual `syncOverdueInvoices` + `sync_errors` + optional broken-promise alerts |
| `app/routes/webhooks.qbo.tsx:23` | No user session. Realm→org lookup, CDC apply, `sync_errors` |
| `app/routes/api.text.send.tsx:38` | Twilio send path (`MessagingDeps.service`): write `text_messages`, lookup customers/invoices/config |
| `app/routes/api.bulk-sms.tsx:41` | `loadOrgConfig` + `runBulkSms` (same Twilio/ledger path) |
| `app/routes/api.email.send.tsx:23` | `sendInvoiceEmail`: `email_messages` insert is owner-write under RLS; service writes the ledger; HMAC unsub tokens |
| `app/routes/api.test-message.tsx:34` | Owner test SMS/email via provider APIs (skips customer pipeline) |
| `app/routes/webhooks.twilio.inbound.tsx:26` | No user session. `recordInboundMessage` (STOP/HELP, `text_messages`) |
| `app/routes/webhooks.twilio.status.tsx:24` | No user session. `updateMessageStatus` by `MessageSid` |
| `app/routes/webhooks.resend.tsx:26` | No user session. `updateEmailStatus` / `recordInboundEmail` |
| `app/routes/unsubscribe.tsx:29` | No user session. HMAC-scoped `customers.do_not_email = true` |

Indirect: `accounts.tsx`, `promises.tsx`, `messages.tsx`, `reports.tsx`, `settings.tsx` receive `service` from `loadWorkspaceChrome` (`workspace.server.ts:26`) — they do not call the factory themselves.

---

## 7. Domain enumerations

### Contact log — `app/lib/contact-log.ts`

**`CONTACT_METHODS`** L7: `call`, `text`, `note`

**`CONTACT_OUTCOMES`** L8–11:

- `promise-to-pay`
- `dispute`
- `no-commitment`
- `left-voicemail`
- `no-answer`
- `other`
- `payment-already-sent`
- `requested-documentation`
- `escalation-required`
- `follow-up-requested`

**`NEXT_STEPS`** L16: `follow_up`, `promise`, `waiting`, `exception`

`EXCEPTION_REASONS` L18 aliases `EXCEPTION_STATES` from `exceptions.ts`.

### Exception taxonomy — `app/lib/exceptions.ts`

**`EXCEPTION_STATES`** L6–16:

| State | terminal | requiresReview | blocksContact | Label |
|---|---|---|---|---|
| `disputed` | false | true | false | Disputed |
| `incorrect_amount` | false | true | false | Incorrect amount |
| `work_incomplete` | false | true | false | Work incomplete |
| `documentation_requested` | false | true | false | Documentation requested |
| `wrong_contact` | false | true | false | Wrong contact |
| `payment_plan` | false | true | false | Payment plan |
| `legal_agency` | true | false | true | Legal / agency |
| `do_not_contact` | true | false | true | Do not contact |
| `other` | false | true | false | Other |

`PRIMARY_EXCEPTION_STATES` L37–38: all except `other`. Policy object: `EXCEPTION_POLICY` L24–34.

DB check (live): `0015_case_exception_taxonomy.sql` L9–12 matches these nine values.

### Case statuses — `app/lib/cases.ts`

**`CaseStatus`** L31: `"new" | "working" | "promised" | "waiting" | "on_hold" | "resolved"`

**`NextActionType`** L32: `"contact" | "follow_up" | "promise" | "waiting" | "exception"`

DB check: `0009_collection_cases.sql` L6–9 matches both unions.

---

## 8. Tooling surface

### `nudgepay-app/package.json` scripts (L6–15)

| Script | Command |
|---|---|
| `build` | `react-router build` |
| `cf-typegen` | `wrangler types && react-router typegen` |
| `typegen` | `wrangler types && react-router typegen` |
| `check` | `tsc && react-router build && wrangler deploy --dry-run` |
| `deploy` | `wrangler deploy` |
| `dev` | `react-router dev` |
| `preview` | `npm run build && vite preview` |
| `typecheck` | `npm run typegen && tsc -b` |

**Missing `test` script.** Vitest is a `devDependency` (`vitest` ^4.1.9). Tests are invoked as `npx vitest run` (see `Agents.md`), not `npm test`.

### Wrangler production placeholder

`nudgepay-app/wrangler.toml` L22–27:

```
# --- Production environment ---------------------------------------------------
# Deploy with: npx wrangler deploy --env production
[env.production.vars]
SUPABASE_URL = "https://<your-prod-project-ref>.supabase.co"
QBO_SANDBOX = "false"
```

`SUPABASE_URL` is still the `<your-prod-project-ref>` placeholder. Secrets are documented L33–52 as `wrangler secret put … --env production` (not in `[vars]`).

### `netlify/_redirects`

Path: `D:\nudgepay\netlify\_redirects`

```
/privacy  https://WORKER_PROD_URL_PLACEHOLDER/privacy  301!
/eula     https://WORKER_PROD_URL_PLACEHOLDER/eula     301!
/*        https://WORKER_PROD_URL_PLACEHOLDER/          302
```

Comment L5–6: replace `WORKER_PROD_URL_PLACEHOLDER` before deploying. Legacy Netlify host `nudgepay-ar.netlify.app` is a redirect shell for Intuit app-card `/privacy` and `/eula` links.

---

## Notes for later waves

- CSRF is Origin/Referer, not a hidden token. Public POSTs (`/login`, `/signup`, `/logout`) and `/unsubscribe` do not call `requireSameOrigin`.
- `/auth/qbo/callback` can redirect `qbo=error` before `requireUser` when Intuit query params are missing (L18–20).
- `oauth_states` and `notification_log` have RLS enabled with zero user policies.
- Table name in live schema is `organizations`, not `orgs`.
