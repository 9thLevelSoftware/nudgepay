# UX and accessibility matrix

Snapshot: `88b9baca35be5b8d9235b2f96863150ef3a67ad1` (`2026-08-20`). The matrix is
primarily a static source audit. A later supplemental Playwright pass captured the
five anonymous public routes at 1440×900 and 390×844; it did not exercise an
authenticated state, keyboard flow, assistive technology, automated accessibility,
contrast, or zoom. Except for the explicitly listed supplemental observations, every
viewport/zoom/keyboard/screen-reader result remains browser-unverified. Source
evidence is not a WCAG conformance claim.

## Required verification matrix

| Target | Required check | Current source evidence | Status |
|---|---|---|---|
| Desktop 1280×800, 100% | Navigation, queue/detail split, settings tabs, reports tables, no horizontal overflow. | `AppShell.tsx:77-269`; `WorkQueue.tsx:600-714`; route surfaces use `lg:grid-cols`/`xl` classes. | `BROWSER-UNVERIFIED`; source has desktop branches but no screenshot/e2e. |
| Mobile 390×844, 100% | Menu, queue cards, Focus reachability, drawers, account/message forms, no clipped controls. | `AppShell.tsx:172-200`; `WorkQueue.tsx:316-385,667-714`; `DetailPanel.tsx:676-714`; many `md:hidden`/`lg:hidden` branches. | `BROWSER-UNVERIFIED`; Focus is absent from `NAV_ITEMS` and is unreachable from mobile nav (NP-2026-107); queue overflow risk NP-2026-110. |
| 200% zoom / 1280 CSS px | Reflow without loss of content/function, focus remains visible, nav/menu still usable. | Tailwind responsive classes and `AppShell` `overflow-hidden` shell (`AppShell.tsx:77-80,260`); no zoom-specific CSS/test. | `BROWSER-UNVERIFIED`; `STATIC-ONLY`. |
| 400% zoom / 320 CSS px equivalent | WCAG 1.4.10 reflow: no two-dimensional scrolling except data grids, all actions reachable. | WorkQueue switches list/cards at `md`; tables/lists use `overflow-auto`; detail uses `overflow-y-auto`. | `BROWSER-UNVERIFIED`; static classes cannot prove 400% reflow or clipped content. |
| Keyboard-only | Tab order, skip link, menu, drawers, forms, queue shortcuts, no keyboard trap. | Skip link `AppShell.tsx:80-83`; focus rings across shell; `use-dialog.ts:4-61` traps Tab/Escape/returns focus; queue/focus hooks guard inputs/dialogs. | `STATIC PASS` for intended hooks; `BROWSER-UNVERIFIED` for actual tab order/hidden controls/trap. |
| Screen reader | Landmark/heading order, names, dynamic result announcements, list/table semantics, error association. | `aria-label`/roles in shell, queue, drawers, messages; many visual-only status spans. | `BROWSER-UNVERIFIED`; no NVDA/VoiceOver/TalkBack pass or accessibility tree snapshot. |

## Surface matrix

Legend: `S` source support; `G` source gap; `U` browser/provider-unverified;
`A` automated pure/server evidence only. A row can contain more than one marker.

