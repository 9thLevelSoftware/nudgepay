# NudgePay Phase 5b — Contact Logging + Promise Tracking Design

**Status:** Approved design (brainstorming output). Next step: writing-plans.

**Parent:** Phase 5 (Cutover & UI port) of the NudgePay production rebuild. Phase 5 is decomposed into 5a–5e; this spec covers **5b only**. Phase 5a (design system + app shell + read-only work-queue + read-only detail panel) is merged to `main`.

## 1. Goal

Make the collections workspace **write-capable**: a collector can log a contact (call / email / note) and record a **promise to pay** from the detail panel, see the account's real **activity timeline**, and let those logged contacts and promises drive two new derived signals — **Follow-ups due** and **Broken promises** — surfaced as both metric tiles and saved views. Every read and the new write go through the server with RLS scoping; the browser never touches the database.

## 2. Scope

**In 5b:**
- Migration adding promise columns to the existing `contact_logs` table.
- A write path (resource-route `action`) to insert a contact log, RLS-scoped.
- A slide-over "Log a contact" form (URL-param driven), with promise fields revealed conditionally.
- The detail panel's **Activity** tab populated with the real contact-log timeline; the **Log** button wired live.
- Folding contact logs into the worklist's "last contact" derivation (correctness: logging a call clears "Never contacted").
- Two new derived signals (**Follow-ups due**, **Broken promises**) as MetricsStrip tiles **and** WorkQueue saved views.

**Out of 5b (later slices):** Messages tab + Twilio templates (5c), owner/assignment + My-work view (5d), Accounts/Promises/Reports nav destinations, Netlify/Railway retirement + final a11y/security review (5e).

## 3. Decisions locked during brainstorming

1. **Logging UX = slide-over / dialog**, but implemented as a **React-rendered slide-over driven by a URL search param** (`?invoice=<id>&log=1`), NOT a native `<dialog>`/`alert`/`confirm` (those block the browser-automation environment). Focus moves into the form on open; Escape/Cancel is a `<Link>` back without `log`; progressively enhanceable.
2. **Two new signals surface as tiles + saved views** (most actionable; mirrors how the existing 4 tiles/views pair). Strip grows to 6 tiles; views grow to 6.
3. **Field set = promise fields only.** Migration adds `promised_amount` + `promised_date`. No `contact_person` column — "who I spoke with" lives in free-text `notes`. Rationale: add a structured column only where something computes on it. Promise amount/date drive Broken promises; `follow_up_at` (already present) drives Follow-ups due; `contact_person` drives nothing in 5b and adds a field to every log. Can be promoted later if the team asks.
4. **Conditional reveal:** promised amount + date appear only when Outcome = "Promise to pay," keeping the common log path fast (Method ▾ Outcome ▾ Save).

## 4. Data model — migration `0007_contact_log_promises.sql`

`contact_logs` already exists (migration 0001) with `id, org_id, invoice_id, customer_id, user_id, method, outcome, notes, follow_up_at, created_at`, the `contact_logs_all` RLS policy (`is_org_member(org_id)` for `all`, with check), and grants to `authenticated`/`service_role`. 5b is a lean ALTER:

```sql
alter table contact_logs
  add column promised_amount numeric(12,2),
  add column promised_date   date;

create index on contact_logs (org_id, invoice_id);
```

No RLS or grant changes — the existing policy already covers `insert` and `select`. `method`, `outcome`, `notes`, `follow_up_at`, `user_id` are reused as-is.

## 5. Write path — `app/routes/api.contact-logs.tsx` (action only)

A dedicated resource route, consistent with the existing `/api/qbo/*` pattern. The slide-over `<Form method="post" action="/api/contact-logs">` posts here.

Action flow:
1. `requireUser(request, env)` → RLS user client + `headers` + `user`.
2. `resolveOrg(supabase, user.id)` → org (→ `/onboarding` if none).
3. **Validate `invoice_id` is readable via the RLS user client** (a `select id` on `invoices` filtered by the id). This blocks inserting a contact_log in the user's own org that references another org's invoice (the FK alone would permit it; RLS on `contact_logs` only checks `org_id`). Reject if not found.
4. Insert the contact_log with the **user client** (RLS `with check (is_org_member(org_id))`), setting `org_id`, `invoice_id`, `customer_id`, `user_id = user.id`, `method`, `outcome`, `notes`, `follow_up_at`, `promised_amount`, `promised_date`.
5. On success: `redirect(returnTo, { headers })` where `returnTo` is the dashboard URL minus `log` (drawer closes, queue + panel reflect the new log). On validation failure: `redirect` back to the dashboard URL with `log=1` preserved plus a `logError=<code>` param the drawer renders.

