# Wave 1 — Ops / docs + accessibility

- **HEAD:** `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc`
- **App:** `nudgepay-app/`
- **Method:** code-only pass. Live evidence left blank (this wave did not hit a running Worker or Lighthouse).
- **IDs:** `TEMP-OPS-*` (release/docs/infra), `TEMP-UX-*` continued from `settings-ux.md` (a11y + SSR).
- **Companion:** product settings/UX findings are in `settings-ux.md`.
- **Reconfirmations:** matches 13 July 2026 audit M27–M30, M32–M34, minors 2, 15, 45–49, 54–59.

Contrast ratios below are computed from the tokens in `app/app.css` (sRGB relative luminance, WCAG 2.x). Not a lab measurement.

---

## Findings — accessibility & SSR

### [TEMP-UX-011]
- **Severity:** major
- **Bars:** P0-public
- **Area:** a11y
- **Status:** reconfirmed
- **Evidence (code):** `--color-copper: #cf8136` (`nudgepay-app/app/app.css:12`) on `--color-surface: #fffdf9` / `--color-panel: #e9e4db`. Used as link/badge/focus-ring and as `text-copper` on light cards (Settings tabs current state `SettingsTabs.tsx:47`; queue hover icons; reports range selected `reports.tsx:162`). Profile Save uses `bg-copper … text-white` (`settings.tsx:192`) — white-on-copper ~3.1:1.
- **Evidence (live):**
- **User / legal impact:** Copper-on-surface is ~3.0:1 (fails WCAG AA 4.5:1 for normal text; borderline 3:1 large text). White-on-copper Save fails AA. Public + workspace both treat copper as the primary interactive color. Keyboard focus rings (`focus-visible:ring-copper`) on light surfaces are similarly weak.
- **Fix recipe:** Darken copper for text/on-light (e.g. `#9a5a18` / `--color-advisory` `#b45309` is closer). Keep `#cf8136` for large fills on ink. Switch the Settings profile button to `text-ink` (every other primary button already does — `ui.tsx:6`). Recheck copper-on-panel and copper-on-paper.
- **Do not:** Tint body text copper. Do not drop focus rings; change the ring token.

### [TEMP-UX-012]
- **Severity:** major
- **Bars:** P0-public
- **Area:** a11y
- **Status:** reconfirmed
- **Evidence (code):** Focus Mode is `bg-ink` (`focus.tsx:280`). Secondary text uses `text-muted` (`#5b6474`) designed for *light* surfaces: `FocusCard.tsx:48,65,84-86,165-169`; Exit link `focus.tsx:285`; kbd hints `FocusCard.tsx:146-150`; recipient line `SendTextMiniForm.tsx:169`. Muted-on-ink ≈ 2.8:1; `text-muted/60` is worse.
- **Evidence (live):**
- **User / legal impact:** The dedicated triage surface (why-now, due dates, invoice amounts, phone number, keyboard hints) is unreadable for low-vision users. Focus is the “power user” path.
- **Fix recipe:** On `bg-ink`, use `text-surface/70` (or a `--color-muted-on-ink` token). Keep `text-muted` for paper/surface only. Recheck `text-copper` on ink (that pair *does* pass ~5.4:1).
- **Do not:** Reuse the light-theme muted token on dark chrome.

### [TEMP-UX-013]
- **Severity:** major
- **Bars:** P0-public
- **Area:** a11y
- **Status:** reconfirmed
- **Evidence (code):**
  - Focus SMS body `<textarea>` has placeholder only (`SendTextMiniForm.tsx:158-165`)
  - Accounts search input has placeholder only (`AccountsDirectory.tsx:61-64`)
  - Late-fee master `<select>` sits in an empty `<label>` (`LateFeesForm.tsx:28-36`)
  - `WebhookUrlField` read-only input is not wired to its visual `<span>` label; Copy has no `aria-label` (`WebhookUrlField.tsx:17-32`)
- **Evidence (live):**
- **User / legal impact:** Core flows (text a customer in Focus, find an account, enable late fees, copy a webhook) fail accessible-name checks. Placeholder-as-label disappears once the field is filled.
- **Fix recipe:** Visible or `sr-only` `<label htmlFor>`. Copy button `aria-label="Copy {label} URL"` + `aria-live` on the Copied state (see TEMP-UX-016).
- **Do not:** Rely on placeholder or adjacent heading text as the name.