| Surface | Viewport / zoom | Keyboard | Screen reader / WCAG criteria | Current source evidence and concerns |
|---|---|---|---|---|
| Public home `/` | 1280/390 and 200/400%: `U` | `U` | 1.3.1/2.4.4/2.4.6: `U`; legal links source in `home.tsx:1-38`. | `PublicLayout.tsx:1-27`, `home.tsx:26-38`; source has links but no metadata/description/OG (NP-2026-131), thin copy (NP-2026-104). |
| Signup/login `/signup`, `/login` | Responsive form source: `S`; zoom: `U` | Labels and focus classes source: `S`; actual order: `U` | 1.3.1/3.3.1/4.1.3: role alerts are present (`signup.tsx`, `login.tsx`), but confirmation/forgot states: `G/U`. | `signup.tsx:21-110`, `login.tsx:22-92`; no forgot-password or dedicated confirmation landing (NP-2026-001/002). Public auth POSTs bypass same-origin protection; security verification is not UX evidence. |
| Onboarding `/onboarding` | 390/200/400%: `U` | Form source labels/focus: `S`; submit/hydration: `U` | 1.3.1/3.3.2: `S` labels in route; 4.1.3: `U` for save/redirect. | `onboarding.tsx:20-55`; no browser first-run pass, no empty/error screenshot. |
| Invite/accept `/invite`, `/accept/:token` | `U` | `U` | 3.3.1/3.3.3/4.1.3: raw/limited errors and “Sending…” copy are source concerns. | `invite.tsx:19-64`, `accept.$token.tsx:23-106`; expired/wrong-user states exist in source but no AT/visual verification; invite delivery/provider blocked (NP-2026-018/126). |
| App shell/nav | Desktop source: `S`; mobile/zoom: `U` | Skip link/menu/close/source: `S`; actual focus: `U` | 2.1.1/2.4.1/2.4.3/4.1.2: `aria-expanded`, labels, current state present (`AppShell.tsx:92-249`); Focus absent mobile is `G`. | `AppShell.tsx:47-52,77-269`; shell uses `h-screen overflow-hidden` and mobile drawer; avatar button signs out immediately (NP-2026-102), Reports is `aria-disabled` “coming soon” for members (NP-2026-101). |
| Dashboard queue `/dashboard` | 1280 source branches: `S`; 390/200/400%: `U` | j/k/x source: `S`; Tab/selection/action focus: `U` | 1.3.1/1.4.10/2.1.1/4.1.2: queue uses `role=list/listitem`, not a real table; no queue result live region. | `WorkQueue.tsx:500-714`; desktop header is a styled div (`619-647`), rows are list items (`647-649`), mobile cards below `md` (`667-714`). `overflow-auto`, hidden columns and hover-only quick actions need browser proof. Empty/error copy NP-2026-015/105; muted/copper contrast NP-2026-053. |
| Dashboard detail panel | Desktop two-pane source: `S`; mobile/zoom: `U` | Close/tabs/action buttons have focus classes source: `S`; panel transition/order: `U` | 1.3.1/2.4.3/4.1.2: labels/regions/groups present (`DetailPanel.tsx:672-813`), but dynamic panel focus is not a modal and no live announcement. | `DetailPanel.tsx:672-1249`; `aria-label` and regions help; mobile close is conditional (`694-697`), panel uses overflow scroll. Browser needed for focus return, selected account announcement, and 400% form reflow. |
| Focus `/focus` | Desktop source: `S`; mobile reachability: `G/U`; zoom: `U` | 1/2/3/space hooks source: `S`; actual shortcut conflict/focus: `U` | 2.1.1/4.1.2/4.1.3: no documented live announcement for completion/collision. | `focus.tsx:44-470`, `use-focus-keys.ts:1-36`; route exists but shell does not expose it on mobile (NP-2026-107); raw error toast/copy concern NP-2026-106. |
| Accounts directory/profile | Desktop/table source: `S`; mobile/zoom: `U` | Links/forms focus classes source: `S`; real tab order: `U` | 1.3.1: account list is `ul role=list`; search uses a placeholder-like label (`AccountsDirectory.tsx:55-67`); profile form labels mostly present. | `AccountsDirectory.tsx:1-133`, `AccountProfile.tsx:1-219`; profile lacks `do_not_email` field (NP-2026-003), metrics overclaim (NP-2026-051), no browser reflow/reader test. |
| Promises ledger | Desktop/table source: `S`; 390/zoom: `U` | Filter links/forms source: `S`; cancel path absent on page `G`. | 1.3.1/2.4.4/4.1.2: `PromisesLedger.tsx:65-125` has nav/list labels but styled columns, no page cancel control. | `PromisesLedger.tsx:1-125`, `promises.tsx:29-216`; page cancel missing NP-2026-113. |
| Messages inbox | Desktop source: `S`; mobile/zoom: `U` | Filter links/composer source: `S`; poll/read behavior `G/U`. | 1.3.1/4.1.3: `MessagesInbox.tsx:69-124` labels nav/list and needs-reply dot; no live update/read announcement. | `MessagesInbox.tsx:1-160`, `MessageThreadPanel.tsx:100-310`, `MessageBubbles.tsx:1-40`; no polling/read state NP-2026-047; timestamps/semantic direction need AT pass (NP-2026-118). |
| Bulk assignment/SMS | Desktop source: `S`; mobile/zoom: `U` | Dialog hook source: `S`; actual focus/confirmation: `U` | 2.1.1/2.4.3/4.1.3: `BulkSmsDrawer.tsx:81-170` has dialog/modal/role status; bulk error summary is incomplete (NP-2026-123). | `BulkActionBar.tsx`, `BulkSmsDrawer.tsx`, `use-dialog.ts`; provider send and browser confirmation blocked. |
| Settings tabs | Desktop source: `S`; wrapped tabs at mobile/zoom: `U` | Links keyboardable source; no arrow-key tab behavior `G`. | 2.1.1/2.4.3/4.1.2: links use `aria-current`, but fake tabs and dirty navigation lack state/guard. | `SettingsTabs.tsx:1-56`; `settings.tsx:28-364`; no unsaved-change prompt NP-2026-116 and no arrow-key tabs NP-2026-136. |
| Settings forms | 1280 source: `S`; 390/200/400%: `U` | Native form controls/focus classes source: `S`; validation/flash: `U`. | 1.3.1/3.3.1/3.3.2/4.1.3: many `role=alert/status` implementations; labels vary and late-fee/threshold semantics need browser/AT. | `CompanyProfileForm.tsx`, `CollectionsRulesForm.tsx`, `LateFeesForm.tsx`, `PriorityThresholdsForm.tsx`, `QuietHoursForm.tsx`, `WorkflowSettingsForm.tsx`; current source gaps NP-2026-045/115/116. |
| Integrations/settings | Desktop source: `S`; mobile sync chip/controls: `U` | Buttons/links source labeled; provider redirects: `U`. | 3.3.1/4.1.3: QBO flash params ignored, SyncIssues not mounted, disconnect lacks confirmation. | `settings.tsx`, `SmsSettingsSection.tsx`, `SyncIssues.tsx`, `api.qbo.*`; NP-2026-017/023/043/142; Intuit provider blocked. |
| Templates/email/SMS | Desktop source: `S`; zoom/reflow: `U` | Form/button source: `S`; fake tabs/preview: `G/U`. | 1.3.1/1.4.10/4.1.3: settings forms have statuses but no preview and no full error announcement audit. | `TemplateEditor.tsx:1-276`, `EmailSettingsSection.tsx:1-166`; fake tabs/no preview NP-2026-026/117; Resend/Twilio blocked. |
| Reports | Desktop source: `S`; mobile/zoom: `U` | Table/export links source: `S`; download behavior: `U`. | 1.3.1/1.4.10/4.1.2: styled report tables and CSV need actual table headers/download check. | `reports.tsx:21-251`, `reports.ts`; member denied banner and coming-soon nav issues NP-2026-048/101. |
| Public legal `/privacy`, `/eula` | Prose likely reflows: `U` at all targets/zoom | Native links: `U` | 1.3.1/1.4.10/2.4.4: source prose only; no reader/zoom evidence. | `privacy.tsx:1-63`, `eula.tsx:1-41`, `PublicLayout.tsx`; Netlify redirect placeholder NP-2026-009. |
| Unsubscribe | Public card/confirmation: `U`; 390/zoom: `U` | Native POST control: `U` | 3.3.1/4.1.3: token-invalid/safe states source, no reader/browser announcement evidence. | `unsubscribe.tsx:14-71`; token tests are automated, mailed/provider/browser flow blocked. |
| ErrorBoundary/404/500 | Source branches: `S`; rendered error page: `U` | CTA focus: `U` | 3.3.1/4.1.3: dev stack only source; anonymous 404 dashboard CTA may be confusing. | `app/root.tsx` ErrorBoundary and route errors; no browser/production error rendering test. |

