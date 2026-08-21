# Wave 2 — Static end-to-end workflow walk

- **HEAD:** `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc`
- **Scope:** `nudgepay-app/` routes + the components a collector actually hits
- **Method:** Read loaders/actions/components. No product-code edits. No live browser, Docker, `.env.test`, or local Supabase.
- **Live evidence:** not tested in this environment
- **Result key:** `pass` = the coded path would complete the step; `fail` = the coded path is missing, wrong, or dishonest; `blocked` = cannot be judged from source (needs a live round-trip)

## Matrix

| Workflow step | result | finding IDs |
|---|---|---|
| W1 home → `/signup` | pass | |
| W1 signup confirm vs session | pass | |
| W1 onboarding (create org) | pass | |
| W1 dashboard requires QBO → settings integrations | pass | |
| W1 QBO connect (owner POST) | pass | |
| W1 QBO callback stores connection | pass | TEMP-WF-017 |
| W1 callback flash (`qbo=connected/error/forbidden`) | fail | TEMP-WF-001 |
| W1 first sync after connect | fail | TEMP-WF-002 |
| W1 dashboard empty after first connect | fail | TEMP-WF-002, TEMP-WF-003 |
| W2 dashboard saved views + KPI strip | pass | |
| W2 log contact — all outcomes + next steps | pass | |
| W2 collision confirm on log | pass | |
| W2 SMS send + gates + banners | pass | TEMP-WF-009 |
| W2 email send + gates + banners | pass | TEMP-WF-009 |
| W2 comm prefs drawer (incl. do_not_email) | fail | TEMP-WF-011 |
| W2 assign owner | pass | |
| W2 priority override | pass | |
| W2 collision live/recent markers | pass | |
| W3 focus keys 1 / 2 / 3 / space | pass | TEMP-WF-013 |
| W3 focus SMS gates (form) | pass | TEMP-WF-013 |
| W3 focus collision / presence | fail | TEMP-WF-012 |
| W3 focus empty / done | pass | |
| W4 promise create via log next-step | pass | |
| W4 promise cancel | pass | TEMP-WF-018 |
| W4 promise evaluate | pass | |
| W5 messages tabs / reply composer | pass | |
| W5 inbox poll | fail | TEMP-WF-006 |
| W5 read / unread state | fail | TEMP-WF-006 |
| W6 bulk assign | pass | |
| W6 bulk SMS | pass | TEMP-WF-009 |
| W7 accounts directory → profile | pass | |
| W7 profile `do_not_email` | fail | TEMP-WF-004 |
| W8 settings intents — owner UI vs member UI | pass | TEMP-WF-014, TEMP-WF-019 |
| W8 owner-only action gate | pass | TEMP-WF-019 |
| W9 reports owner-only + denied banner | pass | TEMP-WF-015 |
| W10 privacy GET | pass | |
| W10 eula GET | pass | |
| W10 unsubscribe GET vs POST | pass | TEMP-WF-020 |
| W11 forgot password | fail | TEMP-WF-007 |
| W11 lockout / rate-limit copy | fail | TEMP-WF-008 |
| W12 loader / action failure honesty | fail | TEMP-WF-001, TEMP-WF-009, TEMP-WF-010, TEMP-WF-016, TEMP-WF-017, TEMP-WF-020 |

---

## W1 First-run

### Home → signup — **pass**

`home.tsx` is a public landing page with Sign up / Log in and privacy/EULA links.

```26:28:nudgepay-app/app/routes/home.tsx
          <Link to="/signup" className={primaryLinkClass}>Sign up</Link>
          <Link to="/login" className={secondaryLinkClass}>Log in</Link>
```

### Signup confirm vs session — **pass**

`signup.tsx` calls `supabase.auth.signUp`, then `signupOutcome(Boolean(data.session), returnTo)`. Production (email confirm ON) returns `{ confirmEmail: true }` and the UI tells the user to click the inbox link then sign in. Local (confirm OFF, session present) redirects to `returnTo` or `/onboarding`. Cookie headers are only attached on the session branch, which is the point of the helper.

```12:16:nudgepay-app/app/lib/auth-flow.server.ts
export function signupOutcome(hasSession: boolean, returnTo: string): SignupOutcome {
  return hasSession
    ? { redirectTo: returnTo || "/onboarding" }
    : { confirmEmail: true, returnTo };
}
```

```39:41:nudgepay-app/app/routes/signup.tsx
  const outcome = signupOutcome(Boolean(data.session), returnTo);
  if ("redirectTo" in outcome) return redirect(outcome.redirectTo, { headers });
  return { confirmEmail: true as const, returnTo: outcome.returnTo };
```

**Blocked (live):** whether the confirmation email actually arrives depends on Supabase Auth config, not this repo.

Login after confirm: `login.tsx` honors `returnTo` **before** `resolveOrg`, so an invitee lands on `/accept/:token` instead of `/onboarding`. Org-less users go to `/onboarding`; members go to `/dashboard`.

