# NudgePay — Stakeholder Requirements Gap Checklist

**Created:** 2026-06-23
**Source:** Stakeholder requirements document (operational-loop / collections-workflow framing) reviewed against the build at `main` (schema `0001`–`0008`, `worklist.ts`, `contact-log.ts`, `qbo-sync.server.ts`, `qbo-mappers.server.ts`).
**Purpose:** Living tracker of what the document requires vs. what is built, so each open item can be planned and resolved. Check items as they ship.

## How to read this
- `[x]` = covered in the current build (do not re-plan).
- `[ ]` = open gap.
- **P0** = document's "directly resolves the documented pain." **P1** = throughput/consistency. **P2** = optimization (correctly deferred).
- Evidence column cites the file/column that establishes current state.

---

## Locked decisions
- [x] **A1 — Promote the customer account to the primary collections workspace** (customer-centric, not invoice-row-centric). *Accepted 2026-06-23.* Interactions and promises re-key to the customer/case; invoices display within the account. Owner is already customer-level (`customers.owner`, 0008), consistent with this.
- [x] **A2 — Adopt "next action" as an enforced system invariant.** ✅ **Decided + shipped in 6c (merged main `be0cd24`).** Every active case carries one of: scheduled follow-up, pending promise, waiting-with-review-date, exception (on_hold), or closed/paid — enforced by a required `nextStep` at log time + server guard.

---

## A. Architecture (gates most other work)

- [x] **A1-impl — Collection-case / customer workspace model.** ✅ **6a (merged main `1cb6c34`).** `collection_cases` groups a customer's invoices, carrying owner/status/next-action; SMS threads + interactions re-keyed to the case (`case_id` on text_messages/contact_logs); per-customer thread + case-anchored logging shipped.
- [x] **A2-impl — Next-action invariant + durable follow-up tasks.** ✅ **6a (durable state) + 6c (enforced invariant).** Next-action is a stored case record (`status`/`next_action_type`/`next_action_at`), auto-surfaced via the follow-ups-due view; 6c added the required-`nextStep` enforcement + the `waiting`/`on_hold` review-date states.

---

## B. P0 — operational loop core

- [x] **B1 — Promise-to-pay state machine.** ✅ **6b (merged main `9068680`).** `promises` table with `status` (pending/kept/partially_kept/broken/renegotiated/cancelled), `amount_received`, `grace_until`, `baseline_balance`, `created_by`, `replacement_promise_id`, + `promise_invoices` **multi-invoice** linkage. Auto-supersede (new → renegotiated) + manual cancel route. `contact_logs.promised_*` kept only as the log snapshot.
- [x] **B2 — Payment-validated broken-promise detection.** ✅ **6b.** Pure `evaluatePromises` (balance-delta: `received = baseline − current`); kept ≥ promised, partially_kept/broken past a **2-business-day weekend-skip grace** (`addBusinessDays`), pending before grace; `applyPromiseEvaluation` applier on all sync paths + cron. *Configurable grace + holiday calendar deferred to C7.*
- [x] **B3 — Payment & credit sync (+ fix staleness bug).** ✅ **6b.** `Payment`/`CreditMemo` synced via CDC + webhook (`mapQboPayment`, `payments` table); classification uses invoice balance-delta (no line attribution, per verified Intuit facts).
  - [x] **B3-bug — Periodic-sync staleness.** ✅ **6b.** On any payment/credit synced, re-pull ALL of that customer's invoices regardless of `Balance>0` (`repullCustomerInvoices`) → a paid invoice drops to balance 0 → case auto-resolves. Residual (payment >30d outside CDC AND no webhook ever) noted/accepted.