## WCAG-oriented cross-cutting audit

| Criterion / concern | Current source evidence | Static assessment | Required live check |
|---|---|---|---|
| 1.3.1 Info and relationships | Native labels in forms; `role=list/listitem`, `role=dialog`, regions and nav labels appear in `WorkQueue.tsx`, `MessagesInbox.tsx`, drawers, `AppShell.tsx`. Work queue desktop is styled divs, not table semantics. | `STATIC PARTIAL`; do not claim conformance. | Inspect accessibility tree and heading/landmark/table relationships at 1280, 390, 200%, 400%. |
| 1.4.3 Contrast minimum | Token usage includes copper `#cf8136` and muted `#5b6474`; prior source review estimates copper-on-surface ~3:1 and muted-on-ink ~2:1. | `STATIC RISK` NP-2026-053. | Run WCAG contrast meter on text, focus rings, disabled/status/error states in both themes. |
| 1.4.10 Reflow | Responsive classes switch queue/list and shell nav; `overflow-hidden` shell plus nested `overflow-auto` panels can mask clipping. | `STATIC UNKNOWN`; source cannot prove reflow. | 200%/400% and 320 CSS px test with no loss of actions/content. |
| 1.4.11 Non-text contrast | Focus rings consistently use `focus-visible:ring-2 ring-copper`; status dots/heat bars rely on color plus labels in some places. | `STATIC PARTIAL`; icons/dots need inspection. | Check focus indicator and graphical-object contrast in light/dark modes. |
| 2.1.1 Keyboard | `use-dialog.ts:34-54` handles Escape/Tab; queue/focus hooks guard fields/dialogs; buttons/links mostly native. Hover-only quick actions use `focus-within` but pointer-events are dynamic. | `STATIC PARTIAL`; intended keyboard paths exist. | Complete tab/shortcut traversal; verify no trap, hidden control, or shortcut conflict. |
| 2.4.1 Bypass blocks | `AppShell.tsx:80-83` has skip-to-content link. | `STATIC PASS` for source presence. | Verify skip link target, visible focus, and focus landing in each route. |
| 2.4.3 Focus order / 2.4.7 Visible focus / 2.4.11 Focus appearance | Focus ring classes are widespread; `use-dialog` restores captured trigger or `main-content`. Dynamic DetailPanel and non-modal panel transitions are not proven. | `STATIC PARTIAL`. | Keyboard audit all drawers, detail panel, mobile nav, validation errors, and URL navigations. |
| 2.4.4 Link purpose / 2.4.6 Headings and labels | Most icon-only controls have aria labels; search/filter and fake tabs are inconsistent; public metadata is thin. | `STATIC PARTIAL`; NP-2026-131/136. | Screen-reader pass for unique names, heading hierarchy, link purpose, and current-state announcements. |
| 3.2.1/3.2.2 Predictable input | Native forms and explicit submit buttons; settings tab switches can lose dirty state; avatar logs out immediately. | `STATIC RISKS` NP-2026-102/116. | Test tab changes, modal close/back, validation, and accidental activation. |
| 3.3.1/3.3.2 Errors and labels | Many forms render `role=alert/status`; errors are query-param or inline and labels are mostly native. Raw provider/error codes and swallowed bulk errors remain. | `STATIC PARTIAL`; NP-2026-106/123/126. | Trigger every validation/server error and verify announcement, association, recovery, and no raw codes. |
| 4.1.2 Name/role/value | `aria-expanded`, `aria-current`, dialog labels, and input labels exist in core components; custom list/table/status patterns vary. | `STATIC PARTIAL`. | Inspect accessibility tree for every route and state; test screen-reader interaction and live updates. |
| 4.1.3 Status messages | `role=status` appears in forms, message gates, drawer statuses, and settings saves; queue errors/flash params and inbox updates lack consistent live region. | `STATIC GAP` for failure/live-data honesty. | Verify announcements for save/send/sync/collision/error/empty transitions without focus movement. |
| 2.3.3 Motion | Some `motion-safe` transition usage (`LogContactDrawer.tsx:61`, shell progress animation), but no reduced-motion preference audit. | `STATIC UNKNOWN`. | Enable OS reduced motion and inspect drawer/nav/progress/hover transitions. |
| Color-independent communication | Queue has text labels/badges plus heat bars; status dots and iconography still require review. | `STATIC PARTIAL`. | Disable color perception / use high contrast and confirm all states retain text/icon meaning. |