### Onboarding — **pass**

`onboarding.tsx` `requireUser` + `resolveOrg`; existing org redirects to `/dashboard`. POST trims `orgName`, uses the service client `createOrgForUser` (owner membership + default templates), then redirects `/dashboard`.

### Settings integrations / QBO connect — **pass** (owner path)

Dashboard **requires** QBO connected and otherwise bounces to integrations:

```197:198:nudgepay-app/app/routes/dashboard.tsx
  const connected = conn?.status === "connected";
  if (!connected) throw redirect("/settings?tab=integrations", { headers });
```

Settings itself uses `loadWorkspaceChrome(..., { requireQbo: false })`, so a brand-new org can open Settings. Integrations tab:

- disconnected + owner → POST `/api/qbo/connect` (“Connect QuickBooks”)
- disconnected + member → “ask an owner”
- connected + owner → Refresh / Reconnect / Disconnect
- connected + member → Refresh only

`api.qbo.connect.tsx` is POST-only (`loader` redirects GET to `/dashboard`), owner-gated, mints one-time OAuth state, redirects to Intuit.

### Callback → dashboard empty? — **fail**

Callback (`auth.qbo.callback.tsx`) consumes state, owner-matches org+user, exchanges the code, `storeConnection`, then `redirect("/dashboard?qbo=connected")`. It does **not** call `syncOverdueInvoices`. `storeConnection` only upserts tokens/status.

After connect, dashboard is reachable (`status === "connected"`) but the queue is empty until cron (`*/30 * * * *`), a QBO webhook, or **Settings → Refresh**. Dashboard has no Refresh control. The empty state is not a first-run empty:

```604:614:nudgepay-app/app/components/WorkQueue.tsx
        ) : items.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
            ...
            <p className="font-sans text-text font-medium">No accounts match this view.</p>
            <p className="font-sans text-sm text-muted max-w-xs">
              <Link to={`?view=all-open&sort=${sort}`} className="text-copper hover:underline font-medium">Clear the search</Link>{" "}
              or pick another view.
            </p>
```

`qbo=connected|error|forbidden` is never read by `dashboard.tsx` or `settings.tsx`. `useFlashCleanup` does not even list `qbo` / `sync`. Manual Refresh writes `?sync=ok|error` with the same problem. See TEMP-WF-001, TEMP-WF-002, TEMP-WF-003, TEMP-WF-017.

---

## W2 Daily collector

### Dashboard views — **pass**

`ViewId` / `ALL_VIEWS` / `VALID_VIEWS` / `SAVED_VIEWS` / `VIEW_LABEL` line up across `worklist.ts`, `dashboard.tsx`, `WorkQueue.tsx`, and `KpiBand`. Ten views: all-open, coming-due, 30-plus, high-value, never-contacted, follow-ups-due, broken-promises, waiting, on-hold, my-work. Coming-due is a separate invoice set (`due_date >= today`), not cases.

### Log contact, all outcomes — **pass**

`CONTACT_OUTCOMES` (10 values) and `NEXT_STEPS` (follow_up / promise / waiting / exception) are rendered in `LogContactDrawer`. Action `api.contact-logs.tsx` parses via `parseContactLogForm`, org-scopes the case/invoice, inserts the log, then `createPromiseForLog` or `applyNextStep`. Fetcher JSON (`respond=json`) is used by Focus; dashboard drawer uses the same action and maps error codes to copy.

Collision: if `collision.level !== "none"`, first submit is intercepted and the user must confirm (“viewing now” / “contacted recently”).

### SMS / email send — **pass** (code path) with provider-env caveat

`DetailPanel` Messages tab uses `smsGateFor` (workspace off → blocked → do-not-text → no invoice → no consent → no phone) and POSTs `/api/text/send`. Email tab gates workspace off → blocked → no address → do-not-email and POSTs `/api/email/send`. Banners cover `sent|noconsent|optout|error|blocked|disabled|quiet` (SMS) and `sent|disabled|optout|blocked|error` (email). Quiet hours are a server-side block with a warm banner.

**Fail adjacent:** `api.text.send` / `api.bulk-sms` call throwing `getTwilioEnv`; `api.email.send` calls throwing `getEmailEnv`. Missing secrets 500 the collector into the root ErrorBoundary instead of `sms=disabled` / `email=error`. Settings test-send already uses the `*OrNull` variants. TEMP-WF-009.

### Comm prefs — **fail** (drawer preferred-channel)

Dashboard `?prefs=1` mounts `CommPrefsDrawer`. Checkboxes include `do_not_call`, `do_not_text`, `do_not_email` (correct unchecked=false semantics). Preferred channel options are only `"" | call | text` — **email is missing**. Saving the drawer will coerce an `email` preference to `null`. TEMP-WF-011.

Action `api.comm-prefs.tsx` correctly writes all four columns, never `sms_consent`, org-scopes via customer/case/invoice.

