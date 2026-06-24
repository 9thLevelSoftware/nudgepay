# NudgePay Phase 7a — Structured Outcomes + Unified Timeline (Design Spec)

**Date:** 2026-06-23
**Status:** Approved (design); pending spec review → writing-plans.
**Scope:** Gap items **B4** (expand structured interaction outcomes) + **B7** (channel-uniform activity timeline). First of three Phase 7 sub-phases (7a outcomes+timeline · 7b multi-factor priority · 7c sync visibility), mirroring the 6a/6b/6c decomposition.

---

## 1. Goal

Today a case's interaction history is split across two DetailPanel tabs — **Activity** (manual `contact_logs`, read-only) and **Messages** (SMS `text_messages`, the live console) — and the manual outcome vocabulary is only 6 values. Phase 7a (a) expands the outcome vocabulary so a logged contact captures what actually happened, and (b) merges manual logs + SMS into **one read-only chronological per-case Timeline**, while keeping the Messages tab as the live two-way SMS console.

## 2. Architecture

Work with the codebase grain: a small **pure module** plus thin loader/markup wiring. No new table, no migration, no new write path.

- **New pure module `app/lib/timeline.ts`** (no I/O, no `node:*`, no `.server` suffix — imported by the loader and by tests). It owns the unification: types, the SMS-outcome derivation, and the merge/sort.
- **Loader** (`routes/dashboard.tsx`) already fetches case-scoped `contact_logs`. It will additionally select `case_id` on the (already-issued) message query, filter those messages to the selected case, and call `buildTimeline(logs, smsForCase)` → `selectedTimeline`. The Messages console keeps its **customer-scoped** message query untouched.
- **DetailPanel** renders `selectedTimeline` in the repurposed **Timeline** tab.

**Rejected alternatives** (from brainstorming):
- *Unified `interactions` table* — new table + dual-write on the SMS path + backfill + new RLS. Cleaner single source long-term, but a much larger surface for a stream the read-merge already produces. YAGNI now.
- *Postgres UNION view* — pushes display logic into SQL, harder to unit-test, awkward typing/pagination.
- *All-manual outcomes* / *all-manual + SMS writes outcome rows* — make reps re-log what SMS status already proves, and/or duplicate SMS into a second store.

## 3. Locked decisions (from brainstorming)

1. **Timeline + keep the SMS console.** Repurpose the read-only **Activity** tab into a unified **Timeline** (manual logs + SMS, both directions, newest-first). **Messages** stays the live SMS console (composer, templates, consent). SMS therefore appears in both — Timeline = the full story, Messages = the live conversation.
2. **Outcome model = manual + derived split.** The rep dropdown gains the human-judgment outcomes; the SMS-knowable outcomes are **derived at read time** from `text_messages.status`/`direction` — no redundant data entry, no extra writes.
3. **Merge-at-read via a pure merger.** `lib/timeline.ts` produces the unified `TimelineEntry[]`. Zero schema change (`contact_logs.outcome` is free `text`).

## 4. B4 — Outcome vocabulary

### 4.1 Manual outcomes (rep-selectable)
Expand `CONTACT_OUTCOMES` in `app/lib/contact-log.ts` from 6 to 10 by appending:
`payment-already-sent`, `requested-documentation`, `escalation-required`, `follow-up-requested`.

Full manual set (order preserved, new ones appended):
```
promise-to-pay, dispute, no-commitment, left-voicemail, no-answer, other,
payment-already-sent, requested-documentation, escalation-required, follow-up-requested
```
`contact_logs.outcome` is a free `text` column (migration `0001`, no CHECK) — **no migration required**. The `LogContactDrawer.tsx` outcome `<select>` gains the 4 new `<option>`s.

### 4.2 Derived SMS outcomes (never written)
Defined in `timeline.ts`, computed from a message row; not part of `CONTACT_OUTCOMES`:
```
customer-replied      ← direction = inbound
message-delivered     ← direction = outbound AND status = delivered
contact-invalid       ← direction = outbound AND status ∈ { failed, undelivered }
message-sent          ← otherwise (outbound queued/sent/accepted/sending/unknown)
```
`deriveSmsOutcome(direction, status, errorCode)` is pure and total (never throws; unknown status → `message-sent`).

