# Workflow matrix (Wave 2)

Method: static walk of loaders/actions/components at HEAD `820fb1ba`. **Authenticated browser e2e was not run** (no Docker, no `.env.test`, no local Supabase). Public Netlify URLs were hit.

Result: `pass` = code path exists and matches the expected contract · `fail` = defect with NP ID · `not-tested` = needs a live env.

Source detail: `wave-2/workflow-static.md`.

## W1 First-run

| Step | Result | ID |
|---|---|---|
| GET `/` marketing + privacy/eula links | pass (thin copy) | NP-2026-104 |
| Signup confirm-on vs session | pass (outcome helper) | NP-2026-002 (confirm landing missing) |
| Onboarding create org | fail (replay orphans) | NP-2026-044 |
| Land Integrations, no welcome | fail | NP-2026-137 |
| QBO callback auto-sync | fail | NP-2026-005 |
| Render `?qbo=` | fail | NP-2026-017 |
| Empty queue copy | fail | NP-2026-105 |
| Invite from Settings | fail (unlinked, no email) | NP-2026-018 |
| Live sandbox connect | **not-tested** | — |

## W2 Daily collector `/dashboard`

| Step | Result | ID |
|---|---|---|
| All 10 ViewId + 4 sorts registered | pass (code) | — |
| Keyboard j/k/x ignore inputs/dialogs | pass | — |
| Log contact methods/outcomes/next steps | pass (call/text/note only) | NP-2026-138 |
| SMS/email server gates | pass (outbound) | — |
| Email updates last-contact | fail | NP-2026-024 |
| CommPrefsDrawer includes `do_not_email` | pass | — |
| Collision on dashboard | pass | — |
| Assign / priority override | pass (org-pinned) | — |
| Loader error honesty | fail | NP-2026-015 |
| Live data / Twilio send | **not-tested** | — |

## W3 Focus

| Step | Result | ID |
|---|---|---|
| Keys 1/2/3/space | pass | — |
| Same `/api/text/send` gates | pass | — |
| Presence/collision | fail | NP-2026-025 |
| Hidden below `sm` | fail | NP-2026-107 |
| Raw error toasts | fail | NP-2026-106 |
| Waiting/promised in deck; snooze as contact | fail | NP-2026-143 |
| Terminal DNC blocks log-call | fail | NP-2026-144 |

## W4 Promises

| Step | Result | ID |
|---|---|---|
| Create via contact log | pass | — |
| Cancel API | pass (dashboard) | — |
| Cancel on `/promises` page | fail | NP-2026-113 |
| Payment-validated evaluate | pass (balance-delta) | NP-2026-046 (float / credits) |
| Broken-promise email | pass if email env + channel on | NP-2026-049 |
| Live QBO payment | **not-tested** | — |

## W5 Messages

| Step | Result | ID |
|---|---|---|
| Unified SMS+email threads | pass (code) | — |
| Poll while open | fail | NP-2026-047 |
| Read/unread | fail | NP-2026-047 |
| Inbox consent posts customerId | pass | NP-2026-109 (DetailPanel still broken) |

## W6 Bulk

| Step | Result | ID |
|---|---|---|
| Bulk assign org-pinned | pass | — |
| Bulk SMS review + server re-check | pass | — |
| Skip summary omits do-not-text | fail | NP-2026-108 |
| Per-case errors swallowed | fail | NP-2026-123 |

## W7 Accounts

| Step | Result | ID |
|---|---|---|
| Directory of synced customers | pass with wrong tile copy | NP-2026-051 |
| Save prefs wipes `do_not_email` | **fail (blocker)** | NP-2026-003 |
| Notes NudgePay-only | pass | — |
| Member cannot edit QBO source fields | pass (0032 trigger) | NP-2026-127 (dev-data) |

## W8 Settings

| Intent | Owner write | Member no-op | Notes |
|---|---|---|---|
| save_company_profile | yes | redirect | |
| save_channels | yes | redirect | |
| save_sms_sender | locked for everyone | — | NP-2026-142 |
| save_quiet_hours | yes | redirect | |
| save_rules | yes | redirect | flash NP-2026-115 |
| add/remove_holiday | yes | redirect | |
| save_late_fees | yes | redirect | |
| save_priority_thresholds | yes | redirect | NP-2026-045 |
| save_workflow | yes | redirect | |
| save_email | yes | redirect | NP-2026-033 |
| save_template / delete / reset | yes | redirect | NP-2026-026 |
| Dirty tab switch | fail | | NP-2026-116 |
| Live save against DB | **not-tested** | | |

## W9 Reports

| Step | Result | ID |
|---|---|---|
| Owner 7/30/90 | pass (code) | — |
| Member redirect `denied=reports` | pass | — |
| Nav “coming soon” for members | fail | NP-2026-101 |
| CSV | fail | NP-2026-048 |

## W10 Public / legal

| Step | Result | ID |
|---|---|---|
| Worker `/privacy` `/eula` implemented | pass | NP-2026-104 (beta), NP-2026-141 (Resend) |
| Netlify `/privacy` `/eula` | **fail live 404** | NP-2026-009 |
| Unsubscribe GET no mutate / POST mutates | pass (tests exist) | — |
| GET `/api/qbo/disconnect` does not clear tokens | pass | — |

## W11 Auth lockouts

| Step | Result | ID |
|---|---|---|
| Forgot password | fail | NP-2026-001 |
| Confirm landing | fail | NP-2026-002 |
| Avatar instant logout | fail | NP-2026-102 |
| Invite expired/wrong-user screens | pass (code) | — |

## W12 Failure honesty

| Step | Result | ID |
|---|---|---|
| PostgREST error → empty $0 | fail | NP-2026-015 |
| Missing Twilio env on send | fail (500, not 4xx) | wave-2 TEMP-WF-009 |
| Email env missing on alerts | pass (degrade) | — |
| Sync errors in chrome | fail | NP-2026-023 |