### Collision — **pass** (dashboard)

Loader builds per-case `collisionState` from recent contacts + presence heartbeats (self excluded). `WorkQueue` shows Viewing/Recent chips; `DetailPanel` shows a banner; log/SMS confirm when not `none`. Heartbeat: `DetailPanel` POSTs `/api/presence/heartbeat` every 20s and revalidates.

### Assign — **pass**

Overview owner `<select>` auto-submits POST `/api/assign`. Action org-scopes customer, membership-guards `ownerId`, throws on write failure (error boundary, not silent).

### Priority override — **pass**

Overview form POSTs `/api/priority-override` with `critical|high|medium|low` or empty=clear. Reason truncated to 280. Org-scoped; throws on write failure.

---

## W3 Focus mode

### Keys — **pass** with one gate hole

`useFocusKeys`: 1 log call, 2 send text, 3 snooze, space skip. Disabled when a mini-form is open, session is done, snooze fetcher is in-flight, or focus is in an input. Modifiers ignored; space `preventDefault`s scroll.

`FocusCard` disables the Send text **button** when `!smsEnabled`, but `handleKey("2")` does not check `smsEnabled` / consent / phone — it still opens the form. The mini-form then hard-blocks. TEMP-WF-013.

Snooze POSTs a follow-up-requested note with `nextStep=follow_up` and waits for `{ ok: true }` before advancing (no optimistic skip). Skip is local-only.

### Gates — **pass** (SMS form) / **fail** (collision)

`SendTextMiniForm` runs the same `smsGateFor` ladder and **blocks every gate**, including soft ones (no invoice / no consent) because Focus has no inline consent toggle. Quiet hours: banner only; submit is still enabled; server returns `quiet`.

`LogCallMiniForm` outcomes are a Focus subset (Reached / No answer / Left voicemail) — acceptable for the deck. Failures show the raw parser code (`bad-outcome`, etc.), not the dashboard copy map. TEMP-WF-020.

**Collision:** focus loader calls `loadCaseQueueSource({ includePresence: false })`. No collision banner, no confirm-on-log. Two collectors can Focus the same customer with no warning. TEMP-WF-012.

Empty queue and “Queue cleared” (restart / back to dashboard) are coded. Scope banner when falling back from my-work to all-open is coded.

QBO gate matches dashboard (`redirect("/settings?tab=integrations")`).

---

## W4 Promises

### Create — **pass**

Only via Log contact `nextStep=promise` (amount + date). `createPromiseForLog` supersedes prior pending (`renegotiated`), snapshots open-balance invoices as baseline, sets `grace_until` from org business days.

### Cancel — **pass** (dashboard only)

`DetailPanel` pending card → confirm → POST `/api/promises/cancel`. `cancelPromise` resets the case to working/follow_up then marks the promise cancelled. Failures return `promiseError=cancel-failed|missing-promise` which dashboard **does** render.

Promises ledger (`PromiseQuickPanel`) has **no** cancel control — collector must open Collections. TEMP-WF-018.

### Evaluate — **pass**

No user “evaluate now” button. `applyPromiseEvaluation` runs inside QBO sync (`qbo-sync.server.ts`) — manual Refresh, 30‑min CDC cron, or webhook. `PromiseQuickPanel` shows “Past grace — awaiting the next sync to settle.” when `awaitingEvaluation`. Honest.

---

## W5 Messages inbox

### Tabs / composer — **pass**

Loader builds SMS+email threads, `needs-reply` / `needs-attention` / `active` / `inactive` / `all`, channel filter, search. `needsReply` = last message inbound (not a per-user read cursor). Composer reuses `/api/text/send` and `/api/email/send` with the same banners/gates. Consent can be toggled via `/api/sms-consent` with a bare `customerId` (invoice-less inbound).

### Poll — **fail**

No `setInterval`, no `useRevalidator`, no SSE. Opening the page is a one-shot loader. Inbound Twilio/Resend webhooks persist rows, but the inbox will not update until a full navigation/reload. Contrast: dashboard `DetailPanel` revalidates every 20s **only** while a case is selected (presence heartbeat). Messages has nothing equivalent.

### Read state — **fail**

No `read_at` / `last_read` / `unread` column usage anywhere in app code (grep of `*.ts,*.tsx,*.sql` in this walk: none). Opening a thread does not mark it read. “Needs reply” stays until an outbound is logged. TEMP-WF-006.

---

## W6 Bulk assign / SMS — **pass**

`WorkQueue` selection + `BulkActionBar`:

- Assign: POST `/api/bulk-assign` with comma-separated `caseIds`, roster member or `__unassign__`. Membership-guarded, org-scoped, clamped to `smsBatchLimit`. Success banner `Reassigned N account(s).`
- SMS: `BulkSmsDrawer` partitions eligible vs skipped (no-phone / no-consent / do-not-contact), template + body, confirm. Action pre-checks `sms_enabled` and quiet hours (`bulkSms=disabled|quiet`), then `runBulkSms`. Result banner `Sent · Failed · Skipped`. Workspace-off and quiet also have dedicated error banners.

