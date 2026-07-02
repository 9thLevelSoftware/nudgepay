# Repository Guidelines — NudgePay

## Active Project

All active development is in **`nudgepay-app/`** — a React Router 7 SSR app on
Cloudflare Workers backed by Supabase (Postgres + Auth + RLS).

`nudgepay-frontend/` and `nudgepay-backend/` are **deprecated** legacy
prototypes. Do not deploy or develop in them.

## Layout

```
nudgepay-app/
├── app/
│   ├── lib/              # Pure modules (*.ts) + server modules (*.server.ts)
│   ├── components/       # React components (UI only, no I/O)
│   └── routes/           # React Router route modules + API actions
├── workers/
│   └── app.ts            # Cloudflare Worker entry (fetch + scheduled handlers)
├── supabase/
│   └── migrations/       # 0001..0024 — sequential SQL migrations
├── tests/                # Vitest test files
├── wrangler.toml         # Worker config + cron + env vars
└── package.json
netlify/                  # Legacy domain redirects (_redirects → Worker)
docs/                     # Gap analysis, Intuit checklist
```

### Pure vs Server modules

- **Pure** (`app/lib/*.ts`, no `.server` suffix): No I/O, no Node/Worker APIs.
  Imported by routes, components (via type-only), and tests. Examples: `worklist.ts`,
  `cases.ts`, `coming-due.ts`, `late-fees.ts`, `names.ts`, `notifications.ts`.
- **Server** (`app/lib/*.server.ts`): I/O-bearing (Supabase queries, fetch calls,
  crypto). Never imported by client bundles. Examples: `orgs.server.ts`,
  `qbo-sync.server.ts`, `notifications.server.ts`.

### Key domain modules

| Module                   | Purpose                                  |
|--------------------------|------------------------------------------|
| `worklist.ts`            | ViewId, Metrics, InvoiceInput types      |
| `cases.ts`               | CaseItem, buildCaseItems, applyCaseView  |
| `coming-due.ts`          | Coming-due invoice grouping (no cases)   |
| `late-fees.ts`           | Display-only late-fee calculation        |
| `names.ts`               | displayLabel, initialsFrom               |
| `org-config.ts`          | OrgConfig resolver (nullable → defaults) |
| `notifications.ts`       | Pure email builders (broken-promise, digest) |
| `notifications.server.ts`| Alert sending + ledger dedup             |
| `orgs.server.ts`         | listOrgMembers (single label source)     |
| `promise-evaluation.server.ts` | Promise status transitions + brokenDetails |
| `qbo-sync.server.ts`     | CDC sync, webhook handlers, SyncDeps     |
| `qbo-cron.server.ts`     | Scheduled CDC catch-up                   |
| `digest-cron.server.ts`  | Scheduled daily digest                   |

### Migrations (0001–0024)

Supabase migrations in `supabase/migrations/`. Key tables: `orgs`, `memberships`,
`qbo_connections`, `invoices`, `customers`, `collection_cases`, `contact_logs`,
`promises`, `text_messages`, `email_messages`, `org_settings`, `email_config`,
`messaging_config`, `sync_errors`, `user_notification_prefs`, `notification_log`.

RLS is the security boundary — all user-facing queries use the user client;
service-role client only in sync/cron/admin paths.

## Commands

Run from `nudgepay-app/`:

```bash
npm run dev          # Local dev server (Workers + Supabase)
npm run typecheck    # tsc --noEmit
npm run check        # tsc + build + wrangler deploy --dry-run
npx vitest run       # Full test suite
npx vitest run tests/names.test.ts  # Single file

# Supabase local
npx supabase start
npx supabase db reset   # Applies all migrations fresh
```

## Conventions

- **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- **No I/O in pure modules** — keep them testable without mocks
- **Fetch-injected clients** — `fetchFn: typeof fetch` for testability
- **Org-scoped queries** — every query includes `.eq("org_id", ...)` or uses RLS
- **OrgConfig pattern** — nullable DB columns → `resolveOrgConfig` → typed defaults
- **ViewId/Metrics pattern** — add new views to `ViewId` union, `ALL_VIEWS`, `VALID_VIEWS`, `SAVED_VIEWS`, `VIEW_LABEL`, `MetricsStrip` tiles
- **Display names** — `listOrgMembers` is the SINGLE source of user labels; never parse emails elsewhere

## Security

- Never hardcode credentials in source. Use `wrangler secret put`.
- RLS enforces tenancy. Test with `*-rls.test.ts` files.
- `getEmailEnvOrNull` degrades gracefully when email secrets are absent.
- The legacy `nudgepay-frontend/` had hardcoded Supabase credentials — they've been removed but exist in git history. Rotate the anon key.