- [x] **B4 — Expand structured interaction outcomes.** ✅ **7a.** Manual outcomes now 10 (added payment-already-sent, requested-documentation, escalation-required, follow-up-requested); SMS outcomes (message-delivered, customer-replied, contact-invalid, message-sent) derived at read time from `text_messages` status/direction in `timeline.ts` (`deriveSmsOutcome`). One shared `OUTCOME_LABELS`. No migration (`outcome` is free text).
- [x] **B5 — Multi-factor + override-able priority.** ✅ **7b (merged main, PR #1).** `scorePriority` (`priority.ts`) weights age + balance + broken-promise + silence + follow-up-due into a numeric score → level thresholds; `priorAttempts` tiebreaker; manual pinned-level override (migration `0012`, `priority_override*` columns; `overrideToLevel`) shown transparently ("Pinned … · computed …") in the queue + "Why this priority" panel.
- [x] **B6 — Sync & error visibility.** ✅ **7c (merged main `a9aeff6`, PR #3).** Durable `sync_errors` table + RLS (migration `0013`); `recordSyncError` on failure / `resolveSyncErrors` on success across all three sync paths (manual refresh, webhook, cron — a successful sync auto-heals). Dashboard loader reads the unresolved count → header `SyncIssues` warning badge + detail panel with per-error **Dismiss** (org-scoped `api.sync-errors.dismiss` route). The `truncated` (>1000 invoices) flag stays a separate label, intentionally not recorded here.
- [x] **B7 — Channel-uniform activity timeline.** ✅ **7a.** Pure `buildTimeline` (`timeline.ts`) merges case-scoped `contact_logs` + `text_messages` into one chronological `TimelineEntry[]` (newest-first, discriminated union); the DetailPanel "Activity" tab became a read-only "Timeline" rendering it. Messages tab stays the live SMS console. Merge-at-read (no new table).

---

## C. P1 — throughput & consistency

- [x] **C1 — Collision / recent-contact warnings & presence.** ✅ **8b.** Recent-contact attribution (`contact_logs.user_id` + `text_messages.sent_by_user_id` → roster label) + poll-based live presence (`case_presence` table, migration `0014`; 20s heartbeat, 45s freshness). Pure `collision.ts` derivation (self-excluded; live > recent > none). Surfaced as a queue-row marker, a DetailPanel banner, a 20s `useRevalidator` poll, and a confirm-gate on SMS send + log-contact. Presence read degrades gracefully (documented RLS deviation).
- [x] **C2 — Exception / dispute workflow.** ✅ **8c.** `collection_cases.exception_reason` widened to the 9-value taxonomy (migration `0015`; the 8 — disputed/incorrect_amount/work_incomplete/documentation_requested/wrong_contact/payment_plan/legal_agency/do_not_contact — plus retained `other`). Pure `exceptions.ts` owns the per-state policy: terminal = `legal_agency`/`do_not_contact` (indefinite hold, no auto-resurface, **block outbound SMS**); the rest review-dated. Parked cases (`isCaseSuppressed`) drop out of the default/never-contacted/30+/high-value/broken-promises views + active metrics into an `onHold` bucket / Exceptions ("waiting") view, and resurface when `next_action_at ≤ today`. Conditional review-date at log time (`requiresReviewDate`); terminal states leave `next_action_at` null. `do_not_contact`/`legal_agency` hard-block individual send (`sendInvoiceText` throws before Twilio) **and** bulk SMS (`partitionEligibility` skips, reason `do-not-contact`). Surfaced via the drawer reason picker, DetailPanel parked banner + disabled "Messaging blocked" composer, and a queue exception badge + On-hold tile.
- [ ] **C3 — Email & click-to-call channels.** Add click-to-call; add an email composer (or clearly mark email as log-only so the UI doesn't imply capture we lack). SMS two-way is done.
- [ ] **C4 — Suggested follow-up dates.** Suggest a cadence-based next date instead of manual-only `follow_up_at`.
- [x] **C5 — Bulk assignment & batch messaging.** ✅ **8a.** Queue multi-select (checkbox + "select all matching", `MAX_BATCH=50`); bulk owner reassign (`api.bulk-assign`, org+membership guarded single UPDATE); batch templated SMS (`api.bulk-sms` → `runBulkSms`: org-scoped load, eligibility partition, sequential per-case send recording each `text_messages` row). Pure `bulk.ts` for eligibility + per-case rendering.
- [ ] **C6 — Communication preferences.** Beyond `sms_consent` + STOP handling: preferred channel/contact, per-channel preference.
- [ ] **C7 — Configurable grace periods / business days.** Prerequisite for B2 and the weekend/holiday promise scenario. Currently absent.
- [ ] **C8 — Team performance / workload reporting.** Per-employee throughput, collection rate by aging bucket, promise-kept rate, time-to-first-contact, adoption metrics. Reporting layer essentially unbuilt today (only org-wide KPI counts + my-work count).

---

## D. Covered — do not re-plan
- [x] QBO OAuth + token refresh + **idempotent** sync (upsert `onConflict org_id,qbo_id`); webhook + CDC catch-up (0004/0005).
- [x] Multi-tenant isolation via RLS (`is_org_member`); user-client reads/writes; service client only for connection status + member roster.
- [x] Prioritized, filterable, sortable work queue + 7 saved views.
- [x] Two-way SMS with delivery status + error codes; opt-out (STOP) handling; inbound threading (0006).
- [x] Contact logging (outcome + notes + follow-up date); SMS templates (5c).
- [x] Ownership & assignment + "My work" (5d); owner is customer-level.
- [x] Explainable priority *reasons* (factor breadth tracked under B5).

## E. P2 — correctly deferred (no action)
- [ ] Automated outreach sequences · predictive payment scoring · AI summaries/message generation · sentiment · voice/transcription · advanced segmentation · benchmarking/forecasting. *Follow the reliable core per the document.*

## F. High-risk scenarios currently untestable (unblock as B1–B3, C2, C7 land)
- [ ] Five invoices / one payment
- [ ] Promise < total balance
- [ ] Promise date on weekend/holiday
- [ ] Partial payment before promise date
- [ ] Payment after a follow-up was created
- [ ] Void/credit in QBO (see B3-bug)
- [ ] Dispute of one of several invoices
- [ ] SMS undeliverable / opt-out mid-thread (opt-out handled; mid-thread state not surfaced)
- [ ] Two employees open the same customer simultaneously (maps to C1)

---

## G. Connections & Settings — in-UI onboarding (post-loop phase)

**Credential architecture (decided 2026-06-23):** two distinct credential tiers.
- **Platform/app identity** (`QBO_CLIENT_ID`/`QBO_CLIENT_SECRET`/`QBO_REDIRECT_URI`/webhook verifier; `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`) — ONE set for all of NudgePay; stays a **deploy-time secret**. Never exposed in any tenant UI (exposing the app's client secret/auth token would let a tenant impersonate NudgePay platform-wide). Operator sets these once per deployment.
- **Tenant connection** — fully in-UI, credential-free for stakeholders.

- [ ] **G1 — In-UI "Connect QuickBooks" CTA + connection management.** OAuth handshake routes exist (`api.qbo.connect`, `auth.qbo.callback`) but the in-UI entry point is thin/absent (only a status dot, `AppShell.tsx:99`). Add a real Connect / disconnect / reconnect surface. *Stakeholder types nothing — OAuth only.*
- [ ] **G2 — SMS sender / A2P status surface.** `messaging_config` (per-org `messaging_service_sid`/`sender`) is read (`twilio-messaging.server.ts:21`) but **never written** by app code — set manually today. **Twilio model = platform-owned + provisioned (decided):** NudgePay owns the Twilio account; each tenant gets a provisioned number; UI shows sender + A2P + consent status read-only. No tenant credential entry.
- [ ] **G3 — Sync status & error visibility in Settings.** Surface last-sync, sync errors (see B6), and connection health. (Overlaps B6.)
- Maps to the document's onboarding requirement: "connect QuickBooks and reach a populated work queue without building workflows."

---

## Proposed phase grouping (for planning)
1. **Phase 6 — operational loop (P0 core)** — decomposed into three sub-phases, built in order (decided 2026-06-23):
   - **6a — Case foundation:** ✅ **DONE (merged to main `1cb6c34`, 2026-06-23; 151/151 green, live-verified).** `collection_cases` table + RLS, auto open/close lifecycle (pure `reconcileCases` + applier on all 3 sync paths), worklist refactor to case-centric queue (`cases.ts`), `case_id` on contact_logs/text_messages, per-customer SMS thread, case-anchored contact logging with durable next-action write (New→Working). (A1-impl delivered; A2 schema scaffolded — hard-invariant forced UX is 6c.)
     - **~~New finding (Minor, cross-cutting tidy):~~ ✅ RESOLVED (pre-6b, merged main `8e19195`).** Date display off-by-one in negative-UTC timezones — fixed by a single timezone-safe `formatDate` (`app/lib/dates.ts`) that builds date-only strings as local calendar dates while still localizing real timestamps; replaced `formatDateTime`/`formatDueDate`/`fmtDate`. +4 tests.
     - **~~6a deferred Minors (tidy/6b):~~ ✅ SWEPT (merged main `d3e69af`).** Unused `beforeAll` import removed; `fd()` extracted to `tests/fd.ts`; `ContactLogRow` trimmed to selected columns; `data-label` corrected "Next action" → "Status". **6b carry-ins:** ✅ last-contact now keyed by `case_id` (merged logs + texts); ✅ `promise`/`brokenPromise`/`promiseStatus` populated (broken-promises view live).
   - **6b — Promise + payment loop:** ✅ **DONE (merged main `9068680`, 2026-06-23; 178/178 green, final review Approved-after-fixes).** `promises`(+`promise_invoices`), `payments`, Payment/CreditMemo sync (CDC+webhook), webhook CloudEvents dual-format parser, B3-bug re-pull, balance-delta evaluation (B1, B3, B2). *Not yet live-Chrome-verified.*
   - **6c — Hard invariant + minimal exceptions:** ✅ **DONE (merged main `be0cd24`, 2026-06-23; 190/190 green, final review READY TO MERGE).** Required `nextStep` at log time + server guard (forced next-step UX); `waiting`/`on_hold` states with `next_action_at` as the review date (free suppression/resurface); minimal exception placeholder (`exception_reason` enum + note, 0011); deferring cancels a pending promise (A2 / A2-impl). *Not yet live-Chrome-verified. PHASE 6 (operational loop) COMPLETE.*
   - *Locked cross-cutting decisions:* hard next-action invariant; auto open/close; minimal exception placeholder; promise matching = invoice balance-delta.
2. **Phase 7 — fidelity (P0 finish):** ✅ **COMPLETE.** B4/B7 (7a), B5 (7b, PR #1), B6 (7c, PR #3). All P0 work now shipped.
3. **Phase 8 — throughput (P1):** C1, C2, C5, C4, C7, C8, C6, C3.
4. **Phase 9 — Connections & Settings (in-UI onboarding):** G1, G2, G3. *Sequenced after the loop (decided 2026-06-23).*
5. **Pull forward anytime:** B3-bug (live data-integrity issue) — folded into 6b.

### Intuit/QBO API facts verified against developer.intuit.com (2026-06-23)
- **CDC** supports all entities except JournalCode/TaxAgency/TimeActivity/TaxCode/TaxRate → Invoice, Payment, CreditMemo, Customer all covered. 30-day lookback; **max 1,000 objects per response, shared across the requested entity list**.
- **Webhook signature** = HMAC-SHA256 with the app verifier token, `intuit-signature` header — matches our `qbo-webhook.server.ts` impl.
- **Webhook payload format** — ✅ **6b shipped a dual-format `parseQboWebhook`** (legacy `eventNotifications[]` + CloudEvents `qbo.<entity>.<event>.v1`/`intuitentityid`/`intuitaccountid`), detected by payload shape; both kept during transition. **⚠️ Remaining pre-prod gate (NOT a merge gate):** confirm exact CloudEvents field casing/nesting against a real Intuit sandbox payload before production cutover (legacy remains the active path until then).
- **Balance-delta validated:** both cash Payments and CreditMemos reduce Invoice `Balance` (already synced), so kept/broken evaluation needs only invoice balances + payment date — no payment→invoice line attribution required.