Empty `caseIds` / empty body silently redirect home — no banner (minor, UI already disables).

---

## W7 Accounts profile `do_not_email` — **fail** (blocker)

Directory (`accounts.tsx`) select:

```61:64:nudgepay-app/app/routes/accounts.tsx
    .from("customers")
    .select("id, name, phone, email, owner, sms_consent, preferred_channel, do_not_call, do_not_text")
    .eq("org_id", org.org_id);
```

Profile (`accounts.$id.tsx`) select omits `do_not_email` as well (`do_not_call, do_not_text, notes`). `AccountProfile` props type comm prefs as `{ preferredChannel, doNotCall, doNotText }` — no `doNotEmail`. The settings form has Do not call / Do not text only:

```135:141:nudgepay-app/app/components/AccountProfile.tsx
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="do_not_call" value="true" defaultChecked={p.commPrefs.doNotCall} /> Do not call
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="do_not_text" value="true" defaultChecked={p.commPrefs.doNotText} /> Do not text
          </label>
```

`parseCommPrefsUpdate` always writes `do_not_email: form.get("do_not_email") === "true"`. An unchecked/missing box is **false**. Saving owner, notes-adjacent prefs, or “do not call” on the profile **clears a CAN-SPAM unsubscribe**. Unsubscribe POST and dashboard CommPrefsDrawer *do* set/show the flag; the account profile is the path that undoes them. TEMP-WF-004.

Same omit exists on the collections queue embed (`case-queue.server.ts` customer select has `do_not_call, do_not_text` only), so queue badges never show “No email”. Email **send** still works because dashboard/messages reload the customer row with `do_not_email` for the composer.

---

## W8 Settings intents — owner vs member

Action `api.org-settings.tsx` line 26: `if (org.role !== "owner") return redirect(returnTo, { headers });` — silent no-op, no `denied=` flag. TEMP-WF-019. UI generally hides the forms, so a normal member will not hit this.

| Intent | Owner UI | Member UI | Action |
|---|---|---|---|
| `save_company_profile` | editable form | read-only + “Only an owner…” | owner |
| `save_channels` | SMS On/Off select | status text | owner |
| `save_sms_sender` | no form; copy says operator-managed | same | even owner → `error=sms_sender_locked` (honest) |
| `save_quiet_hours` | form (channels tab) | not mounted | owner |
| `save_rules` | form | fields `disabled`, no Save | owner |
| `add_holiday` / `remove_holiday` | add/remove | list only | owner |
| `save_late_fees` | form | not mounted | owner |
| `save_priority_thresholds` | form | not mounted | owner |
| `save_workflow` | form | not mounted | owner |
| `save_email` | form + test send | read-only from/status | owner |
| `save_template` / `delete_template` / `reset_templates` | CRUD | view bodies only | owner |
| `test_sms` / `test_email` (`/api/test-message`) | forms | not mounted | owner + `*OrNull` env |
| `api.profile` display name | all members | all members | self |
| `api.notification-prefs` | all members | all members | self (RLS) |
| QBO Connect / Reconnect / Disconnect | owner | hidden | owner → `qbo=forbidden` (unshown, TEMP-WF-001) |
| QBO Refresh | all when connected | all when connected | any member |
| Dismiss sync error | all | all | any member |

**pass** for the owner/member split the user would actually click, with TEMP-WF-019 (silent member POST) and TEMP-WF-014 (`/invite` is owner-gated but **not linked** from Settings or AppShell).

---

## W9 Reports denied — **pass**

`reports.tsx` → `loadWorkspaceChrome(..., { requireOwner: true })` → `redirect("/dashboard?denied=reports")`. Dashboard banner: “Reports are available to workspace owners only.”

AppShell: owners get `/reports`; non-owners get a disabled control labeled **“Reports (coming soon)”** (`aria-disabled`, `tabIndex={-1}`). The denial is real; the label is dishonest. TEMP-WF-015 (minor).

---

## W10 Public pages

### Privacy / EULA — **pass**

`privacy.tsx` and `eula.tsx` are GET-only static `PublicLayout` pages. No actions, no loaders that mutate. Linked from home.

### Unsubscribe GET vs POST — **pass**

RFC 8058: loader verifies the HMAC token and **only renders**. Action is the mutation (`do_not_email: true`), idempotent, org+customer scoped. Invalid token → “Link invalid or expired”. Success → “You're unsubscribed”.

**Honesty gap:** if the UPDATE errors, action returns `{ valid: true, done: false }` and the confirm form redisplays with **no error**. TEMP-WF-020.

---

## W11 Auth lockouts / forgot password

### Forgot password — **fail**

No `resetPassword`, `recovery`, `forgot`, or `/forgot` route. Login form is email + password + signup link only. TEMP-WF-007.

### Lockouts — **fail**

