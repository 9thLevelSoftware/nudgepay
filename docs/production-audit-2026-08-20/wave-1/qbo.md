# Wave 1 — QBO / OAuth / sync / webhooks / cron

- **Auditor:** Wave 1 (Backend Architect)
- **HEAD:** `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc`
- **App:** `nudgepay-app/`
- **Date:** 2026-08-20
- **Method:** code-only re-audit at freeze; no product edits; live Intuit/sandbox not exercised
- **Prior:** `docs/codebase-audit-2026-07-13.md` (B8, B9, M9, M17–M21, M26, gaps 21–23, 25)

## Hunt checklist

| Hunt | Result | Card / note |
|------|--------|-------------|
| No auto first sync | **Open, reconfirmed B8** | TEMP-QBO-001 |
| `qbo=` query unused | **Open, reconfirmed M17** | TEMP-QBO-002 |
| Dead connection stays connected | **Open, reconfirmed B9** | TEMP-QBO-003 |
| Realm switch merges books | **Open, reconfirmed M19** | TEMP-QBO-004 |
| Query cap 1000 truncated discarded | **Open, reconfirmed M18** | TEMP-QBO-005 |
| CDC watermark after process | **Open, reconfirmed gap 22** | TEMP-QBO-006 |
| Deletions / voids | **Open, reconfirmed M26** | TEMP-QBO-007 |
| Webhook sync-before-ack vs waitUntil | **Open, reconfirmed M20** | TEMP-QBO-008 |
| CloudEvents unverified | **Open, reconfirmed gap 25** | TEMP-QBO-009 |
| Cron serial orgs | **Open, reconfirmed M21** | TEMP-QBO-010 |
| GET disconnect must not clear tokens | **Solid** (requirement met) | see Solid |
| POST disconnect unconfirmed | **Open** | TEMP-QBO-011 |
| Encryption AES-GCM | **Solid** | see Solid |
| `user_id` oauth bind (0034) | **Solid** | see Solid |
| `QBO_SANDBOX` | **Partial** — production.vars is `"false"`; runtime defaults **true** unless exact `"false"` | TEMP-QBO-014 |
| Paid invoice re-pull | **Partial** — payment/CDC/webhook path yes; manual Refresh no | TEMP-QBO-012 |
| Sync errors visibility | **Partial** — Settings Integrations only; dashboard badge unmounted (M9) | TEMP-QBO-013 |

---

## Findings

### [TEMP-QBO-001] First connect never runs a full overdue sync
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** qbo
- **Status:** reconfirmed (prior B8)
- **Evidence (code):** `nudgepay-app/app/routes/auth.qbo.callback.tsx:32-34` stores tokens and redirects to `/dashboard?qbo=connected` with no `syncOverdueInvoices` / `runCdcCatchup` / `waitUntil`. `nudgepay-app/app/lib/qbo-sync.server.ts:287-293` first CDC window is **7 days** (capped at 30). `nudgepay-app/app/routes/api.qbo.refresh.tsx:43-51` is the only full overdue pull, behind the Settings "Refresh" button. `nudgepay-app/app/lib/orgs.server.ts:35-69` does not seed a `qbo_connections` row or enqueue a sync on org create.
- **Evidence (live):**
- **User / legal impact:** After Intuit consent the owner lands on an empty collections dashboard. Overdue invoices older than 7 days and unchanged will not arrive via CDC/cron. Collections work is invisible until someone discovers Refresh. First-run product failure for Chancey.
- **Fix recipe:** files, behavior, tests, verify
  - `auth.qbo.callback.tsx`: after `storeConnection`, call `syncOverdueInvoices` (or `ctx.waitUntil` it) then redirect. On sync failure still leave status `connected` and `recordSyncError` (`source: "manual"`, `scope: "full"`).
  - Optionally reset `last_cdc_time` to null on first connect so CDC backfills from the 7-day window *after* the full overdue pull.
  - Tests: callback (or extracted helper) with mocked QBO query upserts overdue invoices; failure path records `sync_errors` and still redirects connected.
  - Verify: connect sandbox company with invoices older than 7 days → dashboard shows them without clicking Refresh.
- **Do not:** block the OAuth redirect on a long sync without `waitUntil` (Intuit callback timeouts). Do not rely on CDC-only first run.

### [TEMP-QBO-002] `qbo=` and `sync=` outcome params are never rendered
- **Severity:** major
- **Bars:** polish
- **Area:** qbo
- **Status:** reconfirmed (prior M17)
- **Evidence (code):** Writers: `auth.qbo.callback.tsx:19,30,34,36` (`qbo=error|forbidden|connected`), `api.qbo.connect.tsx:14`, `api.qbo.disconnect.tsx:19,25`, `api.qbo.refresh.tsx:51,61` (`sync=ok|error`). Readers: `dashboard.tsx:239-253` and `535-548` flash banners for `saved` / `bulkAssign` / `bulkSms` / `denied` — **not** `qbo` or `sync`. `settings.tsx:165` calls `useFlashCleanup` but never reads those params. `use-flash-cleanup.ts:14-19` FLASH_PARAMS omits `qbo` and `sync` (they linger in the URL unused).
- **Evidence (live):**
- **User / legal impact:** Failed connect, forbidden member, or failed Refresh looks like a no-op. Success is silent. Operators cannot tell connect from error without reading the URL.
- **Fix recipe:** files, behavior, tests, verify
  - Render banners on `/settings?tab=integrations` and `/dashboard` for `qbo=connected|error|forbidden|disconnected` and `sync=ok|error`.
  - Add `qbo` and `sync` to `FLASH_PARAMS` so they strip after display.
  - Tests: settings/dashboard render the copy; flash cleanup removes the params.
