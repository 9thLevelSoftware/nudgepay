# Source disposition

All 398 prior-corpus entries are mapped below. Temporary IDs are qualified by their source file.

| Corpus | Qualified source ID | Source title | Final atomic finding(s) | Disposition |
|---|---|---|---|---|
| July 13 | B0 | No password reset / forgot-password flow | NP-AUD-2026-001 | still-open |
| July 13 | B1 | Every loader read silently truncates at Supabase's 1,000-row cap | NP-AUD-2026-007-TRUNCATION | still-open |
| July 13 | B2 | Truncated reconciliation reads wrongly auto-resolve still-overdue cases | NP-AUD-2026-007-RECONCILIATION | still-open |
| July 13 | B3 | Account-profile "Save preferences" silently re-subscribes unsubscribed customers | NP-AUD-2026-003 | still-open |
| July 13 | B4 | All tenants share one operator-owned Twilio sender, by design | NP-AUD-2026-012 | still-open |
| July 13 | B5 | Inbound SMS, including STOP opt-outs, is silently dropped when unmatched | NP-AUD-2026-004 | still-open |
| July 13 | B6 | Per-org email "from" is unverified free text on the operator's shared Resend key | NP-AUD-2026-013 | still-open |
| July 13 | B7 | Inbound email handling cannot work against the real Resend API | NP-AUD-2026-014 | still-open |
| July 13 | B8 | First sync after connecting QuickBooks never happens automatically | NP-AUD-2026-005 | still-open |
| July 13 | B9 | A dead QBO connection reports "Connected" forever | NP-AUD-2026-006 | still-open |
| July 13 | B10 | Production environment was never configured | NP-AUD-2026-008 | still-open |
| July 13 | B11 | Intuit compliance URLs redirect to a placeholder | NP-AUD-2026-009 | still-open |
| July 13 | M1 | Email-confirmation landing is unhandled | NP-AUD-2026-002 | still-open |
| July 13 | M2 | Invites don't send email | NP-AUD-2026-018 | still-open |
| July 13 | M3 | Multi-org membership is a trap | NP-AUD-2026-019 | still-open |
| July 13 | M4 | No member removal, role change, invite revocation, or leave-org | NP-AUD-2026-010 | still-open |
| July 13 | M5 | No change-password, change-email, or account deletion | NP-AUD-2026-020 | still-open |
| July 13 | M6 | Loader DB errors render as healthy empty states | NP-AUD-2026-015 | still-open |
| July 13 | M7 | Focus Mode has no collision safeguards | NP-AUD-2026-025 | still-open |
| July 13 | M8 | No pagination/virtualization; loader re-runs every 20 s | NP-AUD-2026-050 | still-open |
| July 13 | M9 | SyncIssues warning badge exists but is mounted nowhere | NP-AUD-2026-023 | still-open |
| July 13 | M10 | Email never counts as contact | NP-AUD-2026-024 | still-open |
| July 13 | M11 | "Total customers" counts only ever-overdue customers | NP-AUD-2026-051 | still-open |
| July 13 | M12 | No CSV/data export anywhere | NP-AUD-2026-048-CSV | still-open |
| July 13 | M13 | Money is hardcoded USD/en-US | NP-AUD-2026-048-LOCALE | still-open |
| July 13 | M14 | No read/unread state for inbound messages | NP-AUD-2026-047 | still-open |
| July 13 | M15 | Messages inbox never updates while open | NP-AUD-2026-047 | still-open |
| July 13 | M16 | Default templates resurrect after deletion | NP-AUD-2026-026 | still-open |
| July 13 | M17 | OAuth/sync outcome params are never rendered | NP-AUD-2026-017 | still-open |
| July 13 | M18 | No pagination of QBO query/CDC results | NP-AUD-2026-028 | still-open |
| July 13 | M19 | Reconnecting a different QuickBooks company merges two books | NP-AUD-2026-027 | still-open |
| July 13 | M20 | QBO webhook processes synchronously before responding | NP-AUD-2026-031 | still-open |
| July 13 | M21 | CDC cron is one serial loop over all orgs | NP-AUD-2026-041 | still-open |
| July 13 | M22 | No `reply_to` and no inbound-email setup path | NP-AUD-2026-032 | still-open |
| July 13 | M23 | Consent has no provenance and STOP is one-click reversible | NP-AUD-2026-011 | still-open |
| July 13 | M24 | No rate limiting or send-frequency caps on any send endpoint | NP-AUD-2026-035-SMS-RATE, NP-AUD-2026-035-EMAIL-RATE | still-open |
| July 13 | M25 | Plain members can DELETE/rewrite the audit trail | NP-AUD-2026-036-LEDGER-RLS | partially-fixed |
| July 13 | M26 | QBO deletions/voids are mishandled | NP-AUD-2026-030 | still-open |
| July 13 | M27 | No CI | NP-AUD-2026-016-CI | still-open |
| July 13 | M28 | No error monitoring or analytics | NP-AUD-2026-042 | still-open |
| July 13 | M29 | Tests unrunnable from a fresh clone | NP-AUD-2026-016-TEST-ENV | still-open |
| July 13 | M30 | Intuit production checklist entirely open | NP-AUD-2026-009 | still-open |
| July 13 | M31 | QuickBooks Disconnect is one un-confirmed click | NP-AUD-2026-043 | still-open |
| July 13 | M32 | Copper brand color fails WCAG AA on light surfaces | NP-AUD-2026-053-CONTRAST | still-open |
| July 13 | M33 | Focus Mode dark theme renders secondary text at 1.6–2.8:1 | NP-AUD-2026-053-CONTRAST, NP-AUD-2026-053-LABELS | still-open |
| July 13 | M34 | Unlabeled controls in core flows | NP-AUD-2026-053-LABELS | still-open |
| July 13 | min 1 | Onboarding action doesn't re-check org membership | NP-AUD-2026-044 | still-open |
| July 13 | min 2 | Non-owner Reports nav item announced as "(coming soon)" | NP-AUD-2026-101 | still-open |
| July 13 | min 3 | Clicking the user avatar instantly signs you out | NP-AUD-2026-102 | still-open |
| July 13 | min 4 | Unmapped Supabase auth errors collapse to a generic string | NP-AUD-2026-103 | still-open |
| July 13 | min 5 | Landing page is a headline; EULA still says "private beta" | NP-AUD-2026-104-EULA | still-open |
| July 13 | min 6 | Empty work queue always shows the filter-centric message | NP-AUD-2026-105 | still-open |
| July 13 | min 7 | Focus Mode surfaces raw machine error codes in toasts | NP-AUD-2026-106 | still-open |
| July 13 | min 8 | Focus Mode is unreachable on mobile | NP-AUD-2026-107 | still-open |
| July 13 | min 9 | Bulk SMS skipped-reason summary omits the do-not-text bucket | NP-AUD-2026-108 | still-open |
| July 13 | min 10 | Consent toggle in Messages tab breaks with no representative invoice | NP-AUD-2026-109 | partially-fixed |
| July 13 | min 11 | Dashboard detail panel is a fixed 384px pane | NP-AUD-2026-110 | still-open |
| July 13 | min 12 | Coming-due empty state hardcodes "next 7 days" | NP-AUD-2026-111 | still-open |
| July 13 | min 13 | UTC calendar day vs org-local today skews broken-promise flag | NP-AUD-2026-112 | still-open |
| July 13 | min 14 | Promises cannot be edited; Promises page has no cancel/renegotiate | NP-AUD-2026-113 | still-open |
| July 13 | min 15 | Timestamp dates render in the server's UTC zone during SSR; no time-of-day | NP-AUD-2026-114 | still-open |
| July 13 | min 16 | Collections rules form gives zero success/error feedback; saved=1 lights the wrong forms | NP-AUD-2026-115 | partially-fixed |
| July 13 | min 17 | Priority high-value threshold: client min $0.01, server min $1,000 | NP-AUD-2026-045-VALIDATION-RANGE | still-open |
| July 13 | min 18 | No unsaved-changes protection on any settings form | NP-AUD-2026-116 | still-open |
| July 13 | min 19 | Template editor has no preview, no token insertion, no placeholder validation | NP-AUD-2026-117 | still-open |
| July 13 | min 20 | SMS thread bubbles show no timestamps; pane doesn't scroll to newest | NP-AUD-2026-118 | still-open |
| July 13 | min 21 | No 429 detection, backoff, or retry on Intuit API calls | NP-AUD-2026-054-BACKOFF | still-open |
| July 13 | min 22 | CDC watermark stamped with local time AFTER fetch/processing | NP-AUD-2026-029 | still-open |
| July 13 | min 23 | Invoice status column goes stale when a due date passes without a QBO change | NP-AUD-2026-119 | still-open |
| July 13 | min 24 | No data-retention or cleanup job for unbounded operational tables | NP-AUD-2026-120 | still-open |
| July 13 | min 25 | CloudEvents webhook parser admits it is unverified against real Intuit payloads | NP-AUD-2026-054-PARSER | still-open |
| July 13 | min 26 | Resend email.failed / email.suppressed events are ignored | NP-AUD-2026-034 | still-open |
| July 13 | min 27 | No "Reply STOP to opt out" language in default SMS templates | NP-AUD-2026-121 | still-open |
| July 13 | min 28 | Quiet hours computed in the org's timezone, not the recipient's | NP-AUD-2026-122 | still-open |
| July 13 | min 29 | No server-side duplicate-send protection on single-send endpoints | NP-AUD-2026-035-SMS-RATE, NP-AUD-2026-035-EMAIL-RATE | still-open |
| July 13 | min 30 | Bulk SMS partial failures reported only as an aggregate count | NP-AUD-2026-123 | still-open |
| July 13 | min 31 | Broken-promise alert email failures are permanently lost | NP-AUD-2026-049-CHANNEL-GATE, NP-AUD-2026-049-RETRY | still-open |
| July 13 | min 32 | No List-Unsubscribe / one-click unsubscribe headers | NP-AUD-2026-033-UNSUBSCRIBE | still-open |
| July 13 | min 33 | Promise kept/partially-kept boundary uses exact float comparison | NP-AUD-2026-046-FLOAT-MONEY | still-open |
| July 13 | min 34 | high_value_threshold above $10,000 is accepted but silently stops affecting scoring | NP-AUD-2026-045-THRESHOLD-ORDER | still-open |
| July 13 | min 35 | worklist.ts retains a dead, conflicting age-only priority model | NP-AUD-2026-124 | still-open |
| July 13 | min 36 | Late-fee estimate model is simplistic; priority weights stay hardcoded | NP-AUD-2026-125 | still-open |
| July 13 | min 37 | Promise evaluation counts any QBO balance reduction as payment | NP-AUD-2026-046-PAYMENT-SEMANTICS | still-open |
| July 13 | min 38 | Owner test-SMS endpoint sends to arbitrary numbers with no consent gate and no throttle | NP-AUD-2026-052-TEST-SMS | still-open |
| July 13 | min 39 | Auth actions bypass the same-origin CSRF check | NP-AUD-2026-022-AUTH-CSRF, NP-AUD-2026-022-LOGOUT-CSRF | still-open |
| July 13 | min 40 | Invite action returns raw database error message to the client | NP-AUD-2026-126 | still-open |
| July 13 | min 41 | dev-data.sql is broken by the 0032 member-source-edit trigger | NP-AUD-2026-127 | still-open |
| July 13 | min 42 | email_config.updated_at is never maintained | NP-AUD-2026-128 | still-open |
| July 13 | min 43 | Audit-actor columns are bare uuids without FKs / ON DELETE | NP-AUD-2026-129 | still-open |
| July 13 | min 44 | Invites allow unlimited duplicate pending invites per (org, email) | NP-AUD-2026-130 | still-open |
| July 13 | min 45 | No robots.txt, sitemap, meta description, or Open Graph tags | NP-AUD-2026-131 | still-open |
| July 13 | min 46 | README.md materially stale | NP-AUD-2026-132-README | still-open |
| July 13 | min 47 | AGENTS.md stale | NP-AUD-2026-132-AGENTS | still-open |
| July 13 | min 48 | Starter-template boilerplate remains | NP-AUD-2026-132-STARTER | still-open |
| July 13 | min 49 | No LICENSE file committed | NP-AUD-2026-133 | still-open |
| July 13 | min 50 | Six demo-recording PNGs committed | NP-AUD-2026-134 | still-open |
| July 13 | min 51 | Legacy Supabase anon key rotation documented as pending | NP-AUD-2026-135 | still-open |
| July 13 | min 52 | listOrgMembers fetches only the first 1000 auth users project-wide | NP-AUD-2026-038-ROSTER, NP-AUD-2026-038-SERVICE-PIN | still-open |
| July 13 | min 53 | Team alert emails and daily digest gated on the customer-facing email channel | NP-AUD-2026-049-CHANNEL-GATE | still-open |
| July 13 | min 54 | WorkQueue desktop grid has no table semantics | NP-AUD-2026-136-TABLE | still-open |
| July 13 | min 55 | Infinite loading animation and fade-in not gated on prefers-reduced-motion | NP-AUD-2026-136-MOTION | still-open |
| July 13 | min 56 | CommPrefsDrawer scrim link has contradictory aria-hidden + aria-label | NP-AUD-2026-136-SCRIM | still-open |
| July 13 | min 57 | TemplateEditor uses role=tablist/tab without tabpanel or arrow keys | NP-AUD-2026-136-TABS | still-open |
| July 13 | min 58 | QuickBooks sync status chip and sync-issue alerts hidden on mobile | NP-AUD-2026-023 | still-open |
| July 13 | min 59 | Async UI results not announced: copy-to-clipboard and bulk-selection count | NP-AUD-2026-137-LIVE-REGIONS | still-open |
| July 13 | min 60 | No in-app notification surface | NP-AUD-2026-137-NOTIFICATION-SURFACE | still-open |
| July 13 | min 61 | First-run bounce to Settings has no welcome or explanation | NP-AUD-2026-137-FIRST-RUN | still-open |
| August canonical | NP-2026-001 | No password reset / forgot-password flow | NP-AUD-2026-001 | still-open |
| August canonical | NP-2026-002 | No `/auth/confirm`; signup confirm branch drops Set-Cookie | NP-AUD-2026-002 | still-open |
| August canonical | NP-2026-003 | Account-profile Save preferences silently re-subscribes unsubscribed customers | NP-AUD-2026-003 | still-open |
| August canonical | NP-2026-004 | Unmatched inbound SMS, including STOP, is dropped with HTTP 200 | NP-AUD-2026-004 | still-open |
| August canonical | NP-2026-005 | QBO OAuth callback never runs the overdue backfill | NP-AUD-2026-005 | still-open |
| August canonical | NP-2026-006 | Dead QBO connection reports Connected forever | NP-AUD-2026-006 | still-open |
| August canonical | NP-2026-007 | Silent 1,000-row truncation; reconciliation auto-resolves live cases | NP-AUD-2026-007-TRUNCATION, NP-AUD-2026-007-RECONCILIATION | superseded |
| August canonical | NP-2026-008 | Production environment was never configured | NP-AUD-2026-008 | still-open |
| August canonical | NP-2026-009 | Intuit compliance URLs 404; Netlify redirects are placeholders | NP-AUD-2026-009 | still-open |
| August canonical | NP-2026-010 | No member removal, role change, leave-org; memberships RLS is SELECT-only | NP-AUD-2026-010 | still-open |
| August canonical | NP-2026-011 | Consent has no provenance; STOP is one-click reversible | NP-AUD-2026-011 | still-open |
| August canonical | NP-2026-012 | All tenants share one operator-owned Twilio sender | NP-AUD-2026-012 | still-open |
| August canonical | NP-2026-013 | Per-org From is unverified free text on the shared Resend key | NP-AUD-2026-013 | still-open |
| August canonical | NP-2026-014 | Inbound email mapping cannot work against the real Resend API | NP-AUD-2026-014 | still-open |
| August canonical | NP-2026-015 | Loader DB errors render as a healthy empty queue | NP-AUD-2026-015 | still-open |
| August canonical | NP-2026-016 | Tests cannot run from a fresh clone; no CI | NP-AUD-2026-016-TEST-ENV, NP-AUD-2026-016-CI | superseded |
| August canonical | NP-2026-017 | `qbo=` / `sync=` query params are never rendered | NP-AUD-2026-017 | still-open |
| August canonical | NP-2026-018 | Invites do not send email; `/invite` is linked from no page | NP-AUD-2026-018 | still-open |
| August canonical | NP-2026-019 | Multi-org membership is a trap (`resolveOrg` oldest) | NP-AUD-2026-019 | still-open |
| August canonical | NP-2026-020 | No change-password, change-email, or account deletion | NP-AUD-2026-020 | still-open |
| August canonical | NP-2026-021 | Session cookies are not HttpOnly, not Secure, max-age 400 days | NP-AUD-2026-021 | still-open |
| August canonical | NP-2026-022 | Login/signup/logout skip CSRF; login CSRF can swap the session | NP-AUD-2026-022-AUTH-CSRF, NP-AUD-2026-022-LOGOUT-CSRF | superseded |
| August canonical | NP-2026-023 | SyncIssues exists but is mounted nowhere | NP-AUD-2026-023 | still-open |
| August canonical | NP-2026-024 | Email never counts as last contact | NP-AUD-2026-024 | still-open |
| August canonical | NP-2026-025 | Focus Mode has no collision/presence | NP-AUD-2026-025 | still-open |
| August canonical | NP-2026-026 | Default templates resurrect after delete | NP-AUD-2026-026 | still-open |
| August canonical | NP-2026-027 | QBO realm switch merges two books | NP-AUD-2026-027 | still-open |
| August canonical | NP-2026-028 | QBO query/CDC cap 1000; `truncated` discarded | NP-AUD-2026-028 | still-open |
| August canonical | NP-2026-029 | CDC watermark stamped after processing | NP-AUD-2026-029 | still-open |
| August canonical | NP-2026-030 | QBO deletions/voids mishandled | NP-AUD-2026-030 | still-open |
| August canonical | NP-2026-031 | QBO webhook does Intuit+DB work before 200; no waitUntil | NP-AUD-2026-031 | still-open |
| August canonical | NP-2026-032 | No `reply_to`; templates ask customers to reply | NP-AUD-2026-032 | still-open |
| August canonical | NP-2026-033 | No List-Unsubscribe headers; postal address advertised as required then skipped | NP-AUD-2026-033-POSTAL, NP-AUD-2026-033-UNSUBSCRIBE | superseded |
| August canonical | NP-2026-034 | `email.failed` / `email.suppressed` ignored | NP-AUD-2026-034 | still-open |
| August canonical | NP-2026-035 | No rate limits or send idempotency | NP-AUD-2026-035-SMS-RATE, NP-AUD-2026-035-EMAIL-RATE | superseded |
| August canonical | NP-2026-036 | Member FOR ALL on audit tables; members can SELECT invite tokens and QBO ciphertext | NP-AUD-2026-036-LEDGER-RLS, NP-AUD-2026-036-INVITE-TOKEN, NP-AUD-2026-036-QBO-TOKEN | superseded |
| August canonical | NP-2026-037 | 0032 composite FKs are still NOT VALID | NP-AUD-2026-037 | still-open |
| August canonical | NP-2026-038 | Service-role `listUsers(1000)` on every dashboard load; writes sometimes key by id only | NP-AUD-2026-038-ROSTER, NP-AUD-2026-038-SERVICE-PIN | superseded |
| August canonical | NP-2026-039 | Missing security headers on the Worker | NP-AUD-2026-039 | still-open |
| August canonical | NP-2026-040 | `react-router@7.9.6` HIGH XSS/RCE/CSRF/DoS advisories | NP-AUD-2026-040 | still-open |
| August canonical | NP-2026-041 | CDC cron is one serial loop over all orgs | NP-AUD-2026-041 | still-open |
| August canonical | NP-2026-042 | No error monitoring | NP-AUD-2026-042 | still-open |
| August canonical | NP-2026-043 | QBO Disconnect is one unconfirmed click | NP-AUD-2026-043 | still-open |
| August canonical | NP-2026-044 | Onboarding replay creates orphan orgs | NP-AUD-2026-044 | still-open |
| August canonical | NP-2026-045 | High-value threshold ≥ $10k silently stops affecting the 12-point band; client min $0.01 vs server $1,000 | NP-AUD-2026-045-THRESHOLD-ORDER, NP-AUD-2026-045-VALIDATION-RANGE | superseded |
| August canonical | NP-2026-046 | Promise kept uses float compare; any balance drop counts as payment | NP-AUD-2026-046-FLOAT-MONEY, NP-AUD-2026-046-PAYMENT-SEMANTICS | superseded |
| August canonical | NP-2026-047 | No inbox read state or live updates | NP-AUD-2026-047 | still-open |
| August canonical | NP-2026-048 | USD/en-US hardcoded; no CSV export | NP-AUD-2026-048-LOCALE, NP-AUD-2026-048-CSV | superseded |
| August canonical | NP-2026-049 | Team alerts gated on customer email channel; alert send is one-shot | NP-AUD-2026-049-CHANNEL-GATE, NP-AUD-2026-049-RETRY | superseded |
| August canonical | NP-2026-050 | Work queue not virtualized; revalidate every 20s while a case is open | NP-AUD-2026-050 | still-open |
| August canonical | NP-2026-051 | “Total customers” is not the QBO directory | NP-AUD-2026-051 | still-open |
| August canonical | NP-2026-052 | Staff SMS consent toggle / test-SMS to arbitrary numbers | NP-AUD-2026-052-CONSENT-TOGGLE, NP-AUD-2026-052-TEST-SMS | superseded |
| August canonical | NP-2026-053 | Copper / Focus contrast fail WCAG AA; unlabeled core controls | NP-AUD-2026-053-CONTRAST, NP-AUD-2026-053-LABELS | superseded |
| August canonical | NP-2026-054 | CloudEvents QBO parser is unverified; no Intuit 429 backoff | NP-AUD-2026-054-PARSER, NP-AUD-2026-054-BACKOFF | superseded |
| August canonical | NP-2026-101 | Reports nav “(coming soon)” for members | NP-AUD-2026-101 | still-open |
| August canonical | NP-2026-102 | Avatar POST-logout | NP-AUD-2026-102 | still-open |
| August canonical | NP-2026-103 | Generic auth errors | NP-AUD-2026-103 | still-open |
| August canonical | NP-2026-104 | Thin landing; EULA “private beta” | NP-AUD-2026-104-LANDING, NP-AUD-2026-104-EULA | superseded |
| August canonical | NP-2026-105 | Empty queue “Clear the search” | NP-AUD-2026-105 | still-open |
| August canonical | NP-2026-106 | Focus raw error codes | NP-AUD-2026-106 | still-open |
| August canonical | NP-2026-107 | Focus hidden below `sm` | NP-AUD-2026-107 | still-open |
| August canonical | NP-2026-108 | Bulk skip summary omits do-not-text | NP-AUD-2026-108 | still-open |
| August canonical | NP-2026-109 | DetailPanel consent posts only invoiceId | NP-AUD-2026-109 | still-open |
| August canonical | NP-2026-110 | Detail `w-96` overflow on phones | NP-AUD-2026-110 | still-open |
| August canonical | NP-2026-111 | Coming-due copy “7 days” | NP-AUD-2026-111 | still-open |
| August canonical | NP-2026-112 | `todayISO()` UTC vs org-local | NP-AUD-2026-112 | still-open |
| August canonical | NP-2026-113 | Promises page has no cancel | NP-AUD-2026-113 | still-open |
| August canonical | NP-2026-114 | SSR UTC dates | NP-AUD-2026-114 | still-open |
| August canonical | NP-2026-115 | `saved=1` lights wrong Collections forms | NP-AUD-2026-115 | still-open |
| August canonical | NP-2026-116 | No unsaved-changes on settings tabs | NP-AUD-2026-116 | still-open |
| August canonical | NP-2026-117 | Template editor no preview/tokens | NP-AUD-2026-117 | still-open |
| August canonical | NP-2026-118 | SMS bubbles no timestamps / no scroll | NP-AUD-2026-118 | still-open |
| August canonical | NP-2026-119 | Invoice status stale when due date passes | NP-AUD-2026-119 | still-open |
| August canonical | NP-2026-120 | No retention job | NP-AUD-2026-120 | still-open |
| August canonical | NP-2026-121 | No STOP language in SMS templates | NP-AUD-2026-121 | still-open |
| August canonical | NP-2026-122 | Quiet hours = org TZ not recipient | NP-AUD-2026-122 | still-open |
| August canonical | NP-2026-123 | Bulk SMS swallows per-case errors | NP-AUD-2026-123 | still-open |
| August canonical | NP-2026-124 | Dead `priorityOf` in worklist.ts | NP-AUD-2026-124 | still-open |
| August canonical | NP-2026-125 | Late-fee model simplistic | NP-AUD-2026-125 | still-open |
| August canonical | NP-2026-126 | Invite returns raw DB errors | NP-AUD-2026-126 | still-open |
| August canonical | NP-2026-127 | `dev-data.sql` trips 0032 trigger | NP-AUD-2026-127 | still-open |
| August canonical | NP-2026-128 | `email_config.updated_at` never set | NP-AUD-2026-128 | still-open |
| August canonical | NP-2026-129 | Audit actor uuids have no FK / ON DELETE | NP-AUD-2026-129 | still-open |
| August canonical | NP-2026-130 | Duplicate pending invites | NP-AUD-2026-130 | still-open |
| August canonical | NP-2026-131 | No robots/OG/description | NP-AUD-2026-131 | still-open |
| August canonical | NP-2026-132 | README / AGENTS / starter boilerplate | NP-AUD-2026-132-README, NP-AUD-2026-132-AGENTS, NP-AUD-2026-132-STARTER | superseded |
| August canonical | NP-2026-133 | No LICENSE | NP-AUD-2026-133 | still-open |
| August canonical | NP-2026-134 | Demo PNGs in git | NP-AUD-2026-134 | still-open |
| August canonical | NP-2026-135 | Legacy anon key rotation pending | NP-AUD-2026-135 | still-open |
| August canonical | NP-2026-136 | A11y: table semantics, reduced-motion, scrim aria, template tabs | NP-AUD-2026-136-TABLE, NP-AUD-2026-136-MOTION, NP-AUD-2026-136-SCRIM, NP-AUD-2026-136-TABS | superseded |
| August canonical | NP-2026-137 | No live regions; no in-app bell; first-run no welcome | NP-AUD-2026-137-LIVE-REGIONS, NP-AUD-2026-137-NOTIFICATION-SURFACE, NP-AUD-2026-137-FIRST-RUN | superseded |
| August canonical | NP-2026-138 | Contact methods only call/text/note | NP-AUD-2026-138 | still-open |
| August canonical | NP-2026-139 | HELP/INFO SMS keywords missing | NP-AUD-2026-139 | still-open |
| August canonical | NP-2026-140 | Phone match is last-10 only | NP-AUD-2026-140 | still-open |
| August canonical | NP-2026-141 | Privacy/EULA omit Resend | NP-AUD-2026-141 | still-open |
| August canonical | NP-2026-142 | `save_sms_sender` locked (not a bug) | NP-AUD-2026-142 | still-open |
| August canonical | NP-2026-143 | Focus includes waiting/promised; snooze writes last-contact | NP-AUD-2026-143-SUPPRESSED-FOCUS, NP-AUD-2026-143-SNOOZE-CONTACT, NP-AUD-2026-143-WAITING-PROMISE | superseded |
| August canonical | NP-2026-144 | Terminal DNC does not block Focus log-call / applyNextStep | NP-AUD-2026-144 | still-open |
| August canonical | NP-2026-145 | Empty client chunks for API routes | NP-AUD-2026-145 | still-open |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-001 | No password reset / forgot-password flow | NP-AUD-2026-001 | duplicate-merged |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-002 | No `/auth/confirm` landing; signup confirm branch drops `Set-Cookie` | NP-AUD-2026-002 | duplicate-merged |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-003 | Auth cookies are not HttpOnly, not Secure, max-age 400 days | NP-AUD-2026-021 | duplicate-merged |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-004 | Login and signup skip same-origin CSRF; login CSRF + `returnTo` swaps the session | NP-AUD-2026-022-AUTH-CSRF | duplicate-merged |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-005 | Logout POST is not origin-checked | NP-AUD-2026-022-LOGOUT-CSRF | duplicate-merged |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-006 | No change-password, change-email, or account deletion | NP-AUD-2026-020 | duplicate-merged |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-007 | Invites never send email; copy-link is a relative path; page is unlinkable | NP-AUD-2026-018 | duplicate-merged |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-008 | Unlimited duplicate pending invites per (org, email) | NP-AUD-2026-130 | duplicate-merged |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-009 | Invite action returns raw PostgREST errors | NP-AUD-2026-126 | duplicate-merged |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-010 | Onboarding action does not re-check membership — replay creates extra orgs | NP-AUD-2026-044 | duplicate-merged |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-011 | `resolveOrg` always picks the oldest membership; no org switcher | NP-AUD-2026-019 | duplicate-merged |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-012 | No member removal, role change, leave-org, or memberships DELETE policy | NP-AUD-2026-010 | duplicate-merged |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-013 | `listOrgMembers` reads only the first 1,000 auth users project-wide | NP-AUD-2026-038-ROSTER | duplicate-merged |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-014 | Password policy is HTML-only (8) vs GoTrue min 6, no server check | NP-AUD-2026-X201 | still-open |
| August wave | AUG20:wave-1:auth:TEMP-AUTH-015 | Signup enumerates registered emails | NP-AUD-2026-X202 | still-open |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-001 | PostgREST/QBO 1000-row cap can auto-resolve live cases | NP-AUD-2026-007-TRUNCATION, NP-AUD-2026-007-RECONCILIATION | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-002 | Dashboard/focus loaders swallow PostgREST errors and silently empty the queue | NP-AUD-2026-015 | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-003 | Email is not last-contact — Never contacted / silence / timeline lie | NP-AUD-2026-024 | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-004 | Focus Mode is collision-blind (`includePresence: false`) | NP-AUD-2026-025 | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-005 | Dead age-only scorer still lives in `worklist.ts` | NP-AUD-2026-124 | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-006 | High-value threshold ≥ $10,000 silently no-ops the 12-point scoring tier | NP-AUD-2026-045-THRESHOLD-ORDER | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-007 | Owner/user labels fall back to UUID prefix or "Unknown" | NP-AUD-2026-X203 | still-open |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-008 | Timeline "broken" badge uses UTC today, not org-local | NP-AUD-2026-112 | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-009 | Promise kept/partial uses raw IEEE float compare | NP-AUD-2026-046-FLOAT-MONEY | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-010 | Credit memo is treated as cash for promise evaluation | NP-AUD-2026-046-PAYMENT-SEMANTICS | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-012 | Contact log methods are call/text/note while email is a first-class send channel | NP-AUD-2026-138 | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-013 | Terminal exceptions do not block Focus "Log call" or the Log drawer | NP-AUD-2026-144 | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-014 | Promise cancel is only on dashboard Overview, not the Promises ledger | NP-AUD-2026-113 | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-015 | Coming-due empty state hardcodes "next 7 days" | NP-AUD-2026-111 | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-016 | `my-work` includes suppressed (DNC / legal / parked) cases | NP-AUD-2026-143-SUPPRESSED-FOCUS | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-017 | Focus snooze (key 3) writes a contact log and clears Never contacted | NP-AUD-2026-143-SNOOZE-CONTACT | duplicate-merged |
| August wave | AUG20:wave-1:cases-queue:TEMP-CASE-018 | Focus queue includes waiting and pending-promise cases | NP-AUD-2026-143-WAITING-PROMISE | duplicate-merged |
| August wave | AUG20:wave-1:email:TEMP-EMAIL-001 | Account-profile Save preferences silently re-subscribes unsubscribed customers | NP-AUD-2026-003 | duplicate-merged |
| August wave | AUG20:wave-1:email:TEMP-EMAIL-002 | CAN-SPAM postal address is advertised as required then dropped on send | NP-AUD-2026-033-POSTAL | duplicate-merged |
| August wave | AUG20:wave-1:email:TEMP-EMAIL-003 | Per-org From is unverified free text on the operator’s shared Resend key | NP-AUD-2026-013 | duplicate-merged |
| August wave | AUG20:wave-1:email:TEMP-EMAIL-004 | Inbound email mapping cannot work against the live Resend API | NP-AUD-2026-014 | duplicate-merged |
| August wave | AUG20:wave-1:email:TEMP-EMAIL-005 | No List-Unsubscribe / one-click headers; POST handler could not honor them anyway | NP-AUD-2026-033-UNSUBSCRIBE | duplicate-merged |
| August wave | AUG20:wave-1:email:TEMP-EMAIL-006 | `reply_to` is never set; default templates tell customers to reply | NP-AUD-2026-032 | duplicate-merged |
| August wave | AUG20:wave-1:email:TEMP-EMAIL-007 | `email.failed` and `email.suppressed` are ignored; rows stay `sent` | NP-AUD-2026-034 | duplicate-merged |
| August wave | AUG20:wave-1:email:TEMP-EMAIL-008 | Team alert emails are gated on the customer-facing email channel | NP-AUD-2026-049-CHANNEL-GATE | duplicate-merged |
| August wave | AUG20:wave-1:email:TEMP-EMAIL-009 | Staff can clear a legal email opt-out without an affirmative recipient request | NP-AUD-2026-003 | duplicate-merged |
| August wave | AUG20:wave-1:email:TEMP-EMAIL-010 | Privacy Policy and EULA omit the email channel, Resend, and CAN-SPAM | NP-AUD-2026-141 | duplicate-merged |
| August wave | AUG20:wave-1:email:TEMP-EMAIL-011 | No send-side rate limit on the shared Resend account | NP-AUD-2026-035-EMAIL-RATE | duplicate-merged |
| August wave | AUG20:wave-1:email:TEMP-EMAIL-012 | Broken-promise alert failures are one-shot and never retried | NP-AUD-2026-049-RETRY | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-UX-011 | Copper-on-surface is ~3.0:1 (fails WCAG AA 4.5:1 for normal text; borderline 3:1 large text) | NP-AUD-2026-053-CONTRAST | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-UX-012 | The dedicated triage surface (why-now, due dates, invoice amounts, phone number, keyboard hints) is unreadable for low-vision users | NP-AUD-2026-053-CONTRAST | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-UX-013 | Core flows (text a customer in Focus, find an account, enable late fees, copy a webhook) fail accessible-name checks | NP-AUD-2026-053-LABELS | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-UX-014 | Vestibular users get an infinite sliding bar on every navigation | NP-AUD-2026-136-MOTION | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-UX-015 | AT users get a list of “Open {name}” links, not a table they can navigate by column (Heat, Total overdue, Oldest age) | NP-AUD-2026-136-TABLE | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-UX-016 | “Copied” and “12 selected” never reach AT | NP-AUD-2026-137-LIVE-REGIONS | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-UX-017 | Production users never see a stack (good) | NP-AUD-2026-X204 | not-a-defect |
| August wave | AUG20:wave-1:ops-a11y:TEMP-UX-018 | Last-contact timestamps (timestamptz) can flash the previous calendar day on hydrate for US users | NP-AUD-2026-114 | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-UX-019 | AT announces a tablist that does not implement the tabs pattern | NP-AUD-2026-136-TABS | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-UX-020 | Contradictory: hidden from AT but labeled | NP-AUD-2026-136-SCRIM | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-UX-021 | Screen-reader users hear a lie | NP-AUD-2026-101 | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-001 | `npx wrangler deploy --env production` as written points the Worker at a non-existent Supabase host (or a literal angle-bracket hostname) | NP-AUD-2026-008 | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-002 | The suite is large (`nudgepay-app/tests/` ~90 files) and is the only regression net for RLS, quiet hours, and QBO mappers | NP-AUD-2026-016-CI | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-003 | Fresh clone: `npm test` → npm error, not vitest | NP-AUD-2026-016-CI | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-004 | `publish: true` is the Cloudflare template-marketplace flag from the RR7 starter | NP-AUD-2026-132-STARTER | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-005 | Clickjacking the logged-in dashboard (collections PII + send buttons) is possible if a browser will frame the Worker | NP-AUD-2026-039 | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-006 | A silent CDC miss or digest skip is invisible | NP-AUD-2026-042 | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-007 | Intuit app-card Privacy / EULA URLs currently (or after a naive `netlify deploy`) 301 to a hostname that does not exist | NP-AUD-2026-009 | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-008 | Production QBO (sandbox=false) cannot be connected against Intuit’s production app until Redirect URI, Disconnect URL, Privacy, EULA, Launch URL, and webhook endpoint are real and matching | NP-AUD-2026-009 | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-009 | Operators following README install the wrong mental model (legacy packages, 24 migrations, a test script that 404s) | NP-AUD-2026-132-README | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-010 | Agents and humans following AGENTS.md stop reading at 0024 and miss 0025–0034 (company profile, templates, priority, workflow, digest, quiet hours, cleanup, security hardening, phone norm, OAuth state binding) | NP-AUD-2026-132-AGENTS | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-011 | Public GitHub + Intuit listing without a license is “all rights reserved” by default, which may be intended — but EULA (`eula.tsx`) grants a license the repo does not | NP-AUD-2026-133 | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-012 | `npx vitest run` on a fresh clone throws ENOENT before any test | NP-AUD-2026-016-TEST-ENV | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-013 | Anyone opening the app folder gets template docs, not NudgePay | NP-AUD-2026-132-README | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-014 | Intuit / Google / Slack unfurl of `/` and `/privacy` is a bare title “NudgePay” | NP-AUD-2026-131 | duplicate-merged |
| August wave | AUG20:wave-1:ops-a11y:TEMP-OPS-015 | `wrangler deploy` / npm metadata describe a generic starter, not an AR collections app | NP-AUD-2026-132-STARTER | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-001 | First connect never runs a full overdue sync | NP-AUD-2026-005 | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-002 | `qbo=` and `sync=` outcome params are never rendered | NP-AUD-2026-017 | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-003 | Dead QBO connection reports "Connected" forever | NP-AUD-2026-006 | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-004 | Reconnecting a different QuickBooks company merges two books | NP-AUD-2026-027 | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-005 | Query/CDC page cap 1000; `truncated` is computed and discarded | NP-AUD-2026-028 | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-006 | CDC watermark stamped with local time after fetch/processing | NP-AUD-2026-029 | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-007 | QBO deletions/voids are mishandled (clobber + retry storm) | NP-AUD-2026-030 | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-008 | QBO webhook applies entities inline before 200; no `waitUntil` | NP-AUD-2026-031 | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-009 | CloudEvents parser is still unverified; unknown payloads ack 200 and drop | NP-AUD-2026-054-PARSER | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-010 | CDC cron is one serial loop over all connected orgs | NP-AUD-2026-041 | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-011 | POST Disconnect has no confirmation | NP-AUD-2026-043 | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-012 | Manual Refresh does not re-pull paid invoices or payments | NP-AUD-2026-X205 | still-open |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-013 | Sync failures are invisible outside Settings → Integrations | NP-AUD-2026-023 | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-014 | `QBO_SANDBOX` defaults true unless the string is exactly `"false"` | NP-AUD-2026-X206 | still-open |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-015 | No 429 / backoff / retry on Intuit API calls | NP-AUD-2026-054-BACKOFF | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-016 | `invoices.status` goes stale when a due date passes with no QBO change | NP-AUD-2026-119 | duplicate-merged |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-017 | QBO entity ids interpolated raw into query strings | NP-AUD-2026-X207 | still-open |
| August wave | AUG20:wave-1:qbo:TEMP-QBO-018 | OAuth callback swallows all errors; consume is SELECT then DELETE | NP-AUD-2026-X208 | still-open |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-001 | Composite tenant FKs from 0032 are still NOT VALID | NP-AUD-2026-037 | duplicate-merged |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-002 | Member FOR ALL remains on audit and case tables after 0032 | NP-AUD-2026-036-LEDGER-RLS | duplicate-merged |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-003 | Invite bearer tokens are SELECT-visible to every member | NP-AUD-2026-036-INVITE-TOKEN | duplicate-merged |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-004 | Members can SELECT encrypted QBO OAuth tokens | NP-AUD-2026-036-QBO-TOKEN | duplicate-merged |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-005 | Service-role mutators omit `.eq("org_id")` on id-keyed writes | NP-AUD-2026-038-SERVICE-PIN | duplicate-merged |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-006 | `listOrgMembers` dumps the entire `auth.users` directory | NP-AUD-2026-038-ROSTER | duplicate-merged |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-007 | `sync_errors` member UPDATE is not column-constrained | NP-AUD-2026-X209 | still-open |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-008 | FORCE ROW LEVEL SECURITY is never set | NP-AUD-2026-X210 | still-open |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-009 | Owner/assignee columns are not membership-constrained | NP-AUD-2026-X211 | still-open |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-010 | Loaders/helpers that omit `.eq("org_id")` and rely on RLS or global uniqueness | NP-AUD-2026-X212 | still-open |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-011 | `email_config.from_address` is not globally unique | NP-AUD-2026-013 | duplicate-merged |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-012 | User-facing loaders mint service-role clients for RLS-readable rows | NP-AUD-2026-X213 | still-open |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-013 | Any member can trigger service-role QBO financial rewrite | NP-AUD-2026-X214 | still-open |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-014 | Onboarding action can create unbounded extra orgs | NP-AUD-2026-044 | duplicate-merged |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-015 | RLS / IDOR test coverage holes | NP-AUD-2026-X215 | still-open |
| August wave | AUG20:wave-1:rls-tenancy:TEMP-RLS-016 | `prevent_member_customer_source_edits` is the only member UPDATE column gate | NP-AUD-2026-X216 | still-open |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-001 | Owner hits Delete, sees “Templates updated.”, reloads, and the default slug is back | NP-AUD-2026-026 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-002 | Owner sets high-value to `$500` (browser allows it) | NP-AUD-2026-045-VALIDATION-RANGE | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-003 | Saving display name lights “Company profile saved.” Saving late fees lights Saved on priority + workflow too | NP-AUD-2026-115 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-004 | Editing company name / templates / thresholds then clicking another tab discards the form | NP-AUD-2026-116 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-005 | Saving rules looks like a no-op | NP-AUD-2026-115 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-006 | Screen readers get an unlabeled combo | NP-AUD-2026-053-LABELS | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-007 | Failed OAuth, forbidden member connect, and failed Refresh all look like the button did nothing | NP-AUD-2026-017 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-008 | One click locks the whole org out of Collections / Accounts / Promises / Messages until a full reconnect | NP-AUD-2026-043 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-009 | Unresolved QBO sync failures are invisible while working the queue | NP-AUD-2026-023 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-010 | Owners cannot add teammates from the product | NP-AUD-2026-018 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-011 | A member who tampers a form (or an owner who lost the role mid-session) gets bounced to the same tab with no explanation | NP-AUD-2026-X217 | still-open |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-012 | Owner can fire real SMS from the shared Twilio account to any number | NP-AUD-2026-052-TEST-SMS | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-013 | A `message_templates` read error (RLS, missing table, network) renders the factory defaults as if they were the org’s live templates | NP-AUD-2026-X218 | still-open |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-014 | Harmless today because the form only lives on the default Workspace tab | NP-AUD-2026-X219 | still-open |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-015 | A2P 10DLC / TCPA common-carrier rules expect STOP language on business SMS | NP-AUD-2026-121 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-016 | Gap < 5 or value > 200 fails with a silent redirect | NP-AUD-2026-X220 | still-open |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-017 | Toggling SMS Off is a high-stakes mute of all outbound text | NP-AUD-2026-X221 | still-open |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-018 | Members are told the feature is unfinished rather than owner-only | NP-AUD-2026-101 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-019 | Operators configuring Intuit must leave the app | NP-AUD-2026-X222 | still-open |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-020 | If insert fails after delete, the channel is empty | NP-AUD-2026-X223 | still-open |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-021 | Turning customer email off (or never configuring From) silently kills team alerts and the daily digest | NP-AUD-2026-049-CHANNEL-GATE | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-SET-022 | Owners ship `{custmer}` to real phones | NP-AUD-2026-117 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-UX-001 | The only control that looks like “account” immediately signs the user out | NP-AUD-2026-102 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-UX-002 | Phone-sized collectors cannot start Focus Mode | NP-AUD-2026-107 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-UX-003 | On a 375px phone the pane is wider than the viewport | NP-AUD-2026-110 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-UX-004 | Intuit app-card reviewers and net-new signups land on a single sentence | NP-AUD-2026-104-LANDING | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-UX-005 | Shipping this EULA to Intuit production / public signup while still calling it private beta is a legal mismatch (limitation of liability + positioning) | NP-AUD-2026-104-EULA | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-UX-006 | After QBO connect (especially with TEMP-SET-007’s silent outcomes) the empty queue blames the user for a filter they did not set | NP-AUD-2026-105 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-UX-007 | Owner sets 14 days, empty state still says 7 | NP-AUD-2026-111 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-UX-008 | Brand-new owner finishes onboarding and is dropped onto a bare Connect button | NP-AUD-2026-137-FIRST-RUN | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-UX-009 | Mobile users cannot see QBO health without opening Settings | NP-AUD-2026-023 | duplicate-merged |
| August wave | AUG20:wave-1:settings-ux:TEMP-UX-010 | Same as TEMP-SET-010 | NP-AUD-2026-018 | duplicate-merged |
| August wave | AUG20:wave-1:sms:TEMP-SMS-001 | All tenants share one operator-owned Twilio sender (B4) | NP-AUD-2026-012 | duplicate-merged |
| August wave | AUG20:wave-1:sms:TEMP-SMS-002 | Inbound SMS, including STOP, is silently dropped when unmatched (B5) | NP-AUD-2026-004 | duplicate-merged |
| August wave | AUG20:wave-1:sms:TEMP-SMS-003 | Consent has no provenance; STOP is one-click reversible (M23) | NP-AUD-2026-011 | duplicate-merged |
| August wave | AUG20:wave-1:sms:TEMP-SMS-004 | Default SMS templates have no STOP language; send path does not append it | NP-AUD-2026-121 | duplicate-merged |
| August wave | AUG20:wave-1:sms:TEMP-SMS-005 | HELP/INFO are not implemented; privacy policy claims they are | NP-AUD-2026-139 | duplicate-merged |
| August wave | AUG20:wave-1:sms:TEMP-SMS-006 | Last-10 phone matching drops international / `00xx` forms (0033) | NP-AUD-2026-140 | duplicate-merged |
| August wave | AUG20:wave-1:sms:TEMP-SMS-007 | Test SMS bypasses consent, quiet hours, workspace toggle, throttle, and ledger | NP-AUD-2026-052-TEST-SMS | duplicate-merged |
| August wave | AUG20:wave-1:sms:TEMP-SMS-008 | No rate limit, send-frequency cap, or send idempotency (M24 / minor 29) | NP-AUD-2026-035-SMS-RATE | duplicate-merged |
| August wave | AUG20:wave-1:sms:TEMP-SMS-009 | Quiet hours use org timezone, not the called party's (minor 28); test path skips them | NP-AUD-2026-122 | duplicate-merged |
| August wave | AUG20:wave-1:sms:TEMP-SMS-010 | Server and bulk evaluate consent before do-not-text; UI does the reverse | NP-AUD-2026-X224 | still-open |
| August wave | AUG20:wave-1:sms:TEMP-SMS-011 | STOP/START match the entire body only; no confirmation TwiML | NP-AUD-2026-X225 | still-open |
| August wave | AUG20:wave-1:sms:TEMP-SMS-012 | Bulk skip summary omits the do-not-text bucket | NP-AUD-2026-108 | duplicate-merged |
| August wave | AUG20:wave-1:sms:TEMP-SMS-013 | SMS ledger is member-writable; send-then-insert can orphan a live Twilio message | NP-AUD-2026-036-LEDGER-RLS, NP-AUD-2026-X226 | still-open |
| August wave | AUG20:wave-1:sms:TEMP-SMS-014 | Detail-panel consent toggle still requires an invoice | NP-AUD-2026-109 | duplicate-merged |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-TEST-001 | Production can ship with a red suite nobody runs | NP-AUD-2026-016-CI | duplicate-merged |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-TEST-002 | Unit tests are unusable in CI agents without Docker/Supabase; contributors skip the suite; coverage of pure modules silently bitrots | NP-AUD-2026-016-TEST-ENV | duplicate-merged |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-TEST-003 | Login cookie flow, CSRF Origin from real forms, Focus Mode send, QBO connect button, and unsubscribe confirm page are untested in a browser | NP-AUD-2026-X227 | still-open |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-TEST-004 | A multi-org collector can theoretically be protected only by untested action guards | NP-AUD-2026-X215 | still-open |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-TEST-005 | Duplicate or cross-origin collection texts are uncaught | NP-AUD-2026-035-SMS-RATE | duplicate-merged |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-TEST-006 | Login CSRF, duplicate-org onboarding, and invite accept mismatches can ship green | NP-AUD-2026-022-AUTH-CSRF, NP-AUD-2026-044, NP-AUD-2026-X228 | still-open |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-SEC-001 | Login CSRF: attacker’s site POSTs attacker credentials to `https://<nudgepay>/login`; victim’s browser stores the attacker session | NP-AUD-2026-022-AUTH-CSRF | duplicate-merged |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-SEC-002 | A stolen session or click-jacked authenticated POST (if Origin were bypassed) can flood customer phones/inboxes — TCPA + carrier filtering + Twilio/Resend bill | NP-AUD-2026-035-SMS-RATE, NP-AUD-2026-035-EMAIL-RATE | duplicate-merged |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-SEC-003 | A collector can mark a customer consented without written TCPA/A2P consent, then `/api/text/send` will send (`twilio-messaging.server.ts:116`) | NP-AUD-2026-052-CONSENT-TOGGLE | duplicate-merged |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-SEC-004 | Compromised owner session (or CSRF if Origin failed) sends unlogged SMS to arbitrary numbers — TCPA and no audit trail | NP-AUD-2026-052-TEST-SMS | duplicate-merged |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-SEC-005 | Split-brain tenant: QBO connected on org B while the dashboard shows org A; invoices never appear; support believes sync is broken | NP-AUD-2026-019 | duplicate-merged |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-SEC-006 | Every collector can trigger Intuit-rate-limited CDC-ish pulls; parallel clicks amplify; broken-promise emails duplicate if notify is not fully ledger-deduped on this path | NP-AUD-2026-X214, NP-AUD-2026-049-RETRY | still-open |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-SEC-007 | If a token leaks (email logs, Referer), a third-party site can POST unsubscribe | NP-AUD-2026-X229 | not-a-defect |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-SEC-008 | Junk presence rows; low PII risk because reads filter loader customer ids | NP-AUD-2026-X230 | still-open |
| August wave | AUG20:wave-1:tests-and-mutations:TEMP-TEST-007 | Sender-lock or callback `userId` mismatch could regress without CI signal (once CI exists) | NP-AUD-2026-016-CI | duplicate-merged |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-001 | QBO / sync result flags are never shown | NP-AUD-2026-017 | duplicate-merged |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-002 | OAuth callback never runs an initial QBO sync | NP-AUD-2026-005 | duplicate-merged |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-003 | Empty queue copy assumes a filter, not an empty workspace | NP-AUD-2026-105 | duplicate-merged |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-004 | Account profile Save preferences clears `do_not_email` | NP-AUD-2026-003 | duplicate-merged |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-006 | Messages inbox has no poll and no read state | NP-AUD-2026-047 | duplicate-merged |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-007 | No forgot-password / recovery path | NP-AUD-2026-001 | duplicate-merged |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-008 | Lockout / rate-limit is not distinguishable from a generic failure | NP-AUD-2026-X231 | still-open |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-009 | Collector send paths 500 when provider secrets are missing | NP-AUD-2026-X232 | still-open |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-010 | Queue loaders ignore PostgREST errors (empty looks like no work) | NP-AUD-2026-015 | duplicate-merged |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-011 | Comm prefs drawer cannot represent preferred channel = email | NP-AUD-2026-X233 | still-open |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-012 | Focus Mode skips collision / presence | NP-AUD-2026-025 | duplicate-merged |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-013 | Focus key `2` ignores SMS gates | NP-AUD-2026-X234 | still-open |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-014 | Invite flow is undiscoverable | NP-AUD-2026-018 | duplicate-merged |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-015 | Reports nav for members says “coming soon” | NP-AUD-2026-101 | duplicate-merged |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-016 | Production ErrorBoundary hides the failure | NP-AUD-2026-X235 | still-open |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-017 | QBO callback error redirects drop auth headers | NP-AUD-2026-X236 | still-open |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-018 | Promise cancel is missing from the Promises ledger | NP-AUD-2026-113 | duplicate-merged |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-019 | Non-owner settings POST is a silent no-op | NP-AUD-2026-X217 | still-open |
| August wave | AUG20:wave-2:workflow-static:TEMP-WF-020 | Unsubscribe POST failure (and Focus log errors) are silent / raw | NP-AUD-2026-X237, NP-AUD-2026-106 | still-open |
| August wave | AUG20:wave-3:security:TEMP-SEC-001 | Login and invite-accept can be framed (clickjacking) | NP-AUD-2026-039 | duplicate-merged |
| August wave | AUG20:wave-3:security:TEMP-SEC-002 | Login CSRF can bind a victim’s subsequent QBO connect / invite-accept / note-taking to the attacker’s tenant | NP-AUD-2026-022-AUTH-CSRF | duplicate-merged |
| August wave | AUG20:wave-3:security:TEMP-SEC-003 | Any XSS (TEMP-SEC-007, or a future app bug) can steal the session JWT from JavaScript and replay it against Supabase PostgREST (TEMP-SEC-008) and the Worker | NP-AUD-2026-021 | duplicate-merged |
| August wave | AUG20:wave-3:security:TEMP-SEC-004 | A stolen member session can blast TCPA/CASL traffic (SMS) and CAN-SPAM traffic (email) until Twilio/Resend bills or a carrier complaint lands | NP-AUD-2026-035-SMS-RATE, NP-AUD-2026-035-EMAIL-RATE | duplicate-merged |
| August wave | AUG20:wave-3:security:TEMP-SEC-005 | Status rewind can hide a failed SMS from collectors (compliance display) | NP-AUD-2026-X238 | still-open |
| August wave | AUG20:wave-3:security:TEMP-SEC-006 | Worker log leakage, a prototype-pollution RCE (TEMP-SEC-007), or a future unscoped `listUsers` change exposes **every** tenant’s email in the project, not just the caller’s org | NP-AUD-2026-038-ROSTER | duplicate-merged |
| August wave | AUG20:wave-3:security:TEMP-SEC-007 | Unpatched HIGH routing CVEs on the only public HTTP surface | NP-AUD-2026-040 | duplicate-merged |
| August wave | AUG20:wave-3:security:TEMP-SEC-008 | A member (or XSS-stolen session) can wipe call notes, SMS bodies, and (same class) collection cases / promises | NP-AUD-2026-036-LEDGER-RLS | duplicate-merged |
