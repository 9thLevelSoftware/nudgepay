# Wave 1 — Cases / Queue / Focus / Priority / Exceptions / Promises

- **Auditor:** QA Verification Specialist (Wave 1)
- **HEAD:** `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc`
- **App:** `nudgepay-app/`
- **Date:** 2026-08-20
- **Scope:** case worklist, focus mode, priority scoring, exceptions, promises, coming-due grouping
- **Method:** static read of pure modules, `.server.ts` loaders, dashboard/focus/promises routes, and the listed UI. No product-code edits. No live org session.

**Bars used**

| Bar | Meaning |
|-----|---------|
| P0-managed | Collecting team sees wrong work, wrong money, or can act on a legally parked account |
| P0-public | Customer-facing / legal (TCPA, DNC, promise-kept semantics) |
| polish | Copy, dead code, settings-form mismatch that does not change today's queue |

---

## Hunt checklist

| Hunt | Result | Card |
|------|--------|------|
| Loader errors swallowed | **Confirmed.** Stage-1/2 PostgREST `{data,error}` destructures `data` only; roster/templates/org-config `.catch` to empty/defaults. | [TEMP-CASE-002] |
| 1000-row truncation + reconciliation auto-resolve | **Confirmed.** `supabase/config.toml` `max_rows = 1000`; `applyCaseReconciliation` has no pagination; QBO `QUERY_LIMIT = 1000` truncated flag is discarded. | [TEMP-CASE-001] |
| Email not last-contact | **Confirmed.** Last-contact is `contact_logs` + outbound `text_messages` only. `email_messages` never join. Timeline copy: "Logged contacts and texts". | [TEMP-CASE-003] |
| Focus `includePresence: false` | **Confirmed.** Heartbeats still POST; Focus never reads collision. | [TEMP-CASE-004] |
| Dead age-only scorer in `worklist.ts` | **Confirmed.** `priorityOf` / `nextActionOf` / `buildWorkItems` are test-only; production uses `scorePriority`. | [TEMP-CASE-005] |
| `high_value_threshold` > 10000 silent no-op | **Confirmed.** 12-point balance tier is unreachable once threshold ≥ $10,000 because the hardcoded $10k/$25k tiers fire first. View/KPI still honor the number. | [TEMP-CASE-006] |
| UUID fallback | **Confirmed.** `displayLabel` → `userId.slice(0, 8)`; `listUsers({ perPage: 1000 })`; roster catch → `"Unknown"`. Invoice UUID fallback in DetailPanel was already replaced with `"—"`. | [TEMP-CASE-007] |
| UTC vs org-local today | **Mostly solid in loaders** (`todayInTz`). **UI leak:** `DetailPanel.todayISO()` is UTC midnight for the timeline "broken" badge. Org-config catch falls back to `America/New_York`. | [TEMP-CASE-008] |
| Float money compare | **Confirmed.** `received >= promisedAmount` on IEEE `Number` sums. | [TEMP-CASE-009] |
| Credit memo as payment | **Confirmed.** `type: "credit_memo"` shares `applyPaymentsAndEvaluate` with cash; balance-delta can mark a promise **kept**. | [TEMP-CASE-010] |
| Keyboard j/k/x and 1/2/3/space | **Solid** (see Solid section). Dialog / editable / snooze-in-flight guards are present. | — |
| Contact methods only call/text/note | **Confirmed.** Parser rejects `email`. Email is a live send channel. | [TEMP-CASE-003], [TEMP-CASE-012] |
| Exception terminal blocks | **Partial.** SMS/email server + Call tile are blocked. Focus "Log call" and the Log drawer are not. | [TEMP-CASE-013] |
| Promise cancel surfaces | **Partial.** Confirm+error only on dashboard Overview. `/promises` panel has no cancel. | [TEMP-CASE-014] |
| Coming-due empty copy hardcoded 7 days | **Confirmed.** Data path uses `config.workflow.comingDueDays`. | [TEMP-CASE-015] |

**Additional production issues found in-scope**

| Card | Title |
|------|-------|
| [TEMP-CASE-016] | `my-work` view includes suppressed / DNC cases |
| [TEMP-CASE-017] | Focus snooze writes a contact log and falsifies last-contact |
| [TEMP-CASE-018] | Focus queue includes waiting + pending-promise cases |

---

## Findings

