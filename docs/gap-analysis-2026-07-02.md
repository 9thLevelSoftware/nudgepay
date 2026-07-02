# NudgePay Gap Analysis — 2 July 2026

Comparison of two stakeholder documents against the current `nudgepay-app` codebase (React Router 7 / Cloudflare Workers / Supabase). The legacy `nudgepay-backend` (Express/Railway) and `nudgepay-frontend` (React 18 SPA) are superseded and mentioned only where they create drift or security findings.

## Executive Summary

| Category | Count |
|---|---|
| ✅ Met | 10 |
| ⚠️ Partial / misconstrued | 5 |
| ❌ Gap | 2 |
| 🔍 Needs manual confirmation | 3 |
| 📦 Beyond scope (not in docs) | 14 features |
| 📝 Drift (doc statements now false) | 9 items |

**Top findings:**
1. **Late-fee calculations are entirely absent** (C2) — the handoff brief states due date anchors "all aging and late-fee calculations"; aging is implemented correctly, but late fees have zero code anywhere in the repo.
2. **"Coming Due" invoice filter tab is missing** — stated as "functional" in the handoff brief, present in legacy `nudgepay-frontend`, absent from `nudgepay-app` dashboard views.
3. **Netlify is dead** — `nudgepay-ar.netlify.app/privacy` returns 404; privacy policy and EULA exist only as Worker routes. If Intuit's portal still points at Netlify URLs, the compliance pages are unreachable.
4. **User identity is email-derived, not name-based** — the brief says "name auto-fills in contact logs" for 5 named users; the implementation uses email local-part (e.g., `brandy` from `brandy@chanceyair.com`) with no display-name field.
5. **Broken-promise "alerts" are in-app only** — the Product Overview promises you "get alerted when [promises are] broken"; no push/email/SMS notification exists. Surfacing is via dashboard counts and priority scoring only.

---

## Verdict Table

### A. Product Overview — Feature Claims

| ID | Requirement | Verdict | Evidence |
|---|---|---|---|
| A1 | Live QuickBooks sync, no double entry | ✅ Met | CDC via `qbo-sync.server.ts` (`runCdcCatchup`), 30-min cron in `wrangler.toml [triggers]`, Intuit webhook in `webhooks.qbo.tsx`, `qbo-cron.server.ts` per-org catch-up. Invoices/customers/payments/credit-memos all synced. |
| A2 | Team dashboard, shared real-time data | ✅ Met | `/dashboard` route loads all cases for the org. `case_presence` table + heartbeat API (`api.presence.heartbeat`) shows who's viewing which account. Real-time = poll-on-load (no WebSocket), with 30-min CDC cron feeding Supabase. |
| A3 | Contact log: call/text/email + outcome + notes | ✅ Met | `contact_logs` table (migration `0001`), `LogContactDrawer.tsx`, `api.contact-logs.tsx`. Methods: phone, text, email, in-person, voicemail. 10+ outcomes. Notes field. `user_id` references `auth.users`. |
| A4 | Promise tracking + broken-promise **alerts** | ⚠️ Partial | Promise state machine fully implemented (`promise-evaluation.server.ts`, `promise-create.server.ts`, `promise-ledger.ts`, migration `0010`). Broken promises auto-detected during QBO sync. **However**, "alert" = in-app badge/count/priority boost only. No email, SMS, push, or browser notification for broken promises. The Product Overview says "get alerted" — users must notice it on the dashboard. |
| A5 | Built-in SMS, per-invoice conversation history | ✅ Met | Real Twilio integration (`twilio-client.server.ts`, `twilio-messaging.server.ts`). HMAC-SHA1 webhook verification (`twilio-webhook.server.ts`). Per-invoice threads via `text_messages.invoice_id` + `MessageThreadPanel.tsx`. Bulk SMS (`api.bulk-sms.tsx`). A2P/TCPA consent gating. |
| A6 | Follow-up reminders surface automatically | ⚠️ Partial | Suggested follow-up dates are priority-driven (`follow-up-cadence.ts`: Critical=2d, High=3d, Med=7d, Low=14d, business-day aware). Follow-ups due appear in "Follow-ups due" saved view and boost priority. **However**, "surface automatically" = appears in the work queue when user opens the app. No proactive notification (email/push/SMS to the team member). If no one logs in, nothing surfaces. |
| A7 | Priority view — sorted/flagged by urgency | ✅ Met | Multi-factor scorer `priority.ts`: age (up to 45pts), balance (up to 25pts), broken promise (25pts), silence (up to 15pts), follow-up due (12pts). Levels: Critical/High/Medium/Low. Default sort = "Recommended" (by priority). Manual override via `api.priority-override.tsx` + migration `0012`. |
| A8 | "Five minutes to set up" | ✅ Met (code) | Onboarding flow: `/signup` → `/onboarding` (create org name) → `/settings` (connect QBO OAuth) → auto-sync. Team onboarding via `/invite` email → `/accept/:token`. Minimal friction by design. **Actual elapsed time depends on Intuit OAuth approval speed — cannot verify from code.** |

