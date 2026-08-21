# Wave 1 — Settings, templates, notifications, reports + product UX

- **HEAD:** `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc`
- **App:** `nudgepay-app/`
- **Method:** code-only pass. Live evidence left blank (this wave did not hit a running Worker).
- **IDs:** `TEMP-SET-*` (settings/reports), `TEMP-UX-*` (product UX). A11y/ops live in `ops-a11y.md`.
- **Reconfirmations:** several items match the 13 July 2026 audit (M2, M9, M16, M17, M31, minors 2–3, 5, 8, 11, 16–19) and are still open on this HEAD.

---

## Owner vs member — every `api.org-settings` intent

Surface gate is a single check, then RLS (`is_org_owner`) is the real boundary:

```25:26:nudgepay-app/app/routes/api.org-settings.tsx
  // Owner-only surface gate; RLS (is_org_owner) is the real boundary.
  if (org.role !== "owner") return redirect(returnTo, { headers });
```

A non-owner POST is a **silent redirect** — no `?error=` (see TEMP-SET-011).

| Intent | Owner | Member UI | Member POST | Notes |
|---|---|---|---|---|
| `save_company_profile` | writes org name + profile + digest hour | read-only Company card | silent deny | Distinct `?saved=profile` (collides with display-name save — TEMP-SET-003) |
| `save_channels` | SMS on/off upsert | On/Off text only | silent deny | Auto-submits on `<select>` change; no Saved banner (TEMP-SET-017) |
| `save_sms_sender` | **locked** — always `error=sms_sender_locked` | no form | silent deny | Intent is dead on purpose; UI is display-only. Solid. |
| `save_quiet_hours` | writes window | form hidden | silent deny | Distinct `?saved=quiet_hours`. Same-day windows only. |
| `save_rules` | grace / working days / cadence | disabled inputs, no Save | silent deny | **No success/error UI at all** (TEMP-SET-005) |
| `add_holiday` / `remove_holiday` | yes | list only | silent deny | `?saved=1` |
| `save_late_fees` | yes | form hidden | silent deny | Display-only fees. No error banners (TEMP-SET-006) |
| `save_priority_thresholds` | yes | form hidden | silent deny | Client min `$0.01` vs server `$1,000` (TEMP-SET-002) |
| `save_workflow` | yes | form hidden | silent deny | min/max match server (1–60 / 1–30 / 1–200). Solid. |
| `save_email` | yes | read-only From/status | silent deny | Distinct `?email_saved=1` — the one flash that was fixed |
| `save_template` / `delete_template` / `reset_templates` | yes | view-only + “Only an owner can edit” | silent deny | Defaults resurrect after delete (TEMP-SET-001) |

**Not org-settings, but settings-adjacent:**

| Route | Owner | Member |
|---|---|---|
| `POST /api/profile` | display name | display name (any member) |
| `POST /api/notification-prefs` | own prefs | own prefs (RLS self-only) |
| `POST /api/test-message` | SMS to arbitrary number / email to self | silent deny |
| `POST /api/qbo/connect` / `disconnect` | yes | forbidden → `/dashboard?qbo=forbidden` (never rendered) |
| `POST /api/qbo/refresh` | yes | yes, if connected |
| `POST /api/sync-errors/dismiss` | yes | yes (inline list on Integrations) |
| `GET/POST /invite` | yes | redirect `/dashboard` |
| `GET /reports` | yes | redirect `/dashboard?denied=reports` |

---

## Exhaustive page inventory (UX)

Paths relative to the Worker origin. Chrome: `AppShell` unless noted.

### Public (no session)

| Path | File | What the user sees |
|---|---|---|
| `/` | `app/routes/home.tsx` | One headline, Sign up / Log in, Privacy · EULA. No product shots, pricing, or support. |
| `/signup` | `app/routes/signup.tsx` | Email/password/name. Confirm-email branch if session not returned. |
| `/login` | `app/routes/login.tsx` | Email/password + `returnTo`. |
| `/privacy` | `app/routes/privacy.tsx` | Privacy Policy (prose). |
| `/eula` | `app/routes/eula.tsx` | EULA; still “private beta”. |
| `/unsubscribe` | `app/routes/unsubscribe.tsx` | CAN-SPAM confirm-then-POST. No AppShell. |

### Auth, public chrome (`PublicLayout`)