- **Do not:** leak Intuit error bodies into the banner. Do not treat query params as authorization.

### [TEMP-QBO-003] Dead QBO connection reports "Connected" forever
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** qbo
- **Status:** reconfirmed (prior B9)
- **Evidence (code):** `qbo-connection.server.ts:13` writes `status: "connected"`; `:61-62` writes `"disconnected"` only from explicit disconnect. `getValidAccessToken` `:33-35,41-45` throws on missing refresh token or failed `refreshTokens`; it never updates `status`. `getConnectionStatus` `:18-24` returns the stored status blindly. UI: `workspace.server.ts:35-59`, `dashboard.tsx:197-213`, `settings.tsx:160,228-229` treat `status === "connected"` as healthy (copper chip, "Synced Xm ago" / "Connected"). Cron `:42-54` records `sync_errors` but leaves status connected. Intuit GET disconnect (`api.qbo.disconnect.tsx:32-48`) does not clear tokens (correct) so Intuit-side revoke + this bug = permanently green + frozen AR.
- **Evidence (live):**
- **User / legal impact:** Refresh-token expiry (~100 days unused) or Intuit-side revoke freezes invoices/payments while the product shows Connected. Team keeps dunning from stale balances. No reconnect prompt.
- **Fix recipe:** files, behavior, tests, verify
  - On refresh 400/401/invalid_grant, set `status` to `error` (or `disconnected`), keep `realm_id` for reconnect, `recordSyncError`.
  - Surface `error` in Settings + dashboard chip + require reconnect (owner).
  - Tests: `getValidAccessToken` mock 400 → status `error`; UI copy; cron still isolates the org.
- **Do not:** mark disconnected on transient 5xx/429. Do not clear tokens from the unsigned GET Intuit landing (TEMP-QBO-011 / GET-solid). Do not change status from the webhook 401 path.

### [TEMP-QBO-004] Reconnecting a different QuickBooks company merges two books
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** qbo
- **Status:** reconfirmed (prior M19)
- **Evidence (code):** `qbo-connection.server.ts:11-14` upserts `{ org_id, realm_id, tokens, status: "connected" }` on `org_id` only — does not compare previous `realm_id`, does not null `last_cdc_time` / `last_sync_at`, does not purge `customers` / `invoices` / `payments` / `collection_cases`. Settings Reconnect is the same `POST /api/qbo/connect` (`settings.tsx:243-246`). Unique realm index `0005_qbo_sync.sql:5-7` only prevents two orgs sharing one realm, not one org switching realms. After switch, CDC `:287-293` continues from the **previous company's** watermark.
- **Evidence (live):**
- **User / legal impact:** Mixed AR of two legal entities in one workspace. Cases, SMS, and promises can target the wrong company's customers. CDC will not full-backfill the new book.
- **Fix recipe:** files, behavior, tests, verify
  - `storeConnection`: if existing `realm_id` is non-null and differs, refuse or require an explicit "replace company" POST that (service-role) deletes org-scoped QBO-sourced rows (`invoices`, `payments`, QBO-keyed `customers` keeping local notes if specified), nulls `last_cdc_time`, then stores tokens.
  - Tests: same-realm reconnect keeps data; different-realm without confirm throws; with confirm purges and resets CDC cursor.
- **Do not:** delete `contact_logs` / `text_messages` / local `customers.notes` without a spec. Do not upsert a second `qbo_connections` row per org (schema is 1:1).

### [TEMP-QBO-005] Query/CDC page cap 1000; `truncated` is computed and discarded
- **Severity:** major
- **Bars:** P0-public
- **Area:** qbo
- **Status:** reconfirmed (prior M18)
- **Evidence (code):** `qbo-sync.server.ts:26-28,148,158,187,197,74` — every query uses `startposition 1 maxresults ${QUERY_LIMIT}` with `QUERY_LIMIT = 1000`. Comment sizes the cap to Chancey (125–175 overdue). `truncated: overdueInvoices.length >= QUERY_LIMIT` at `:227` is returned from `syncOverdueInvoices` and ignored by `api.qbo.refresh.tsx:44`. Migration `0013_sync_errors.sql:3-4` says truncated is intentionally **not** recorded. `qboCdc` (`qbo-api.server.ts:45-59`) does not page `QueryResponse` / `maxResults`; Intuit CDC also pages at 1000/entity. Customer `Id in (...)` lists are themselves capped at 1000 (`:187,197`).
- **Evidence (live):**
- **User / legal impact:** Orgs above ~1000 overdue (or 1000 CDC changes / 30 min) silently drop the tail. Collections on dropped invoices never open. Pilot size fits; public does not.
- **Fix recipe:** files, behavior, tests, verify
  - Page `startposition` until a short page; page CDC while `maxResults` is full.
  - If still truncated, `recordSyncError` and surface in Settings.
  - Honor `truncated` in `api.qbo.refresh.tsx` (`sync=truncated`).
  - Tests: 1001 mock invoices → two queries, 1001 upserts; single-page 1000 still flags warning.
