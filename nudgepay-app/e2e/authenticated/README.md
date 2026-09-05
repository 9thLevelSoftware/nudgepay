# Authenticated browser workflows

This suite exercises real Supabase Auth sessions and RLS against the local
Supabase stack. Its setup refuses every Supabase URL except loopback port
`54321`, creates synthetic tenants and users, and removes only those stable
fixture IDs after the run. Message history is seeded directly with outbound
delivery disabled, so the suite never calls a messaging provider.

Run the Chromium desktop gate from `nudgepay-app/`:

```sh
node e2e/authenticated/run.mjs --project=chromium-desktop
```

Run all configured desktop, tablet, and mobile projects:

```sh
node e2e/authenticated/run.mjs
```

The runner checks Docker, starts local Supabase when needed, and stops only a
stack that it started. An explicit authenticated run fails with a clear error
when Docker, local Supabase, or required local keys are unavailable. The root
`npm run test:e2e` smoke suite remains database independent.

Integration Vitest and this authenticated suite use the shared OS-temporary
`nudgepay-local-db-harness.lock` directory. A second harness fails before it
can truncate or reseed the local database. Teardown removes its own lock. The
lock never treats a PID as stale or deletes one automatically: after confirming
the recorded harness has stopped, an operator may remove that exact temporary
directory explicitly before retrying.

Playwright traces, videos, and failure screenshots are written under the OS
temporary directory at `nudgepay-playwright/authenticated`. Review screenshots
are written under `NudgePay/e2e-evidence` in `LOCALAPPDATA` on Windows or the OS
temporary directory elsewhere. No auth storage state or cookie fixture is
written to disk.

The suite covers seeded owner/admin/member/other-tenant sessions, tenant RLS,
core navigation, report CSV download, contact and promise mutation, local
message ledgers, URL selection history, dialog focus/inert behavior, light and
dark themes, reduced motion, responsive desktop/tablet/mobile layouts, and a
bounded axe-core audit of the dashboard, settings, and selected-account views
in both themes at desktop and mobile widths. The automated audit applies WCAG
2 A/AA, 2.1 AA, and 2.2 AA rule tags. Manual screen-reader testing of announcements, reading
order, and end-to-end task flow remains required before accessibility sign-off.
Signup confirmation, first-run onboarding, QuickBooks OAuth and sync, live
provider delivery, and payment reconciliation are outside this synthetic local
workflow. Their database rows are pre-seeded where the UI needs connected or
ledger state; passing this suite is not proof of those external flows.

The console fixture fails every application error. Its sole exception is
Playwright WebKit's exact loopback access-control rejection for React Router's
development-server `__manifest` patch request (plus the paired "Failed to fetch
manifest patches" message). The built Worker preview returns this request with
HTTP 200 and navigates the unvisited route without console or request failures;
production runtime and all other browser errors remain fatal.