### [TEMP-CASE-001] PostgREST/QBO 1000-row cap can auto-resolve live cases
- **Severity:** major
- **Bars:** P0-managed
- **Area:** cases
- **Status:** open
- **Evidence (code):** `nudgepay-app/supabase/config.toml:18` (`max_rows = 1000`); `nudgepay-app/app/lib/case-lifecycle.server.ts:10-27` (overdue invoices + open cases, **no `.range` / pagination**); `nudgepay-app/app/lib/cases.ts:119-120` (`resolve` every open case whose customer is missing from the overdue set); `nudgepay-app/app/lib/qbo-sync.server.ts:26-28,148,227` (`QUERY_LIMIT = 1000`, `truncated: overdueInvoices.length >= QUERY_LIMIT`); `nudgepay-app/app/routes/api.qbo.refresh.tsx:44` (return value including `truncated` discarded); `nudgepay-app/supabase/migrations/0013_sync_errors.sql:3` (comment: truncated warning is a *separate* channel — that channel is not wired).
- **Evidence (live):** Not exercised. Chancey is documented at 125–175 overdue invoices (`qbo-sync.server.ts:26-27`), so this is **latent** for that tenant and **fires as soon as any of: overdue invoices, open cases, or the reconciliation SELECT pages past 1000**.
- **User / legal impact:** An open collections case whose customer is not in the truncated overdue page is written `status: "resolved", closed_at: now, next_action_at: null`. Work disappears from All open / My work / Focus with no agent action and no sync-error banner. Inverse: overdue customers off the page never get a case opened.
- **Fix recipe:** Page every reconciliation SELECT until a short page (or use a SQL RPC that is not `max_rows`-capped). Treat QBO `truncated === true` as a recorded `sync_errors` row and **skip** resolve-ops on that run. Same pagination for `loadCaseQueueSource` invoices/cases (see TEMP-CASE-002).
- **Do not:** Rely on "Chancey is under 1000" as a production invariant; CDC + cron call this path on every payment.