| Path | File | Notes |
|---|---|---|
| `/onboarding` | `app/routes/onboarding.tsx` | Name the org. No QBO prompt. |
| `/invite` | `app/routes/invite.tsx` | Owner-only. **Not linked from Settings or anywhere else.** |
| `/accept/:token` | `app/routes/accept.$token.tsx` | Invite accept / expiry / wrong-email states. |
| `/logout` | `app/routes/logout.tsx` | POST signs out; GET redirects `/login`. Triggered by the avatar. |

### Workspace (`AppShell`)

| Path | File | Nav | Notes |
|---|---|---|---|
| `/dashboard` | `app/routes/dashboard.tsx` | Collections | KPI band, triage strip, WorkQueue, optional DetailPanel (`w-96`), log/prefs drawers. Focus Mode link in header (hidden `<sm`). |
| `/focus` | `app/routes/focus.tsx` | *(no AppShell)* | Full-screen dark triage. Only reachable from dashboard header. |
| `/accounts` | `app/routes/accounts.tsx` | Accounts | Directory + metrics + quick panel. |
| `/accounts/:id` | `app/routes/accounts.$id.tsx` | Accounts | Full account profile (invoices, notes, comm prefs). |
| `/promises` | `app/routes/promises.tsx` | Promises | Ledger + metrics + quick panel. |
| `/messages` | `app/routes/messages.tsx` | Messages | Unified SMS+email inbox + thread panel. |
| `/reports` | `app/routes/reports.tsx` | Reports (owners) | Team performance + workload. Members: nav says “coming soon”; URL redirects with `denied=reports`. |
| `/settings` | `app/routes/settings.tsx` | gear in top bar | Five tabs via `?tab=`. |

### Settings tabs (`?tab=`)

| Tab | Default URL | Sections |
|---|---|---|
| Workspace | `/settings` | Display name, Company (profile + timezone + digest hour), Notifications |
| Integrations | `/settings?tab=integrations` | QuickBooks connect/refresh/disconnect, inline Sync health list |
| Channels | `/settings?tab=channels` | SMS (toggle, sender readout, test SMS, Twilio webhooks, provider status), Email (enable, from, postal, test email, Resend webhook), Quiet hours (owner) |
| Templates | `/settings?tab=templates` | SMS/email template CRUD + reset |
| Collections | `/settings?tab=collections` | Rules + holidays, Late fees, Priority scoring, Workflow knobs |

### API / webhook (no product UI)

`/api/*` (contact-logs, sms-consent, comm-prefs, org-settings, assign, bulk-assign, bulk-sms, priority-override, sync-errors/dismiss, presence/heartbeat, promises/cancel, text/send, email/send, account-notes, profile, notification-prefs, test-message, qbo/connect|refresh|disconnect) · `/auth/qbo/callback` · `/webhooks/qbo|twilio/inbound|twilio/status|resend`.

`GET /api/qbo/disconnect` returns a standalone HTML “QuickBooks disconnected” page (Intuit Disconnect URL).

`ErrorBoundary` in `app/root.tsx` wraps every route (404 / unexpected) with `PublicLayout`.

---

## Findings

### [TEMP-SET-001]
- **Severity:** major
- **Bars:** P0-public
- **Area:** settings
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/lib/message-templates.ts:31-47`; `nudgepay-app/app/components/TemplateEditor.tsx:123-141`; `nudgepay-app/tests/message-templates.test.ts:33-47`
- **Evidence (live):**
- **User / legal impact:** Owner hits Delete, sees “Templates updated.”, reloads, and the default slug is back. Custom copy they meant to retire (final-notice, etc.) keeps going out. Reset-to-defaults is the only durable way to change a default slug, which is not what Delete says it does.
- **Fix recipe:** Stop appending missing default slugs after a channel has any DB rows. Seed defaults once (migration / first-save / explicit Reset). Treat `delete_template` as durable. If empty-channel fallback is kept, only use it when the org has *never* written templates (sentinel), not when the last row was deleted.
- **Do not:** Keep “merge missing defaults so editing one doesn’t drop the rest” as a load-time behavior. Seed on write instead.

### [TEMP-SET-002]
- **Severity:** major
- **Bars:** P0-public
- **Area:** settings
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/components/PriorityThresholdsForm.tsx:37` (`min={0.01}`); `nudgepay-app/app/lib/org-settings.ts:123-125` (reject `< 1000`); `nudgepay-app/app/components/PriorityThresholdsForm.tsx:77` (“must be greater than 0”); `nudgepay-app/tests/org-settings.test.ts:130-138`
- **Evidence (live):**
- **User / legal impact:** Owner sets high-value to `$500` (browser allows it). Server rejects. Error copy says “greater than 0” — which `$500` is — so the save looks broken. High-value view/metric silently stays at the previous floor.
- **Fix recipe:** Set the input `min={1000}`. Map `high_value_threshold` to “must be at least $1,000”. Also surface `priority_thresholds_range` (gap < 5 / > 200) — currently unhandled in the form (TEMP-SET-016).
- **Do not:** Lower the server floor to match the input without revisiting `priority.ts:balancePoints` (the `$1,000` floor exists so the configurable tier cannot shadow the fixed $1k band).