Login is a single `signInWithPassword`. No app-level lockout, CAPTCHA, or cooldown. `humanAuthError` maps only three strings; anything else (including Supabase “Too many requests”) becomes “Something went wrong. Please try again.” A locked-out user cannot tell lockout from an outage. TEMP-WF-008.

---

## W12 Failure honesty

What is honest:

- Contact-log fetcher 400s mapped to copy in the drawer
- SMS/email result codes on dashboard + messages
- Bulk SMS disabled/quiet/error banners
- Reports denied banner
- 404 account profile (`throw new Response("Account not found", { status: 404 })`)
- Assign / comm-prefs / priority-override / sync-dismiss **throw** on write failure (loud)
- Settings holiday query `if (holidayErr) throw holidayErr`
- Test-send env-missing banners

What is not:

- Production `ErrorBoundary` shows “An unexpected error occurred.” and hides `error.message` unless `import.meta.env.DEV`. Collectors get a dead end with “Go to dashboard”. TEMP-WF-016.
- `getTwilioEnv` / `getEmailEnv` / `getQboEnv` throw on missing secrets → that ErrorBoundary. TEMP-WF-009.
- `loadCaseQueueSource` documents that PostgREST `{ data, error }` never rejects, then **ignores `error`**. A failed invoices/cases query renders the first-run-looking empty queue. `loadOrgConfig(...).catch(() => DEFAULT_ORG_CONFIG)` hides settings load failure. TEMP-WF-010.
- `qbo=*` and `sync=*` query flags are written and never read. TEMP-WF-001.
- QBO callback `oauthError` / catch redirects **omit** `headers` from `requireUser` (session refresh cookies can be dropped). TEMP-WF-017.
- Non-owner settings POST redirects with no flash. TEMP-WF-019.
- Unsubscribe POST DB error is silent. TEMP-WF-020.
- Focus log-call errors print raw codes. TEMP-WF-020 (also listed under W3).

---

## Finding cards

### [TEMP-WF-001] QBO / sync result flags are never shown

- **Severity:** major
- **Bars:** P0-managed
- **Area:** W1 first-run / W12 honesty
- **Status:** open
- **Evidence (code):** Callback and connect/disconnect/refresh redirect with `qbo=connected|error|forbidden` or `sync=ok|error` (`auth.qbo.callback.tsx:19,30,34,36`, `api.qbo.connect.tsx:14`, `api.qbo.disconnect.tsx:19,25`, `api.qbo.refresh.tsx:51,61`). `dashboard.tsx` parses `denied`, `sms`, `bulkSms`, etc., but never `qbo` or `sync`. `settings.tsx` does not either. `use-flash-cleanup.ts` FLASH_PARAMS omits both, so the flags sit in the URL with no banner.
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** After Connect, Intuit cancel, forbidden, or Refresh failure, the owner gets a silent dashboard/settings page. First-run looks broken. Member hitting Connect is redirected `qbo=forbidden` with no explanation.
- **Fix recipe:** Parse `qbo` and `sync` on dashboard + settings integrations; add role="status"/alert banners; add the keys to FLASH_PARAMS.
- **Do not:** Rely on last-sync relative time as the only success signal; it is unchanged on a no-op error.

### [TEMP-WF-002] OAuth callback never runs an initial QBO sync

- **Severity:** major
- **Bars:** P0-managed
- **Area:** W1 first-run
- **Status:** open
- **Evidence (code):** `auth.qbo.callback.tsx:32-34` `exchangeCodeForTokens` + `storeConnection` + redirect. `storeConnection` (`qbo-connection.server.ts:5-16`) upserts tokens/status only. `syncOverdueInvoices` is invoked from `api.qbo.refresh.tsx`, `qbo-cron.server.ts` (30‑min cron), and the webhook handler — not the callback. Dashboard has no Refresh button (settings integrations only).
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** Brand-new owner connects QuickBooks, lands on Collections, and sees no invoices until they discover Settings → Refresh or wait up to 30 minutes (or a webhook). First-run looks like a failed integration.
- **Fix recipe:** After `storeConnection`, kick off the same sync path as Refresh (or redirect to integrations with a “Syncing…” / Refresh CTA). Surface errors via TEMP-WF-001.
- **Do not:** Leave first-run dependent on cron/webhooks the operator may not have configured yet.

### [TEMP-WF-003] Empty queue copy assumes a filter, not an empty workspace

- **Severity:** major
- **Bars:** polish (blocks first-run comprehension → treat as P0-managed onboarding)
- **Area:** W1 first-run / W2 dashboard
- **Status:** open
- **Evidence (code):** `WorkQueue.tsx:604-614` — any `items.length === 0` (including `view=all-open` and `q=""`) shows “No accounts match this view.” and “Clear the search”. Combined with TEMP-WF-002 this is the entire first-run Collections screen.
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** New owner cannot tell “not synced yet” from “filters hid everything” from “you have no overdue invoices”.
- **Fix recipe:** Branch copy: no QBO invoices ever / connected-but-zero-overdue / filtered-empty. If never synced (`last_sync_at` null), CTA to Refresh.
- **Do not:** Keep “Clear the search” when `q` is empty.

