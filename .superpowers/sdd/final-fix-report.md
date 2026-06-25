# Phase 7c Final-Fix Wave Report

Branch: `phase7c-sync-visibility`
Date: 2026-06-24

---

## Item 1 (IMPORTANT — data correctness) — Bound 0013 backfill UPDATE

**File:** `nudgepay-app/supabase/migrations/0013_sync_errors.sql`

**Change:** Added `and tm.created_at >= c.opened_at` to the UPDATE WHERE clause, plus an updated comment explaining the window bound. This prevents cross-cycle bleed: texts sent during a previous closed case cycle can no longer be stamped onto the customer's current open case.

**Before:**
```sql
where c.customer_id = tm.customer_id
  and c.closed_at is null
  and tm.case_id is null;
```

**After:**
```sql
where c.customer_id = tm.customer_id
  and c.closed_at is null
  and tm.case_id is null
  and tm.created_at >= c.opened_at;
```

**DB reset:** `npx supabase db reset`
- Result: All 13 migrations (0001–0013) applied cleanly. No errors.

---

## Item 2 (IMPORTANT — operability) — Restore cron operator log

**File:** `nudgepay-app/app/lib/qbo-cron.server.ts`

**Change:** Added `console.error` call before `recordSyncError` in the per-org catch block, mirroring the webhook path's logging style. Now a background cron failure always has a console signal even if the DB record also fails.

**Added line:**
```ts
console.error(`[cron] CDC catch-up failed for org ${orgId}:`, err);
```

---

## Item 3 (Minor) — Fix stale comment in api.assign

**File:** `nudgepay-app/app/routes/api.assign.tsx`

**Change:** Replaced inaccurate comment "Cross-org guard: the RLS user client only sees own-org customers." with accurate comment explaining that RLS permits every org the caller is a member of, so the explicit `.eq("org_id", org.org_id)` is a necessary guard for multi-org users. No logic changed.

---

## Item 4 (Minor) — Defensive scope check in resolveSyncErrors

**File:** `nudgepay-app/app/lib/sync-errors.server.ts`

**Change:** `if (args.scope)` → `if (args.scope !== undefined)` so a future empty-string scope filters by empty string rather than resolving all errors. No callers pass `""` today; purely defensive.

---

## Item 5 (Minor) — Tighten check-constraint test

**File:** `nudgepay-app/tests/sync-errors-schema.test.ts`

**Change:** Added `expect(error!.code).toBe("23514");` after the existing `expect(error).not.toBeNull()` assertion. The Postgres check-violation code `23514` was verified correct by running the test against the live local Supabase instance.

---

## Item 6 (pre-existing flaky test) — qbo-connection token coincidence

**File:** `nudgepay-app/tests/qbo-connection.test.ts`

**Change:** Changed plaintext tokens in the "storeConnection encrypts tokens at rest" test from `"AT"` / `"RT"` (2-char strings that can appear in base64 by chance) to long distinctive strings:
- Access token: `"ACCESS-TOKEN-PLAINTEXT-DO-NOT-LEAK"`
- Refresh token: `"REFRESH-TOKEN-PLAINTEXT-DO-NOT-LEAK"`

Also added an `access_token_enc` not-contain assertion (was missing before — only `refresh_token_enc` was checked). The test's intent is identical; it is now statistically robust against false failures.

---

## Item 7 (test-isolation flake) — sync-errors-wiring cron test

**Files changed:** `nudgepay-app/vitest.config.ts` (config fix only; test file not modified)

**Root cause identified and fixed.**

**Investigation:** Running `npx vitest run tests/sync-errors-wiring.test.ts` alone: passes 2/2 on both isolation runs. Running `npx vitest run` (full suite): failed with `AssertionError: expected 2 to be 1` on the cron test.

**Root cause:** `qbo-cron.test.ts` also calls `runScheduledCdc(TEST_ENV)` and vitest runs test files concurrently by default (no `sequence.concurrent` setting in the config). With vitest 4.x using worker threads by default, both test files were executing simultaneously. The cron from `qbo-cron.test.ts` sweeps ALL `status = 'connected'` orgs in the shared local Supabase DB, including the wiring test's freshly-inserted tokenless org. Both cron calls fail on that org and each inserts a `sync_error` row, producing `length = 2` instead of `1`.

A timestamp-bound approach (`gte("occurred_at", testStart)`) was tried but failed because the concurrent cron call also starts after `testStart`.

**Fix:** Added `sequence: { concurrent: false }` to `vitest.config.ts`. This serializes test file execution (not tests within a file) for the integration test suite. With a single shared local Supabase DB, file-level serialization is the architecturally correct choice for any test that sweeps ALL orgs globally. The wiring test assertion `=== 1` was preserved unchanged and is correct.

---

## Covering-Test Results

Command:
```
npx vitest run tests/sync-errors-wiring.test.ts tests/sync-errors-schema.test.ts tests/sync-errors.test.ts tests/qbo-connection.test.ts tests/api-assign.test.ts
```

Result: **5 test files passed, 17 tests passed** — all green.

---

## Full Build Pipeline Results

### `npx supabase db reset`
All 13 migrations applied cleanly (0001–0013). No errors.

### `npx tsc -b`
Exit 0. No output (clean).

### `npx react-router build`
Exit 0. Client (102 modules) + SSR (177 modules) builds succeeded.

### `npx vitest run` (full suite, after all fixes)
**48 test files passed, 231 tests passed** — all green.

Pre-fix (before Item 7 vitest.config change): 1 failed (sync-errors-wiring.test.ts, `length === 1` received 2).
Post-fix: fully green.