### [TEMP-UX-014]
- **Severity:** minor
- **Bars:** polish
- **Area:** a11y
- **Status:** reconfirmed
- **Evidence (code):** AppShell loading bar `animate-[fade-in_…]` + `animate-[progress-slide_…]` (`AppShell.tsx:85-87`); keyframes in `app.css:43-59`. Focus card progress `transition-all duration-300` (`focus.tsx:302`). Side-nav `transition-transform duration-200` (`AppShell.tsx:184`). **No** `@media (prefers-reduced-motion: reduce)` anywhere in `app.css` or components. `ThermalBand` is correctly static (`ThermalBand.tsx:21`).
- **Evidence (live):**
- **User / legal impact:** Vestibular users get an infinite sliding bar on every navigation. Vestibular / OS “reduce motion” is ignored.
- **Fix recipe:** In `app.css`, `prefers-reduced-motion: reduce { animation: none !important; transition: none !important; }` or gate the AppShell bar and nav drawer. Keep ThermalBand as-is.
- **Do not:** Add decorative animation to Focus / KPI tiles without the same gate.

### [TEMP-UX-015]
- **Severity:** minor
- **Bars:** polish
- **Area:** a11y
- **Status:** reconfirmed
- **Evidence (code):** Desktop queue is a CSS grid inside `div aria-label="Work queue table"` (`WorkQueue.tsx:619`) with column labels in a sibling row (`635-643`) and rows as `role="list"` / `listitem` (`647-649`). Not `role="table"` / `row` / `columnheader`. Headers are not referenced from cells. Mobile cards are a separate unlabeled map (`667`).
- **Evidence (live):**
- **User / legal impact:** AT users get a list of “Open {name}” links, not a table they can navigate by column (Heat, Total overdue, Oldest age). Reports page *does* use real `<table>`s (`reports.tsx:193,226`) — the queue is the exception.
- **Fix recipe:** `role="table"` + `row` + `columnheader`/`cell`, or a real `<table>` with the checkbox column. Keep the mobile card list as `role="list"`.
- **Do not:** Nest `role="list"` inside something announced as a table without row/cell roles.

### [TEMP-UX-016]
- **Severity:** minor
- **Bars:** polish
- **Area:** a11y
- **Status:** reconfirmed
- **Evidence (code):** Copy confirmation is a button label swap with no live region (`WebhookUrlField.tsx:26-32`). Bulk selection count is plain text (`BulkActionBar.tsx:32-36`). AppShell loading bar is `aria-hidden="true"` (`AppShell.tsx:85`). Many save flashes *do* use `role="status"` (solid — see below).
- **Evidence (live):**
- **User / legal impact:** “Copied” and “12 selected” never reach AT. Navigating the app is silent even though a progress bar is on screen.
- **Fix recipe:** `aria-live="polite"` on Copied (and reset). `role="status"` on the bulk count. Loading: `role="progressbar"` or a visually-hidden “Loading” live region; do not leave the only indicator `aria-hidden`.
- **Do not:** Announce every keystroke in the queue search.