### [TEMP-WF-004] Account profile Save preferences clears `do_not_email`

- **Severity:** blocker
- **Bars:** P0-public
- **Area:** W7 accounts / CAN-SPAM
- **Status:** open
- **Evidence (code):**
  - Profile SELECT omits the column (`accounts.$id.tsx:137-139`).
  - Directory SELECT omits it (`accounts.tsx:61-64`).
  - `AccountProfile` type and form have no Do not email checkbox (`AccountProfile.tsx:29, 120-141`).
  - `parseCommPrefsUpdate` always sets `do_not_email: form.get("do_not_email") === "true"` (`api.comm-prefs.tsx:21-22`) and the action UPDATEs that object (`:71-72`).
  - Public unsubscribe (`unsubscribe.tsx:31-33`) and dashboard drawer (`CommPrefsDrawer.tsx:63-65`) *do* persist/show the flag — the profile save undoes them.
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** A collector who saves owner or “do not call” on the account profile will re-enable collection email to someone who unsubscribed. That is a CAN-SPAM / EULA (“honor opt-out”) break.
- **Fix recipe:** Select `do_not_email` on both account loaders; add the checkbox (same semantics as the drawer); never write `do_not_email: false` unless the box is present in the form. Add a regression test that profile save preserves an existing true flag.
- **Do not:** Treat missing checkbox as false on a partial preferences form.

### [TEMP-WF-006] Messages inbox has no poll and no read state

- **Severity:** major
- **Bars:** P0-managed
- **Area:** W5 messages
- **Status:** open
- **Evidence (code):** `messages.tsx` loader is request-scoped only; the page component has `useFlashCleanup` and no timer/revalidator. `message-inbox.ts` derives `needsReply` from “last message is inbound” (`:161`) and `unansweredInbound` from messages after the last outbound — no `read_at`. Repo grep for `read_at|last_read|unread` in app/SQL: no hits. Dashboard presence interval (`DetailPanel.tsx:613-628`) is not reused here.
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** Inbound STOP/HELP/replies (Twilio webhook) sit invisible until reload. Two collectors cannot see that a thread was already opened. “Needs reply” never clears by reading.
- **Fix recipe:** Revalidate the inbox on an interval (or webhook-driven); persist per-user (or per-org) last-read; opening a thread should mark it read without requiring an outbound.
- **Do not:** Equate “needs reply” with unread — they are different jobs.

### [TEMP-WF-007] No forgot-password / recovery path

- **Severity:** major
- **Bars:** P0-managed
- **Area:** W11 auth
- **Status:** open
- **Evidence (code):** `login.tsx` is email/password/signup only. Workspace grep of `forgot|resetPassword|reset-password|recovery` in `*.ts,*.tsx`: no matches. No route in `routes.ts`.
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** A locked-out owner cannot recover the workspace. Support becomes the password-reset channel; production orgs will abandon the product on first forgotten password.
- **Fix recipe:** Add `/forgot` + `/reset` using Supabase recovery, rate-limit it, and link from login. Keep generic success copy (do not enumerate emails).
- **Do not:** Ship production auth with password-only and no recovery.

### [TEMP-WF-008] Lockout / rate-limit is not distinguishable from a generic failure

- **Severity:** major
- **Bars:** P0-managed
- **Area:** W11 auth / W12 honesty
- **Status:** open
- **Evidence (code):** `login.tsx:30-32` single `signInWithPassword`. `humanAuthError` (`auth-flow.server.ts:33-40`) maps three strings; default is “Something went wrong. Please try again.” No cooldown UI.
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** After Auth rate-limits, the user retries blindly. Combined with TEMP-WF-007 there is no exit.
- **Fix recipe:** Map known Supabase rate-limit/lockout messages to “Wait a few minutes and try again”; keep invalid-credentials copy unchanged (no user enumeration).
- **Do not:** Return 500 or the raw Auth payload.

### [TEMP-WF-009] Collector send paths 500 when provider secrets are missing

- **Severity:** major
- **Bars:** P0-managed
- **Area:** W2 SMS/email / W6 bulk / W12 honesty
- **Status:** open
- **Evidence (code):** `api.text.send.tsx:17` and `api.bulk-sms.tsx:33` call `getTwilioEnv` (throws, `env.server.ts:141-149`). `api.email.send.tsx:10` calls `getEmailEnv` (throws, `:55-58`). Contrast: `api.test-message.tsx` uses `getTwilioEnvOrNull` / `getEmailEnvOrNull` and redirects `test_sms=env`. `wrangler.toml:50-52` even documents that QBO/Twilio routes throw 500 until secrets are set.
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** A collector hitting Send on a misconfigured workspace gets the generic ErrorBoundary, not “text messaging isn’t configured”. Looks like an app crash during a customer conversation.
- **Fix recipe:** Use the `*OrNull` readers (or catch) and return the existing `sms=disabled|error` / `email=error` banners.
- **Do not:** Throw `Missing required env var` into a user-facing boundary.