### [TEMP-SET-003]
- **Severity:** minor
- **Bars:** polish
- **Area:** settings
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/routes/api.org-settings.tsx:43` (`saved=profile`); `nudgepay-app/app/routes/api.profile.tsx:28` (same flag); `nudgepay-app/app/routes/settings.tsx:197`; `nudgepay-app/app/components/CompanyProfileForm.tsx:34,153`; Late fees / Priority / Workflow all key off `saved=1` (`LateFeesForm.tsx:67`, `PriorityThresholdsForm.tsx:76`, `WorkflowSettingsForm.tsx:69`); email was split to `email_saved` (`api.org-settings.tsx:134-136`)
- **Evidence (live):**
- **User / legal impact:** Saving display name lights “Company profile saved.” Saving late fees lights Saved on priority + workflow too. Operators cannot tell which card actually persisted.
- **Fix recipe:** One unique flash token per intent (`saved=display_name|profile|rules|late_fees|priority|workflow|channels|…`) matching the pattern already used for `email_saved`, `quiet_hours`, `template`, `notifications`.
- **Do not:** Add more cards that read `saved=1`.

### [TEMP-SET-004]
- **Severity:** minor
- **Bars:** polish
- **Area:** settings
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/components/SettingsTabs.tsx:33-55` (`Link`s, no dirty check); repo-wide `beforeunload` / unsaved = none
- **Evidence (live):**
- **User / legal impact:** Editing company name / templates / thresholds then clicking another tab discards the form. No confirm. Easy to lose a postal address or template body.
- **Fix recipe:** Track dirty per tab (or a single page-level dirty). `beforeunload` + in-app confirm on tab `Link` click. Reset dirty after a successful redirect.
- **Do not:** Convert tabs to client state that hides unsaved POST bodies without a confirm.

### [TEMP-SET-005]
- **Severity:** minor
- **Bars:** polish
- **Area:** settings
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/components/CollectionsRulesForm.tsx:69-75` (Save rules, no `useSearchParams`); errors `grace` / `working_days` / `cadence` produced at `app/lib/org-settings.ts:28-44`; holidays share `saved=1`
- **Evidence (live):**
- **User / legal impact:** Saving rules looks like a no-op. Invalid grace/cadence redirects with `?error=grace` that this form never reads. Holidays can light Saved on the late-fee/priority/workflow cards instead.
- **Fix recipe:** Read `error` + a distinct `saved=rules`. Disable Save when zero working days are checked (client-side mirror of the server).
- **Do not:** Rely on the sibling cards’ `saved=1` banners as feedback for this form.

### [TEMP-SET-006]
- **Severity:** minor
- **Bars:** polish
- **Area:** settings
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/components/LateFeesForm.tsx:28-36` (Enabled/Disabled `<select>` inside an empty `<label>`); no read of `late_fee_grace` / `late_fee_percent` / `late_fee_flat`
- **Evidence (live):**
- **User / legal impact:** Screen readers get an unlabeled combo. Invalid percent/flat fails with a generic redirect and no message. Display-only disclaimer itself is good (fees never hit QBO).
- **Fix recipe:** Visible “Late fees” label on the select. Map the three error codes. Keep the “never added to QuickBooks” copy.
- **Do not:** Write late fees into QBO invoices.

### [TEMP-SET-007]
- **Severity:** major
- **Bars:** P0-managed
- **Area:** settings
- **Status:** reconfirmed
- **Evidence (code):** writers set `qbo=connected|error|forbidden|disconnected` and `sync=ok|error` (`auth.qbo.callback.tsx:19-36`, `api.qbo.connect.tsx:14`, `api.qbo.disconnect.tsx:19,25`, `api.qbo.refresh.tsx:51,61`). **Zero readers** of `qbo=` / `sync=` in `app/`. Settings Integrations only shows Connected / Not connected from loader state. `useFlashCleanup` does not even list `qbo`/`sync`.
- **Evidence (live):**
- **User / legal impact:** Failed OAuth, forbidden member connect, and failed Refresh all look like the button did nothing. First-run connect is the highest-stakes settings action and it has no outcome UI.
- **Fix recipe:** Render banners on `/settings?tab=integrations` (and dashboard if that’s where the callback still lands). Add `qbo`/`sync` to `FLASH_PARAMS`.
- **Do not:** Keep redirecting the callback to `/dashboard?qbo=connected` with nothing consuming the param.