### B. Handoff Brief — "What Needs to Be Finished"

| ID | Requirement | Verdict | Evidence |
|---|---|---|---|
| B1 | Intuit checklist: privacy + EULA at correct URLs, production creds | ⚠️ Partial | Privacy policy at `/privacy` (`privacy.tsx`) and EULA at `/eula` (`eula.tsx`) are implemented as Worker routes with correct content (operator "9th Level Software", effective July 1 2026, QBO data scope, AES-256 encryption disclosure, TCPA/A2P). **Problem:** the handoff brief references `nudgepay-ar.netlify.app` as the host. WebFetch confirms `nudgepay-ar.netlify.app/privacy` returns **404**. If Intuit's portal links to Netlify URLs, the compliance pages are unreachable. The Worker's production domain must be submitted to Intuit instead. **Intuit portal state: 🔍 needs manual confirmation.** |
| B2 | Live QBO sync off sandbox, CDC, tested on real data | 🔍 Manual | Code-complete: `wrangler.toml [env.production.vars]` sets `QBO_SANDBOX = "false"`, `qbo-api.server.ts` gates the Intuit API base URL on this var (sandbox → `sandbox-quickbooks.api.intuit.com`, production → `quickbooks.api.intuit.com`). CDC endpoint used (`qboCdc`), 7-day first-run window, 30-day lookback cap. **Whether production secrets are actually set in Cloudflare and the sync has been tested against real Chancey data: 🔍 needs manual confirmation.** |
| B3 | Supabase Auth for 5 named users, name auto-fill, RLS | ⚠️ Misconstrued | **Auth:** implemented via Supabase Auth (`@supabase/ssr`, cookie-based sessions, `session.server.ts`). Login/signup/logout routes exist. Multi-tenant with org memberships. **5 named users:** the brief names Brandy, Diskin, John, Kristi, Macy. The implementation is generic multi-tenant (any email can sign up + be invited), which is a **better** design — but the 5 specific users are a deployment/onboarding concern, not a code concern. **Name auto-fill:** the brief says user names auto-fill in contact logs. Contact logs store `user_id` (UUID FK to `auth.users`). Display labels are derived from **email local-part** (`email.split("@")[0]`) in `orgs.server.ts:68`. There is no `display_name`, `full_name`, or name field anywhere. If a user signs up as `brandy@chanceyair.com`, they appear as "brandy" — not "Brandy Morgan". This is a mild misconstrual: functional but less polished than the brief's "name auto-fills" implies. **RLS:** fully enabled on all 20 tables (confirmed via Docker `pg_tables.rowsecurity = true`), with membership-keyed policies. This **exceeds** the brief's starting point of "RLS disabled." |
| B4 | Twilio wired: real send + inbound webhook | ✅ Met | `twilio-client.server.ts` — REST POST to Twilio Messages API with Basic auth. `twilio-webhook.server.ts` — HMAC-SHA1 X-Twilio-Signature validation with timing-safe compare. Routes: `api.text.send.tsx` (outbound), `webhooks.twilio.inbound.tsx` (inbound), `webhooks.twilio.status.tsx` (delivery status). Per-org sender resolution via `messaging_config` table. **Twilio account/A2P registration status: 🔍 needs manual confirmation.** |