### [TEMP-CASE-002] Dashboard/focus loaders swallow PostgREST errors and silently empty the queue
- **Severity:** major
- **Bars:** P0-managed
- **Area:** cases
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/lib/case-queue.server.ts:128-151` (comment: builders never reject so `Promise.all` will not short-circuit — then `{ data: invRows }` / `{ data: caseRows }` **drop `error`**); `:148` `listOrgMembers(...).catch(() => [])`; `:150` `loadTemplates(...).catch(() => resolveTemplates([]))`; `:120` `loadOrgConfig(...).catch(() => DEFAULT_ORG_CONFIG)`; `:213-236` Stage-2 logs/SMS/promises similarly take `data` only; `:231-234` presence is the only path that logs. Dashboard: `nudgepay-app/app/routes/dashboard.tsx:175,191-194,312-340` (org-config catch; org/email/selected-case queries ignore `error`). Focus: `nudgepay-app/app/routes/focus.tsx:53` (config catch) vs `:62` (org name **does** throw). Promises tab: `nudgepay-app/app/routes/promises.tsx:58-61,68-70,79-83,91-98` (every SELECT `{ data }` only). Same `max_rows = 1000` applies to invoices, open cases, `contact_logs`, `text_messages`, and `promises` in the queue source.
- **Evidence (live):**
- **User / legal impact:** A failing invoices query renders every open case as `$0` / 0 invoices (cases still load). A failing cases query renders an empty "healthy" queue. Truncated `contact_logs` (newest-first, then capped) makes recently-worked accounts look **Never contacted** and inflates silence points. Roster failure labels every owner `"Unknown"` (`cases.ts:180`).
- **Fix recipe:** If `error` is set, throw (or return a typed loader failure the shell can banner). Page `.range(from, from+999)` until a short page for invoices, cases, logs, SMS, promises. Do not `.catch` org-config to defaults on the path that computes `today`.
- **Do not:** Treat "empty queue" as "caught up." Presence degrade-to-[] (`case-queue.server.ts:231-234`) is the one catch that is acceptable.

### [TEMP-CASE-003] Email is not last-contact — Never contacted / silence / timeline lie
- **Severity:** major
- **Bars:** P0-managed
- **Area:** cases
- **Status:** open
- **Evidence (code):** Last-contact assembly `nudgepay-app/app/lib/case-queue.server.ts:214-250` reads `contact_logs` + outbound `text_messages` only. `methodLabel` still maps `email: "Email"` (`:238`) but nothing inserts `method: "email"` anymore. Dashboard selected timeline: `nudgepay-app/app/routes/dashboard.tsx:318-367` (`buildTimeline(logInputs, smsInputs)` — emails loaded separately at `:336-340` for the Email tab only). `nudgepay-app/app/lib/timeline.ts:85-90` has no email kind. Empty copy `nudgepay-app/app/components/DetailPanel.tsx:1070` ("Logged contacts and texts will appear here."). `never-contacted` view `nudgepay-app/app/lib/cases.ts:256`. Silence factor `nudgepay-app/app/lib/cases.ts:184` + `priority.ts:48-54`. Emails **are** a live channel: `DetailPanel.tsx:1162-1178`, `email-messaging.server.ts:65-79` (`email_messages.insert`, including `case_id`).
- **Evidence (live):**
- **User / legal impact:** An agent who only emails a customer leaves the case in **Never contacted**, keeps the 15-point "never contacted" silence bonus, and the Timeline tab looks empty. Follow-up / "why now" copy says they have never been touched. TCPA/SMS consent is unrelated — this is the collections worklist lying about outreach.
- **Fix recipe:** Include outbound `email_messages` (and inbound, as "customer replied") in `lastContactsInput` and `buildTimeline`. Channel label `"Email"`. Keep the Email tab as the thread; Timeline should still show the send.
- **Do not:** Add `email` to `CONTACT_METHODS` as a fake log without also ingesting `email_messages` (duplicate / drift). The parser test at `tests/contact-log.test.ts:112-116` documents the current "email is not a NudgePay channel" fiction.

### [TEMP-CASE-004] Focus Mode is collision-blind (`includePresence: false`)
- **Severity:** major
- **Bars:** P0-managed
- **Area:** focus
- **Status:** open
- **Evidence (code):** Dashboard `nudgepay-app/app/routes/dashboard.tsx:189` `includePresence: true`. Focus `nudgepay-app/app/routes/focus.tsx:58` `includePresence: false`. Focus still **writes** heartbeats `focus.tsx:256-272` (`POST /api/presence/heartbeat` every 20s). Collision is never computed in the Focus loader (no `collisionState` import). `case-queue.server.ts:80,99,230-235` documents empty `presenceRows` when the flag is false. Dashboard users **will** see the Focus agent as "viewing now" (`WorkQueue.tsx:88-103`, `DetailPanel.tsx:811+`).
- **Evidence (live):**
- **User / legal impact:** Two agents can Focus-triage the same account (call + text in the same minute) with no live/recent banner and no confirm-on-save. The collecting team’s collision contract (C1) does not apply to the keyboard-speed path.
- **Fix recipe:** Pass `includePresence: true` on the Focus loader; surface `collisionState` on `FocusCard` (at least live-viewer names) and gate Log call / Send text / Snooze with the same confirm used by `LogContactDrawer.tsx:105-108,245-250`.
- **Do not:** Stop sending heartbeats from Focus — that would hide Focus agents from the dashboard.

### [TEMP-CASE-005] Dead age-only scorer still lives in `worklist.ts`
- **Severity:** minor
- **Bars:** polish
- **Area:** cases
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/lib/worklist.ts:68-83` (`priorityOf` age bands 90/60/30; `nextActionOf`); `:137-138` used only inside `buildWorkItems`. Production dashboard `nudgepay-app/app/routes/dashboard.tsx:19-22,89` calls `buildCaseItems` → `scorePriority` (`cases.ts:185-197`). `buildWorkItems` call sites: `tests/worklist.test.ts` only (grep). `heatOf` / `ageInDays` / `HIGH_VALUE_THRESHOLD` / `ViewId` **are** live.
- **Evidence (live):**
- **User / legal impact:** None today. A future wiring of `buildWorkItems` onto the dashboard would silently drop broken-promise / balance / silence / follow-up scoring.
- **Fix recipe:** Delete `priorityOf`, `nextActionOf`, `buildWorkItems`, `applyView`, `sortItems`, `computeMetrics`, `isBrokenPromise`, `isFollowUpDue` if unused, or mark them `@deprecated` and stop exporting from the production graph. Keep `heatOf` / `ageInDays` / types.
- **Do not:** "Fix" production priority by editing `priorityOf` — production does not call it.

