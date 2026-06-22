# NudgePay — Production Rebuild Design

**Date:** 2026-06-22
**Status:** Approved design (pre-implementation)
**Owner:** Diskin Morgan / Chancey Heating & Cooling
**Author:** Brainstorming session (Claude Code)

---

## 1. Context & Goal

NudgePay is an accounts-receivable (AR) collections workspace for QuickBooks
Online users. It is in private beta at **Chancey Heating & Cooling** (Douglas,
GA), an HVAC contractor carrying 125–175 past-due invoices at a time, worked by
a 5-person AR team. The current prototype is a React + Vite SPA (one 1088-line
`App.jsx`) plus a small Express/Railway backend, with a Supabase Postgres DB.
Data today is **dummy seed data**; no live customer data is connected yet.

**Goal:** rebuild the prototype into a secure, typed, multi-tenant production web
app, wire QuickBooks + Twilio + auth cleanly, satisfy Intuit's production app
requirements, and only then connect real Chancey data.

### Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Sequencing | Rebuild right → then go live. Secure before any live data connects. |
| Stack | TypeScript, React Router v7 (framework mode) on Cloudflare Workers |
| Infra | Cloudflare (Pages/Workers) + Supabase (Postgres + Auth). 3 providers → 2. |
| Horizon | Multi-tenant foundation now (org layer + RLS keyed by org). |
| Twilio | Shared Messaging Service + number now; A2P 10DLC registered under Chancey first. Schema ready for per-tenant senders later. |
| App architecture | React Router v7 full-stack: public + auth + app + server resource routes in one codebase. |

### Why these choices

- **TypeScript**: the app is mostly external data contracts (QBO payloads,
  Supabase rows, Twilio webhooks, auth sessions). Types catch field/nullability
  bugs early. Plain JS is the wrong production target.
- **Cloudflare + Supabase (drop Railway)**: Express routes move into the RR7
  Worker; Supabase keeps Postgres + Auth. Supabase free tier pauses after 1 week
  inactivity (unusable for production) → Pro (~$25/mo); Cloudflare Workers ~$5/mo.
- **Multi-tenant now**: the handoff brief anticipates offering NudgePay to other
  QuickBooks businesses. Building the org/tenant layer up front avoids a later
  re-platform of data + auth. (A single-tenant Cloudflare-only D1+Access stack
  would have been cheaper but a dead-end for SaaS.)
- **React Router v7 full-stack**: marketing/signup/legal pages and the authed app
  live in one typed codebase with server loaders/actions + resource routes — no
  separate API service to maintain.

---

## 2. Critical Finding in Current Prototype (must be closed before live data)

`App.jsx` (lines 5–7) hardcodes the Supabase URL + anon key and the browser
talks **directly** to Supabase. Combined with **RLS disabled on all tables**, any
visitor to the deployed bundle has an anon key able to read/write `customers`,
`invoices`, `contact_logs`, and `text_messages` with no auth boundary. The anon
key is also committed to git.

Today this only exposes dummy seed data, so it is not a live incident — but it is
the exact gap Intuit's security review blocks on, and it must be closed by design
before any real Chancey data connects. The rebuild's security model (Section 5)
closes it: browser only talks to the app's own server routes; service-role access
is server-only; RLS on from day one.

---

## 3. Architecture & Topology

- **React Router v7 (framework mode), TypeScript, Vite**, deployed to
  **Cloudflare Workers** via `@react-router/cloudflare`. One app serves:
  - Public: landing, **`/privacy`**, **`/eula`**
  - Auth: signup, login, invite-accept
  - App: the authed AR dashboard (ported from the prototype UI)
  - Server **resource routes**: QBO OAuth callback, QBO webhook, Twilio
    send/inbound/status
