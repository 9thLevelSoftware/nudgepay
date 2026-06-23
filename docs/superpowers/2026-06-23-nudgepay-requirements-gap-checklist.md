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
- [ ] **A2 — Adopt "next action" as an enforced system invariant** (decision pending — take into brainstorming). Every active case must carry one of: scheduled follow-up, pending promise, waiting-with-review-date, exception, or closed/paid.

---

## A. Architecture (gates most other work)

- [ ] **A1-impl — Collection-case / customer workspace model.** Introduce a customer-level case grouping its invoices, carrying owner, status, next-action, escalation level, last meaningful outcome. Re-key SMS threads and interactions off per-invoice (`text_messages.invoice_id`) to the customer/case. *Decision A1 accepted; implementation open.*
  - Current state: `WorkItem` is one-per-invoice (`worklist.ts:11`); status/next-action/priority derived per-invoice, not stored; SMS threads keyed per-invoice (5c design). Document §1/§2 flags the per-invoice conversation model as a defect.
- [ ] **A2-impl — Next-action invariant + durable follow-up tasks.** Replace the derived `nextActionOf()` label (`worklist.ts:76`) with a real task/state record; auto-surface due actions in a queue; add a "waiting / review-date" status.
  - Document calls this its single most important principle.

---

## B. P0 — operational loop core

- [ ] **B1 — Promise-to-pay state machine.** Add a `promise` entity with `status` (Pending / Kept / Partially Kept / Broken / Renegotiated / Cancelled), `amount_received`, `grace_period`, `created_by`, `replacement_promise_id`, and **multi-invoice** linkage.
  - Current: 2 nullable columns on `contact_logs` (`promised_amount`, `promised_date`, 0007); single-invoice only.
- [ ] **B2 — Payment-validated broken-promise detection.** Mark broken only after grace period **unless** qualifying payment detected; weekend/holiday-aware.
  - Current: `isBrokenPromise()` = `promise.date < today` (`worklist.ts:146`), payment-blind, no grace period.
- [ ] **B3 — Payment & credit sync (+ fix staleness bug).** Sync `Payment` / `CreditMemo` entities; model partial/grouped payments and credits; match payments to promises and invoices.
  - Current: only `Invoice where Balance > 0 and DueDate < today` is synced (`qbo-sync.server.ts:58`); no payment/credit entities (grep-confirmed).
  - [ ] **B3-bug — Periodic-sync staleness (live correctness issue):** an invoice paid/voided outside the CDC window is never re-pulled by the `Balance>0` periodic sync, so it can linger as "overdue." Pull forward regardless of roadmap.
- [ ] **B4 — Expand structured interaction outcomes.** Add message-delivered, customer-replied, payment-already-sent, requested-documentation, contact-invalid, escalation-required, follow-up-requested; emit a structured outcome from SMS sends too.
  - Current: 6 outcomes (`contact-log.ts:6`), manual logs only.
- [ ] **B5 — Multi-factor + override-able priority.** Feed balance, broken promises, time-since-last-contact, prior attempts, and follow-up-due into the score; add a manual override that leaves financial data untouched.
  - Current: age-only buckets + `neverContacted` boost (`worklist.ts:66`); explainable *reason* exists but factors are narrow; no override.
- [ ] **B6 — Sync & error visibility.** Surface failed-sync state and an "unresolved sync errors" count.
  - Current: connection status + "Synced Xm ago" label + `truncated` flag only (`dashboard.tsx:179`).
- [ ] **B7 — Channel-uniform activity timeline.** Unify `contact_logs` (manual) and `text_messages` (SMS) into one standardized chronological interaction stream per customer/case. (Couples with A1/B4.)

---

## C. P1 — throughput & consistency

- [ ] **C1 — Collision / recent-contact warnings & presence.** Warn when a teammate recently contacted or is actively working the same customer.
- [ ] **C2 — Exception / dispute workflow.** Promote `dispute` from an outcome string to a case **state** (disputed, incorrect-amount, work-incomplete, documentation-requested, wrong-contact, payment-plan, legal/agency, do-not-contact) that suppresses generic reminders.
- [ ] **C3 — Email & click-to-call channels.** Add click-to-call; add an email composer (or clearly mark email as log-only so the UI doesn't imply capture we lack). SMS two-way is done.
- [ ] **C4 — Suggested follow-up dates.** Suggest a cadence-based next date instead of manual-only `follow_up_at`.
- [ ] **C5 — Bulk assignment & batch messaging.** Assign multiple accounts and send templated SMS in batch (the "50+ invoices" pain). Current: one-at-a-time (`api.assign.tsx`, single send).
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

## Proposed phase grouping (for planning)
1. **Brainstorm A2** (A1 accepted) — then scope Phase 6.
2. **Phase 6 — operational loop (P0 core):** A1-impl → A2-impl → B1 → B3 → B2. One tightly-coupled arc.
3. **Phase 7 — fidelity (P0 finish):** B4/B7, B5, B6.
4. **Phase 8 — throughput (P1):** C1, C2, C5, C4, C7, C8, C6, C3.
5. **Pull forward anytime:** B3-bug (live data-integrity issue).