### [TEMP-CASE-006] High-value threshold ≥ $10,000 silently no-ops the 12-point scoring tier
- **Severity:** major
- **Bars:** P0-managed
- **Area:** cases
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/lib/priority.ts:39-46` (`balance >= 25_000` → 25, `>= 10_000` → 18, **then** `>= highValueThreshold` → 12). Parser allows any `highValue >= 1000` with **no upper bound** (`org-settings.ts:123-125,148`). Form `min={0.01}` (`PriorityThresholdsForm.tsx:37`) and error copy "must be greater than 0" (`:77`) disagree with the $1,000 floor. High-value **view/KPI** correctly use `config.priority.highValue` (`cases.ts:255,287`; `dashboard.tsx:88-91`). Comment in `priority.ts:36-38` admits only "that one boundary is configurable."
- **Evidence (live):**
- **User / legal impact:** An owner who sets High-value to $15,000 sees the High value tile filter at $15k (correct) but a $12,000 case never receives the 12-point "org high value" bonus — it already took the hardcoded 18-point $10k tier. Recommended sort / Focus order / Why-now do not move when the owner thinks they retuned "high value."
- **Fix recipe:** Either (a) apply the org threshold **before** the fixed $10k/$25k steps, or (b) reject / clamp `high_value_threshold` to `(1000, 10000)` in `parsePriorityThresholdsUpdate` and explain the 12-point tier in the form. Align input `min` + error copy with the $1,000 floor.
- **Do not:** Document "high-value threshold drives scoring" while the 10k/25k constants shadow it.

### [TEMP-CASE-007] Owner/user labels fall back to UUID prefix or "Unknown"
- **Severity:** minor
- **Bars:** polish
- **Area:** cases
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/lib/names.ts:10-18` (`display_name` → email local-part → `userId.slice(0, 8)`). `nudgepay-app/app/lib/orgs.server.ts:88-95` `auth.admin.listUsers({ perPage: 1000 })` — members not on that page get empty email → UUID prefix. Roster catch `case-queue.server.ts:148` → empty map → `cases.ts:180` `"Unknown"`. Collision fallback `"A teammate"` (`dashboard.tsx:291`). Invoice UUID fallback in the panel is **fixed** (`DetailPanel.tsx:955` `docNumber ?? "—"`).
- **Evidence (live):**
- **User / legal impact:** Contact-log "by {author}" and Owner chips can show `a1b2c3d4` or `Unknown`. Assignment UX degrades; activity attribution is weaker for reports. Unlikely at a 5-person tenant unless roster load fails (TEMP-CASE-002).
- **Fix recipe:** Page `listUsers` (or look up by `memberIds`). Fail the loader if roster throws instead of `catch([])`. Prefer a profiles/`display_name` requirement at invite-accept.
- **Do not:** Parse emails anywhere except `listOrgMembers` / `displayLabel` (AGENTS.md).

### [TEMP-CASE-008] Timeline "broken" badge uses UTC today, not org-local
- **Severity:** minor
- **Bars:** P0-managed
- **Area:** promises
- **Status:** open
- **Evidence (code):** Loaders are org-local: `dashboard.tsx:175-176`, `focus.tsx:53-54`, `promises.tsx:49-50`, `qbo-sync.server.ts:129-130,141-142,265-266,308-309` all `todayInTz`. UI leak: `nudgepay-app/app/components/DetailPanel.tsx:88-90` `todayISO()` = `new Date().toISOString().slice(0, 10)` (UTC calendar day); used `:1075,1103` `e.promisedDate < today` to paint "· broken" on a timeline promise row. Org-config catch (`dashboard.tsx:175`) falls back to `DEFAULT_COMPANY_PROFILE.timezone = "America/New_York"` (`org-profile.ts:13-18`) if `org_settings` fails — wrong `today` for a non-Eastern org, feeding every view filter.
- **Evidence (live):**
- **User / legal impact:** Between UTC midnight and local midnight, a still-pending promise can show as **broken** on the Timeline while evaluation (`promises.ts:32` `today > graceUntil`, org-local) has not flipped it. Inverse in Asia/Tokyo: delayed badge. Not the evaluator itself.
- **Fix recipe:** Pass loader `today` into `DetailPanel` (already in the Focus loader payload). Never call `toISOString().slice(0, 10)` for a date-only business rule. Do not default `today` on org-config failure (throw; see TEMP-CASE-002).
- **Do not:** Change `business-days.ts` to be tz-aware — it correctly consumes already-resolved date strings (`tz.ts:7-8`).

### [TEMP-CASE-009] Promise kept/partial uses raw IEEE float compare
- **Severity:** minor
- **Bars:** P0-managed
- **Area:** promises
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/lib/promises.ts:27-34` `received = max(0, baseline - currentLinkedBalance)` then `received >= row.promisedAmount`. Summation `promise-evaluation.server.ts:43-49` `Number(inv.balance) || 0` reduced in JS. Mapper `qbo-mappers.server.ts:26-28` `Number(v)` (NaN → 0). Ledger live received `promise-ledger.ts:78` same subtraction. No cent rounding (late fees **do** round: `late-fees.ts:39`).
- **Evidence (live):**
- **User / legal impact:** A $500.00 promise against a sum of many `numeric` balances can miss `>=` by `1e-12` and stay pending until grace, then `partially_kept` / `broken`. Inverse false-kept is less likely but possible on binary fractions.
- **Fix recipe:** Compare on integer cents: `Math.round(received * 100) >= Math.round(promised * 100)`. Round `amountReceived` the same way before write.
- **Do not:** Use `Number.EPSILON` as a money epsilon.

### [TEMP-CASE-010] Credit memo is treated as cash for promise evaluation
- **Severity:** major
- **Bars:** P0-managed
- **Area:** promises
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/lib/qbo-sync.server.ts:85-117,119-131` `applyPaymentsAndEvaluate` accepts `type: "payment" | "credit_memo"`, upserts the row, **re-pulls invoices**, then `applyPromiseEvaluation`. CDC merges credit memos into the same array (`:310-315`). Webhook `webhooks.qbo.tsx` CreditMemo → `applyPaymentWebhook(..., "credit_memo")`. Evaluator has no `payments.type` filter — only invoice **balance delta** (`promises.ts:23-36`). Test `tests/qbo-sync-payments.test.ts:108-126` explicitly: a credit memo that zeroes the balance **resolves the case** (correct for AR) via the same path that evaluates promises.
- **Evidence (live):**
- **User / legal impact:** A QBO credit memo (not a customer payment) drops linked invoice balances → `received >= promisedAmount` → promise **kept**, case may close. Collections KPIs (kept rate, broken-promise alerts) treat a write-off/credit as "they paid." Case auto-resolve on zero balance is the right AR behavior; **kept** is the wrong promise semantics.
- **Fix recipe:** Keep credit memos in `payments` and in case reconciliation. For promises, either (a) compute received from `payments` where `type = 'payment'` only, or (b) mark kept only when a payment (not credit_memo) exists in the window. Document the rule next to `evaluatePromise`.
- **Do not:** Stop syncing CreditMemo — unpaid balances would go stale.