- **Supabase** accessed from the Worker two ways:
  - **User-scoped client** (forwards the logged-in user's JWT) → all normal
    reads/writes, governed by RLS.
  - **Service-role client** (server-only Cloudflare secret, never shipped to the
    browser) → privileged jobs only: QBO token storage, sync upserts, webhook
    ingestion.
- **Boundary rule:** the browser never holds the service-role key and never calls
  QBO/Twilio/Supabase-admin directly. It only calls the app's own server routes.

---

## 4. Multi-Tenant Data Model

Biggest change from today's single-row schema.

- **`organizations`** — one row per tenant.
- **`memberships`** — (`user_id`, `org_id`, `role`) linking Supabase Auth users
  to orgs. Roles: `owner`, `member` (extensible).
- **Every domain table gets `org_id` (FK):** `customers`, `invoices`,
  `contact_logs`, `text_messages`.
- **`qbo_connections`** replaces the single-row `qbo_sync_state`. One row **per
  org**: `org_id`, `realm_id`, encrypted `access_token` / `refresh_token`,
  `token_expires_at`, `last_cdc_time`, `last_sync_at`, connection status.
- **`messaging_config`** — per org: Twilio Messaging Service SID + sender. Null =
  fall back to the shared platform sender. Enables per-tenant senders later.

Domain rules preserved from the handoff:
- Invoices displayed by `qbo_doc_number` (not UUID PK).
- **Due date** (not invoice date) is the anchor for aging + late-fee math.

---

## 5. Auth & Security Model

- **Supabase Auth**: email/password + magic-link. Flow: sign up → create org
  (becomes `owner`) → invite teammates by email → invitees join that org.
  Chancey's 5 (Brandy, Diskin, John, Kristi, Macy) seeded as one org.
- **RLS on every table from day one.** Policy: a row is visible/writable only if
  the user is a member of the row's `org_id`. Cross-org access denied.
- **Per-user attribution**: contact logs auto-stamp the authenticated user
  (replaces the prototype's manual name dropdown).
- **Token encryption at rest**: QBO refresh tokens + realm IDs encrypted with
  **AES-GCM** (Web Crypto in the Worker; key as a Cloudflare secret) before they
  touch Postgres.
- HTTPS enforced (default on Workers); `cache-control` on authed routes;
  parameterized Supabase queries; structured logging that **redacts** tokens/PII;
  no QBO customer data written to logs.

---

## 6. QuickBooks Online Integration

### OAuth hardening (fixes prototype gaps)
- Replace hardcoded `state: "nudgepay_auth"` with a per-request **random CSRF
  nonce**, stored server-side (short TTL), verified on callback. State also
  carries the connecting `org_id`.
- `/auth/qbo/callback` **redirects** into the app instead of returning HTML
  (Intuit warns sensitive params leak via referrer). Tokens exchanged,
  **encrypted**, written to that org's `qbo_connections` row.
- **Disconnect/revoke**: real endpoint calling Intuit's `QBO_REVOKE_URL`
  (currently defined but unused) and clearing stored tokens — becomes the
  Intuit-required disconnect URL.
- Token refresh always persists the latest (rotated) refresh token,
  transactionally, per org. Failed refresh marks connection "needs reconnect"
  rather than crashing sync.

### Sync strategy — webhooks + bounded CDC (not blind polling)
- **Primary: QBO webhooks** → `/webhooks/qbo` (signature-verified). Upsert only
  changed entities per org. Near-real-time.
- **Catch-up: CDC** on a Cloudflare **Cron Trigger** (~15–30 min) using
  `last_cdc_time`, respecting CDC's **30-day lookback / 1,000-object** limits.
- **Manual "Refresh from QuickBooks"** hits the real per-org sync (replaces the
  `setTimeout` simulation at `App.jsx:329`).
- **Initial connect** does one full overdue-invoice backfill
  (`SELECT * FROM Invoice WHERE Balance > '0' AND DueDate < today`, scoped per
  org).
- Upserts idempotent (keyed on `qbo_id`) so webhook/CDC overlap is safe.

---

## 7. Twilio SMS Integration

- **Shared sender now**: one Messaging Service + number at platform level; **A2P
  10DLC registered under Chancey's brand** to go live. Per-tenant senders later
  via `messaging_config`.
- Resource routes:
  - `POST /api/text/send` — authed; sends via org's `messaging_config` (or shared
    service); writes a `text_messages` row.
  - `POST /webhooks/twilio/inbound` — signature-verified; inbound replies matched
    to invoice/customer thread, stored, shown in the iMessage-style UI (replaces
    the simulated 3-second reply at `App.jsx:433`).
  - `POST /webhooks/twilio/status` — delivery/error callbacks update the row.
- **Consent / opt-out**: capture `sms_consent` per customer; honor STOP/HELP via
  Messaging Service Advanced Opt-Out. Required for compliant A2P texting.
- **`text_messages` new columns**: `twilio_message_sid`, `direction`, `status`,
  `error_code`, `from_number`, `to_number`, `sent_by_user_id`, `org_id`.
- All QBO/Twilio calls use `fetch`/REST (or Twilio SDK under `nodejs_compat`) for
  the Workers runtime.

---

## 8. Intuit Production Checklist → Deliverables

| Intuit requirement | Satisfied by |
|---|---|
| Privacy Policy + EULA URLs | Real `/privacy`, `/eula` routes (fixes current 404s) |
| App details (host, launch, connect/reconnect, disconnect URLs) | Real routes; disconnect calls revoke flow |
| Production-ready OAuth (connect/disconnect/reconnect) | CSRF nonce, redirect callback, token rotation, revoke (§6); sandbox-tested |
| Encrypted token storage | AES-GCM at rest (§5) |
| No HTML/param leakage on callback | Callback redirects; no sensitive params rendered |
| Security (HTTPS, no sensitive caching, CSRF/XSS/SQLi, no token/PII exposure, no logging QBO data) | §5 |
| Auth + RLS before production | Supabase Auth + RLS day one (§5) |
| Compliance questionnaire | Completed in Intuit portal once above are demonstrable in sandbox |

---

## 9. Error Handling

- Typed result contracts at every external boundary; no silent `any`.
- QBO/Twilio: retry with backoff on transient (429/5xx); actionable UI errors;
  never leak raw provider errors to the browser.
- Webhooks: verify signature → fast 200 → process; idempotent upserts (keyed on
  `qbo_id` / `twilio_message_sid`) so redelivery is safe.
- Token-expiry path refreshes transactionally; failed refresh → "needs reconnect"
  state, not a crash.

---

## 10. Testing

No test framework exists today — this is net-new.

- **Vitest** for unit/integration. Cover:
  - RLS policies (cross-org access denied)
  - OAuth state/nonce verification
  - Token encrypt/decrypt round-trip
  - Sync upsert idempotency
  - Webhook signature verification (QBO + Twilio)
  - Aging / late-fee date math (due-date anchored)
  - SMS consent + STOP/HELP handling
- `tsc` typecheck + build in CI on push.

---

## 11. Phasing

Each phase is independently shippable and gets its own implementation plan.
External lead-time items (Intuit review, A2P 10DLC) start as early as their
prerequisites allow, in parallel.

1. **Foundation** — RR7 + TS skeleton on Workers, Supabase Auth, multi-tenant
   schema + RLS, Chancey org seed. *(No live data.)*
2. **QBO** — OAuth hardening, encrypted tokens, webhook + CDC sync, real
   "Refresh." Validated in **sandbox**.
3. **Twilio** — send/inbound/status routes, consent/opt-out. A2P 10DLC
   registration kicked off at the **start** of this phase (lead time).
4. **Intuit submission** — legal pages, app details, questionnaire; switch to
   production credentials, connect real Chancey QBO.
5. **Cutover & cleanup** — migrate/retire Netlify + Railway, decommission old
   deploys, finish porting prototype UI into typed components, final security
   review.

---

## 12. Out of Scope (for now)

- Per-tenant Twilio senders (schema-ready, not built).
- Email/voice channels beyond logging (contact log supports them; no provider
  integration).
- Self-serve public billing/subscription for additional tenants.
- Mobile app.