### [TEMP-SET-008]
- **Severity:** major
- **Bars:** P0-managed
- **Area:** settings
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/routes/settings.tsx:248-252` (Disconnect, no confirm); `nudgepay-app/app/routes/api.qbo.disconnect.tsx:24-25` (revokes tokens); `loadWorkspaceChrome` then bounces unconnected orgs off every workspace route except settings (`workspace.server.ts:36-38`)
- **Evidence (live):**
- **User / legal impact:** One click locks the whole org out of Collections / Accounts / Promises / Messages until a full reconnect. Easy misclick next to Refresh.
- **Fix recipe:** Confirm dialog naming the consequence. Prefer a typed “DISCONNECT” or a two-step. Keep owner-only + RLS.
- **Do not:** Disconnect on GET (the Intuit landing GET is display-only, correctly).

### [TEMP-SET-009]
- **Severity:** major
- **Bars:** P0-managed
- **Area:** settings
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/components/SyncIssues.tsx:27-51` is imported by **zero** routes. `AppShell` accepts `syncIssues` (`AppShell.tsx:17-18,139`). Only `reports.tsx:150` passes `syncIssues={null}`. Settings inlines a list on Integrations (`settings.tsx:269-291`) instead of the header badge. Badge is also `hidden sm:inline-flex` (`SyncIssues.tsx:59`).
- **Evidence (live):**
- **User / legal impact:** Unresolved QBO sync failures are invisible while working the queue. A stuck CDC looks like “nothing to collect.”
- **Fix recipe:** Mount `<SyncIssues>` from dashboard / accounts / messages / settings loaders (they already query `sync_errors` on settings). Show a mobile-visible variant, not `hidden sm:`.
- **Do not:** Duplicate a third inline list. One component, header + settings.

### [TEMP-SET-010]
- **Severity:** major
- **Bars:** P0-public
- **Area:** settings
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/routes/invite.tsx:19-61`; `app/routes.ts:9`; grep of `to="/invite"` / Settings copy = none. Button says “Sending invite…” but the action only inserts a row and returns a relative `/accept/<token>` in a `<code>` block (`invite.tsx:41,51-54,60`).
- **Evidence (live):**
- **User / legal impact:** Owners cannot add teammates from the product. The only team-setup path is a hidden URL. The button lies — nothing is emailed. Collections stays single-user in practice.
- **Fix recipe:** Link “Invite teammates” from Settings → Workspace (owners). Send the email (or copy-to-clipboard of an absolute URL with origin). Change the button label if email isn’t wired yet.
- **Do not:** Leave `/invite` as an unlinked developer page.

### [TEMP-SET-011]
- **Severity:** minor
- **Bars:** polish
- **Area:** settings
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/routes/api.org-settings.tsx:26`; same pattern on `api.test-message.tsx:31`
- **Evidence (live):**
- **User / legal impact:** A member who tampers a form (or an owner who lost the role mid-session) gets bounced to the same tab with no explanation. Looks like a broken Save.
- **Fix recipe:** `redirect(flag(returnTo, "error", "forbidden"))` and a banner. Keep the silent fail only if the control is not visible — but several member views still POST (disabled fields can still submit in some browsers).
- **Do not:** Soften the owner gate.

### [TEMP-SET-012]
- **Severity:** major
- **Bars:** P0-public
- **Area:** settings
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/routes/api.test-message.tsx:39-55`; `nudgepay-app/app/components/SmsSettingsSection.tsx:88-110`. No consent, no quiet-hours, no throttle, no ledger. Destination is any parseable phone.
- **Evidence (live):**
- **User / legal impact:** Owner can fire real SMS from the shared Twilio account to any number. TCPA/A2P risk on a “test” button. No record in `text_messages`.
- **Fix recipe:** Restrict to the owner’s verified number (or a short allowlist). Enforce quiet hours. Rate-limit. Write a ledger row tagged `test`. Keep owner-only.
- **Do not:** Reuse the customer send pipeline in a way that requires a fake invoice/customer — but do not skip consent *and* logging.

### [TEMP-SET-013]
- **Severity:** minor
- **Bars:** polish
- **Area:** settings
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/routes/settings.tsx:93` (`loadTemplates(...).catch(() => resolveTemplates([]))`)
- **Evidence (live):**
- **User / legal impact:** A `message_templates` read error (RLS, missing table, network) renders the factory defaults as if they were the org’s live templates. Owner edits then “save” against a table that just failed.
- **Fix recipe:** Fail the loader (ErrorBoundary) or show an explicit “templates unavailable” empty state. Do not substitute defaults on I/O failure.
- **Do not:** Treat empty-array defaults and query-failure defaults as the same.