### [TEMP-CASE-012] Contact log methods are call/text/note while email is a first-class send channel
- **Severity:** minor
- **Bars:** polish
- **Area:** cases
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/lib/contact-log.ts:7` `CONTACT_METHODS = ["call", "text", "note"]`. Drawer `LogContactDrawer.tsx:13-15,124-126`. Focus log-call hardcodes `method: "call"` (`LogCallMiniForm.tsx:80`); snooze hardcodes `method: "note"` (`focus.tsx:240`). Parser rejects `email` (`contact-log.ts:65`; test `tests/contact-log.test.ts:112-116`). Comm prefs still have `preferredChannel: "email"` (`comm-prefs.ts:9`).
- **Evidence (live):**
- **User / legal impact:** Agents cannot log "I emailed them from Outlook" as Email; they must pick Note/Text/Call. Combined with TEMP-CASE-003, in-app email is invisible to last-contact anyway.
- **Fix recipe:** After TEMP-CASE-003 ingests `email_messages`, either add `email` as a method for **external** emails or a dedicated "logged email" outcome. Until then, the drawer helper text should say "In-app email is tracked on the Email tab."
- **Do not:** Store Outlook emails as `method: "text"`.

### [TEMP-CASE-013] Terminal exceptions do not block Focus "Log call" or the Log drawer
- **Severity:** major
- **Bars:** P0-public
- **Area:** cases
- **Status:** open
- **Evidence (code):** Policy `nudgepay-app/app/lib/exceptions.ts:22-33,48-50` (`legal_agency` / `do_not_contact` → `blocksContact: true`, terminal). Server SMS `twilio-messaging.server.ts:123-126`; server email `email-messaging.server.ts:45-47`; bulk `bulk.ts:39`. Call tile `channel-actions.ts:19-20` + `DetailPanel.tsx:667,741-760`. SMS composer `sms-gate.ts:30-32`. **Gaps:** `LogCallMiniForm.tsx` has no `contactBlocked` check (Focus key `1` always opens it, `focus.tsx:228-230`). `LogContactDrawer` always submits. Focus snooze (`focus.tsx:234-246`) POSTs a note on a DNC case. `applyNextStep` will still update a DNC case to `working` if someone logs a follow-up (`next-step.server.ts:34-35`).
- **Evidence (live):**
- **User / legal impact:** Do-not-contact / legal-agency is a legal hold. The product blocks outbound SMS/email and the `tel:` button, then Focus Mode’s primary action is still "Log call" with no banner. An agent can also flip the case back to `working` via next-step follow-up, which **un-suppresses** it into All open (`isCaseSuppressed` requires `status === "on_hold"` — `exceptions.ts:66`).
- **Fix recipe:** Gate Focus Log call / Snooze like `smsGateFor` (hard stop + reason). Refuse `applyNextStep` follow_up/promise on `isContactBlocked` unless the exception is explicitly cleared. Keep the Log drawer for "customer called in" but default next-step to keep the exception and show the legal banner (`LogContactDrawer.tsx:238-240` already has copy for the picker).
- **Do not:** Rely on "they shouldn’t press 1."

### [TEMP-CASE-014] Promise cancel is only on dashboard Overview, not the Promises ledger
- **Severity:** minor
- **Bars:** P0-managed
- **Area:** promises
- **Status:** open
- **Evidence (code):** Cancel UI only `nudgepay-app/app/components/DetailPanel.tsx:1025-1056` (confirm, 5s auto-reset `:637-642`, errors `:111-114,1020-1023`). Action `api.promises.cancel.tsx:27-30` + `promise-cancel.server.ts:12-42` (write order: case first, promise last — recoverable). `PromiseQuickPanel.tsx:73-92` has Open in Collections / View account **only**. Grep: `promises/cancel` appears in DetailPanel + route registration, nowhere else.
- **Evidence (live):**
- **User / legal impact:** The Promises tab is where pending/due-soon work is reviewed; cancel requires a round-trip to Collections with the case selected. Failed cancel is a query-param banner only if `returnTo` is the dashboard. Opaque `ok: false` (`promise-cancel.server.ts:22,31,40`) collapses RLS miss, non-pending, and write failure into `cancel-failed`.
- **Fix recipe:** Add the same confirm form to `PromiseQuickPanel` for `status === "pending"`. Distinguish error codes. Keep the recoverable write order.
- **Do not:** Cancel from Focus as a silent side effect of skip.

### [TEMP-CASE-015] Coming-due empty state hardcodes "next 7 days"
- **Severity:** minor
- **Bars:** polish
- **Area:** cases
- **Status:** open
- **Evidence (code):** UI `nudgepay-app/app/components/ComingDueList.tsx:29` `"No invoices coming due in the next 7 days."`. Data `coming-due.ts:8,32-34,45-49`; dashboard `dashboard.tsx:94` passes `config.workflow.comingDueDays`; query window `case-queue.server.ts:126` (variable still named `plus7`). Settings `WorkflowSettingsForm.tsx:39,59` (1–60 days). Tests `coming-due.test.ts:31-38,98+` cover a 14-day window.
- **Evidence (live):**
- **User / legal impact:** An org with a 14-day window and no invoices in 14 days still reads "next 7 days" — agents may reopen settings or distrust the view. Inverse: 3-day window with empty copy claiming 7.
- **Fix recipe:** Pass `comingDueDays` into `ComingDueList` and interpolate. Rename `plus7`.
- **Do not:** Change `COMING_DUE_DAYS` default; the bug is copy, not the default.

### [TEMP-CASE-016] `my-work` includes suppressed (DNC / legal / parked) cases
- **Severity:** major
- **Bars:** P0-managed | P0-public
- **Area:** cases
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/lib/cases.ts:250-263` — `30-plus` / `high-value` / `never-contacted` / `follow-ups-due` / `broken-promises` / default all-open all `!i.suppressed`. `my-work` (`:261`) is **only** `ownerId === currentUserId`. `waiting` (`:259`) is status-only. Focus extra-filters suppressed (`focus-queue.ts:23-24`) and tests it (`tests/focus-queue.test.ts:73-81`). Dashboard My work tab does not.
- **Evidence (live):**
- **User / legal impact:** A collector’s My work queue still lists do-not-contact / legal-agency accounts they own. Combined with TEMP-CASE-013 they can Log call from that row. All open correctly hides them (`:263`).
- **Fix recipe:** `my-work` should be `ownerId === currentUserId && !i.suppressed` (or a third "My hold" if parked-mine must remain visible). Mirror in `computeCaseMetrics` if a my-work tile is added later. Keep Focus’s extra filter until `applyCaseView` is fixed.
- **Do not:** Special-case only Focus.

