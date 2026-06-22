# Phase 2B Live Sandbox Verification Guide

This document describes the steps to verify the QuickBooks Online (QBO) sync, webhooks, and Change Data Capture (CDC) implementation against a **real Intuit sandbox** when credentials become available. Local mock testing (QBO API stub) was completed in Phase 2B; this guide covers the deferred manual verification step.

## Prerequisites

Before proceeding with Phase 2B live sandbox verification, you must:

1. **Complete Phase 2A live-sandbox connect** as documented in `docs/superpowers/phase2a-live-sandbox-verification.md`. Verify that:
   - Your organization is registered in `qbo_connections` with `status = 'connected'`.
   - The access token and realm ID are securely encrypted and stored.

2. **Provide a public HTTPS endpoint** for webhook delivery. Intuit cannot reach `localhost`; use one of:
   - **Cloudflare Tunnel:** `cloudflared tunnel` to expose your local `wrangler dev` environment.
   - **ngrok:** `ngrok http 8787` to tunnel your local Wrangler dev port.
   - **Deployed Workers URL:** If testing against staging, use the deployed HTTPS worker endpoint.

3. Have the Intuit Developer Portal open and the app's settings accessible (for webhook registration in Step 4).

## Step 1: Backfill and Manual Refresh

This step verifies that the initial overdue-invoice backfill works end-to-end from the dashboard.

1. **Set up sandbox company data:**
   - In your Intuit sandbox company, create at least a few test invoices with:
     - `Balance > 0` (unpaid or partially paid).
     - `DueDate` in the past (to ensure they appear in the past-due report).

2. **Log in to the NudgePay dashboard** as a member of the connected organization.

3. **Click "Refresh from QuickBooks"** (or equivalent button that triggers the sync endpoint).

4. **Verify the redirect:** The page should redirect to `/dashboard?sync=ok` and display a success message.

5. **Confirm data population:**
   - The past-due invoices table should now populate with the invoices you created in the sandbox.
   - Check the database:
     - `qbo_connections.last_sync_at` is set to a recent timestamp.
     - `invoices.qbo_id` and `invoices.customer_id` are populated (no NULL values).
     - The invoice `due_date` and `balance` fields match the sandbox values.

## Step 2: Idempotency

This step verifies that repeated syncs do not create duplicates and correctly handle updates.

1. **Click "Refresh from QuickBooks" again** from the dashboard.

2. **Verify no duplicates:** The row count in the past-due table should remain unchanged (same invoices, not duplicated).

3. **Verify updates in place:**
   - In your Intuit sandbox, edit one of the invoice balances (e.g., reduce it by paying part of the invoice).
   - Click "Refresh from QuickBooks" again.
   - Confirm that the invoice row updates its balance in place (no duplicate row created).
   - Check the database: only one row per `qbo_id` exists; no stale/orphaned rows are left behind.

## Step 3: Webhooks

This step verifies that Intuit webhooks deliver real-time invoice and customer updates.

1. **Register the webhook endpoint:**
   - In the Intuit Developer Portal, navigate to your app's **Keys & Credentials** or **Webhooks** section.
   - Set the webhook endpoint URL to `https://<your-public-host>/webhooks/qbo` (use your Cloudflare Tunnel, ngrok, or deployed Workers URL).
   - Subscribe to at least:
     - `Invoice` (Create, Update, Delete events).
     - `Customer` (Create, Update, Delete events).

2. **Set the webhook verifier token:**
   - In the Intuit Developer Portal, copy the **Webhook Verifier Token** (sometimes labeled "Webhook Verification Token").
   - Store it in your environment:
     - **For local development:** Add `QBO_WEBHOOK_VERIFIER_TOKEN=<token>` to `.dev.vars`.
     - **For deployed Workers:** Run `wrangler secret put QBO_WEBHOOK_VERIFIER_TOKEN` and paste the token.

3. **Test webhook delivery and signature verification:**
   - In your sandbox company, edit an invoice (e.g., change the balance, memo, or status).
   - Within a few seconds (near real-time), confirm:
     - The updated invoice appears in your application's database (upserted).
     - `last_cdc_time` advances to reflect the change.
   - Check the application logs or database for confirmation of the webhook entity upsert.

4. **Verify bad-signature rejection:**
   - Send a manual test webhook request with an incorrect (or absent) `intuit-signature` header:
     ```bash
     curl -X POST https://<your-public-host>/webhooks/qbo \
       -H "Content-Type: application/json" \
       -H "intuit-signature: wrong-signature" \
       -d '{"eventNotifications":[{"realmId":"<realm-id>","dataChangeEvent":{"entities":[{"id":"123","type":"Invoice","changeType":"Update"}]}}]}'
     ```
   - The route must return **401 Unauthorized** before any processing occurs. The bad signature must be rejected early, preventing any upsert.

## Step 4: Change Data Capture (CDC) Cron

This step verifies that the CDC cron job pulls changed entities and advances the sync cursor.

1. **Trigger the cron locally:**
   - Start the local Wrangler dev environment:
     ```bash
     npx wrangler dev
     ```
   - In another terminal, trigger the scheduled cron using the test endpoint:
     ```bash
     curl "http://localhost:8787/__scheduled?cron=*/30+*+*+*+*"
     ```
   This simulates a 30-minute scheduled trigger (the actual cron interval used in production).