### [TEMP-SET-014]
- **Severity:** minor
- **Bars:** polish
- **Area:** settings
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/routes/api.notification-prefs.tsx:19-41` (hardcoded `/settings?saved=notifications`, ignores tab); form has no `returnTo` (`NotificationPrefsForm.tsx:27-28`)
- **Evidence (live):**
- **User / legal impact:** Harmless today because the form only lives on the default Workspace tab. Any future move of the card, or a `?tab=` already in the URL, drops the tab on save.
- **Fix recipe:** Thread `returnTo` like every org-settings form. `safeReturnTo` already exists.
- **Do not:** Special-case `/settings` as the only legal return.

### [TEMP-SET-015]
- **Severity:** major
- **Bars:** P0-public
- **Area:** settings
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/lib/sms-templates.ts:26-46` (four defaults; none say “Reply STOP to opt out”); send path does not append it
- **Evidence (live):**
- **User / legal impact:** A2P 10DLC / TCPA common-carrier rules expect STOP language on business SMS. Defaults go out on first send. Template editor legend does not mention compliance tokens.
- **Fix recipe:** Add STOP language to every default. Append a footer at send time if the body lacks it. Show a Templates-tab warning when a saved body has no STOP.
- **Do not:** Rely on Twilio’s Messaging Service sticky sender to paper over missing copy.

### [TEMP-SET-016]
- **Severity:** minor
- **Bars:** polish
- **Area:** settings
- **Status:** open
- **Evidence (code):** parser returns `priority_thresholds_range` (`org-settings.ts:135-142`); form only handles `high_value_threshold` / `priority_thresholds` / `priority_thresholds_order` (`PriorityThresholdsForm.tsx:77-79`)
- **Evidence (live):**
- **User / legal impact:** Gap < 5 or value > 200 fails with a silent redirect. Same class of bug as TEMP-SET-002.
- **Fix recipe:** Render the missing error code. Optionally disable Save until `critical - high >= 5` and `high - medium >= 5`.
- **Do not:** Relax the gap CHECK to hide the missing banner.

### [TEMP-SET-017]
- **Severity:** minor
- **Bars:** polish
- **Area:** settings
- **Status:** open
- **Evidence (code):** `save_channels` redirects `saved=1` (`api.org-settings.tsx:53`); `SmsSettingsSection` never reads `saved`
- **Evidence (live):**
- **User / legal impact:** Toggling SMS Off is a high-stakes mute of all outbound text. The only feedback is the select reverting to the new default after reload. Easy to miss.
- **Fix recipe:** Distinct `saved=channels` + a status line next to the select (“Outbound SMS is off”).
- **Do not:** Piggyback `saved=1` (that token is already overloaded).

### [TEMP-SET-018]
- **Severity:** minor
- **Bars:** polish
- **Area:** reports
- **Status:** reconfirmed
- **Evidence (code):** Owner gate `loadWorkspaceChrome(..., { requireOwner: true })` (`reports.tsx:26-28`); members redirected `/dashboard?denied=reports` (`workspace.server.ts:22-24`); dashboard banner (`dashboard.tsx:565-568`). Non-owner nav item: `aria-label={`${item.label} (coming soon)`}` (`AppShell.tsx:245`) even though Reports is built.
- **Evidence (live):**
- **User / legal impact:** Members are told the feature is unfinished rather than owner-only. Owners get a real team-performance + workload report (no CSV, no aging buckets — out of this card).
- **Fix recipe:** `aria-label="Reports (owners only)"` + `aria-disabled`. Keep the denied banner. Do not advertise “coming soon” for a shipped owner surface.
- **Do not:** Hide the nav item with no explanation; members already get the denied flash if they guess the URL.

### [TEMP-SET-019]
- **Severity:** minor
- **Bars:** P0-managed
- **Area:** settings
- **Status:** open
- **Evidence (code):** `deriveWebhookUrls` returns Twilio inbound/status + Resend only (`provider-status.ts:14-24`). Integrations tab has no QBO webhook URL. Intuit endpoint is documented as a placeholder in `docs/intuit-production-checklist.md:43`.
- **Evidence (live):**
- **User / legal impact:** Operators configuring Intuit must leave the app. Twilio/Resend copy fields exist and work (`WebhookUrlField.tsx`). Asymmetric.
- **Fix recipe:** Show `APP_PUBLIC_BASE_URL/webhooks/qbo` on Integrations next to the connection card (read-only + copy), even if Intuit itself is operator-pasted.
- **Do not:** Let tenants *register* the Intuit webhook from this field — display only.