### [TEMP-CASE-017] Focus snooze (key 3) writes a contact log and clears Never contacted
- **Severity:** major
- **Bars:** P0-managed
- **Area:** focus
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/routes/focus.tsx:234-246` snooze POST `/api/contact-logs` with `method=note`, `outcome=follow-up-requested`, `nextStep=follow_up`, `followUpAt=suggestedFollowUpAt`. That insert is then counted as last-contact (`case-queue.server.ts:239-243`) and as `priorAttempts` (`cases.ts:160-161`). `never-contacted` (`cases.ts:256`) and silence (`priority.ts:48-54`, null → 15 pts) both move. Skip (`focus.tsx:248-249`) does **not** write — correct.
- **Evidence (live):**
- **User / legal impact:** "Snooze" is presented as deferring work (`FocusCard.tsx:140-144`, footer `focus.tsx:425`). It is actually a logged contact. KPIs (Never contacted, silence score, attempt count, last-contact column) change without a customer touch. A later audit trail shows a Note / Follow-up requested.
- **Fix recipe:** Snooze should only `applyNextStep` follow_up (or a dedicated snooze write) **without** a `contact_logs` row, or use a method/outcome that `loadCaseQueueSource` excludes from last-contact and attempts. Do not count snooze in `priorAttempts`.
- **Do not:** Equate snooze with skip (skip is in-memory only and comes back on restart — `focus-session.ts:47-48`).

### [TEMP-CASE-018] Focus queue includes waiting and pending-promise cases
- **Severity:** major
- **Bars:** P0-managed
- **Area:** focus
- **Status:** open
- **Evidence (code):** Dashboard triage **excludes** them: `nudgepay-app/app/lib/next-best-action.ts:44-55` (`on_hold`, `waiting`, `promiseStatus !== "pending"`, `!suppressed`). Focus `buildFocusQueue` (`focus-queue.ts:18-29`) = `my-work` or `all-open` + recommended sort. `all-open` only drops `suppressed` (`cases.ts:263`). Waiting and `promised`/`pending` remain. Focus actions are Log call / Send text / Snooze / Skip — no "leave the promise alone."
- **Evidence (live):**
- **User / legal impact:** Keyboard triage will call/text a customer who already promised to pay, or a case marked waiting for a review date. That is the opposite of the dashboard "Start here" strip sitting above the same org’s queue.
- **Fix recipe:** Filter Focus with the same predicate as `pickTriage` (or call `pickTriage(items, Infinity)` then sort). Surface waiting/promised on dashboard views, not in the Focus deck.
- **Do not:** Teach agents to skip-spam through promised accounts.

---

## What is solid

Production-grade pieces in this domain. File:line is the implementation, not a test.

### Case model and reconciliation (pure)

- `cases.ts:107-123` `reconcileCases` is idempotent, open-if-missing / resolve-if-no-longer-overdue, ignores `_today`.
- `cases.ts:137-155` overdue invoices grouped by customer; null `customer_id` skipped; `heatOf` + display-only `computeLateFee`.
- `cases.ts:157-164` last-contact is max-by-date, not input order; attempt count is per log row.
- `cases.ts:166-168,252-264` one active promise per case at derive time; coming-due is a **separate** dataset (`applyCaseView("coming-due")` returns `[]` on purpose).
- `cases.ts:182` follow-up due is `nextActionAt <= today` on a `date` column (`0009_collection_cases.sql:10`).
- `cases.ts:198-225` override maps via `overrideToLevel`; `effectiveLevel` drives sort rank (`:271-276`) while `score` stays the computed score.
- `cases.ts:238-239` `suppressed` / `contactBlocked` derived from the exception module, not copied flags.
- `case-lifecycle.server.ts:13-16` overdue = `balance > 0` AND `due_date < today` AND non-null customer (due-today is coming-due, not a case).
- `case-lifecycle.server.ts:36-42` concurrent open is unique-violation `23505` → no-op.
- `case-lifecycle.server.ts:44-45` resolve clears `next_action_at`.

### Priority / heat / cadence

- `priority.ts:29-54,95-120` multi-factor: age 8/20/32/45, balance 2/6/12/18/25, broken 25, silence 5/10/15 (null = never), follow-up 12; reason = top two factors.
- `priority.ts:65-78,80-82` level thresholds default 80/50/25; `levelToRank` Critical < High < Medium < Low.
- `worklist.ts:53-66` `ageInDays` / `heatOf` UTC date-component math (no TZ drift on `YYYY-MM-DD`).
- `follow-up-cadence.ts:10-33` Critical 2 / High 3 / Medium 7 / Low 14, then `nextWorkingDay`.
- `business-days.ts:24-61` UTC-component add; holidays + workingDays; `MAX_ROLL` guard.
- `org-config.ts:113-156` nullable DB columns → defaults; `priority.highValue` and `workflow.comingDueDays` actually flow into `buildCaseItems` / `buildComingDueGroups` / dashboard (`dashboard.tsx:88-94`).
- `dashboard.tsx:104-110` view counts and sort honor the same `highValue` as the KPI tile.

### Coming due (awareness only)

- `coming-due.ts:32-35,54-56` window `[-days, 0]`; overdue excluded; `balance > 0`; null due_date excluded.
- `coming-due.ts:76-90` group by customer, sort by next due then name; invoices soonest-first.
- `coming-due.ts:93-98` KPI count = customers, amount = sum.
- `ComingDueList.tsx:39-43` "Awareness only — not in the collections queue"; links to `/accounts/:id`, no bulk/select.
- `qbo-sync.server.ts:144-150` overdue and coming-due are **separate** QBO queries so coming-due cannot displace overdue at the cap.

### Late fees (display-only)

- `late-fees.ts:31-39` gated on `enabled`; grace; months = `floor((age - grace - 1) / 30) + 1`; rounded to cents; never written to QBO (`late-fees.ts:1-2`).

### Exceptions

- `exceptions.ts:6-34` 8 primary + retained `other`; terminal = legal_agency + do_not_contact only; those `blocksContact`.
- `exceptions.ts:60-70` suppressed iff `on_hold` + exception; terminal always; missing review date parks; `nextActionAt > today` parks; **review date == today resurfaces**.
- `next-step.server.ts:39-50` terminal writes `next_action_at: null`; review-dated keeps `reviewAt`.
- `next-step.server.ts:23-30` waiting/exception cancels pending promises first so the evaluator cannot flip a parked case back to working.
- `sms-gate.ts:14-16,30-35` contact-block before do-not-text before consent (no "mark consent" on DNC).
- `channel-actions.ts:14-22` no phone → hidden; DNC/legal → blocked; `do_not_call` → blocked.
- Server send paths throw on block (`twilio-messaging.server.ts:123-126`, `email-messaging.server.ts:45-47`).

### Promises

- `promises.ts:23-36` only `pending` evaluates; kept if received ≥ promised even before grace; after grace: partial if received > 0 else broken; `today > graceUntil` (grace day still pending).
- `promises.ts:44` missing linked balance falls back to **baseline** (received 0) — does not false-kept.
- `promise-create.server.ts:30-50` baseline = all open-balance invoices for the customer (same set eval will use); grace from org working days/holidays.
- `promise-create.server.ts:52-57,76-83` pending superseded → `renegotiated` + `replacement_promise_id`.
- `promise-create.server.ts:86-87` case → `promised`, exception cleared.
- `promise-cancel.server.ts:6-11,26-40` documented recoverable write order; pending guard on the terminal update.
- `promise-evaluation.server.ts:70` `eq("status", "pending")` concurrency guard; `:81-83` broken → case `working` / follow_up today; `brokenDetails` for alerts.
- `promise-ledger.ts:46-53,67-90` `DayConfig` required (no silent default); live linked balance for pending received; `awaitingEvaluation` when `today > graceUntil` still pending.
- `promise-ledger.ts:95-101` due-soon includes already-past promised dates.
- `promise-ledger.ts:153` kept rate = kept / (kept + partial + broken); null if none resolved.
- `promises.tsx:49-55,131-139` org-local today + org DayConfig on the tab.
- `PromiseQuickPanel.tsx:74-85` closed-case deep-link blocked (`caseOpen`).

### Focus session / queue helpers

- `focus-session.ts:21-49` order frozen; skip does not increment `actions`; resolve past end is a no-op.
- `focus-queue.ts:23-29` my-work first, then all-open; **does** drop suppressed (unlike dashboard my-work).
- `focus.tsx:192-208` snooze waits for server `ok` (no optimistic advance).
- `focus.tsx:217-222` vanished case auto-skips with toast.
- `focus.tsx:254` keys disabled while a mini-form is open or snooze in-flight.
- `LogCallMiniForm.tsx:30-46` / `SendTextMiniForm.tsx:66-84` handledRef prevents double advance.
- `SendTextMiniForm.tsx:97-99` **all** SMS gates block the composer in Focus (no inline consent).

### Collision (when loaded)

- `collision.ts:22-45` ignores null-user (automation) and self; live beats recent; `PRESENCE_FRESH_SEC = 45`, `RECENT_WINDOW_MIN = 60`.
- `dashboard.tsx:277-293` presence mapped per customer → per case; label from roster.
- `LogContactDrawer.tsx:45,105-108,245-250` live/recent requires a second Save click.
- `use-queue-keys.ts:23` j/k/x ignored inside `[role="dialog"]`.

### Keyboard

- `use-queue-keys.ts:17-28` j/k/x; modifiers and INPUT/TEXTAREA/SELECT/contentEditable ignored.
- `WorkQueue.tsx:479-497` j with no selection → first row; k on first is a no-op (`items[-1]` undefined, not wrap). `x` toggles only if a case is selected.
- `use-focus-keys.ts:19-32` 1/2/3/space; space `preventDefault` to avoid scroll.
- Footer/header hints exist (`WorkQueue.tsx:513-515`, `focus.tsx:423-425`).

### Dates / names / money display

- `dates.ts:27-35` date-only strings render the calendar day in every TZ; ISO timestamps use the viewer zone.
- `tz.ts:42-44` `todayInTz` via `en-CA` + IANA zone (Workers-safe).
- `format.ts:26-28` USD with 2 fraction digits.
- Invoice numbers in the panel/focus/drawer use `docNumber ?? "—"`, not the UUID (`DetailPanel.tsx:955`, `FocusCard.tsx:163`, `LogContactDrawer.tsx:87`).

### Next-best-action (dashboard)

- `next-best-action.ts:16-39` Why-now stitches broken date, follow-up date, last-contact, preferred channel.
- `next-best-action.ts:48-55` Start-here strip excludes hold / waiting / pending promise / suppressed; sorts by score.

---

## Residual / not verified in this wave

- No live org session; all "Evidence (live)" left blank on purpose.
- Hosted Supabase `max_rows` may differ from `supabase/config.toml:18`; cloud default is also 1000 unless raised.
- Chancey’s actual overdue count vs 1000 was not re-measured; code comment still says 125–175.
- Whether production `org_settings.timezone` is set (vs NY default) was not read.
- Promise-evaluation cent rounding against real QBO balances: unit tests use whole dollars only (`tests/promises.test.ts`).
- Focus "Start over" (`focus.tsx:332`) reuses the frozen loader queue; it does not re-fetch — by design, not retested live.
- Reports / digest broken-promise email path is Wave 3/6; this wave only confirms `brokenDetails` is produced (`promise-evaluation.server.ts:86-91`).