A pure exported helper does the parsing/validation so it is unit-testable with no I/O:

```ts
type ContactLogFields = {
  invoiceId: string;
  customerId: string | null;
  method: "call" | "email" | "text" | "note";
  outcome: "promise-to-pay" | "dispute" | "no-commitment" | "left-voicemail" | "no-answer" | "other";
  notes: string | null;
  followUpAt: string | null;       // YYYY-MM-DD or null
  promisedAmount: number | null;   // required & > 0 ONLY when outcome = promise-to-pay
  promisedDate: string | null;     // required & valid date ONLY when outcome = promise-to-pay
};
type ParseResult =
  | { ok: true; fields: ContactLogFields }
  | { ok: false; error: string };   // error code string, e.g. "missing-invoice", "promise-required", "bad-amount", "bad-date", "bad-method", "bad-outcome"

export function parseContactLogForm(form: FormData): ParseResult;
```

Validation rules: `invoiceId` present; `method`/`outcome` in their enums; when `outcome === "promise-to-pay"`, `promisedAmount` parses to a finite number `> 0` and `promisedDate` is a valid `YYYY-MM-DD`; when outcome is anything else, promise fields are ignored (stored null); `followUpAt`, when present, is a valid `YYYY-MM-DD`; `notes` trimmed to null when empty.

## 6. Pure logic changes — `app/lib/worklist.ts`

New/changed types:
- `WorkItem` gains `promise: { amount: number; date: string } | null` and `followUpAt: string | null`.
- `ViewId` adds `"follow-ups-due" | "broken-promises"` → `"all-open" | "30-plus" | "high-value" | "never-contacted" | "follow-ups-due" | "broken-promises"`.
- `Metrics` gains `followUpsDue: Metric` and `brokenPromises: Metric`.
- New input type `PromiseSignalInput = { invoiceId: string; promisedAmount: number | null; promisedDate: string | null; followUpAt: string | null }`.

New/changed functions:
- `buildWorkItems(invoices, customers, lastContacts, promiseSignals, today)` — adds the `promiseSignals` parameter; maps `promise`/`followUpAt` onto each item. **Hardened last-contact selection:** pick the max-by-date contact per invoice explicitly (today it relies on `Map` insertion order). `promise` = the signal's amount+date when both present, else null.
- `isBrokenPromise(item, today): boolean` = `item.promise != null && item.promise.date < today`. (All worklist items already have `balance > 0`, so "still unpaid" holds.)
- `isFollowUpDue(item, today): boolean` = `item.followUpAt != null && item.followUpAt <= today`.
- `applyView` handles the two new views (using the predicates above; both need `today`, so `applyView(items, view, today)` gains a `today` param).
- `computeMetrics(items, today)` adds `followUpsDue` (sum over `isFollowUpDue`) and `brokenPromises` (sum over `isBrokenPromise`); gains a `today` param.

**Correctness fix (called out):** because contact_logs now feed `lastContacts`, a logged contact clears "Never contacted" and refreshes "Last contact." This was a latent gap in 5a (text-messages-only) and is fixed here.

`buildDashboardData` in `dashboard.tsx` threads `promiseSignals` and `today` into the above; metrics/viewCounts continue to be computed over the search-filtered set.

## 7. Loader — `app/routes/dashboard.tsx`

When connected, in addition to the existing invoice/customer/text reads (RLS user client):
- **Read `contact_logs`** for the worklist invoices: `select invoice_id, customer_id, method, created_at, follow_up_at, promised_amount, promised_date` filtered by `org_id` and `invoice_id in (…)`, ordered `created_at desc`. Derive per invoice: merged **last contact** (most-recent of contact_logs vs text_messages; channel = method label for logs, "Text" for messages), latest **promise** (most-recent row where `promised_amount` and `promised_date` are non-null), and pending **follow_up_at** (most-recent non-null).
- **Selected-account activity:** when an invoice is selected, a second small read pulls **that invoice's full contact-log history** (all columns needed for display, ordered `created_at desc`) → `selectedActivity: ActivityEntry[]` for the Activity tab.
- Parse `log` (`"1"` → boolean) and `logError` (string|null) params; pass through to the component.