### [TEMP-SET-020]
- **Severity:** minor
- **Bars:** polish
- **Area:** settings
- **Status:** open
- **Evidence (code):** `reset_templates` deletes then inserts (`api.org-settings.tsx:167-177`) with no transaction
- **Evidence (live):**
- **User / legal impact:** If insert fails after delete, the channel is empty. Combined with TEMP-SET-001 the UI then *shows* defaults that are not in the DB.
- **Fix recipe:** Upsert defaults in place, or wrap in a single RPC. On insert failure, do not report `saved=template`.
- **Do not:** Delete-then-insert across two round trips on a Worker.

### [TEMP-SET-021]
- **Severity:** major
- **Bars:** P0-managed
- **Area:** settings
- **Status:** reconfirmed
- **Evidence (code):** `sendBrokenPromiseAlerts` returns if org email is off / no from-address (`notifications.server.ts:34-40`). UI warns (`NotificationPrefsForm.tsx:23-25`). Digest hour lives on Company (`CompanyProfileForm.tsx:132-144`). There is no in-app bell.
- **Evidence (live):**
- **User / legal impact:** Turning customer email off (or never configuring From) silently kills team alerts and the daily digest. Prefs stay checked. A collections manager thinks they will be emailed when a promise breaks.
- **Fix recipe:** Separate a “team alerts” channel from customer email, or hard-warn on the Notifications card when the gate is closed. Log a settings-visible “last digest / last alert” timestamp (digest already has `lastDigestDate` server-side).
- **Do not:** Send customer-facing copy from the alert path, or vice versa, without the CAN-SPAM footer.

### [TEMP-SET-022]
- **Severity:** minor
- **Bars:** polish
- **Area:** settings
- **Status:** reconfirmed
- **Evidence (code):** `TemplateEditor.tsx:88-96` (legend only; “Unset tokens render blank” — misspelled `{placeholder}`s are left as literals by `applyTemplate`). No preview, no click-to-insert.
- **Evidence (live):**
- **User / legal impact:** Owners ship `{custmer}` to real phones. Payment-link / company / phone tokens stay unused because they are easy to omit.
- **Fix recipe:** Click-to-insert chips. Live preview with sample vars. Warn on `{...}` that are not in `TEMPLATE_TOKEN_KEYS`.
- **Do not:** Strip unknown tokens at send time without showing the owner first.

---

## Product UX findings

### [TEMP-UX-001]
- **Severity:** major
- **Bars:** P0-managed
- **Area:** ux
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/components/AppShell.tsx:153-163` — avatar `<button type="submit">` POSTs `/logout`. `title="Sign out"`. No menu, no confirm.
- **Evidence (live):**
- **User / legal impact:** The only control that looks like “account” immediately signs the user out. Accidental click mid-call log. No path to profile (display name lives in Settings).
- **Fix recipe:** Avatar opens a menu: Settings, Sign out (confirm). Keep the accessible name honest (`Sign out` only if that remains the sole action).
- **Do not:** Keep a circular initials control whose primary affordance is “that’s me” while its action is logout.

### [TEMP-UX-002]
- **Severity:** major
- **Bars:** P0-public
- **Area:** ux
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/routes/dashboard.tsx:527-532` (`hidden sm:flex` on Focus mode). `/focus` itself is not responsive-gated, only the entry point.
- **Evidence (live):**
- **User / legal impact:** Phone-sized collectors cannot start Focus Mode. Keyboard-driven triage is the fastest path through the queue and it is desktop-only by CSS, not by capability.
- **Fix recipe:** Show the link at all breakpoints (icon + `aria-label` on xs). Or add a Focus item to the mobile nav drawer.
- **Do not:** Ship Focus as the recommended workflow while hiding it below `sm`.

