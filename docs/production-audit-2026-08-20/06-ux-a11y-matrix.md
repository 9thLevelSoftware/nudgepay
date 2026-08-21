# UX / a11y matrix

HEAD `820fb1ba`. Code + Netlify home. **No authenticated 1280/390 browser pass** (no local app with data). Viewport notes are from CSS/class inspection.

Detail: `wave-1/settings-ux.md`, `wave-1/ops-a11y.md`.

Legend: E empty · R error · L loading/submitting · S success flash · A a11y · D desktop · M mobile 390.

| Page | E | R | L | S | A11y issues | D | M |
|---|---|---|---|---|---|---|---|
| `/` | n/a | n/a | n/a | n/a | no description/OG (NP-2026-131); thin marketing (104) | ok | ok (centered) |
| `/signup` | n/a | role=alert | busy button | confirm-email card | labels present | ok | ok |
| `/login` | n/a | role=alert | busy | redirect | no forgot-password (001); labels present | ok | ok |
| `/onboarding` | n/a | n/a | busy | redirect | labels present | ok | ok |
| `/invite` | n/a | raw DB error (126) | “Sending…” lies (018) | code block, no copy | unlinked from app | ok | ok |
| `/accept/:token` | dead-end states exist | pass | — | — | — | ok | ok |
| `/dashboard` | wrong empty copy (105); $0 on error (015) | swallowed | AppShell bar, no reduced-motion (136) | flash params unused for qbo (017) | WorkQueue not a table (136); copper (053); no live region (137) | queue+w-96 | overflow (110); Focus hidden (107); hamburger |
| `/focus` | skip always | raw codes (106) | — | toasts | muted-on-ink (053); unlabeled SMS body (053) | ok | **unreachable** (107) |
| `/accounts` | metrics overclaim (051) | — | — | — | search placeholder-as-label (053) | ok | ok |
| `/accounts/:id` | invoices empty copy | — | form busy | none obvious | **no do_not_email** (003) | table ok | table scroll |
| `/promises` | — | — | — | — | no cancel (113) | ok | ok |
| `/messages` | — | — | **no poll** (047) | — | bubbles no time (118); consent ok with customerId | ok | ok |
| `/reports` | owner only | denied banner | — | — | member nav “coming soon” (101) | tables ok | — |
| `/settings` workspace | — | error query | busy | distinct? | avatar logout is chrome (102) | tabs | tabs wrap |
| `/settings` integrations | QBO empty | qbo= unread (017) | — | — | disconnect no confirm (043); SyncIssues unmounted (023) | ok | sync chip hidden |
| `/settings` channels | — | — | — | — | sender Inactive (142); test SMS (052) | ok | ok |
| `/settings` templates | resurrection (026) | — | — | — | fake tabs (136); no preview (117) | ok | ok |
| `/settings` collections | — | min mismatch (045) | — | **wrong form** (115) | late-fee unlabeled (053); dirty tabs (116) | ok | ok |
| `/privacy` `/eula` | n/a | Worker ok; Netlify **404** (009) | n/a | n/a | EULA private beta (104); omit Resend (141) | prose | prose |
| `/unsubscribe` | invalid token safe | — | — | POST only | — | ok | ok |
| ErrorBoundary | n/a | 404/500; stack in DEV only | n/a | n/a | dashboard CTA for anon 404 | ok | ok |

## Keyboard

| Surface | Keys | Guards | Result |
|---|---|---|---|
| Dashboard queue | j k x | skip input/textarea/select/dialog | pass |
| Focus | 1 2 3 space | skip when mini-form / inputs | pass |
| Settings tabs | none (links) | — | no arrow-key tabs (136) |

## Contrast (code tokens, not a live meter)

| Pair | Approx | ID |
|---|---|---|
| copper `#cf8136` on surface/paper | ~3:1 | NP-2026-053 |
| muted `#5b6474` on ink (Focus) | ~2:1 | NP-2026-053 |
| copper button `text-ink` | better | some buttons already ink-on-copper |

Re-measure with a contrast tool in the fix pass; no later contrast PR landed after July 13.

## Chrome UX footguns

- Avatar = instant logout (NP-2026-102).
- Focus Mode not in mobile nav (NP-2026-107).
- First-run Integrations dump with no welcome (NP-2026-137).
- Empty work queue always “Clear the search” (NP-2026-105).