### [TEMP-WF-010] Queue loaders ignore PostgREST errors (empty looks like no work)

- **Severity:** major
- **Bars:** P0-managed
- **Area:** W12 honesty / W2 dashboard
- **Status:** open
- **Evidence (code):** `case-queue.server.ts:128-151` comments that builders resolve `{ data, error }` and will not reject `Promise.all`, then destructures only `data`. `loadOrgConfig(...).catch(() => DEFAULT_ORG_CONFIG)` (`:120`, also `dashboard.tsx:175`). Failed reads → empty `items` → TEMP-WF-003 copy.
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** A RLS/outage/query failure is indistinguishable from a healthy empty book. Collectors stop working; owners think QBO is empty.
- **Fix recipe:** If `error`, throw (ErrorBoundary) or return a typed `loadError` the UI can banner. Do not default org config on failure for the live workspace path.
- **Do not:** Treat `data ?? []` as success when `error` is set.

### [TEMP-WF-011] Comm prefs drawer cannot represent preferred channel = email

- **Severity:** major
- **Bars:** P0-managed
- **Area:** W2 comm prefs
- **Status:** open
- **Evidence (code):** `CommPrefsDrawer.tsx:5-8` options `"" | call | text`. Domain `CHANNELS` includes `"email"` (`comm-prefs.ts:9`). Saving the drawer POSTs `preferred_channel` without `email`, so `parseCommPrefsUpdate` writes `null` (`api.comm-prefs.tsx:16-19`).
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** A customer marked “prefers email” is silently unmarked when a collector saves Do not text from Collections. Related wipe class to TEMP-WF-004.
- **Fix recipe:** Add `{ value: "email", label: "Email" }` to CHANNEL_OPTIONS (AccountProfile already uses `CHANNELS`).
- **Do not:** Ship two preference UIs with different channel enums.

### [TEMP-WF-012] Focus Mode skips collision / presence

- **Severity:** major
- **Bars:** P0-managed
- **Area:** W3 focus
- **Status:** open
- **Evidence (code):** `focus.tsx:57-59` `loadCaseQueueSource({ ..., includePresence: false })`. Heartbeat is sent for the current card (`:256-272`) but the loader never reads teammates’ heartbeats or recent contacts. `LogCallMiniForm` has no confirm step (unlike `LogContactDrawer`).
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** Two collectors can simultaneously Focus-call the same customer. The dashboard was built to prevent that.
- **Fix recipe:** `includePresence: true`, show the same live/recent banner, confirm before log/text (or skip the case with a toast).
- **Do not:** Treat keyboard speed as a reason to drop collision safety.

### [TEMP-WF-013] Focus key `2` ignores SMS gates

- **Severity:** minor
- **Bars:** polish
- **Area:** W3 focus
- **Status:** open
- **Evidence (code):** `FocusCard.tsx:133-138` disables the button when `!smsEnabled`. `focus.tsx:231-233` `case "2": setOpenForm(...)` has no `smsEnabled` / consent check. Mini-form then shows the hard gate.
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** Keyboard users open a dead form; button users do not. Inconsistent, not a send bypass (server still gates).
- **Fix recipe:** No-op or toast when `smsGateFor` is non-null / `!smsEnabled`, matching the button.
- **Do not:** Disable keys only in the card and not in `handleKey`.

### [TEMP-WF-014] Invite flow is undiscoverable

- **Severity:** minor
- **Bars:** polish
- **Area:** W8 settings / first teammate
- **Status:** open
- **Evidence (code):** `invite.tsx` is owner-gated and returns a raw `/accept/:token` link. Grep of `settings.tsx` / `AppShell.tsx` / `CompanyProfileForm.tsx` for `invite`: no hits.
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** Owners cannot add a collector without a documented secret URL. Not a security hole (still owner-gated).
- **Fix recipe:** Owner-only “Invite teammate” on Settings → Workspace that POSTs `/invite` and shows the link (or emails it).
- **Do not:** Email the token from the client; keep the server insert.

### [TEMP-WF-015] Reports nav for members says “coming soon”

- **Severity:** minor
- **Bars:** polish
- **Area:** W9 reports
- **Status:** open
- **Evidence (code):** `AppShell.tsx:238-252` non-owner reports item `aria-label={`${item.label} (coming soon)`}`. Loader denial + dashboard banner correctly say owner-only (`workspace.server.ts:22-23`, `dashboard.tsx:565-568`).
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** Members think the feature is unfinished rather than restricted. They may file bugs instead of asking an owner.
- **Fix recipe:** `aria-label="Reports (owners only)"` or hide the item.
- **Do not:** Link members at `/reports` and rely only on the redirect.