## Browser/provider evidence limits

- The in-app Browser could not start because its trusted Node REPL service was
  unavailable. Standalone Playwright/Chrome was used only as supplemental evidence.
- Ten fresh screenshots under `evidence/screenshots/` show `/`, `/login`, `/signup`,
  `/privacy`, and `/eula` rendering without a gross error page at 1440×900 and
  390×844. Visual inspection also confirms the public landing content remains thin
  and the login view has no discoverable forgot-password control.
- These screenshots do not establish authenticated layout, Firefox/WebKit parity,
  keyboard behavior, focus, screen-reader output, accessibility-tree semantics,
  contrast, reduced motion, target size, or 200%/400% zoom. No screenshot is treated
  as closure evidence for an accessibility finding.
- No authenticated session, real Supabase row, QBO OAuth/CDC/payment, Twilio sender,
  Resend delivery/event, or deployed Worker/Render response was observed.
- Automated tests cover pure modules, mocked/injected server paths, and selected RLS
  contracts. They do not certify CSS layout, hydration, focus, screen-reader output,
  contrast, zoom/reflow, or provider behavior.
- Minimum follow-up: browser smoke at 1280×800 and 390×844; keyboard-only; NVDA or
  VoiceOver; 200% and 400% zoom/reflow; contrast meter; reduced motion; then provider
  sandboxes and deployed Worker/Node health/cron/webhook checks.