### [TEMP-UX-017]
- **Severity:** minor
- **Bars:** polish
- **Area:** a11y
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/root.tsx:60-98`. 404 vs generic split is correct. Stack only when `import.meta.env.DEV`. Details in `role="alert"`. Recovery links to `/dashboard` and `/`. Uses `PublicLayout` even when the user still has a session.
- **Evidence (live):**
- **User / legal impact:** Production users never see a stack (good). Logged-in collectors who hit a loader throw are dumped onto a marketing-chrome page with “Go to dashboard” — they may think they were signed out. 404 copy is fine.
- **Fix recipe:** If a session cookie is present, render AppShell-ish recovery (or at least “you are still signed in”). Keep stacks behind DEV.
- **Do not:** Print `error.stack` in production. Do not remove the 404 branch.

### [TEMP-UX-018]
- **Severity:** minor
- **Bars:** polish
- **Area:** ux
- **Status:** reconfirmed
- **Evidence (code):** `formatDate` for ISO timestamps calls `toLocaleDateString("en-US", MEDIUM_DATE)` with no `timeZone` (`dates.ts:27-34`). Cloudflare Workers format in UTC during SSR; the browser hydrates in the viewer’s zone. Date-only `YYYY-MM-DD` path (`new Date(y, m-1, d)`) is TZ-safe — that half is solid. Settings `relTime` uses `Date.now()` in render and already `suppressHydrationWarning` (`settings.tsx:228,272,278`).
- **Evidence (live):**
- **User / legal impact:** Last-contact timestamps (timestamptz) can flash the previous calendar day on hydrate for US users. No time-of-day is shown, so a “contacted this morning” vs “yesterday” error is the whole signal.
- **Fix recipe:** For timestamptz, either format in the org timezone on the server (`todayInTz` already exists) and pass a string, or render timestamps client-only. Do not `suppressHydrationWarning` as the fix.
- **Do not:** Pass date-only columns through `new Date("2026-07-01")` — the comment at `dates.ts:5-8` is correct; keep that branch.

### [TEMP-UX-019]
- **Severity:** minor
- **Bars:** polish
- **Area:** a11y
- **Status:** reconfirmed
- **Evidence (code):** `TemplateEditor.tsx:63-86` — `role="tablist"` / `role="tab"` / `aria-selected`, no `aria-controls`, no `tabpanel`, no arrow-key behavior. Channel switch is click-only.
- **Evidence (live):**
- **User / legal impact:** AT announces a tablist that does not implement the tabs pattern. Keyboard users Tab to both buttons instead of arrows + Tab-into-panel.
- **Fix recipe:** Either implement the APG tabs pattern or drop the roles and keep two toggle buttons (`aria-pressed`).
- **Do not:** Add `role="tablist"` without the rest of the pattern.

### [TEMP-UX-020]
- **Severity:** minor
- **Bars:** polish
- **Area:** a11y
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/app/components/CommPrefsDrawer.tsx:29` — scrim `<Link aria-hidden="true" tabIndex={-1} aria-label="Close">`
- **Evidence (live):**
- **User / legal impact:** Contradictory: hidden from AT but labeled. The real Close link is in the panel header (`CommPrefsDrawer.tsx:33`). The scrim should be presentation-only.
- **Fix recipe:** `aria-hidden="true"` and **no** `aria-label`. Keep `tabIndex={-1}`. Dialog already has `aria-modal` + `aria-label`.
- **Do not:** Put the only Close control on an `aria-hidden` node.

### [TEMP-UX-021]
- **Severity:** minor
- **Bars:** polish
- **Area:** a11y
- **Status:** reconfirmed
- **Evidence (code):** Non-owner Reports nav: `aria-label={`${item.label} (coming soon)`}` (`AppShell.tsx:245`). The page exists and is owner-gated (`reports.tsx:26-28`).
- **Evidence (live):**
- **User / legal impact:** Screen-reader users hear a lie. Sighted members see a dimmed “Reports” with no “owners only” text. See also TEMP-SET-018.
- **Fix recipe:** `aria-label="Reports (owners only)"`. Optional visible tooltip.
- **Do not:** Announce shipped features as coming soon.

---

## Findings — ops / docs