### [TEMP-WF-016] Production ErrorBoundary hides the failure

- **Severity:** major
- **Bars:** P0-managed
- **Area:** W12 honesty
- **Status:** open
- **Evidence (code):** `root.tsx:60-74` — 404 is specific; other `Response` uses `statusText`; non-route errors only show `error.message` when `import.meta.env.DEV`. Production copy is always “An unexpected error occurred.”
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** Combined with TEMP-WF-009/010, a missing Twilio secret or a thrown assign error looks like a crashed app. No correlation id.
- **Fix recipe:** Stable user-facing codes (“Couldn’t send the text — messaging isn’t configured”) plus an error id. Keep stacks DEV-only.
- **Do not:** Dump `error.message` with secrets in production; also do not leave collectors with only “Go to dashboard”.

### [TEMP-WF-017] QBO callback error redirects drop auth headers

- **Severity:** major
- **Bars:** P0-managed
- **Area:** W1 callback / W12 honesty
- **Status:** open
- **Evidence (code):** `auth.qbo.callback.tsx:18-19` early `redirect("/dashboard?qbo=error")` **before** `requireUser`. `:35-36` `catch { return redirect("/dashboard?qbo=error"); }` after `requireUser` **without** `{ headers }`. Success and forbidden paths pass `{ headers }` (`:30,34`).
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** A failed Intuit round-trip can drop a refreshed session cookie and bounce the owner to `/login`, on top of the missing `qbo=error` banner (TEMP-WF-001).
- **Fix recipe:** Always forward `headers` from `requireUser`; for the pre-auth error, still use the optional-user client headers.
- **Do not:** Catch-all-and-redirect without the supabase cookie jar.

### [TEMP-WF-018] Promise cancel is missing from the Promises ledger

- **Severity:** minor
- **Bars:** polish
- **Area:** W4 promises
- **Status:** open
- **Evidence (code):** Cancel UI lives only on `DetailPanel.tsx:1025-1056`. `PromiseQuickPanel.tsx` has open-in-Collections / view-account only. `api.promises.cancel.tsx` is generic (`safeReturnTo`).
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** Extra navigation; cancel still exists, so not a functional hole if the collector knows to open Collections.
- **Fix recipe:** Same confirm+POST on the ledger panel when `status === "pending"`.
- **Do not:** Cancel from the ledger without the confirm step.

### [TEMP-WF-019] Non-owner settings POST is a silent no-op

- **Severity:** minor
- **Bars:** polish
- **Area:** W8 settings / W12 honesty
- **Status:** open
- **Evidence (code):** `api.org-settings.tsx:26` `if (org.role !== "owner") return redirect(returnTo, { headers });` — no `error=` / `denied=`. UI hides most owner forms, so this is a crafted-request / stale-tab case.
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** A member who still has a Save button (e.g. Collections rules fields are visible but disabled; if a browser ignores `disabled`) thinks Save worked.
- **Fix recipe:** `redirect(flag(returnTo, "denied", "owner"))` and a banner. Keep RLS as the real boundary.
- **Do not:** Return 200 with no mutation and no flash.

### [TEMP-WF-020] Unsubscribe POST failure (and Focus log errors) are silent / raw

- **Severity:** minor
- **Bars:** P0-public (unsubscribe) / polish (Focus codes)
- **Area:** W10 unsubscribe / W3 focus / W12 honesty
- **Status:** open
- **Evidence (code):** `unsubscribe.tsx:34` on DB error returns `{ valid: true, done: false }` — UI falls through to the confirm form with no `role="alert"`. `LogCallMiniForm.tsx:58-61,126-127` renders `fetcher.data.error` raw (`bad-next-step`, etc.) instead of `ERROR_MESSAGE` from `LogContactDrawer`.
- **Evidence (live):** not tested — no local Supabase/Docker in this environment
- **User / legal impact:** A failed CAN-SPAM opt-out looks like the button did nothing; the recipient may retry or give up still subscribed. Focus users see parser tokens.
- **Fix recipe:** Unsubscribe: `{ done: false, error: true }` + “Couldn’t save your request — try again.” Focus: reuse the dashboard error map.
- **Do not:** Redisplay a confirm form after a failed legal opt-out without saying it failed.

---

## Notes (not filed)

- Signup confirm-vs-session, CSRF `requireSameOrigin` on authenticated POSTs, owner-gated QBO POST vs unsigned Intuit GET disconnect, and RFC 8058 GET-vs-POST unsubscribe are implemented as designed.
- Promise evaluation is intentionally sync-driven; the ledger says so.
- Focus log-call outcomes are a deliberate subset of the full drawer.
- `save_sms_sender` locked for everyone is intentional tenant isolation, and the error copy is honest when that intent is posted.
- Live browser, actual Intuit OAuth, Resend/Twilio delivery, and email-confirm inbox were **not** exercised (environment: no Docker, no `.env.test`, no local Supabase).
