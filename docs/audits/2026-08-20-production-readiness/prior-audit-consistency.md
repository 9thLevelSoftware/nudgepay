# Prior-audit corpus reconciliation

Status: complete (audit-only). Sources inspected: `docs/codebase-audit-2026-07-13.md` and all 24 files under `docs/production-audit-2026-08-20/`.

The machine-readable registry is [prior-corpus-registry.json](evidence/logs/prior-corpus-registry.json). It parses as JSON and contains 398 entries:

- 107 July entries: B0–B11, M1–M34, and minor 1–61. Dispositions reconcile to 104 `still-open`, 3 `partial`, 0 `fixed`.
- 99 August canonical entries: NP-2026-001–054 and NP-2026-101–145. Canonical card counts are 16 blockers, 38 majors, and 45 minors.
- 192 temporary wave cards. Temporary IDs are namespaced with their source path, so duplicate labels remain distinct.

The registry also has an `embeddedMentionIndex` for findings cited only in workflow, security, UX, ops, test, and raw-wave prose/matrices; those mentions resolve back to canonical, July, or source-file-namespaced temporary entries.

## Collisions and gaps

`TEMP-SEC-001` through `TEMP-SEC-008` occur independently in `wave-1/tests-and-mutations.md` and `wave-3/security.md`. A bare temporary ID is therefore not unique; the registry keys them as `<source path>::TEMP-SEC-NNN`. The same namespacing rule applies to every temporary card.

The temporary sequence has two actual missing cards: `TEMP-CASE-011` (cases queue sequence jumps 010 → 012) and `TEMP-WF-005` (workflow sequence jumps 004 → 006). No other numbered temporary gap was found in the 192 headings. The canonical catalog intentionally jumps from NP-2026-054 to NP-2026-101; NP-2026-055–100 are absent and should not be silently treated as cards.

## Bundles and count reconciliation

The executive 16 blocker / 42 major / 58 minor / 116 total numbers are de-duplicated finding counts, not a count of canonical headings. The registry finds 99 canonical headings (16 / 38 / 45), a difference of 17. Bundled or multi-source cards include:

- NP-2026-007: B1+B2
- NP-2026-016: M27+M29
- NP-2026-033: minor 32 plus new
- NP-2026-035: M24 + minor 29
- NP-2026-045: minor 17+34
- NP-2026-046: minor 33+37
- NP-2026-047: M14+M15
- NP-2026-048: M12+M13
- NP-2026-049: minor 31+53
- NP-2026-053: M32–M34
- NP-2026-054: minor 21+25

Other cards combine a prior finding with a new promotion/extension, notably NP-2026-036 (M25 plus new) and NP-2026-052 (minor 38 plus a new consent/test-SMS concern). Counting headings without expanding these aliases undercounts the executive catalog.

Severity drift is explicit: M1, M4, M6, M23, M27, and M29 are July majors represented by August blocker cards; M25 remains a partial major in NP-2026-036. Conversely, several July minors are represented by August major cards (for example minor 17/34 → NP-2026-045 and minor 32 → NP-2026-033). The registry preserves the source severity and the August severity separately.

## Current atomic severity adjudication

The release-candidate ledger uses `critical/high/medium/low/informational` rather
than copying either prior scale. Decisions that had drifted across the corpus are:

| Concern | Current decision | Reason |
|---|---|---|
| STOP recognition, persistence, and terminal DNC enforcement | High / blocker | A failure can produce unauthorized customer communication and a direct legal/compliance exposure. |
| HELP/INFO response content | High / blocker | Required sender/support/opt-out information is part of the controlled messaging compliance gate. |
| Phone normalization and collision-safe tenant attribution | High / blocker | Ambiguous attribution can mutate or message the wrong tenant/customer. |
| Recipient-timezone quiet hours | High / blocker | Server-time enforcement can send outside the recipient's permitted window. |
| Privacy disclosure for Resend/inbound processing/retention | High / blocker | Public GA cannot proceed with a known material subprocessor and data-use disclosure gap. |
| CI and fresh-clone test environment | High / blocker | The exact candidate cannot demonstrate a repeatable release gate; both Vitest attempts collected zero tests. |
| Root license and dependency-license policy | Medium / conditional | Distribution and supply-chain policy must be resolved, but it is not independently treated as an exploit or customer-data breach. |
| First-run welcome/guidance | Low / non-blocking | This is a discoverability/activation defect; separate onboarding, QBO first-sync, and auth lifecycle failures retain blocker status. |

Bundled August headings were split whenever root cause, owner, or closure evidence
differs. The atomic ledger includes separate postal/unsubscribe, SMS/email rate,
invite-token/QBO-token/ledger-RLS, contrast/labels, table/motion/scrim/tabs, and
live-region/notification/first-run records. Narrow workflow cards remain aliases
where they exercise the same underlying defect.

Concerns remaining for follow-up: fill or formally retire the two missing temporary sequence cards; document why canonical IDs 055–100 are reserved; and keep using namespaced temporary IDs in future matrices so the two TEMP-SEC series cannot collide.