`ActivityEntry` shape (loader → DetailPanel): `{ id, method, outcome, notes, createdAt, followUpAt, promisedAmount, promisedDate }`.

## 8. UI components

- **`app/components/LogContactDrawer.tsx` (new):** React-rendered slide-over, shown when `log` is true. Contains `<Form method="post" action="/api/contact-logs">` with hidden `invoiceId`, `customerId`, `returnTo`. Fields: Method `<select>`, Outcome `<select>`, Notes `<textarea>`, Follow-up date `<input type=date>`, and Promised amount + Promised date that render only when Outcome = "Promise to pay" (controlled by a small client `useState` seeded from the select; the server still validates). Focus moves to the Method field on open; Escape and Cancel are `<Link>`s back to the dashboard URL without `log`; copper focus rings; responsive (full-width sheet on mobile, right-anchored panel on desktop); honors reduced-motion. Renders the `logError` message when present.
- **`app/components/DetailPanel.tsx`:** the inert **Log** button becomes a `<Link to="?invoice=<id>&tab=activity&log=1&…">` (preserving view/sort/q). The **Activity** tab renders the `selectedActivity` timeline: each entry shows a method icon, outcome label, relative date, notes, and — for promises — "Promised $X by ⟨date⟩," styled `hot` when broken (`promised_date < today`). Empty state when no history ("No contact logged yet. Use Log to record a call or note.").
- **`app/components/MetricsStrip.tsx`:** 6 tiles — adds **Follow-ups due** (warm tone) and **Broken promises** (hot tone), each count + USD total, using the existing static tone-class map pattern.
- **`app/components/WorkQueue.tsx`:** 6 saved-view tabs — adds **Follow-ups due** and **Broken promises** with counts, preserving sort + q like the existing tabs.

## 9. Error handling & copy

- Validation failures route back to the open drawer with a specific, in-voice message ("Add a promised amount and date, or change the outcome." / "Enter a valid amount."). Never raw provider/DB errors.
- Activity empty state is an invitation to act, not a mood: "No contact logged yet. Use Log to record a call or note."
- Action labels stay active and consistent: the button says "Save contact," the timeline entry it produces reads as a logged contact.
- Broken-promise styling is functional (hot), not decorative — it marks accounts that need re-contact.

## 10. Testing

- **`tests/worklist.test.ts`** (extend): merged latest-contact (a newer contact_log beats an older text message; channel label correct); broken-promise boundary (`promised_date == today` → not broken, `< today` → broken); follow-up-due boundary (`followUpAt == today` → due, `> today` → not due, `< today` → due); `applyView` for `follow-ups-due` and `broken-promises`; `computeMetrics` totals for both new buckets.
- **`tests/api-contact-logs.test.ts` (new):** `parseContactLogForm` unit cases — valid call-with-no-promise; promise-to-pay missing amount/date → `promise-required`; bad amount/date codes; bad method/outcome codes; follow-up-only. Plus one **DB-backed RLS insert test** against a per-test fresh org (helper `serviceClient()` to seed, `makeUserClient(email)` to insert; globally-unique data; never global truncation): assert the row lands with `user_id` set and is readable back via the user client.
- **`tests/dashboard-worklist.test.ts`** (extend): `buildDashboardData` threads promise/follow-up signals → assert a known invoice surfaces as a broken promise and a follow-up-due, and that a logged contact clears "Never contacted."
- Components verified by `npx tsc --noEmit` + `npx react-router build` (the `-app` no-render-test convention), plus a visual check in Chrome with a frontend-design self-critique pass (the slide-over, the populated Activity timeline, the 6-tile strip, the 6 view tabs).

## 11. Global constraints (inherited)

- No `node:*` in `app/**`; Web standards only.
- Security boundary intact: browser → server routes only; **RLS user client for reads and the contact-log insert**; service client untouched in 5b (connection status only, unchanged); no secret/token exposure in any loader/action payload.
- Multi-tenant: all reads and the insert org-scoped via the session; cross-org `invoice_id` references blocked by the readability check in §5.
- Tailwind v4 CSS-first; static literal class maps only (no dynamic `bg-${x}`); copper focus rings; reduced-motion honored.
- Conventional Commits; `.env.test` / `.dev.vars` gitignored, never committed.

## 12. Out of scope (restated)

Messages tab + Twilio templates (5c), owner/assignment + My-work view (5d), Accounts/Promises/Reports destinations, Netlify/Railway retirement + final a11y/security review (5e).
