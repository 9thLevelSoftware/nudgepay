# Repository Guidelines — NudgePay

## Active Project

All active development is in **`nudgepay-app/`** — a React Router 7 SSR app on
Cloudflare Workers backed by Supabase (Postgres + Auth + RLS).

Legacy `nudgepay-frontend/` and `nudgepay-backend/` prototypes are **not**
in this tree. Do not recreate or deploy them.

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
│   └── migrations/       # 0001..0051 — sequential SQL migrations
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

### Migrations (0001–0051)

Supabase migrations in `supabase/migrations/`, sequential through
`0051_message_events_direction.sql`. After `0048_sms_sender_inventory.sql`:
`0049_cases_and_consent_rls.sql`, `0050_promises_rls.sql`,
`0051_message_events_direction.sql`.

Key tables: `organizations`, `memberships`, `qbo_connections`, `invoices`
(including `paid_date`), `customers`, `collection_cases`, `contact_logs`,
`promises`, `text_messages`, `email_messages`, `org_settings`, `email_config`,
`messaging_config`, `sync_errors`, `user_notification_prefs`,
`notification_log`, `inbound_orphans`, `cron_checkpoints`. Messages Realtime
broadcasts a content-free `{ table, org_id, direction }` ping (no body).

RLS is the user-data boundary — all user-facing queries use the user client.
The service-role client is used for roster, sync, cron, webhooks, send, and
invites, always pinned to `org_id`. Never use service-role in user loaders.

## Commands

Run from `nudgepay-app/`:

```bash
npm run dev          # Local dev server (Workers + Supabase)
npm run typecheck    # wrangler types + react-router typegen + tsc -b
npm run check        # tsc + build + wrangler deploy --dry-run
npm run test:unit    # PR CI — no Docker; does not run RLS/QBO/Twilio
npx vitest run       # Full suite (needs local Supabase) — RLS proof
npx vitest run tests/names.test.ts  # Single file

# Supabase local
npx supabase start
npx supabase db reset   # Applies all migrations fresh
```

GitHub Actions PR CI is the `typecheck + unit tests` job. A green PR does
**not** mean RLS, QBO, or Twilio ran. No coverage thresholds. No auth rate
limits.

## Conventions

- **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- **No I/O in pure modules** — keep them testable without mocks
- **Fetch-injected clients** — `fetchFn: typeof fetch` for testability
- **Org-scoped queries** — every query includes `.eq("org_id", ...)` or uses RLS
- **OrgConfig pattern** — nullable DB columns → `resolveOrgConfig` → typed defaults
- **ViewId/Metrics pattern** — add new views to `ViewId` union, `ALL_VIEWS`, `VALID_VIEWS`, `SAVED_VIEWS`, `VIEW_LABEL`, `MetricsStrip` tiles
- **Display names** — `listOrgMembers` is the SINGLE source of user labels; never parse emails elsewhere

### UI primitives & overlays (Phase 0 foundations)

- **`app/components/ui.tsx`** is the shared primitive library: `cx`, `Button`
  (`primary|secondary|destructive|ghost` × `sm|md|lg|icon`), `Input`,
  `Textarea`, `Select`, `Badge`, `Card`, `Kbd`, `Skeleton`, `EmptyState`,
  plus `inputClass` / `labelClass`. Compose via `cx`/className overrides
  (later classes win). Do not hand-roll control classes.
- **Overlays:** `DrawerShell` (right sheet — the default overlay) and
  `ModalShell` (centered, sparingly) wrap content and share `use-dialog.ts`
  (focus trap, Escape, focus restore, optional `onCloseHref` for
  URL-as-state drawers). Never hand-roll `fixed inset-0 … role="dialog"`.
- **Content width:** `ContentShell` (`app/components/ContentShell.tsx`) owns
  the padding + max-width policy: `workspace` (full-bleed dashboard/reports),
  `split` (accounts/promises/messages list+rail), `detail` (centered max-w-5xl
  profile/settings). Adopt it instead of per-route `p-*/max-w-*` strings.
- **Destructive confirm:** universal styled inline `TwoStepConfirm` / shared
  `useTwoStep` auto-reset, or async `ConfirmProvider` + `useConfirm()`.
  Do NOT use `window.confirm` (native dialogs are removed).
- **Toasts:** `ToastProvider` is mounted inside `AppShell`; call `useToast()`
  and `push(text, tone)` for transient confirmations. Prefer toasts over
  persistent `?saved=` URL params for new surfaces. (`/focus` keeps its own
  dark-themed stack — it's outside AppShell.)
- **List+rail panels (accounts/promises/messages):** the quick panel renders
  in the grid rail at `lg+` (`hidden lg:block`) AND in a `DrawerShell` below
  `lg` when selected — selection must never dead-end at the page bottom.
- **Virtualized lists:** fixed-height windowing via `visibleWindow`
  (`app/lib/virtual-window.ts`) + `useScrollWindow` (app/lib/use-scroll-window.ts).
  Force uniform desktop row heights so the pad math holds; mobile stacked
  cards render unwindowed.
- **Charts:** use the dependency-free SSR-safe SVG primitives in
  `app/components/SvgCharts.tsx` for report bars, trends, and optional metric
  sparklines. Prefer real loader data; never invent trend points for snapshots.
- **Keyboard UX:** `CommandPalette` in `AppShell` owns `Ctrl/Cmd+K` and `?`;
  list surfaces use `useSearchShortcut` for `/`. Queue and Focus keep their
  scoped handlers, and editable/dialog targets must remain guarded.
- **Color tokens:** `warm` is a distinct amber `#b45309` for cautionary
  states (standing "fair", medium heat, quiet-hours). It is NOT copper —
  never use it for brand actions. The old duplicate `advisory` token is
  removed; raw palette classes (`sky/amber/emerald-…`) are disallowed in
  components — always use semantic tokens. Dark mode is activated through the
  persisted `nudgepay-theme` cookie/localStorage preference and
  `[data-theme="dark"]` token overrides.

## Security

- Never hardcode credentials in source. Use `wrangler secret put`.
- RLS enforces tenancy. Test with `*-rls.test.ts` files.
- `getEmailEnvOrNull` degrades gracefully when email secrets are absent.
- The legacy `nudgepay-frontend/` had hardcoded Supabase credentials — they've been removed but exist in git history. Rotate the anon key.