### [TEMP-OPS-001]
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** ops
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/wrangler.toml:25-26`

```toml
[env.production.vars]
SUPABASE_URL = "https://<your-prod-project-ref>.supabase.co"
```

- **Evidence (live):**
- **User / legal impact:** `npx wrangler deploy --env production` as written points the Worker at a non-existent Supabase host (or a literal angle-bracket hostname). Auth, RLS, every loader die. This is the production env block, not a comment.
- **Fix recipe:** Put the real project URL in `[env.production.vars]` (non-secret) before the first production deploy. Pair with `wrangler secret put` for the keys already listed in the file header (`wrangler.toml:33-49`).
- **Do not:** Commit real secrets. Do not deploy production with the default `[vars] SUPABASE_URL = "http://127.0.0.1:54321"` (`wrangler.toml:8`).

### [TEMP-OPS-002]
- **Severity:** major
- **Bars:** P0-public
- **Area:** ops
- **Status:** reconfirmed
- **Evidence (code):** no `D:\nudgepay\.github\` (wave-0 freeze + re-checked). Nothing runs `tsc`, `vitest`, or `wrangler deploy --dry-run` on PRs.
- **Evidence (live):**
- **User / legal impact:** The suite is large (`nudgepay-app/tests/` ~90 files) and is the only regression net for RLS, quiet hours, and QBO mappers. PRs can merge red. Production audit HEAD has no automated witness.
- **Fix recipe:** GitHub Actions: `npm ci` → `npm run typecheck` on every PR (no Docker). A second job for `npx vitest run` that needs Supabase + `.env.test` (see TEMP-OPS-012). `npm run check` on main.
- **Do not:** Claim the 90-file suite is a release gate until CI exists.

### [TEMP-OPS-003]
- **Severity:** minor
- **Bars:** polish
- **Area:** ops
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/package.json:6-14` — scripts are `build`, `cf-typegen`, `typegen`, `check`, `deploy`, `dev`, `preview`, `typecheck`. **No `test`.** Root README tells people `npm run test` / `npm test` (`README.md:105,133`).
- **Evidence (live):**
- **User / legal impact:** Fresh clone: `npm test` → npm error, not vitest. Docs train operators onto a command that does not exist.
- **Fix recipe:** `"test": "vitest run"` (and `"test:watch": "vitest"`). Point README at it. Keep `npx vitest run` working.
- **Do not:** Add a test script that hides the `.env.test` requirement (TEMP-OPS-012) behind a zero-exit skip.

### [TEMP-OPS-004]
- **Severity:** minor
- **Bars:** polish
- **Area:** ops
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/package.json:40-51` — `"cloudflare": { … "publish": true }` plus starter `description`: “Build a full-stack web application with React Router 7.”
- **Evidence (live):**
- **User / legal impact:** `publish: true` is the Cloudflare template-marketplace flag from the RR7 starter. A production deploy of this package.json can advertise NudgePay as a public Workers template with Cloudflare’s stock preview images.
- **Fix recipe:** `"publish": false` (or delete the `cloudflare` block). Replace `description` with the product one-liner.
- **Do not:** Leave marketplace metadata on a customer-data app.

### [TEMP-OPS-005]
- **Severity:** major
- **Bars:** P0-public
- **Area:** ops
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/workers/app.ts:19-24` — `fetch` returns `requestHandler` with no header mutation. No CSP, HSTS, `X-Frame-Options` / `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, or `Permissions-Policy` in wrangler, `react-router.config.ts`, or `entry.server.tsx`.
- **Evidence (live):**
- **User / legal impact:** Clickjacking the logged-in dashboard (collections PII + send buttons) is possible if a browser will frame the Worker. No CSP means a XSS in a template body or a third-party script (Google Fonts is already loaded in `root.tsx:26-35`) has no fallback policy. HSTS is not guaranteed on a custom domain.
- **Fix recipe:** Wrapper in `workers/app.ts` `fetch`: set `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), and a starter CSP (`default-src 'self'`; allow Supabase, fonts.googleapis.com / fonts.gstatic.com, Intuit). Report-only first.
- **Do not:** Copy a lock-tight CSP that breaks QBO OAuth or Google Fonts without a report-only soak. Missing Docker is not this bug.

### [TEMP-OPS-006]
- **Severity:** major
- **Bars:** P0-managed
- **Area:** ops
- **Status:** reconfirmed
- **Evidence (code):** No Sentry / Datadog / Honeycomb / Workers Analytics Engine binding. `wrangler.toml` has no `[observability]` / `[metrics]`. Cron failures go to `console.error` inside `qbo-cron.server.ts` / `digest-cron.server.ts` (invoked from `workers/app.ts:25-34`). Starter README mentions “Built-in Observability” (`nudgepay-app/README.md:20`) as Cloudflare template copy, not an enabled binding.
- **Evidence (live):**
- **User / legal impact:** A silent CDC miss or digest skip is invisible. The only user-facing sync signal is a component that is not mounted (TEMP-SET-009). Managed-pilot operators cannot answer “did last night’s cron run?”
- **Fix recipe:** Enable Workers observability (`[observability] [observability.logs]`) and/or Sentry in `workers/app.ts` (fetch + scheduled). Alert on scheduled-handler exceptions. Log digest/CDC per-org counts.
- **Do not:** Treat `console.error` in Wrangler tail as a production pager.

