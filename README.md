# NudgePay

AR collections for QuickBooks Online users.

NudgePay turns a QBO company's overdue-invoice list into a prioritized,
assignable collections work queue: pull customers, invoices, and payments
from QBO; work the queue ranked by a multi-factor priority score; log
structured contact outcomes and promise-to-pay commitments; and run
two-way SMS conversations with delivery status — all behind a multi-tenant
login with row-level isolation.

## Status

Actively built. The gap analysis lives at
[`docs/gap-analysis-2026-07-02.md`](docs/gap-analysis-2026-07-02.md).

## What's in the box

- **Prioritized, filterable, sortable work queue** with saved views
  (all-open, coming-due, 30-plus, high-value, never-contacted,
  follow-ups-due, broken-promises, waiting, on-hold, my-work) and
  explainable "why this priority" reasoning.
- **Customer-centric case workspace** — every customer has a collection
  case that groups their invoices, contact log, SMS thread, and a
  next-action invariant (scheduled follow-up / pending promise / waiting /
  exception / closed).
- **Coming-due awareness** — 7-day window of approaching invoices,
  read-only metric tile + grouped view (no cases opened).
- **Promise-to-pay state machine** with multi-invoice linkage, manual
  cancel, auto-supersede, and payment-validated broken-promise detection
  (balance-delta with a business-day grace window).
- **Two-way SMS** via Twilio — templated sends, delivery status,
  inbound threading, STOP / opt-out handling, status callbacks.
- **Email** — invoice email via Resend, delivery tracking, CAN-SPAM
  unsubscribe handling.
- **Team alert emails** — immediate broken-promise alerts + daily
  follow-ups-due digest per member, with per-user opt-out.
- **Display names** — real names in all labels + contact-log author
  attribution in timeline.
- **Late fees (display-only)** — org-configurable (grace days, monthly %,
  flat fee), shown for awareness only, never written to QBO.
- **QBO OAuth + sync** — connection per org, encrypted token store,
  idempotent upserts, QuickBooks webhooks + a 30-minute CDC catch-up
  cron, payment/credit classification via invoice balance-delta, and an
  on-payment staleness fix that re-pulls the customer's invoices to
  catch paid-off invoices.
- **Manual priority override** that records who, when, and why without
  mutating underlying financial signals.
- **Multi-tenant isolation** via Supabase Row Level Security keyed on
  org membership; service-role client used only for connection status
  and member roster.

## Stack

| Layer        | Tech                                                                 |
|--------------|----------------------------------------------------------------------|
| Web framework| React Router 7 (SSR)                                                 |
| UI           | React 19, Tailwind CSS 4, IBM Plex / Space Grotesk                   |
| Runtime      | Cloudflare Workers (`workers/app.ts`) + scheduled cron handlers      |
| Backend      | Supabase (Postgres + Auth + RLS) — 24 migrations under `supabase/`   |
| QBO          | Intuit QuickBooks Online Data API + webhooks (OAuth + CDC catch-up)  |
| Messaging    | Twilio (SMS two-way), Resend (email)                                 |
| Build / test | Vite 7, TypeScript 5.9, Vitest 4, Wrangler 4                         |

## Repo layout

```
.
├── docs/                                # gap analysis, Intuit production checklist
├── netlify/                             # legacy domain redirects → Worker
├── nudgepay-frontend/                   # DEPRECATED — legacy React SPA
├── nudgepay-backend/                    # DEPRECATED — legacy Express API
└── nudgepay-app/
    ├── app/
    │   ├── components/                  # AppShell, WorkQueue, DetailPanel, MetricsStrip, ...
    │   ├── lib/                         # pure + server-side domain logic
    │   └── routes/                      # page + API + webhook routes
    ├── supabase/
    │   └── migrations/                  # 0001–0024 schema + RLS
    ├── tests/                           # vitest suites
    ├── workers/
    │   └── app.ts                       # Cloudflare fetch + scheduled handlers
    └── wrangler.toml                    # env config + cron schedules
```

### Route map

`/` · `/signup` · `/login` · `/onboarding` · `/invite` · `/accept/:token` · `/dashboard` · `/accounts` · `/accounts/:id` · `/promises` · `/messages` · `/reports` · `/settings` · `/privacy` · `/eula`

API: `/api/contact-logs` · `/api/sms-consent` · `/api/comm-prefs` · `/api/org-settings` · `/api/assign` · `/api/bulk-assign` · `/api/bulk-sms` · `/api/priority-override` · `/api/sync-errors/dismiss` · `/api/presence/heartbeat` · `/api/promises/cancel` · `/api/text/send` · `/api/email/send` · `/api/account-notes` · `/api/profile` · `/api/notification-prefs` · `/api/qbo/connect|refresh|disconnect`

OAuth: `/auth/qbo/callback`

Webhooks: `/webhooks/qbo` · `/webhooks/twilio/inbound` · `/webhooks/twilio/status` · `/webhooks/resend`

## Local development

Prereqs: Node 20+, a Supabase project (or local `supabase start`), a QBO
sandbox app, and a Twilio account.

```bash
cd nudgepay-app
npm install
npm run dev          # React Router dev server (Vite)
npm run test         # vitest, node environment
npm run typecheck    # wrangler types + react-router typegen + tsc -b
npm run build        # production build
```

Wrangler binds the dev worker to the local Supabase at
`http://127.0.0.1:54321` (see `wrangler.toml`). All secrets — Supabase
keys, QBO client id/secret/encryption-key/webhook-verifier-token,
Twilio account/auth/sender, Resend API key/webhook secret — are loaded
via `wrangler secret put`, never committed.

## Deploy

```bash
# Production — set secrets first, then deploy
npx wrangler secret put <NAME> --env production   # repeat per secret in wrangler.toml
npm run deploy -- --env production
```

A successful deploy requires every secret listed under
`[env.production]` in `wrangler.toml`; the QBO and Twilio routes throw
500 at runtime until their respective secrets are present. Email/alert
secrets are optional — `getEmailEnvOrNull` degrades gracefully.

## Testing

```bash
cd nudgepay-app
npm test
```

The suite covers server-side domain logic (priority scoring, worklist
derivation, promise evaluation, case lifecycle, coming-due grouping,
late-fee math, display names, notification builders, business-day math,
RLS contracts), API endpoints, webhook handlers, and route registration.

## License

No license file is committed yet. All rights reserved until one is
added.