### C. Handoff Brief — Invariants / "Key Things to Know"

| ID | Invariant | Verdict | Evidence |
|---|---|---|---|
| C1 | Display `qbo_doc_number`, not UUIDs | ⚠️ Partial | `invoices` table has `qbo_doc_number text` column (migration `0001:54`). Used throughout: `cases.ts:141` maps to `docNumber`, `DetailPanel.tsx:915`, `AccountProfile.tsx:179`, `bulk-send.server.ts:36`. **However**, multiple fallbacks exist: `DetailPanel.tsx:915` renders `{inv.docNumber ?? inv.invoiceId}` and `AccountProfile.tsx:179` renders `{inv.docNumber ?? "—"}`. Since `invoiceId` is a UUID (`invoices.id uuid primary key`), the first pattern **will show a raw UUID** to users when `qbo_doc_number` is null (e.g., for manually-created or pre-sync invoices). The dash fallback in AccountProfile is correct; DetailPanel's is not. |
| C2 | Due date anchors ALL aging **and late-fee** calculations | ❌ Gap | **Aging:** correctly anchored on `due_date` — `cases.ts:138` (`ageInDays(inv.due_date, today)`), `priority.ts` age scoring, heat bands in `worklist.ts` at 30/60/90 days. **Late fees: entirely absent.** Grep for `late.?fee`, `lateFee`, `late_fee` across the entire repo returns zero matches. No calculation, no display, no schema column. If the stakeholder expects the app to calculate or display late fees, this is a gap. If the feature was intentionally dropped, the handoff brief's statement is misleading and should be corrected. |
| C3 | "Single large JSX file" → component splitting | ✅ Met (superseded) | `nudgepay-app` is fully componentized: `app/components/` (13 `.tsx` files), `app/lib/` (~60 modules), `app/routes/` (39 route files). The monolith never existed in `nudgepay-app` — it was a characteristic of `nudgepay-frontend/src/App.jsx`. The legacy `nudgepay-frontend` has an **uncommitted** component-split rewrite in its working tree (never committed to git). |
| C4 | 6 tables (users, customers, invoices, contact_logs, text_messages, qbo_sync_state), RLS disabled | 📝 Drift | **20 tables** in the live local Supabase (confirmed via Docker). No `users` table (Supabase `auth.users` + `memberships`). No `qbo_sync_state` table (role played by `qbo_connections`). 14 additional tables for cases, promises, payments, invites, presence, sync errors, org config, email, etc. RLS is **enabled** everywhere, not disabled. |
| C5 | Two repos (frontend/backend), Netlify + Railway deploy | 📝 Drift | Monorepo with 3 subdirectories. Deployment is **Cloudflare Workers** via `wrangler.toml`. No `netlify.toml` or Railway config anywhere in the repo. Legacy `nudgepay-frontend` and `nudgepay-backend` dirs still exist but are superseded. `AGENTS.md` describes only the legacy projects and does not mention `nudgepay-app` at all. |

### D. Success Definition

> "The app is 'done' when the AR team at Chancey can log in, see their live overdue invoices synced from QuickBooks, log contact attempts, set follow-up reminders, and send real SMS messages to customers — all from the same screen, with each team member's activity tracked separately."