### [TEMP-OPS-007]
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** ops
- **Status:** reconfirmed
- **Evidence (code):** `netlify/_redirects:5-10` and `netlify/index.html:1` still contain `WORKER_PROD_URL_PLACEHOLDER`. `docs/intuit-production-checklist.md:5-6,21-25` tells operators to deploy this directory so Intuit Privacy/EULA URLs 301 to the Worker.
- **Evidence (live):**
- **User / legal impact:** Intuit app-card Privacy / EULA URLs currently (or after a naive `netlify deploy`) 301 to a hostname that does not exist. App review fails. Existing `nudgepay-ar.netlify.app` links break if this folder is pushed as-is.
- **Fix recipe:** Replace the placeholder with the real Worker origin in `_redirects` **and** `index.html` before any Netlify deploy. Verify `curl -I https://nudgepay-ar.netlify.app/privacy` → 301 to the Worker.
- **Do not:** Deploy the placeholder. Do not delete Netlify until Intuit URLs are repointed.

### [TEMP-OPS-008]
- **Severity:** major
- **Bars:** P0-managed
- **Area:** ops
- **Status:** reconfirmed
- **Evidence (code):** `docs/intuit-production-checklist.md` — every URL is `WORKER_PROD_URL_PLACEHOLDER`; every secret row is unverified; section 8 smoke test is a to-do list. File header: “TODO(deploy): Replace every `WORKER_PROD_URL_PLACEHOLDER`”.
- **Evidence (live):**
- **User / legal impact:** Production QBO (sandbox=false) cannot be connected against Intuit’s production app until Redirect URI, Disconnect URL, Privacy, EULA, Launch URL, and webhook endpoint are real and matching. This is the launch checklist and it is empty.
- **Fix recipe:** Fill the table with the Worker origin. Tick each row with a date + who verified. Treat an unchecked Disconnect URL as a blocker (Intuit will send users to it).
- **Do not:** Set `QBO_SANDBOX = "false"` (`wrangler.toml:27`) before the production app card URLs match.

### [TEMP-OPS-009]
- **Severity:** minor
- **Bars:** polish
- **Area:** docs
- **Status:** reconfirmed
- **Evidence (code):** Root `README.md`:
  - Stack table: “24 migrations” (`README.md:60`)
  - Layout lists `nudgepay-frontend/` and `nudgepay-backend/` (`README.md:71-72`) — **absent from the tree** (wave-0 freeze)
  - Migrations “0001–0024” (`README.md:79`) — disk has `0001`–`0034`
  - Route map misses `/focus`, `/unsubscribe`, `/api/test-message`, `/logout` (`README.md:88-94`)
  - `npm run test` does not exist (TEMP-OPS-003)
  - Status points at a July 2 gap analysis as if current (`README.md:14-15`)
- **Evidence (live):**
- **User / legal impact:** Operators following README install the wrong mental model (legacy packages, 24 migrations, a test script that 404s).
- **Fix recipe:** Align with AGENTS.md + actual tree: active app is `nudgepay-app/`, migrations `0001`–`0034`, no legacy dirs, `npx vitest run`, include `/focus` and `/unsubscribe`.
- **Do not:** Restore the deprecated packages “for README accuracy.”

### [TEMP-OPS-010]
- **Severity:** minor
- **Bars:** polish
- **Area:** docs
- **Status:** reconfirmed
- **Evidence (code):** `AGENTS.md:22` and `AGENTS.md:57` say migrations `0001..0024`. Disk: `nudgepay-app/supabase/migrations/` has 34 files through `0034_oauth_state_user_binding.sql`. Key-tables list in AGENTS.md also predates `message_templates`, org profile, quiet hours, digest columns.
- **Evidence (live):**
- **User / legal impact:** Agents and humans following AGENTS.md stop reading at 0024 and miss 0025–0034 (company profile, templates, priority, workflow, digest, quiet hours, cleanup, security hardening, phone norm, OAuth state binding).
- **Fix recipe:** `0001..0034`. Extend the key-tables sentence. `npm run typecheck` in AGENTS.md is `tsc -b` via package.json (OK) vs the prose `tsc --noEmit` (`AGENTS.md:73`) — pick one.
- **Do not:** Renumber migrations.