2. **Verify changed-entity ingestion:**
   - Before running the cron, note the current `last_cdc_time` value in `qbo_connections` for your organization.
   - In your Intuit sandbox, make changes to an invoice or customer (e.g., edit balance, address, or contact info).
   - Run the cron trigger.
   - Confirm:
     - The changed invoice/customer entities are ingested and upserted in the database.
     - `qbo_connections.last_cdc_time` advances to a later timestamp (reflecting the new CDC query start point).
     - No duplicates are created; existing rows are updated in place.

3. **Understand CDC limits:**
   - CDC respects a **30-day lookback window:** only changes in the last 30 days are returned by the Intuit API.
   - CDC returns a maximum of **1000 objects per query response.**
   - If a response is truncated (`truncated: true`), the implementation logs this; handling multi-page pagination is deferred to a later phase when a tenant exceeds this limit.

## Step 5: Minor-Version Configuration

The client code pins Intuit's **minor version** to `minorversion=65` for API stability (see the `QboApiConfig` in the codebase).

1. **Verify against Intuit documentation:**
   - Visit the [Intuit Accounting API Documentation](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/latest/introduction).
   - Check which minor version is currently supported and recommended. As of the Phase 2B implementation, `minorversion=65` is current; Intuit may deprecate older versions over time.

2. **If deprecation is detected:**
   - Update the `minorversion` constant in the codebase (typically in `nudgepay-worker/src/lib/qbo-api.ts` or the `QboApiConfig`).
   - Increment to the next stable minor version.
   - Re-run all tests to ensure the new version's API contract is respected.
   - Verify that fields, data types, and pagination behavior remain compatible.

## Scope Notes

### Included in Phase 2B
- **Backfill sync:** Initial pull of overdue invoices and their customers via "Refresh from QuickBooks."
- **Webhook ingestion:** Real-time single-entity upsert triggered by Intuit webhook notifications.
- **CDC catch-up:** Scheduled cron pulling changed entities since the last sync time.
- **Signature verification:** Rejection of webhook requests with invalid or absent `intuit-signature`.
- **Idempotent upserts:** All sync and webhook operations use `qbo_id` as the natural key, preventing duplicates.

### Out of Scope (Later Phases)
- **Pagination beyond 1000 objects:** Multi-page CDC responses are currently flagged but not fully processed. Tenant demand may trigger this in a later phase.
- **Webhook Delete operations:** Delete events are received but not yet acted upon; soft-deleting or archiving invoices removed in QBO is deferred.
- **GCM AAD field binding:** Encryption-at-rest (AES-GCM) is implemented; additional cryptographic hardening with attribute-based decryption is deferred.
- **Live Intuit Production Credentials:** Only sandbox testing is verified here; production submission is Phase 4.

## Troubleshooting

- **"Webhook endpoint not reachable":** Confirm your tunnel (ngrok, Cloudflare, or deployed URL) is active and forwarding traffic to your local/deployed worker. Test with `curl https://<host>/webhooks/qbo -X POST -H "Content-Type: application/json" -d '{}'`.
- **"Refresh returns 401":** The access token may have expired. Verify in the code that `getValidAccessToken` is refreshing the token if needed. Check `qbo_connections` to ensure both `access_token_enc` and `refresh_token_enc` are present and non-null.
- **"CDC cron does not run":** Ensure the Wrangler dev environment is running and `wrangler.toml` has the `[triggers] crons` entry registered for the handler. If testing locally, the `curl` command with the `__scheduled?cron=` query parameter must be issued while `wrangler dev` is running.
- **"Webhook signature verification fails":** Confirm the `QBO_WEBHOOK_VERIFIER_TOKEN` matches exactly the token from the Intuit portal (no extra spaces or newlines). Check logs to see the computed vs. expected signature.
- **"Minor version API mismatch":** Review the Intuit API response error message. If the minor version is too old, update `minorversion` in the config and redeploy. If too new, fall back to a stable version and file a feature request for a later phase.

## References

- [Intuit Change Data Capture (CDC) Documentation](https://developer.intuit.com/app/developer/qbo/docs/develop/explore-the-quickbooks-online-api/change-data-capture)
- [Intuit Webhooks Documentation](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks)
- [Intuit Accounting API Documentation (current)](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/latest/introduction)
- Phase 2B implementation code (all under `nudgepay-worker/`):
  - QBO API client (`QboApiConfig`, API calls): `nudgepay-worker/src/lib/qbo-api.ts`
  - Sync logic (backfill, CDC, upsert): `nudgepay-worker/src/lib/qbo-sync.ts`
  - Webhook route and signature verification: `nudgepay-worker/src/routes/webhooks-qbo.ts`
  - CDC cron handler: `nudgepay-worker/src/cron/qbo-cdc.ts`
  - Database upsert helpers: `nudgepay-worker/src/db/sync.ts`
  - Test suites: `nudgepay-worker/src/__tests__/qbo-sync.test.ts`, `qbo-sync-cdc.test.ts`, `webhooks-route.test.ts`, `qbo-webhook.test.ts`, `qbo-cron.test.ts`