| Criterion | Status | Evidence |
|---|---|---|
| Log in | ✅ | Supabase Auth, `/login`, cookie sessions |
| Live overdue invoices from QBO | ✅ (code) / 🔍 (deployed) | CDC sync + cron implemented; production deployment needs manual confirmation |
| Log contact attempts | ✅ | `LogContactDrawer.tsx`, `api.contact-logs.tsx` |
| Set follow-up reminders | ✅ | Follow-up date on contact log, cadence suggestion, saved view |
| Send real SMS | ✅ (code) / 🔍 (deployed) | Twilio integration complete; production Twilio config needs manual confirmation |
| Same screen | ✅ | `/dashboard` contains work queue, detail panel (overview + activity + messages tabs) — all in one view |
| Per-member activity tracked | ✅ | `contact_logs.user_id`, `text_messages.sent_by_user_id`, `promises.created_by` all reference `auth.users(id)`. Roster labels derived from email. Reports page (`/reports`) shows per-member activity. |

---

## Misconstrued Requirements — Narratives

### Late Fees (C2)
The handoff brief says: "Due date (not invoice date) is the anchor for all aging **and late fee calculations**, matching QBO's behavior." The aging half is correctly implemented. The late-fee half has zero implementation: no schema column, no calculation logic, no UI display. This may have been an aspirational statement or a misunderstanding of scope. If Chancey expects the app to compute late fees (e.g., percentage per period past due), it needs a feature spec and implementation. If late fees are handled inside QBO itself and the brief was describing QBO's behavior (not NudgePay's), the statement should be clarified.

### Netlify URLs vs Worker URLs (B1)
The handoff brief says the privacy policy and EULA are "hosted as HTML pages on Netlify for Intuit compliance." The app has migrated to Cloudflare Workers. `nudgepay-ar.netlify.app/privacy` returns 404. The policies exist at the Worker's `/privacy` and `/eula` routes. If the Intuit Developer portal's compliance section still references the Netlify URLs, the app review will fail. The correct URLs need to be submitted to Intuit matching the Worker's production domain.

### Named Users vs Multi-Tenant Auth (B3)
The brief describes auth as "5 members: Brandy, Diskin, John, Kristi, and Macy" with "name auto-fills in contact logs." The implementation is a **better** multi-tenant design: any email can sign up, org membership via invites, generic identity. However, the "name" display is email-local-part only (e.g., `diskin` not `Diskin Morgan`). There is no user profile / display-name field. To match the brief's intent, either:
- Add a `display_name` column to a `profiles` table or use Supabase Auth `user_metadata`, or
- Accept the email-local-part convention and update the brief.

### Alert Semantics (A4 / A6)
The Product Overview says "get alerted when [promises are] broken" and "follow-up reminders surface automatically." Both are implemented as **in-app-only** dashboard signals: priority boost, saved-view counts, metric tiles. There are no proactive notifications — no email, no push, no SMS to the team member. If a user doesn't open the app, they won't know. The Resend email infrastructure exists and is wired for **customer-facing** email (invoice collection emails), but is not used for **internal team** notifications. Adding team alerts would be a feature extension using the existing email pipeline.

### "Coming Due" Filter Tab
The handoff brief states "Coming Due filter tab (7-day window) [...] all functional." This tab existed in the legacy `nudgepay-frontend` (committed code has `COMING_DUE_DAYS = 7`). In `nudgepay-app`, the dashboard saved views are: All open, 30+ days, High value, Never contacted, Follow-ups due, Broken promises, Waiting, On hold, My work. **No "Coming Due" (invoices approaching their due date) view exists.** There is a "Due soon" tab on the `/promises` page, but that's for promises approaching their payment date — a different concept. Invoices not yet past due are excluded from the case-building logic entirely (`cases.ts` works only with overdue invoices whose `balance > 0`).

---

## Drift Catalog

Doc statements that are now factually incorrect and should be updated for stakeholder communication:

| # | Doc | Statement | Current reality |
|---|---|---|---|
| 1 | Handoff Brief | "Frontend: React, Vite — nudgepay-ar.netlify.app" | React Router 7 SSR on Cloudflare Workers (`nudgepay-app`). Netlify site is a dead stub (title only, 404 on subpages). |
| 2 | Handoff Brief | "Backend: Node.js / Express on Railway" | Backend logic is in `nudgepay-app` Worker (`workers/app.ts`, `app/lib/*.server.ts`, `app/routes/api.*`). Legacy Express `server.js` exists but is superseded. |
| 3 | Handoff Brief | "Database: 6 tables [...] RLS currently disabled" | 20 tables, 22 migrations, RLS enabled on all tables with org-membership-keyed policies. |
| 4 | Handoff Brief | "OAuth flow stubbed in backend" | Full OAuth 2.0 flow in `nudgepay-app`: state management (`oauth-state.server.ts`), token encryption (AES-256-GCM, `crypto.server.ts`), automatic refresh, multi-tenant (per-org connections). |
| 5 | Handoff Brief | "Currently using sandbox credentials" | `wrangler.toml [env.production.vars]` sets `QBO_SANDBOX = "false"`. Code supports both; deployed state is a configuration concern. |
| 6 | Handoff Brief | "[SMS] currently runs in demo mode with simulated replies" | Real Twilio integration with signed webhooks, A2P consent gating, delivery-status tracking. No demo/simulated mode in `nudgepay-app`. |
| 7 | Handoff Brief | "Currently there is no login" | Supabase Auth with email/password, signup, invite-accept, cookie sessions, RLS-enforced org isolation. |
| 8 | Handoff Brief | "The frontend is a single large JSX file" | `nudgepay-app` has 13 component files, ~60 lib modules, 39 route files. Never was a monolith. |
| 9 | Handoff Brief | "Version Control: GitHub (two repos — frontend and backend)" | Single monorepo with three subdirectories. `nudgepay-app` is the active project. |

---

## Beyond-Scope Additions

Features implemented in `nudgepay-app` that appear in **neither** stakeholder document:

| # | Feature | Key files |
|---|---|---|
| 1 | **Email channel** (Resend) — send collection emails to customers with unsubscribe links | `email-client.server.ts`, `email-messaging.server.ts`, `api.email.send.tsx`, `webhooks.resend.tsx`, `email_messages` + `email_config` tables |
| 2 | **Collection cases** — customer-centric grouping of invoices into cases with status lifecycle (working → waiting → on_hold) | `collection_cases` table (migration `0009`), `cases.ts`, `case-sync.server.ts` |
| 3 | **Exception taxonomy** — 9-value reason set (disputed, incorrect amount, work incomplete, documentation requested, wrong contact, payment plan, legal/agency, do not contact, other) with terminal vs review-required policies | `exceptions.ts`, migration `0011` + `0015` |
| 4 | **Bulk operations** — bulk assign owner, bulk SMS send | `api.bulk-assign.tsx`, `api.bulk-sms.tsx`, `bulk.ts`, `bulk-send.server.ts`, `BulkActionBar.tsx` |
| 5 | **Reports** — team activity report with per-member contact log/promise/case metrics over selectable date ranges | `/reports` route, `team-report.ts` |
| 6 | **Org scheduling config** — per-org working days, holidays, follow-up cadence overrides | `org_settings` + `org_holidays` tables (migration `0016`), `org-config.ts`, `business-days.ts` |
| 7 | **Communication preferences** — per-customer do-not-contact, SMS opt-out, email opt-out with TCPA/CAN-SPAM compliance | Migration `0017`, `comm-prefs.server.ts`, `api.comm-prefs.tsx`, unsubscribe flow |
| 8 | **Case presence** — real-time "who's looking at this account" indicator via heartbeat polling | `case_presence` table (migration `0014`), `api.presence.heartbeat.tsx` |
| 9 | **Message templates** — predefined SMS/email templates (friendly reminder, firm follow-up, promise reminder, broken promise, final notice) | `labels.ts` template definitions, template selector in `MessageThreadPanel.tsx` |
| 10 | **Customer owner assignment** — assign team members as account owners, "My work" filtered view | Migration `0008`, `api.assign.tsx`, `api.bulk-assign.tsx` |
| 11 | **Priority override** — manual override of computed priority level by authorized users | Migration `0012`, `api.priority-override.tsx` |
| 12 | **Sync-error visibility** — surface QBO sync failures to the user with dismiss capability | `sync_errors` table (migration `0013`), `api.sync-errors.dismiss.tsx` |
| 13 | **Account notes** — free-form per-customer notes | Migration `0019`, `api.account-notes.tsx` |
| 14 | **Invite system** — email-based team invitations with token-based acceptance | `invites` table (migration `0003`), `accept.$token.tsx` |