### 4.3 Shared display labels
A single `OUTCOME_LABELS: Record<string, string>` of **static literal strings** centralizes display copy for **all** outcomes (manual + derived). It replaces the DetailPanel-local `OUTCOME_TEXT` and is consumed by both the Timeline and (for the manual subset) the log drawer. Labels:
```
promise-to-pay → "Promise to pay"          dispute → "Dispute"
no-commitment → "No commitment"            left-voicemail → "Left voicemail"
no-answer → "No answer"                    other → "Logged"
payment-already-sent → "Payment already sent"
requested-documentation → "Requested documentation"
escalation-required → "Escalation required"
follow-up-requested → "Follow-up requested"
message-sent → "Text sent"                 message-delivered → "Text delivered"
customer-replied → "Customer replied"      contact-invalid → "Text failed"
```
Location: `OUTCOME_LABELS` lives in `timeline.ts` (it must cover derived outcomes, which `contact-log.ts` does not know about); `contact-log.ts` remains the source of the manual `CONTACT_OUTCOMES` tuple. The label map keys are a superset of the manual tuple.

## 5. B7 — The unified timeline

### 5.1 Types (`timeline.ts`)
```ts
export type TimelineLogInput = {
  id: string; at: string; method: string; outcome: string | null;
  notes: string | null; followUpAt: string | null;
  promisedAmount: number | null; promisedDate: string | null;
};
export type TimelineSmsInput = {
  id: string; at: string; direction: string;       // "outbound" | "inbound"
  body: string | null; status: string | null; errorCode: string | null;
};
export type TimelineEntry =
  | { kind: "log"; id: string; at: string; method: string;
      outcome: string | null; outcomeLabel: string | null; notes: string | null;
      followUpAt: string | null; promisedAmount: number | null; promisedDate: string | null }
  | { kind: "sms"; id: string; at: string; direction: string;
      body: string | null; status: string | null; errorCode: string | null;
      outcome: string; outcomeLabel: string };
```

### 5.2 Merge function
```ts
export function buildTimeline(
  logs: TimelineLogInput[],
  smsMessages: TimelineSmsInput[],
): TimelineEntry[]
```
- Maps each `log` → `{ kind: "log", … , outcomeLabel: OUTCOME_LABELS[outcome] ?? null }`.
- Maps each `sms` → derive outcome via `deriveSmsOutcome`, set `outcomeLabel`.
- Concatenate, sort **descending by timestamp** — compare `Date.parse(at)` (epoch ms), not raw strings, so differing ISO formats can't misorder. Sort is **stable** for equal timestamps (preserve input order; logs passed before SMS). `Date.parse` is pure and allowed in this module (the no-`node:*`/no-I/O rule still holds).
- Inputs are already case-scoped by the caller; the function does no filtering.
- Empty inputs → `[]`. Pure, total, no throws.

### 5.3 Loader wiring (`routes/dashboard.tsx`)
- Keep the existing case-scoped `contact_logs` select (it already provides the `TimelineLogInput` fields).
- Add `case_id` to the existing `text_messages` select; build `smsForCase = msgRows.filter(m => m.case_id === sel.caseId)` and map to `TimelineSmsInput`.
- `const selectedTimeline = buildTimeline(logInputs, smsForCase)`.
- Export `selectedTimeline` from the loader; pass it to `DetailPanel`. `selectedActivity` is removed (superseded); `selectedMessages` (customer-scoped) stays for the Messages console.