### [TEMP-UX-003]
- **Severity:** major
- **Bars:** P0-public
- **Area:** ux
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/routes/dashboard.tsx:581-609` — selected case mounts a `w-96` (`384px`) `shrink-0 overflow-hidden` pane beside the queue. `DetailPanel.tsx:676-684` has a `lg:hidden` “Back to queue” link, but the parent still reserves 384px.
- **Evidence (live):**
- **User / legal impact:** On a 375px phone the pane is wider than the viewport. Queue + detail clip. Logging a call / sending a text on mobile is the collections job, and the workspace fights the screen.
- **Fix recipe:** Below `lg`, render DetailPanel as a full-width overlay / route (`/dashboard?case=` already exists). Keep `w-96 xl:w-[28rem]` only at `lg+`.
- **Do not:** Shrink type to squeeze the current two-pane into 375px.

### [TEMP-UX-004]
- **Severity:** major
- **Bars:** P0-public
- **Area:** ux
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/routes/home.tsx:15-37`. `app/lib/meta.ts:1-2` — title only, no description / OG. Intuit Launch URL is `/dashboard`, but the public marketing URL is `/`.
- **Evidence (live):**
- **User / legal impact:** Intuit app-card reviewers and net-new signups land on a single sentence. No screenshots, no TCPA/QBO explanation, no support contact (privacy has `support@nudgepay-ar.app`, home does not). Looks unfinished for a public App Store listing.
- **Fix recipe:** Add a short feature list (queue, promises, QBO, SMS), a support email, and a meta description. Screenshots already exist under `nudgepay-app/demo-recording/`.
- **Do not:** Claim “automatic payment reminders” as the only story (`home.tsx:23`) — the product is a human work queue with optional send, not an autopilot dunning bot.

### [TEMP-UX-005]
- **Severity:** major
- **Bars:** P0-public
- **Area:** ux
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/routes/eula.tsx:25-26` (“provided ‘as is’ during private beta”)
- **Evidence (live):**
- **User / legal impact:** Shipping this EULA to Intuit production / public signup while still calling it private beta is a legal mismatch (limitation of liability + positioning). Privacy is dated July 1, 2026 and does not say beta.
- **Fix recipe:** Counsel rewrite before public. For a managed pilot, keep “private beta” but do not point Intuit production App Card at this URL until the language matches the program.
- **Do not:** Find-and-replace “private beta” without reviewing sections 3–4.

### [TEMP-UX-006]
- **Severity:** minor
- **Bars:** polish
- **Area:** ux
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/components/WorkQueue.tsx:604-614` — empty state is always “No accounts match this view” + “Clear the search”, including a brand-new org with zero cases.
- **Evidence (live):**
- **User / legal impact:** After QBO connect (especially with TEMP-SET-007’s silent outcomes) the empty queue blames the user for a filter they did not set.
- **Fix recipe:** Branch on `totalCount === 0 && !q` → “No collection cases yet. Connect QuickBooks or wait for the first sync.”
- **Do not:** Use the filter-empty copy for the zero-data first run.

### [TEMP-UX-007]
- **Severity:** minor
- **Bars:** polish
- **Area:** ux
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/components/ComingDueList.tsx:29` (“next 7 days”); window is `workflow.comingDueDays` (default 7, owner-configurable 1–60)
- **Evidence (live):**
- **User / legal impact:** Owner sets 14 days, empty state still says 7. Trust in the Workflow card drops.
- **Fix recipe:** Pass `comingDueDays` into `ComingDueList` and interpolate.
- **Do not:** Hardcode 7 anywhere the knob exists.

### [TEMP-UX-008]
- **Severity:** minor
- **Bars:** P0-managed
- **Area:** ux
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/lib/workspace.server.ts:36-38` redirects unconnected orgs to `/settings?tab=integrations` with no welcome copy. Integrations card is just QuickBooks + Sync health (`settings.tsx:222-292`).
- **Evidence (live):**
- **User / legal impact:** Brand-new owner finishes onboarding and is dropped onto a bare Connect button. No “what happens next / invoices appear after sync.”
- **Fix recipe:** First-run callout on Integrations: connect QBO → wait for sync → Collections fills. Pair with TEMP-SET-007 outcome banners.
- **Do not:** Auto-redirect to an empty dashboard after connect without a sync.

### [TEMP-UX-009]
- **Severity:** minor
- **Bars:** polish
- **Area:** ux
- **Status:** reconfirmed
- **Evidence (code):** Sync chip `hidden sm:flex` (`AppShell.tsx:125-127`); `SyncIssues` trigger `hidden sm:inline-flex` (`SyncIssues.tsx:59`). Settings gear remains visible.
- **Evidence (live):**
- **User / legal impact:** Mobile users cannot see QBO health without opening Settings. Combined with TEMP-SET-009 the header badge would still be invisible on phones even after it is mounted.
- **Fix recipe:** Icon-only sync dot in the top bar at `<sm`, linking to Integrations.
- **Do not:** Rely on Settings as the only mobile health surface.