- **Do not:** raise the cap without paging (Intuit maxresults max is 1000). Do not let coming-due paging displace overdue (current split queries are correct — keep that).

### [TEMP-QBO-006] CDC watermark stamped with local time after fetch/processing
- **Severity:** major
- **Bars:** P0-managed
- **Area:** qbo
- **Status:** reconfirmed (prior gap 22)
- **Evidence (code):** `qbo-sync.server.ts:289-325`. `changedSince` is `last_cdc_time` (or now−7d). `qboCdc` is awaited. `now = new Date()` is taken **after** the fetch (`:302`) and written as `last_cdc_time` **after** upserts + payment eval (`:320-322`). Intuit CDC responses include a server `time`; it is unused (`qbo-api.server.ts:52-59` only flattens entity arrays).
- **Evidence (live):**
- **User / legal impact:** Changes that land between Intuit's CDC snapshot and our post-processing clock are skipped on the next catch-up. Combined with webhook timeouts (TEMP-QBO-008) this is a real hole, not just a theoretical race.
- **Fix recipe:** files, behavior, tests, verify
  - Capture `changedSince` (or CDC response `time`) **before** the HTTP call; persist **that** timestamp (or Intuit's `time`), not `new Date()` after work.
  - Tests: fake CDC delay; assert `last_cdc_time` ≤ request start / equals payload `time`.
- **Do not:** set `last_cdc_time` on a failed catch-up (today it only writes after success — keep that). Do not use a watermark in the future.

### [TEMP-QBO-007] QBO deletions/voids are mishandled (clobber + retry storm)
- **Severity:** major
- **Bars:** P0-managed
- **Area:** qbo
- **Status:** reconfirmed (prior M26)
- **Evidence (code):**
  - Webhook parses `operation` (`qbo-webhook.server.ts:60,79`; test includes `operation: "Delete"`) but `webhooks.qbo.tsx:60-63` never reads it — Delete still calls `applyInvoiceWebhook` / `applyCustomerWebhook`.
  - `qboReadEntity` + `getJson` (`qbo-api.server.ts:16-22,35-42`) throw on non-2xx. Deleted entity GET is typically 400 Fault, not a null body. `applyInvoiceWebhook` `:251` `if (!inv) return` is therefore unreachable on delete. Webhook catch records `sync_errors` and returns **500** (`webhooks.qbo.tsx:66-76`) → Intuit retries the **whole batch**.
  - CDC (`qbo-api.server.ts:55-58`, `runCdcCatchup` `:297-306`) upserts every entity including CDC `status: "Deleted"` skeletons. `mapQboCustomer` (`qbo-mappers.server.ts:31-38`) becomes `name: "(unnamed)"`, `email/phone: null` and **clobbers** the real customer. `mapQboInvoice` maps missing Balance to 0 / `paid` via the NaN guard (`:26-28,50-62`) — better for invoices, destructive for customers.
- **Evidence (live):**
- **User / legal impact:** Deleted invoices stay open with old balances (webhook path) so reps keep dunning vanished invoices. CDC delete of a customer overwrites the display name to "(unnamed)" and wipes email/phone used for SMS/email. Permanent 500s on Delete events can get the webhook subscription throttled (with TEMP-QBO-008).
- **Fix recipe:** files, behavior, tests, verify
  - If `operation` is Delete/deleted (legacy + CloudEvents), mark local invoice balance 0 / status `voided|deleted` (or delete the row) and skip GET; for customers, do not upsert a skeleton — deactivate or leave local identity.
  - CDC: skip or special-case `status === "Deleted"` before `mapQbo*`.
  - `qboReadEntity`: treat 400 "Object Not Found" as null, not throw.
  - Tests: Delete webhook → 200, invoice not leftover overdue; CDC deleted customer does not become "(unnamed)".
- **Do not:** return 500 on a known-deleted entity. Do not upsert CDC skeletons. Do not send SMS to a customer whose QBO record was deleted without a product decision.

### [TEMP-QBO-008] QBO webhook applies entities inline before 200; no `waitUntil`
- **Severity:** major
- **Bars:** P0-public
- **Area:** qbo
- **Status:** reconfirmed (prior M20)
- **Evidence (code):** `webhooks.qbo.tsx:12-77` verifies HMAC, then **synchronously** loops events: realm lookup, QBO GET, upserts, case recon, promise eval, optional email, then 200 or 500. `workers/app.ts:30-33` uses `ctx.waitUntil` only for cron. App code has **zero** `cloudflare.ctx` / `waitUntil` usages in routes. A 500 on any event (`:75`) asks Intuit to retry the entire batch (comment at `:41-43` is intentional for at-least-once).
- **Evidence (live):**
- **User / legal impact:** Intuit expects a fast 2xx. Slow batches look like failures, retry while the original still runs, and can suspend the webhook subscription. Collections then depend on 30-min cron only.
- **Fix recipe:** files, behavior, tests, verify
  - After signature verify, `context.cloudflare.ctx.waitUntil(process(events))` and return 200 immediately (or 202). Persist a delivery id if adding exactly-once later.
  - Keep per-event `recordSyncError`; do not 500 the HTTP ack for a single poison Delete (TEMP-QBO-007).
  - Tests: action returns 200 before mocked slow QBO GET completes (fake timer / waitUntil spy).
- **Do not:** ack 200 before HMAC verify. Do not drop per-event isolation. Do not skip `recordSyncError`.

### [TEMP-QBO-009] CloudEvents parser is still unverified; unknown payloads ack 200 and drop
- **Severity:** major
- **Bars:** P0-public
- **Area:** qbo
- **Status:** reconfirmed (prior gap 25)
- **Evidence (code):** `qbo-webhook.server.ts:85-99` still ships `NOTE: confirm exact CloudEvents field casing/nesting against a real Intuit payload before production cutover`. Parser uses `ev.intuitaccountid` / `ev.intuitentityid` / `type` `qbo.<entity>.<event>.vN` (`:66-82`). Those field names match Intuit's Nov 2025 CloudEvents sample (`intuitentityid`, `intuitaccountid`, `type: "qbo.account.created.v1"`), but: (1) no captured production payload in repo; (2) tests use guessed `qbo.invoice.update.v1` / `create` (`tests/qbo-webhook.test.ts:56-65`), not Intuit's past-tense `created`/`updated`; (3) `ENTITY_CASING` has `creditmemo` not `credit_memo`; (4) `parseQboWebhook` returns `[]` for unrecognized JSON; (5) `webhooks.qbo.tsx:45-76` with zero entities returns **200 ok**.
- **Evidence (live):**
- **User / legal impact:** Flipping Intuit's CloudEvents toggle can silently stop all live sync while HMAC still verifies. Cron (30 min, 7-day first window) is the only remaining path.
- **Fix recipe:** files, behavior, tests, verify
  - Capture one real sandbox CloudEvents POST (headers + body) and lock a fixture.
  - Accept `created|updated|deleted` and `create|update|delete`; map `credit_memo` / `creditmemo`.
  - If signature is valid but zero entities parsed from non-empty body, 400/500 so Intuit retries and operators see it — do not 200 an unparsed payload.
  - Tests: fixture from Intuit sample + empty-parse-nonempty-body fails closed.
- **Do not:** drop the legacy `eventNotifications` parser (Intuit has not finished the cutover). Do not 200 on parse-zero of a non-empty body.

### [TEMP-QBO-010] CDC cron is one serial loop over all connected orgs
- **Severity:** major
- **Bars:** P0-public
- **Area:** qbo
- **Status:** reconfirmed (prior M21)
- **Evidence (code):** `qbo-cron.server.ts:19-57` selects all `status='connected'`, then `for (const c of conns ?? []) { await runCdcCatchup(...) }`. Per-org try/catch + `recordSyncError` is correct isolation (`:47-55`). `wrangler.toml:17-20,29-31` fires `*/30 * * * *`. `workers/app.ts:31-33` `waitUntil(runScheduledCdc)` — no time budget, checkpoint, or concurrency limit. Each catch-up is multiple Intuit GETs + writes (TEMP-QBO-005/006).
- **Evidence (live):**
- **User / legal impact:** One org is fine (P0-managed). N orgs × slow CDC approaches Worker scheduled wall-clock; orgs later in `org_id` order starve. Combined with TEMP-QBO-003 a single dead token still iterates but should not abort others (today it does not — keep that).
- **Fix recipe:** files, behavior, tests, verify
  - Bound wall time; checkpoint last-processed `org_id`; or `Promise.all` with a small concurrency (2–3) and 429-aware backoff (TEMP-QBO-015).
  - Tests: two orgs, second still runs when first throws (already true); add a time-budget test if you introduce one.
- **Do not:** remove per-org try/catch. Do not run unbounded parallel Intuit calls (429).

### [TEMP-QBO-011] POST Disconnect has no confirmation
- **Severity:** major
- **Bars:** polish
- **Area:** qbo
- **Status:** open
- **Evidence (code):** `settings.tsx:248-253` — owner button POSTs `/api/qbo/disconnect` with no `confirm()` / dialog (repo `window.confirm` exists only in `TemplateEditor.tsx`). `api.qbo.disconnect.tsx:13-25` owner-gates, revokes refresh token, nulls tokens/realm, `status: "disconnected"`. CSRF: `requireUser` → `requireSameOrigin` (`session.server.ts:26-27`). GET loader (`:32-48`) correctly does **not** mutate (see Solid).
- **Evidence (live):**
- **User / legal impact:** One misclick revokes Intuit tokens and blanks the connection. Reconnect is possible but first sync is still not automatic (TEMP-QBO-001), so the queue empties.
- **Fix recipe:** files, behavior, tests, verify
  - Confirm dialog or two-step POST (`confirm=1`) before `disconnectConnection`.
  - Keep GET landing mutation-free.
- **Do not:** clear tokens from GET. Do not allow members to POST disconnect (owner check is correct).

### [TEMP-QBO-012] Manual Refresh does not re-pull paid invoices or payments
- **Severity:** major
- **Bars:** P0-managed
- **Area:** qbo
- **Status:** open (payment-path re-pull is solid; Refresh is not)
- **Evidence (code):** `repullCustomerInvoices` (`qbo-sync.server.ts:63-83`) correctly queries invoices **without** `Balance > 0` and is covered by `tests/qbo-sync-payments.test.ts`. It runs only when `applyPaymentsAndEvaluate` is given payment rows (`:103-106`). `syncOverdueInvoices` queries `Balance > '0'` (`:146-160`) and calls `applyPaymentsAndEvaluate(..., [], ...)` (`:214-215`) — empty payments → no re-pull. `api.qbo.refresh.tsx:44-50` comment claims Refresh pulls "overdue invoices + their payments"; it does not query Payment/CreditMemo. Paid-off invoices therefore stay overdue locally until a Payment webhook/CDC event arrives.
- **Evidence (live):**
- **User / legal impact:** Operator hits Refresh after recording a payment/void in QBO and the invoice still shows overdue. They may SMS a paid customer. Webhook/CDC usually converge within 30 min — Refresh as a "sync now" control is a lie for the paid path.
- **Fix recipe:** files, behavior, tests, verify
  - On Refresh, either run `runCdcCatchup` in addition to (or instead of) the overdue query, or query recent payments, or re-pull all currently-local open invoices by QBO id (no Balance filter).
  - Tests: local overdue invoice + QBO Balance 0 and no payment in the mock → Refresh sets balance 0 and reconciles the case.
- **Do not:** drop the payment-path re-pull. Do not resolve webhook/cdc `sync_errors` from a Refresh that did not re-fetch those entities (`api.qbo.refresh.tsx:45-50` scope=`full` only — keep that).

### [TEMP-QBO-013] Sync failures are invisible outside Settings → Integrations
- **Severity:** major
- **Bars:** P0-managed
- **Area:** qbo
- **Status:** reconfirmed (prior M9)
- **Evidence (code):** Durable log is real: `sync-errors.server.ts`, `0013_sync_errors.sql`, RLS member read, `api.sync-errors.dismiss.tsx` org-scoped, Settings list `settings.tsx:35-41,269-291`. `SyncIssues.tsx` header badge exists (`hidden sm:inline-flex` — already hidden on mobile). **Zero routes import it.** `AppShell` has a `syncIssues` slot (`:17,139`); `dashboard.tsx:519-534` does not pass it; `reports.tsx` passes `null`. Dashboard loader never selects `sync_errors`.
- **Evidence (live):**
- **User / legal impact:** Cron/webhook failures that freeze AR (TEMP-QBO-003) are only visible if someone opens Settings → Integrations. Collections team works a stale queue with a green chip.
- **Fix recipe:** files, behavior, tests, verify
  - Load unresolved `sync_errors` in workspace chrome; mount `<SyncIssues>` on dashboard/accounts/focus.
  - Show the chip on mobile (drop `hidden sm:inline-flex`).
- **Do not:** auto-dismiss errors. Do not let dismiss cross orgs (dismiss route already pins `org_id`).

### [TEMP-QBO-014] `QBO_SANDBOX` defaults true unless the string is exactly `"false"`
- **Severity:** minor
- **Bars:** P0-public
- **Area:** qbo
- **Status:** open
- **Evidence (code):** `env.server.ts:44` `QBO_SANDBOX: e.QBO_SANDBOX !== "false"`. Top-level `wrangler.toml:9` `QBO_SANDBOX = "true"`; `[env.production.vars]` `:27` is `"false"`. `qboApiBaseUrl` is used by refresh, webhook, cron — OAuth URLs in `qbo-client.server.ts` are always production Intuit OAuth (correct). Deploy without `--env production` talks to **sandbox** Data API with whatever client id is in secrets.
- **Evidence (live):**
- **User / legal impact:** Wrong-company data or empty sandbox books in a supposed production workspace. Intuit production app review expects production Data API.
- **Fix recipe:** files, behavior, tests, verify
  - Fail closed in production if `QBO_SANDBOX` is unset; accept only `"true"|"false"`.
  - Deploy gate: `wrangler deploy --env production` required; document.
- **Do not:** switch OAuth host with this flag (Intuit uses one OAuth host; keys differ).

### [TEMP-QBO-015] No 429 / backoff / retry on Intuit API calls
- **Severity:** minor
- **Bars:** P0-public
- **Area:** qbo
- **Status:** reconfirmed (prior gap 21)
- **Evidence (code):** `qbo-api.server.ts:16-22` `if (!res.ok) throw new Error(\`QBO API request failed: ${res.status}\`)`. Same for token POST (`qbo-client.server.ts:36`). No `Retry-After`, no retry, no jitter. Webhook 500 then re-delivers the batch; cron waits 30 min.
- **Evidence (live):**
- **User / legal impact:** A rate-limit during Refresh or CDC marks a durable error and (webhook) 500s Intuit. Under public load this clusters with TEMP-QBO-008/010.
- **Fix recipe:** files, behavior, tests, verify
  - Retry 429/5xx 2–3 times with Retry-After/backoff in `getJson` / `postForTokens`.
  - Tests: first 429 then 200 succeeds; persistent 429 throws.
- **Do not:** retry 400/401 (those are TEMP-QBO-003). Do not retry forever inside the webhook request (use waitUntil + bounded retries).

### [TEMP-QBO-016] `invoices.status` goes stale when a due date passes with no QBO change
- **Severity:** minor
- **Bars:** polish
- **Area:** qbo
- **Status:** reconfirmed (prior gap 23)
- **Evidence (code):** `invoiceStatus` (`qbo-mappers.server.ts:41-45`) runs only at upsert time. Work queue aging uses `due_date` vs org-local today (`cases.ts:141`) so the queue is mostly right. `AccountProfile.tsx` still displays stored `inv.status`.
- **Evidence (live):**
- **User / legal impact:** An invoice due yesterday still labeled "open" on the account page until the next sync touches it. Dunning from the queue is less affected.
- **Fix recipe:** files, behavior, tests, verify
  - Derive display status from `balance` + `due_date` + today (pure), or recompute on CDC/cron even when QBO sends no change.
- **Do not:** use stored `status` as the collections source of truth (due_date path is correct — keep it).

### [TEMP-QBO-017] QBO entity ids interpolated raw into query strings
- **Severity:** minor
- **Bars:** P0-managed
- **Area:** qbo
- **Status:** open
- **Evidence (code):** `qbo-sync.server.ts:71-74,184-187,194-197` `` `... CustomerRef in (${idList})` `` / `` `Id in (${idList})` `` with `ids.map((id) => `'${id}'`)`. Ids come from QBO JSON, not the user, but are unsanitized.
- **Evidence (live):**
- **User / legal impact:** A malformed/malicious Id containing `'` breaks the query or changes its predicate. Low likelihood; defense in depth is missing.
- **Fix recipe:** files, behavior, tests, verify
  - Allow only `/^[A-Za-z0-9-]+$/` (QBO Ids) before interpolation.
  - Tests: quote in id is rejected; numeric id queries.
- **Do not:** pass user input into QBO queries.

### [TEMP-QBO-018] OAuth callback swallows all errors; consume is SELECT then DELETE
- **Severity:** minor
- **Bars:** P0-managed
- **Area:** qbo
- **Status:** open
- **Evidence (code):** `auth.qbo.callback.tsx:35-36` `catch { return redirect("/dashboard?qbo=error") }` hides unique-realm conflicts (`0005_qbo_sync.sql:5-7`), encrypt failures, and Intuit 400s behind the same unused query param (TEMP-QBO-002). `consumeOAuthState` (`oauth-state.server.ts:22-34`) SELECTs then DELETEs; PostgREST delete of 0 rows is not an error, so two overlapping consumes can both pass `if (!data)` (Intuit auth codes are still single-use).
- **Evidence (live):**
- **User / legal impact:** Connecting a realm another org already claimed looks like a generic failure. Concurrent double-submit is saved by Intuit, not by us.
- **Fix recipe:** files, behavior, tests, verify
  - Map unique-realm to `qbo=realm-taken`. Log the caught error.
  - Consume with `DELETE … RETURNING` (or RPC) so a second consume sees no row.
- **Do not:** weaken the `user_id` + owner + org bind (`callback.tsx:29`). Do not consume after token exchange (replay window).

---

## What is solid

Each item is true at HEAD `820fb1ba` with a file:line.

### OAuth start / state / callback bind

- `POST /api/qbo/connect` is owner-only; members get `qbo=forbidden` (`api.qbo.connect.tsx:13-15`). GET loader redirects (`:26-28`).
- Authorize URL includes `client_id`, `scope=com.intuit.quickbooks.accounting`, `redirect_uri`, `response_type=code`, `state` (`qbo-client.server.ts:13-21`).
- State nonce is 24 random bytes hex, 600s TTL, stored with `org_id` **and** `user_id` (`oauth-state.server.ts:3-19`; migration `0034_oauth_state_user_binding.sql:1-12` NOT NULL + FK to `auth.users`).
- `oauth_states` has RLS enabled and **no policies** — service-role only (`0004_qbo_oauth.sql:8-10`).
- Consume is single-use: row is deleted before success is returned; unknown/expired throw (`oauth-state.server.ts:22-34`). Tests: `tests/oauth-state.test.ts:15-43`.
- Callback requires a logged-in user, then `org.role === "owner" && org.org_id === oauthState.orgId && user.id === oauthState.userId` (`auth.qbo.callback.tsx:24-31`). Cross-user completion of a stolen callback URL is rejected (state already burned).
- Callback is GET from Intuit: `requireSameOrigin` skips GET (`csrf.server.ts:12-14,16-23`; `session.server.ts:26-27`), so the Intuit redirect is not 403'd.
- Session expiry during the Intuit dance: `requireUser` on GET preserves `returnTo` including `code`/`state` (`session.server.ts:15-24`); login posts that `returnTo` (`login.tsx:37-38`). TTL 10 min is the remaining risk.
- `exchangeCodeForTokens` posts `authorization_code` + Basic auth to Intuit (`qbo-client.server.ts:41-45,27-38`). Tests: `tests/qbo-client.test.ts:12-44`.

### Token storage / AES-GCM / refresh rotation

- Tokens encrypted AES-256-GCM via Web Crypto; key must be 32 bytes base64; 12-byte random IV; payload `v1:<iv>:<ct>` (`crypto.server.ts:16-44`). Tests: round-trip, unique IV, wrong key, tamper, short key (`tests/crypto.test.ts`).
- Ciphertext stored as text (`0004_qbo_oauth.sql:12-17`); tests assert no plaintext in DB (`tests/qbo-connection.test.ts:17-29`).
- `getValidAccessToken` skips refresh when `expiresAt > now+60s`; on refresh persists **rotated** refresh token via `storeConnection` (`qbo-connection.server.ts:26-45`; test `:32-47`).
- Refresh/revoke use confidential-client Basic auth (`qbo-client.server.ts:9-11,47-59`).
- Privacy policy accurately describes AES-256 at rest and no browser exposure (`privacy.tsx:28-31`) for the **in-app POST** disconnect path.

### Disconnect

- **GET `/api/qbo/disconnect` must not clear tokens — held.** `intuitDisconnectPlan` always `{ clear: false, orgId: null }` (`auth-flow.server.ts:18-27`). Loader uses `getOptionalUser` (no login bounce), computes `plan`, and `void plan` (`api.qbo.disconnect.tsx:32-40`). HTML only. Tests: `tests/auth-flow.test.ts:20-32` (owner, member, no session).
- POST disconnect is owner-gated, CSRF-same-origin via `requireUser`, `safeReturnTo` on the form, revokes refresh token best-effort, then nulls tokens/realm and sets `disconnected` (`api.qbo.disconnect.tsx:13-25`; `qbo-connection.server.ts:48-65`; test `:72-81`).
- Members cannot mutate `qbo_connections` via RLS (`0032_security_hardening.sql:27-33`; `tests/rls.test.ts:50-68`). Owners write; service role used for OAuth/sync.

### Tenancy / realm uniqueness

- One connection row per org (`qbo_connections.org_id unique`, `0001_tenancy_schema.sql:98-109`).
- Partial unique index on non-null `realm_id` (`0005_qbo_sync.sql:1-7`) so webhooks can `.maybeSingle()` by realm (`webhooks.qbo.tsx:46-47`) and two orgs cannot claim one QBO company.
- Unknown/disconnected realm on webhook is ignored (`webhooks.qbo.tsx:56`); DB error on lookup sets `hadFailure` rather than failing open (`:48-54`).

### Webhook authentication and isolation

- HMAC-SHA256 of **raw body** with verifier token, base64, timing-safe compare; missing header → false (`qbo-webhook.server.ts:12-37`). Verified **before** DB/QBO (`webhooks.qbo.tsx:16-20`). Tests: round-trip, tamper, wrong token, missing header, 401 on route (`tests/qbo-webhook.test.ts`, `tests/webhooks-route.test.ts`).
- `getQboEnv` requires `QBO_WEBHOOK_VERIFIER_TOKEN` (`env.server.ts:31-37`) — unsigned webhooks cannot be deployed by omitting the secret (route 500s instead).
- Per-event try/catch records `sync_errors` and continues (`webhooks.qbo.tsx:41-73`). Successful entity apply resolves only that `scope` (`:65`). Wiring test: `tests/sync-errors-wiring.test.ts:28-53`.
- Entity allow-list: Invoice / Customer / Payment / CreditMemo; others `continue` without resolving errors (`:60-64`).
- Legacy `eventNotifications` parser flattens multi-realm batches (`qbo-webhook.server.ts:55-64`; test `:32-50`).
- Broken-promise emails on webhook/refresh/cron are ledger-deduped (`notifications.server.ts:90-99`).

### Data API client

- Sandbox vs production host is **only** the Data API base URL (`qbo-api.server.ts:10-14`; `env.server.ts:44`). OAuth URLs stay on Intuit production hosts (`qbo-client.server.ts:1-3`). Production wrangler sets `QBO_SANDBOX = "false"` (`wrangler.toml:27`).
- `minorversion=65` on query/read/CDC (`qbo-api.server.ts:8,30,40,51`).
- `fetchFn` injected everywhere; tests mock HTTP (`qbo-api.test.ts`, `qbo-sync.test.ts`).
- `qboQuery` missing entity key → `[]` (`:32`; test).
- `qboReadEntity` missing key on 2xx → `null` (`:42`; test).
- CDC requests `Invoice,Customer,Payment,CreditMemo` and flattens all four (`qbo-api.server.ts:49-58`; `tests/qbo-api.test.ts:59-84`).
- Overdue vs coming-due are **separate** capped queries so coming-due cannot displace overdue at the cap (`qbo-sync.server.ts:144-169`); customers hydrated overdue-first (`:170-200`).

### Paid-invoice re-pull (payment path)

- `repullCustomerInvoices` queries invoices **without** `Balance > 0` (`qbo-sync.server.ts:63-83`).
- `applyPaymentsAndEvaluate` upserts payments/credit memos, re-pulls that customer's invoices, reconciles cases, evaluates promises, notifies (`:85-117`).
- Tests: payment keeps promise; payment after follow-up resolves case; credit memo zeroing balance resolves case (`tests/qbo-sync-payments.test.ts`).
- Manual Refresh still does not use this path unless payments are in the payload (TEMP-QBO-012).

### Mappers / money / consent

- NaN money → 0, never written as NaN (`qbo-mappers.server.ts:26-28,52-57`; test).
- Invoice status from balance + due date (`:41-45,61`).
- Customer upsert omits `sms_consent` / notes / owner so QBO sync cannot clobber legal consent or local notes (`mapQboCustomer` fields; `tests/qbo-mappers.test.ts:8-19`; notes column added `0019_account_notes.sql` with that intent).
- `upsertCustomers` / `upsertInvoices` / `upsertPayments` conflict on org-scoped QBO keys (`qbo-sync.server.ts:30-46`). Payment unique `(org_id, qbo_id, type)` (`0010_promise_payment_loop.sql:55`). Idempotent sync test (`tests/qbo-sync.test.ts:56-70`).

### Case recon / promise eval after sync

- `applyCaseReconciliation` org-scoped; unique-violation on open is a no-op (`case-lifecycle.server.ts:7-52`).
- `syncOverdueInvoices` stamps `last_sync_at` (`qbo-sync.server.ts:220-222`; test).
- `runCdcCatchup` stamps `last_cdc_time` + `last_sync_at` only after successful apply (`:320-323`; test `qbo-sync-cdc.test.ts:54-81`). Failed catch-up does **not** advance the watermark (the write is after work; the bug is the *value* of `now`, TEMP-QBO-006).
- Manual Refresh resolves only `scope: "full"` so it cannot heal webhook/cdc errors for entities it never fetched (`api.qbo.refresh.tsx:45-50`). Cron catch-up heals all (`qbo-cron.server.ts:46`).
- Refresh/cron/webhook log before `recordSyncError`, and `.catch(() => {})` on the record so logging failure cannot mask the original (`api.qbo.refresh.tsx:53-59`; `qbo-cron.server.ts:50-54`; `webhooks.qbo.tsx:66-72`).

### Cron wiring

- Crons `*/30 * * * *` (CDC) and `0 * * * *` (digest) in default and production (`wrangler.toml:17-31`).
- Scheduled handler dispatches by cron expression (`workers/app.ts:25-34`) and `waitUntil`s the work so the isolate stays alive.
- CDC cron uses service-role client, `getQboEnv`, `qboApiBaseUrl(QBO_SANDBOX)` (`qbo-cron.server.ts:11-40`).
- Per-org try/catch: one bad org does not abort the batch (`:42-56`). Test: tokenless connected org records `cron`/`cdc` error (`tests/sync-errors-wiring.test.ts:11-26`).
- Email notify is optional via `getEmailEnvOrNull` (`qbo-cron.server.ts:24-31`; `env.server.ts:73-84`) so missing Resend secrets do not 500 CDC.

### Sync errors (storage / RLS / dismiss)

- Table + unresolved partial index (`0013_sync_errors.sql:5-15`).
- Member SELECT; service-role insert/auto-resolve; dismiss via user client org-scoped (`api.sync-errors.dismiss.tsx:17-23`).
- Message truncated to 500 (`sync-errors.server.ts:3,8-9`; test).
- `resolveSyncErrors` with no scope heals one org only; with scope heals matching rows (`:19-29`; `tests/sync-errors.test.ts`).
- Settings Integrations lists last 20 unresolved with dismiss (`settings.tsx:35-41,269-291`).

### Routes / CSRF / redirects

- All QBO routes registered (`app/routes.ts:31-35`; `tests/routes-registration.test.ts`).
- `safeReturnTo` blocks open redirects (`return-to.ts:5-18`).
- Authenticated POSTs (connect/disconnect/refresh/dismiss) go through `requireUser` → `requireSameOrigin`.
- Connect/refresh GET loaders redirect to dashboard (no accidental GET mutate) (`api.qbo.connect.tsx:26-28`, `api.qbo.refresh.tsx:65-67`).
- Owner-only connect/disconnect; Refresh is any member (sync is not a control-plane change).

### Tests that lock the above

| File | What it locks |
|------|----------------|
| `tests/crypto.test.ts` | AES-GCM v1, IV, auth tag, key length |
| `tests/oauth-state.test.ts` | single-use, expiry, unknown, user_id returned |
| `tests/qbo-client.test.ts` | authorize URL, token POST, refresh, revoke |
| `tests/qbo-connection.test.ts` | encrypt at rest, refresh rotate, status, disconnect revoke+clear |
| `tests/qbo-api.test.ts` | sandbox URL, query/read/CDC, non-2xx throw |
| `tests/qbo-mappers.test.ts` | money, status, consent omission |
| `tests/qbo-sync.test.ts` | upsert FK, idempotent, `last_sync_at` |
| `tests/qbo-sync-cdc.test.ts` | invoice+customer webhook, CDC cursor |
| `tests/qbo-sync-payments.test.ts` | payment re-pull, case resolve, credit memo |
| `tests/qbo-cron.test.ts` | scheduled CDC ingest |
| `tests/qbo-webhook.test.ts` | HMAC + legacy + CloudEvents parse |
| `tests/webhooks-route.test.ts` | 401 bad/missing sig |
| `tests/sync-errors-wiring.test.ts` | cron + webhook error records |
| `tests/auth-flow.test.ts` | GET disconnect never clears |
| `tests/rls.test.ts` | member cannot mutate `qbo_connections` |
| `tests/api-sync-errors-dismiss.test.ts` | org-scoped dismiss |

---

## Out of scope / not re-litigated here

- Production secrets actually set in Cloudflare (B10 / Intuit checklist) — ops, not this module's code.
- `netlify/_redirects` Intuit privacy/EULA URLs (B11).
- Promise classifier treating credit/void as payment (prior gap 37) — Wave 3 domain.
- Worker CPU/subrequest quotas under multi-tenant load — called out in TEMP-QBO-008/010, not measured live.