### [TEMP-OPS-011]
- **Severity:** major
- **Bars:** P0-public
- **Area:** docs
- **Status:** reconfirmed
- **Evidence (code):** no `LICENSE` at repo root. `README.md:141-144` — “No license file is committed yet. All rights reserved until one is added.”
- **Evidence (live):**
- **User / legal impact:** Public GitHub + Intuit listing without a license is “all rights reserved” by default, which may be intended — but EULA (`eula.tsx`) grants a license the repo does not. Contributors / template leftovers (`publish: true`) confuse the story.
- **Fix recipe:** Commit LICENSE matching the EULA (proprietary is fine). Remove starter marketplace flags (TEMP-OPS-004).
- **Do not:** Add MIT “to be safe” if the EULA is proprietary.

### [TEMP-OPS-012]
- **Severity:** major
- **Bars:** P0-managed
- **Area:** ops
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/tests/global-setup.ts:11-16` `readFileSync(join(dir, "../.env.test"))`. Wave-0 freeze: `.env.test` missing. No `.env.test.example`. `vitest.config.ts:12` always runs that globalSetup.
- **Evidence (live):**
- **User / legal impact:** `npx vitest run` on a fresh clone throws ENOENT before any test. Blocks CI (TEMP-OPS-002). Pure unit files cannot run in isolation because globalSetup is suite-wide.
- **Fix recipe:** Commit `.env.test.example` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` pointing at local `supabase start`). Document `cp .env.test.example .env.test`. Split pure tests (no globalSetup) from RLS/integration tests so CI can run the pure set without Docker.
- **Do not:** Commit a real `.env.test` with production keys. Missing Docker is not a product bug; the missing example file is.

### [TEMP-OPS-013]
- **Severity:** minor
- **Bars:** polish
- **Area:** docs
- **Status:** reconfirmed
- **Evidence (code):** `nudgepay-app/README.md` is still the Cloudflare “React Router + Cloudflare Workers!” starter (Deploy button, `create-cloudflare`, `react-router-starter-template.templates.workers.dev`).
- **Evidence (live):**
- **User / legal impact:** Anyone opening the app folder gets template docs, not NudgePay. Combined with `publish: true` (TEMP-OPS-004) this is how the product would be listed on the template marketplace.
- **Fix recipe:** Replace with a short pointer to the root README + `npm run dev` / secrets list from `wrangler.toml`.
- **Do not:** Keep the C3 “start a new project from this template” section.

### [TEMP-OPS-014]
- **Severity:** minor
- **Bars:** P0-public
- **Area:** docs
- **Status:** reconfirmed
- **Evidence (code):** `app/lib/meta.ts:1-2` returns only `{ title }`. No `robots.txt`, sitemap, meta description, or Open Graph. `root.tsx` `Layout` has charset + viewport only.
- **Evidence (live):**
- **User / legal impact:** Intuit / Google / Slack unfurl of `/` and `/privacy` is a bare title “NudgePay”. Privacy/EULA are the App Card URLs; they should describe themselves.
- **Fix recipe:** `pageTitle` plus a description. `public/robots.txt`. OG tags on `/`, `/privacy`, `/eula`.
- **Do not:** `noindex` the privacy/EULA pages — Intuit has to fetch them.

### [TEMP-OPS-015]
- **Severity:** minor
- **Bars:** polish
- **Area:** ops
- **Status:** open
- **Evidence (code):** `nudgepay-app/package.json:3` `"description": "Build a full-stack web application with React Router 7."` (same starter string as TEMP-OPS-004). Root README product description is correct; the deployable package is not.
- **Evidence (live):**
- **User / legal impact:** `wrangler deploy` / npm metadata describe a generic starter, not an AR collections app.
- **Fix recipe:** One-line product description. Same change as TEMP-OPS-004.
- **Do not:** Duplicate the whole root README into package.json.

---

## What is solid

### Accessibility