### [TEMP-UX-010]
- **Severity:** major
- **Bars:** P0-public
- **Area:** ux
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/routes/invite.tsx:60` (“Sending invite…”); action does not call Resend (`invite.tsx:38-41`)
- **Evidence (live):**
- **User / legal impact:** Same as TEMP-SET-010. Copy promises an email that never leaves the building.
- **Fix recipe:** If email is not ready, button = “Create invite link” and a Copy control for an absolute URL.
- **Do not:** Keep “Sending…” on a DB insert.

---

## What is solid

- **Owner gate + RLS.** `api.org-settings.tsx:26` plus `org_settings_owner_write` / `message_templates` owner policies (`0016_org_scheduling_config.sql:49-50`, `0026_message_templates.sql:25`, `0032_security_hardening.sql`). Members can read, not write.
- **Sender lock.** `save_sms_sender` is a hard error (`api.org-settings.tsx:56-61`). UI explains operator-managed identity (`SmsSettingsSection.tsx:67-86`). Right call for a shared Twilio account.
- **Flash hygiene (partial).** `email_saved`, `saved=quiet_hours`, `saved=template`, `saved=notifications` are distinct. `useFlashCleanup` strips them after paint (`use-flash-cleanup.ts:14-18,29-54`).
- **Tab-preserving returnTo.** `settingsReturnTo` (`SettingsTabs.tsx:25-27`) is threaded through almost every org-settings form.
- **Quiet hours.** Owner form (`QuietHoursForm.tsx`) matches DB CHECKs (start 0–23, end 1–24, start < end). Enforced on send paths (covered by `quiet-hours.test.ts` / `twilio-send.test.ts`), not just the UI.
- **Digest hour + timezone.** Company profile owns `digest_hour_local` and IANA timezone (`CompanyProfileForm.tsx:110-144`, `org-profile.ts:96-100`). Defaults `America/New_York` / 8:00 AM.
- **Notification prefs.** Any member, self-only upsert (`api.notification-prefs.tsx:1-2,25-33`). Unchecked boxes correctly become `false` (`notification-prefs.ts:13-16`).
- **Late-fee honesty.** “Shown in NudgePay for awareness only — never added to QuickBooks invoices” (`LateFeesForm.tsx:23`).
- **Workflow knobs.** Client `min`/`max` match server 1–60 / 1–30 / 1–200 (`WorkflowSettingsForm.tsx:39-55`, `org-settings.ts:172-179`).
- **Email CAN-SPAM field.** Postal address with required-by-CAN-SPAM copy (`EmailSettingsSection.tsx:86-95`). From-address format-checked (`email-settings.ts:23-37`).
- **Test-message surface exists** (owner-only, env-null degrades to a banner rather than 500) — `api.test-message.tsx:3,43-44,69-70`.
- **Webhook copy fields** for Twilio inbound/status + Resend (`WebhookUrlField.tsx`, `SmsSettingsSection.tsx:113-120`, `EmailSettingsSection.tsx:130-137`). Secrets never rendered (`settings.tsx:72-73`).
- **Provider status.** Last send + 7d failures, credentials as booleans only.
- **QBO member vs owner.** Members can Refresh; only owners Connect / Disconnect (`settings.tsx:232-266`).
- **Reports are real.** Owner-only team throughput + workload (`reports.tsx`), real `<table>`s, range toggle with `aria-current`. Denied members get an honest dashboard banner (`dashboard.tsx:565-568`) even if the nav label is wrong (TEMP-SET-018).
- **Parse tests.** `tests/org-settings.test.ts`, `channel-settings.test.ts`, `holiday-action.test.ts`, `save-email.action.test.ts`, `save-workflow.action.test.ts`, `test-message.test.ts`, `settings-tabs.test.ts`.
- **CSRF.** `requireUser` → `requireSameOrigin` on this POST surface (`session.server.ts:26`).
- **AppShell chrome (non-a11y).** Skip link (`AppShell.tsx:78-83`), section titles, settings gear labeled, mobile drawer with backdrop, Reports hidden-as-disabled for members (intent is right; copy is wrong).
- **Display name.** Members can set the name that `listOrgMembers` uses — single label source, as AGENTS.md requires.

---

## Intentional non-findings

- Member-cannot-edit-org-settings is **by design**, not a bug.
- `save_sms_sender` rejection is **by design**.
- Reports owner-only is **by design**; only the “coming soon” copy is wrong.
- Late fees display-only is **by design**.
- Quiet hours in the *org* timezone (not the recipient’s) is a known limitation; not a settings save bug.
- Missing Docker in some environments is **not** a product bug (per wave brief).