---

## Repo Hygiene Findings

These are not requirement gaps but are worth addressing:

| # | Issue | Impact |
|---|---|---|
| 1 | **`AGENTS.md` is stale** — describes only legacy `nudgepay-frontend` + `nudgepay-backend`, does not mention `nudgepay-app` | AI coding tools given wrong context for the project; any agent reading AGENTS.md will target the wrong codebase |
| 2 | **`README.md` says "12 migrations"** — there are 22 | Minor doc accuracy |
| 3 | **`README.md` links to deleted doc** — `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` no longer exists | Dead link |
| 4 | **`docs/` directory is empty** — 60+ files staged-deleted in git | If intentional, commit the deletion; if accidental, restore |
| 5 | **Legacy `nudgepay-frontend` has hardcoded Supabase URL + anon key** in `src/App.jsx:18-20` (`dnjdmshjnfhzvrjcluvt`) | Security concern if the Netlify auto-deploy is still active — credentials in client source of a dead app |
| 6 | **Legacy `nudgepay-backend` has no auth** — all endpoints are public, uses service-role Supabase key, open CORS | Security concern if Railway instance is still running — unauthenticated access to service-role operations |
| 7 | **`nudgepay-frontend` uncommitted rewrite** — working-tree component split never committed | Loss risk; either commit or discard |
| 8 | **`wrangler.toml` production SUPABASE_URL is placeholder** — `https://<your-prod-project-ref>.supabase.co` | Needs real value before production deploy (or is set via secret) |
| 9 | **Resend secrets (`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `UNSUBSCRIBE_SECRET`, `APP_PUBLIC_BASE_URL`) not listed in `wrangler.toml` comments** | Ops gap — someone deploying from wrangler.toml's secret list will miss the email channel secrets |

---

## Items Requiring Manual Confirmation

These cannot be verified from code or local Docker alone:

| # | Item | What to check |
|---|---|---|
| 1 | **Intuit Developer portal** | Are production credentials activated? Does the app review checklist reference the correct (Worker) URLs for privacy policy and EULA? |
| 2 | **Cloudflare Worker production secrets** | Are all secrets listed in `wrangler.toml` comments actually set in the production environment? Is `QBO_SANDBOX` = `false`? Are Resend secrets set? |
| 3 | **Twilio A2P registration** | Is the Twilio number/Messaging Service registered for A2P 10DLC? Is the `TWILIO_PUBLIC_BASE_URL` pointing at the correct Worker domain for webhook signature validation? |

---

## Verification Methodology

- **Test suite:** `nudgepay-app` — 90 test files, 523 tests, all passing (vitest 4.1.9, 32.6s).
- **Schema confirmation:** Docker exec into `supabase_db_nudgepay-app` — 20 public tables, all with `rowsecurity = true`, 22 applied migrations matching the `supabase/migrations/` directory.
- **Live URL check:** `nudgepay-ar.netlify.app` returns page with title "NudgePay — Chancey AR" but no content; `/privacy` returns 404.
- **Code grep coverage:** every verdict backed by file path and line-level evidence from `nudgepay-app/app/`.
- **Stakeholder doc text:** extracted from `.docx` XML; full text reviewed, no sections omitted.
