# NudgePay

AR collections for QuickBooks Online users.

NudgePay turns a QBO company's overdue-invoice list into a prioritized,
assignable collections work queue: pull customers, invoices, and payments
from QBO; work the queue ranked by a multi-factor priority score; log
structured contact outcomes and promise-to-pay commitments; and run
two-way SMS conversations with delivery status — all behind a multi-tenant
login with row-level isolation.

## Status

Actively built. 

The high-level requirements gap checklist lives at
[`docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md`](docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md)
and tracks what's shipped, what's open, and what's deliberately deferred.

## What's in the box

- **Prioritized, filterable, sortable work queue** with saved views
  (all-open, 30-plus, high-value, never-contacted, follow-ups-due,
  broken-promises, waiting, my-work) and explainable "why this priority"
  reasoning.
- **Customer-centric case workspace** — every customer has a collection
  case that groups their invoices, contact log, SMS thread, and a
  next-action invariant (scheduled follow-up / pending promise / waiting /
  exception / closed).
- **Promise-to-pay state machine** with multi-invoice linkage, manual
  cancel, auto-supersede, and payment-validated broken-promise detection
  (balance-delta with a business-day grace window).
- **Two-way SMS** via Twilio — templated sends, delivery status,
  inbound threading, STOP / opt-out handling, status callbacks.
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
| Runtime      | Cloudflare Workers (`workers/app.ts`) + scheduled cron handler       |
| Backend      | Supabase (Postgres + Auth + RLS) — 12 migrations under `supabase/`   |
| QBO          | Intuit QuickBooks Online Data API + webhooks (OAuth + CDC catch-up)  |
| Messaging    | Twilio (SMS two-way, status callbacks, signature verification)       |
| Build / test | Vite 7, TypeScript 5.9, Vitest 4, Wrangler 4                         |

## Repo layout

```
.
├── docs/
│   └── superpowers/                 # design specs, gap checklists, implementation plans
└── nudgepay-app/
    ├── app/
    │   ├── components/              # AppShell, WorkQueue, DetailPanel, MetricsStrip, ...
    │   ├── lib/                     # server-side domain logic (qbo-sync, promises, worklist, ...)
    │   └── routes/                  # page + API + webhook routes (see below)
    ├── public/                      # static assets
    ├── supabase/
    │   ├── migrations/              # 0001–0012 schema + RLS
    │   └── seed.sql
    ├── tests/                       # 47 vitest suites (server logic + API contracts)
    ├── workers/
    │   └── app.ts                   # Cloudflare fetch + scheduled handler
    ├── react-router.config.ts
    ├── vite.config.ts
    ├── vitest.config.ts
    └── wrangler.toml                # env config + cron schedule
```

### Route map

`/` (home) · `/signup` · `/login` · `/onboarding` · `/invite` · `/accept/:token` · `/dashboard` · `/privacy` · `/eula`

API: `/api/contact-logs` · `/api/sms-consent` · `/api/assign` · `/api/priority-override` · `/api/promises/cancel` · `/api/text/send` · `/api/qbo/connect|refresh|disconnect`

OAuth callback: `/auth/qbo/callback`

Webhooks (signature-verified): `/webhooks/qbo` · `/webhooks/twilio/inbound` · `/webhooks/twilio/status`

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
Twilio account/auth/sender — are loaded via `wrangler secret put`, never
committed.

## Deploy

```bash
# Production — set secrets first, then deploy
npx wrangler secret put <NAME> --env production   # repeat per secret in wrangler.toml
npm run deploy -- --env production
```

A successful deploy requires every secret listed under
`[env.production]` in `wrangler.toml`; the QBO and Twilio routes throw
500 at runtime until their respective secrets are present.

## Testing

```bash
cd nudgepay-app
npm test
```

The suite covers server-side domain logic (priority scoring, worklist
derivation, promise evaluation, business-day math, RLS contracts), API
endpoints (assignment, contact logs, priority override, promise cancel,
SMS send/consent, QBO connect/disconnect/refresh/webhook), Twilio
sends/inbound/status, and route registration. CI is not wired up here
yet.

## Roadmap

The `docs/superpowers/` gap checklist is the source of truth. The
currently-open, in-build work:

- **B5** — extend priority scoring (balance, broken-promises,
  time-since-last-contact, prior attempts, follow-up-due) — *shipping
  in 7b on `phase7b-priority`*.
- **B6** — surface failed-sync state and an "unresolved sync errors"
  count.
- **C1** — collision / recent-contact warnings on the same customer.
- **C2** — expand the on-hold exception taxonomy (disputed,
  incorrect-amount, work-incomplete, ...) into a first-class workflow.
- **C3** — click-to-call + email composer (or honest "log-only" email).
- **C5** — bulk assignment + templated batch SMS.
- **C7** — configurable grace periods + holiday calendar.

Deliberately deferred: automated outreach sequences, predictive payment
scoring, AI-generated messages, voice/transcription, advanced
segmentation, benchmarking.

## License

No license file is committed yet. All rights reserved until one is
added.