### 5.4 Rendering (`DetailPanel.tsx`)
- Rename the **Activity** tab → **Timeline** (`id`/`aria` updated consistently: `timeline-tab`/`timeline-panel`).
- Render `timeline: TimelineEntry[]` newest-first. Each entry is a left channel-icon + content row:
  - **log:** method icon (`phone`/`mail`/`message`/`note`), bold `outcomeLabel`, `formatDate(at)`, optional notes, optional promise line (`Promised $X by date · broken?`), optional follow-up line — i.e. today's Activity rendering, generalized to read `outcomeLabel`.
  - **sms:** `message` icon, bold `outcomeLabel` (e.g. "Customer replied" / "Text delivered"), body snippet (`whitespace-pre-wrap`, clamped), and a mono `status`/`errorCode` caption. Subtle inbound/outbound differentiation (e.g. inbound left-tinted) using existing tokens.
- The empty state ("No contact logged yet") generalizes to "No activity yet."
- **Messages** tab unchanged.

## 6. Data flow

```
contact_logs (case-scoped)  ─┐
                             ├─ loader maps → buildTimeline() → selectedTimeline → DetailPanel "Timeline" tab
text_messages (filter case) ─┘
text_messages (customer-scoped) ── selectedMessages ───────────→ DetailPanel "Messages" console (unchanged)
```
Browser never touches the DB; all reads on the RLS user client, scoped by `org_id` and (for the timeline) `case_id`.

## 7. Error handling & constraints

- **Pure & total:** `buildTimeline`/`deriveSmsOutcome` never throw; tolerate null fields; unknown SMS status → `message-sent`; empty inputs → `[]`.
- **No new writes / no migration:** outcome is free text; SMS outcomes are derived, not persisted.
- **RLS boundary unchanged:** reads on the user client; no service-client use.
- **Tailwind v4:** timeline classes are static literal strings (no `text-${x}`).
- **No client→`.server` import:** `timeline.ts` is a pure client-safe module; `DetailPanel` is already a client component.

## 8. Testing (verification)

- **`tests/timeline.test.ts` (new, pure):**
  - `deriveSmsOutcome` table: inbound→customer-replied; outbound+delivered→message-delivered; outbound+failed→contact-invalid; outbound+undelivered→contact-invalid; outbound+sent/queued/unknown→message-sent.
  - `buildTimeline`: descending-by-`at` order; mixed log+SMS interleaving by timestamp; stable tie-break (equal `at`); `outcomeLabel` populated from `OUTCOME_LABELS`; empty inputs → `[]`.
- **`tests/contact-log.test.ts` (extend):** the 4 new manual outcomes parse/validate (the parser validates `outcome` against `CONTACT_OUTCOMES.includes(...)` at `contact-log.ts:65`, rejecting `"bad-outcome"` otherwise); an unknown outcome still rejects.
- **Component gate:** `cd nudgepay-app && npx tsc -b && npx react-router build` — both clean.
- **Regression gate:** `npx vitest run` — full suite green (existing 190 + the new timeline/contact-log cases).
- **Visual (controller):** screenshot a case with both a manual log and SMS to confirm one interleaved chronological Timeline; confirm Messages console still composes.

## 9. Out of scope

- B5 (priority) and B6 (sync visibility) — later Phase 7 sub-phases.
- A new `interactions` table; dual-writing SMS into a second store.
- Pagination / infinite scroll (per-case interaction counts are small).
- Editing or deleting timeline entries; cross-case (customer-wide) timeline.
- Changing the queue's "last contact" computation (already a logs+SMS merge).

## 10. File manifest

**New:**
- `app/lib/timeline.ts` — types, `deriveSmsOutcome`, `buildTimeline`, `OUTCOME_LABELS`.
- `tests/timeline.test.ts` — pure unit tests.

**Modified:**
- `app/lib/contact-log.ts` — append 4 manual outcomes to `CONTACT_OUTCOMES`.
- `app/routes/dashboard.tsx` — loader: add `case_id` to message select, build `selectedTimeline`, drop `selectedActivity`, pass timeline to `DetailPanel`.
- `app/components/DetailPanel.tsx` — Activity→Timeline tab rendering `TimelineEntry[]`; consume shared `OUTCOME_LABELS`.
- `app/components/LogContactDrawer.tsx` — 4 new outcome `<option>`s.

**No migration. No new write path.**
