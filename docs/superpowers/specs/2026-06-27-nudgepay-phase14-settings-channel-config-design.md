# Phase 14 — Settings: Channel Config (per-org channel toggles + email groundwork) — Design

**Status:** Approved (design) — 2026-06-27
**Project:** NudgePay (AR-collections workspace for QuickBooks Online; Chancey Heating & Cooling)
**Predecessors:** Phases 1–13 merged to `main`. This is **subsystem #2** of the three-part initiative scoped during the Phase 13 brainstorm (2026-06-27). Subsystem #1 (Messages tab) shipped in Phase 13; subsystem #3 (real email backend) is a later, separate spec.

## 1. Goal

Give an org owner an in-UI, server-enforced switch over their communication **channels**, and lay the minimal storage groundwork the future email backend (subsystem #3) will consume.

Concretely:
- A per-org **SMS on/off toggle** in Settings (owner-only), **enforced on the send paths** — not cosmetic.
- The **email channel config storage** created now (disabled by default), with **no email UI and no sending** built this phase.
- A targeted **security fix**: tighten `messaging_config` RLS from member-write to owner-write, matching the rest of Settings.

The "writable sender" idea from the Phase 13 brainstorm is **explicitly dropped** (brainstorm decision 2026-06-27): in the shared platform Twilio account, free-typing a sender would let a tenant send as a number they don't own. The sender stays **read-only / operator-provisioned**.

## 2. Background — what exists

- **`messaging_config`** (0001) — one row per org: `messaging_service_sid`, `sender`, `created_at`. **RLS = `is_org_member` (member read AND write)** — looser than the rest of Settings. The Settings "Text messaging" panel (G2) reads it **read-only**; `resolveSender` (`twilio-messaging.server.ts`) prefers `messaging_service_sid` → `sender` → env default.
- **`org_settings`** (0016) — C7 scheduling rules. **RLS = members read (`is_org_member`), owners write (`is_org_owner`)**. Edited via `CollectionsRulesForm` → `/api/org-settings` (owner-gated action with `intent` dispatch: `save_rules`/`add_holiday`/`remove_holiday`; redirects with `?saved=1`/`?error=<key>`). This is the established Settings-write model this phase follows.
- **Outbound SMS** flows through **`sendInvoiceText`** (`twilio-messaging.server.ts`), used directly by `/api/text/send` and indirectly by `/api/bulk-sms` (via `runBulkSms` in `bulk-send.server.ts` → `sendInvoiceText`). It currently gates only on per-customer `sms_consent`, `do_not_text`, and case-level contact-block. **There is no org-level channel switch.**
- **Inbound** (`recordInboundMessage`) + status webhooks are independent of any outbound gate.
- **comm-prefs** (`comm-prefs.ts`) are per-**customer** (call/text); the org toggle is a new, separate, org-wide layer.
- **Composers** that send SMS: `DetailPanel` (dashboard Messages tab) and `MessageThreadPanel` (Phase 13 Messages tab). Both post to `/api/text/send`.

## 3. Scope (locked decisions — brainstorm 2026-06-27)

| Decision | Choice |
| --- | --- |
| Sender editing | **Dropped.** Sender stays read-only / operator-provisioned (shared-account impersonation risk). |
| Channels with a per-org toggle | **SMS** (live, enforced now) + **Email** (stored now, enforced in #3). Call unchanged (tel: handoff, governed by `do_not_call`). |
| Enforcement | **Server-side** in `sendInvoiceText` (the real gate; covers single + bulk) **plus** UI disabling in both composers. Not UI-only. |
| Email groundwork | **Storage schema only**, `email_enabled` default false. No email UI, no sending, no provider-key handling this phase. |
| Storage model | **Per-channel, symmetric:** `sms_enabled` on `messaging_config`; new `email_config` table. (Not folded into `org_settings`.) |
| `messaging_config` RLS | **Tightened** to members-read / owners-write (fix of pre-existing member-write looseness). |
| Settings write | New **`save_channels`** intent on the existing owner-gated `/api/org-settings`. |
| SMS-off behavior | Disable **composing/sending**; still **read** threads and **receive** inbound. |

## 4. Architecture

```
Settings (owner) ── save_channels ──▶ /api/org-settings ──▶ messaging_config.sms_enabled (RLS owner-write)
                                                                     │
outbound send paths:                                                 ▼ (read)
  /api/text/send ─┐                                          sendInvoiceText() ── throws if sms disabled
  /api/bulk-sms ──┴─ runBulkSms ─▶ sendInvoiceText() ────────────────┘
  (early bulk short-circuit for clean UX)

composers (dashboard DetailPanel, Messages MessageThreadPanel):
  loaders expose org `smsEnabled` ─▶ Send disabled + reason when false

email_config (NEW, disabled, owner-write RLS) ── created now, consumed by subsystem #3
```

Reads use the RLS **user client**; the `sendInvoiceText` gate uses the **service client** it already holds. Writes go through the owner-gated `/api/org-settings`. No browser→DB access.

## 5. Components & data flow

### 5.1 Migration `0020_channel_settings.sql` (NEW)

1. **`messaging_config.sms_enabled`**: `alter table messaging_config add column sms_enabled boolean not null default true;` (existing rows + no-row orgs → SMS on, preserving today's behavior).
2. **Tighten `messaging_config` RLS**: drop the existing `messaging_config_all` (member read+write) policy; add `messaging_config_member_read` (`for select using (is_org_member(org_id))`) and `messaging_config_owner_write` (`for all using (is_org_owner(org_id)) with check (is_org_owner(org_id))`), mirroring `org_settings`. (`is_org_owner` already exists from 0016.)
3. **`email_config`** (NEW, groundwork):
   ```sql
   create table email_config (
     org_id uuid primary key references organizations(id) on delete cascade,
     email_enabled boolean not null default false,
     from_address text,
     from_name text,
     provider text,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );
   alter table email_config enable row level security;
   create policy email_config_member_read on email_config for select using (is_org_member(org_id));
   create policy email_config_owner_write on email_config for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));
   ```
   **No API-key/secret column** — provider credential handling is a deliberate subsystem-#3 decision. Table is created empty; absence of a row ⇒ email disabled.

   > **Local re-apply note:** `messaging_config` RLS is being changed; applying an edited/added migration locally uses `supabase db reset` per the project's established workflow. `0020` is additive/forward-only for remote.

### 5.2 `app/lib/channel-settings.ts` (NEW — pure, suffix-free)

```ts
export type ChannelSettings = { smsEnabled: boolean };
export type ChannelSettingsRow = { sms_enabled?: boolean | null };

// nullish row / missing column ⇒ default ENABLED (preserves pre-toggle behavior)
export function resolveChannelSettings(row: ChannelSettingsRow | null | undefined): ChannelSettings;

export type ChannelParseResult =
  | { ok: true; patch: { sms_enabled: boolean } }
  | { ok: false; error: string };

// Reads a checkbox-style form field; "true"/"on"/"1" ⇒ true, else false. Always ok
// for a boolean (no invalid state), but returns the typed shape for the route.
export function parseChannelSettingsUpdate(form: FormData): ChannelParseResult;
```

Pure, no I/O, unit-tested. Mirrors `org-settings.ts` / `comm-prefs.ts`.

### 5.3 `/api/org-settings` — add `save_channels` intent

In the existing owner-gated action (after the `org.role !== "owner"` guard), add:
```ts
if (intent === "save_channels") {
  const parsed = parseChannelSettingsUpdate(form);            // { sms_enabled }
  const { error } = await supabase.from("messaging_config")
    .upsert({ org_id: org.org_id, ...parsed.patch }, { onConflict: "org_id" });
  if (error) return redirect(flag(returnTo, "error", "save"), { headers });
  return redirect(flag(returnTo, "saved", "1"), { headers });
}
```
RLS (owner-write) is the real boundary; the surface gate is the existing `org.role !== "owner"` redirect. Upsert preserves `sender`/`messaging_service_sid` (only `sms_enabled` + `org_id` are written; `upsert` on the `org_id` conflict updates just those, leaving other columns intact on an existing row — and a no-row org gets a row with default sender NULL, which is fine: `resolveSender` falls back to env).

### 5.4 `twilio-messaging.server.ts` — enforce

Add an org-level gate in `sendInvoiceText`, before the Twilio call (alongside the existing consent/contact-block checks):
```ts
const { data: mc } = await deps.service.from("messaging_config")
  .select("sms_enabled").eq("org_id", args.orgId).maybeSingle();
if (mc && mc.sms_enabled === false) throw new Error("SMS disabled for this workspace");
```
(No row ⇒ enabled, matching the default.) Because `runBulkSms` calls `sendInvoiceText`, this single gate covers both single and bulk. Order it early (before `sendSms`) so no Twilio call happens when disabled.

### 5.5 `/api/text/send` + `/api/bulk-sms` — surface the disabled outcome

- **`/api/text/send`**: the `catch` already maps `err.message` → `sms=blocked|optout|noconsent|error`. Add a `disabled` arm: `/(disabled)/i.test(msg) ? "disabled"` → `withSms(returnTo, "disabled")`. Composers render a banner for `sms=disabled` ("Text messaging is turned off for this workspace.").
- **`/api/bulk-sms`**: add an early org-level check (read `messaging_config.sms_enabled` once via the service client) — if disabled, skip the run and redirect `?bulkSms=disabled` for a clean banner instead of N per-case failures.

### 5.6 `settings.tsx` — owner toggle

- **Loader**: extend the existing `messaging_config` read to also select `sms_enabled`; return `messaging.smsEnabled` (via `resolveChannelSettings`). (`sender`/`configured` unchanged.)
- **Page**: the "Text messaging" panel keeps the read-only From/Status rows and adds an **SMS-enabled toggle** — for an owner, a `Form method="post" action="/api/org-settings"` with `intent=save_channels`, a checkbox (`name="sms_enabled"`), `returnTo=/settings`, and a Save button (or auto-submit on change, matching `CollectionsRulesForm` ergonomics); for a non-owner, a read-only "On/Off" label. The existing `?saved=1`/`?error=` handling covers feedback. Sender remains read-only with the "carrier registration managed by NudgePay" note. **No email panel.**

### 5.7 Composer enforcement (UI)

- **Loaders** `dashboard.tsx` and `messages.tsx`: read the org `messaging_config.sms_enabled` (service client, as both already use it for connection status) and return `smsEnabled: boolean`.
- **`DetailPanel`** (dashboard Messages tab) and **`MessageThreadPanel`** (Phase 13): accept an `smsEnabled` prop; Send is disabled when `!smsEnabled` with the reason "Text messaging is turned off for this workspace." This org-wide gate is a **separate prop**, NOT folded into the per-customer `canReply` deriver in `message-inbox.ts` (which stays per-customer). Disabled precedence: org-off reason shown when SMS is off, otherwise the existing per-thread reason.

## 6. Security boundary

- **Writes** (`save_channels` → `messaging_config`): owner-only — enforced by the new owner-write RLS **and** the route's `org.role !== "owner"` surface gate.
- **`messaging_config` RLS tightened** to members-read / owners-write (removes the pre-existing member-write hole; nothing writes it via UI today, so no behavior regression).
- **`email_config`**: owner-write / member-read from creation; no secrets stored.
- **Reads** (`smsEnabled` in loaders, settings): existing clients; the send-path gate uses the service client `sendInvoiceText` already holds.
- No secrets to the client; browser never touches the DB.

## 7. Error & edge handling

- **No `messaging_config` row** for an org ⇒ SMS treated as **enabled** (default), preserving today's behavior; the first toggle write upserts a row.
- **SMS disabled mid-session** (toggled off between load and send): `sendInvoiceText` throws server-side → `/api/text/send` redirects `sms=disabled` banner; the stale-enabled composer's optimistic send is re-blocked.
- **Bulk with SMS disabled**: early redirect `bulkSms=disabled` (no partial sends).
- **Non-owner** attempts the toggle: surface gate redirects; RLS would also reject.
- **Inbound while SMS disabled**: still recorded; STOP/START still honored (no outbound gate on inbound).
- **`email_config`**: created disabled; not read by any loader or send path this phase (groundwork only).

## 8. Testing (TDD)

- **`tests/channel-settings.test.ts`** (NEW, pure): `resolveChannelSettings` (true/false/nullish-row → default enabled; missing column → enabled); `parseChannelSettingsUpdate` (checkbox present/absent → true/false).
- **`tests/api-org-settings.test.ts`** (extend or NEW, DB-backed): an owner's `save_channels` upserts `sms_enabled` (true→false→true) and leaves `sender`/`messaging_service_sid` intact; a **member** cannot write `messaging_config` (RLS); a member **can read** it.
- **`tests/messaging-config-rls.test.ts`** (NEW or fold into above): post-0020, member read allowed, member write denied, owner write allowed; `email_config` same matrix.
- **`tests/twilio-messaging*.test.ts`** (extend): `sendInvoiceText` throws "SMS disabled…" when `sms_enabled=false`; sends normally when true / no row; the throw does **not** call Twilio (no `sendSms`).
- **Components** verified by `npx react-router typegen && npx tsc -b` + `npx react-router build` (no render-test infra). Live-Chrome pass on the merged feature (seed + owner login): toggle SMS off → Save → composer disabled with reason + send blocked server-side; toggle on → send works. Deferred to a manual run per Phase 11–13 precedent.
- **Gates:** `npx react-router typegen && npx tsc -b` exit 0 · `npx vitest run` green (local Supabase up; `supabase db reset` after adding `0020`) · `npx react-router build` clean.

## 9. File structure

| Action | File | Responsibility |
| --- | --- | --- |
| Create | `supabase/migrations/0020_channel_settings.sql` | `sms_enabled` column + `messaging_config` RLS retighten + `email_config` table |
| Create | `app/lib/channel-settings.ts` | Pure parse/resolve for the SMS toggle |
| Modify | `app/routes/api.org-settings.tsx` | `save_channels` intent (owner-gated upsert) |
| Modify | `app/routes/settings.tsx` | Loader reads `sms_enabled`; owner SMS toggle in the messaging panel |
| Modify | `app/lib/twilio-messaging.server.ts` | Org SMS gate in `sendInvoiceText` |
| Modify | `app/routes/api.text.send.tsx` | Map `disabled` → `sms=disabled` |
| Modify | `app/routes/api.bulk-sms.tsx` | Early `sms_enabled` short-circuit (`bulkSms=disabled`) |
| Modify | `app/routes/dashboard.tsx` | Loader exposes `smsEnabled`; pass to `DetailPanel` |
| Modify | `app/routes/messages.tsx` | Loader exposes `smsEnabled`; pass to `MessageThreadPanel` |
| Modify | `app/components/DetailPanel.tsx` | Composer disabled + reason when SMS off; `sms=disabled` banner |
| Modify | `app/components/MessageThreadPanel.tsx` | Composer disabled + reason when SMS off; `sms=disabled` banner |
| Create | `tests/channel-settings.test.ts` | Pure unit tests |
| Create/Modify | `tests/api-org-settings.test.ts` / `tests/messaging-config-rls.test.ts` | `save_channels` + RLS matrices |
| Modify | `tests/twilio-messaging*.test.ts` | SMS-disabled gate |

## 10. Global constraints (carried)

- React Router v7 framework mode on Cloudflare Workers. No `node:*` in `app/**`. No client→`.server.ts` graph reference; pure modules suffix-free (`channel-settings.ts`).
- Tailwind v4 CSS-first; literal class strings only. Phase-10 warm tokens. Reuse the existing Settings panel styling.
- Supabase RLS via `is_org_member`/`is_org_owner`; user client for reads + the consent/settings writes; service client only where already used (send path, connection status, roster). Browser never touches the DB.
- Vitest against local Supabase; per-test fresh orgs + globally-unique data; never global truncation. `supabase db reset` after adding `0020`. `npx vitest run`.
- Conventional Commits. Never commit secrets. Never `git add` untracked scratch/prototype dirs.

## 11. Out of scope (→ subsystem #3)

All email **sending**: provider integration (Resend/SendGrid/SES/Postmark), provider key handling (likely a platform deploy secret), domain auth (SPF/DKIM), the `email_messages` thread model, opt-out/CAN-SPAM unsubscribe, email templates, the email enable/disable **UI**, and wiring email into the Messages tab (the `channel:"sms"` reservation). This phase creates only the disabled `email_config` row shape. Also out of scope: bring-your-own Twilio, writable sender selection, and any Call-channel toggle.
