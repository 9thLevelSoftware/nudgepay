# Public-GA release checklist

Verdict: **NO-GO**

A checkbox may be marked only with linked, redacted evidence for the exact candidate.

| Mandatory gate | Result | Evidence / blocker | Sign-off |
|---|---|---|---|
| No open release blockers | FAIL | `findings.json` contains open blocker rows | |
| No critical/high security findings | FAIL | High security/tenancy/runtime rows remain; deep scan blocked | Security: |
| Clean install and both builds | PASS (local) | `evidence/logs/build-and-test.md` | DevOps: |
| Full tests twice from reset state | FAIL | `.env.test` missing; zero tests collected twice | Engineering: |
| Empty database migration + effective RLS matrix | BLOCKED | Docker/local Supabase unavailable | Database: |
| Cloudflare staging deployment and rollback | BLOCKED | No staging account/config | DevOps: |
| Render staging deployment and rollback | BLOCKED | No staging service/config; free plan unsuitable | DevOps: |
| Authenticated browser W1-W12 | BLOCKED | No Supabase fixtures/session; in-app Browser unavailable | Product/QA: |
| WCAG 2.2 AA keyboard/screen-reader/reflow | BLOCKED | Public screenshots only; no NVDA or authenticated flows | Accessibility: |
| QBO Sandbox lifecycle | BLOCKED | No sandbox realms/credentials | Integrations: |
| Twilio/TCPA controlled delivery | BLOCKED | No owned destination/Messaging Service access | Legal/Integrations: |
| Resend/CAN-SPAM controlled delivery | BLOCKED | No verified domain/inboxes/provider access | Legal/Integrations: |
| Monitoring, alerts, logs, retention | FAIL/BLOCKED | No monitoring config or hosted verification | Operations: |
| Backup/restore and RPO/RTO | BLOCKED | No isolated database or restore evidence | Operations: |
| Failover, concurrency, load, and rollback | BLOCKED | No retained staging | Operations: |
| Production secrets, URLs, key rotation | FAIL/BLOCKED | Worker URL placeholder; secret state/key rotation unverified | Security/DevOps: |
| Deep Security Scan sealed artifacts | BLOCKED | Managed filesystem profile unavailable | Security: |
| Final release approver | NOT ELIGIBLE | Re-run all gates after remediation | Approver: |

## Binary decision rule

The verdict may change to **GO** only when every mandatory row is PASS for the same retained release candidate. Any BLOCKED row remains an automatic NO-GO.