- **Skip link** to `#main-content` (`AppShell.tsx:78-83`). `<main id="main-content" tabIndex={-1}>` (`259-264`).
- **`lang="en"`** on the root html (`root.tsx:40`).
- **Focus rings** on interactive chrome (`focus-visible:ring-2 focus-visible:ring-copper`) — contrast is the gap (TEMP-UX-011), presence is not.
- **Icon-only controls named:** nav toggle, settings, sign-out (`AppShell.tsx:95,147,158`), queue row open/SMS/call (`WorkQueue.tsx:209,298,305`), detail close (`DetailPanel.tsx:694`).
- **Search/sort `sr-only` labels** on the work queue (`WorkQueue.tsx:525,538`). Bulk assign `sr-only` (`BulkActionBar.tsx:41`). Holiday date/label `sr-only` (`CollectionsRulesForm.tsx:103-107`). SMS enabled select (`SmsSettingsSection.tsx:45`).
- **Dialogs:** LogContactDrawer / CommPrefsDrawer / BulkSmsDrawer / SyncIssues panel use `role="dialog"` + `aria-modal` / `aria-haspopup`.
- **Reports tables** are real `<table>` + `<th>` (`reports.tsx:193-218,226-245`). Range toggle `role="group"` + `aria-current`.
- **Many save/test flashes already `role="status"`** (Company profile, quiet hours, templates, notifications, email/SMS test, dashboard contact/bulk banners). The gap is Copy + bulk count + loading bar (TEMP-UX-016), not a total absence of live regions.
- **ErrorBoundary** hides stacks in production, distinguishes 404, `role="alert"` on details (`root.tsx:60-84`).
- **Date-only formatting is TZ-safe** (`dates.ts:14-32`) — the remaining SSR issue is timestamptz only (TEMP-UX-018).
- **ThermalBand** is reduced-motion-safe by construction (`ThermalBand.tsx:21`) and has an `aria-label` with days overdue.
- **Denied-reports banner** for members who hit `/reports` (`dashboard.tsx:565-568`).
- **Public forms** (login/signup/onboarding/invite/unsubscribe) use visible `<label>` + `role="alert"` on errors.

### Ops / security posture (already in the tree)

- **Secrets are not in source.** `wrangler.toml` documents `wrangler secret put` per name, including `--env production` (`wrangler.toml:10-15,33-52`).
- **Email degrades.** `getEmailEnvOrNull` — alert paths do not 500 when Resend is unset (`wrangler.toml:52`, `api.test-message.tsx:69-70`).
- **QBO/Twilio fail closed.** Missing production secrets throw at route runtime (`wrangler.toml:50-51`, `env.server.ts:29-37`).
- **Crons exist in both default and production:** `*/30 * * * *` CDC + `0 * * * *` digest (`wrangler.toml:17-31`). `scheduled` handler branches correctly (`workers/app.ts:25-34`).
- **Same-origin CSRF** on authenticated mutations (`csrf.server.ts`, `session.server.ts:26`).
- **RLS is the tenancy boundary**; loaders still pin `.eq("org_id", …)`.
- **`npm run check`** is a real dry-run gate (`package.json:10`: `tsc && react-router build && wrangler deploy --dry-run`).
- **`private: true`** on the npm package (`package.json:3`) — marketplace `publish: true` is a separate Cloudflare block (TEMP-OPS-004).
- **Unsubscribe is POST-only** (RFC 8058) (`unsubscribe.tsx:10-13`).
- **QBO tokens encrypted at rest** (privacy policy + `QBO_ENCRYPTION_KEY` AES-256) — not re-litigated here.
- **Vitest config is honest** about serial DB tests (`vitest.config.ts:14-19`).
- **Wave-0 freeze** already recorded the missing `.github/`, `.env.test`, and 34 migrations — this wave agrees.

### Intentional non-findings

- **No Docker in some environments is not a product bug** (wave brief). The bug is the missing `.env.test.example` and the hard `readFileSync` (TEMP-OPS-012), not Docker itself.
- **Google Fonts** in `root.tsx` is an ops/CSP input (TEMP-OPS-005), not an a11y fail.
- **Workers `nodejs_compat`** + `compatibility_date = "2025-06-01"` are fine.
- **Demo-recording PNGs** in-repo are docs-hygiene, not a release blocker; noted in the July audit (minor 50), not re-opened as P0.
