# Phase 4: QBO Sandbox Demonstration Script for Intuit Review

**Purpose:** This document provides an ordered, click-path demonstration of the NudgePay application's QuickBooks Online OAuth, sync, webhook, and disconnect flow against an **Intuit sandbox**. This demonstration script produces the evidence Intuit requires before granting production credentials.

**Target Audience:** Intuit application review team.

**Prerequisite:** Review the Phase 4 Production Deploy Runbook (`docs/superpowers/phase4-deploy-runbook.md`) for sandbox environment setup details.

---

## Setup: Deploy with Sandbox Configuration

Before proceeding with the demonstration steps, deploy the NudgePay application with Intuit sandbox credentials.

### Configuration

1. Ensure the Worker environment is configured with:
   - `QBO_SANDBOX=true` (enables Intuit sandbox endpoints in QBO API calls)
   - **Sandbox app keys** from the Intuit Developer Portal (not production keys):
     - `QBO_CLIENT_ID` (sandbox app client ID)
     - `QBO_CLIENT_SECRET` (sandbox app client secret)
     - `QBO_REDIRECT_URI` set to `${APP_BASE_URL}/auth/qbo/callback`
   - Sandbox webhook verifier token: `QBO_WEBHOOK_VERIFIER_TOKEN` (from the sandbox app's Webhooks section in the Intuit Developer Portal)

2. Deploy the application:
   ```bash
   cd nudgepay-app
   npx wrangler deploy --env production
   ```

3. Verify deployment:
   ```bash
   curl "${APP_BASE_URL}/" -I
   # Should return HTTP 200
   ```

4. Confirm the public base URL is accessible from the internet (required for webhook delivery in Step 5):
   ```bash
   curl "${APP_BASE_URL}/dashboard" -I
   # Should return HTTP 200 (or 302 if not authenticated)
   ```

---

## Step 1: User Sign-Up and Authentication

**Observable Result:** User is signed up and authenticated; dashboard is accessible.

1. Navigate to `${APP_BASE_URL}` in a web browser.
2. Click **Sign Up** (or **Register**).
3. Enter a test email and password, then submit.
4. Check your email inbox for a confirmation link from Supabase (subject line: "Confirm Your Signup").
5. Click the confirmation link to verify your email.
6. Log in with the confirmed email and password.
7. **Verify:** You are logged in and see the dashboard or tenant workspace selector.

---

## Step 2: Connect to QuickBooks Online (Sandbox Company)

**Observable Result:** OAuth redirect completed; dashboard displays "Connected" status for QuickBooks.

### 2.1 Initiate OAuth

1. On the dashboard, locate the **Connect QuickBooks** button or link (or **Manage QuickBooks Integration** if already partially configured).
2. Click **Connect QuickBooks**.
   - **Route triggered:** `POST /api/qbo/connect` (nudgepay-app/app/routes/api.qbo.connect.tsx)
   - You are redirected to Intuit's OAuth login screen (`https://appcenter.intuit.com/connect/oauth2` for sandbox).

### 2.2 Authorize the Sandbox Company

1. On the Intuit login page, sign in with your Intuit sandbox account credentials.
2. On the authorization consent screen, select a sandbox company (e.g., "Sample Sandbox Company" or a test company you created).
3. Click **Authorize** or **Connect**.
   - Intuit redirects you back to `${APP_BASE_URL}/auth/qbo/callback?realmId=<realm-id>&state=<state-token>`
   - **Route triggered:** `GET /auth/qbo/callback` (nudgepay-app/app/routes/auth.qbo.callback.tsx)
   - The callback validates the state token, exchanges the authorization code for an access token, and stores encrypted tokens in the database.

### 2.3 Verify Connected Status

1. You are redirected back to the dashboard.
2. **Verify on the dashboard:** A "Connected to QuickBooks" or similar status message is displayed (e.g., green checkmark, "Connected" label).
3. **Verify in the database:** Query the Supabase `qbo_connections` table:
   ```sql
   SELECT id, organization_id, status, access_token_enc, refresh_token_enc, realm_id, created_at
   FROM qbo_connections
   WHERE organization_id = '<your-org-id>'
   ORDER BY created_at DESC
   LIMIT 1;
   ```
   - `status` = `'connected'`
   - `access_token_enc` is a non-null base64-encoded ciphertext (not plaintext)
   - `refresh_token_enc` is a non-null base64-encoded ciphertext (not plaintext)
   - `realm_id` matches the sandbox company realm ID from Step 2.2

---

## Step 3: Verify Encrypted Token Storage

**Observable Result:** Tokens are encrypted at rest; no plaintext credentials are stored in the database.

1. In your Supabase project dashboard, open the **SQL Editor**.
2. Run the query from Step 2.3 and inspect the token columns:
   ```sql
   SELECT access_token_enc, refresh_token_enc FROM qbo_connections
   WHERE organization_id = '<your-org-id>'
   LIMIT 1;
   ```
3. **Verify:** Both columns contain base64-encoded ciphertext (not readable plaintext). For example:
   - `access_token_enc`: `AwECVFq7J1X8mQ2b3K9Z5f...` (encrypted binary, base64-encoded)
   - `refresh_token_enc`: `BxF4Wm2N6P0K3X8L5Q1Y7...` (encrypted binary, base64-encoded)

4. Confirm the encryption by attempting to decode the ciphertext:
   - The decoded value is random binary data, not a valid OAuth token.
   - (The decryption key is `QBO_ENCRYPTION_KEY`, held securely in Cloudflare Secrets and never exposed in the database.)

---

## Step 4: Sync Overdue Invoices from Sandbox

**Observable Result:** Dashboard displays overdue invoices pulled from the sandbox company.

### 4.1 Populate Test Invoices in Sandbox

1. Log into your Intuit sandbox company (via the Intuit portal or the Intuit QuickBooks interface).
2. Create at least **three test invoices** with the following properties:
   - **Customer:** Any customer in your sandbox company (create one if needed).
   - **Invoice Date:** In the past (e.g., 30 days ago).
   - **Due Date:** In the past (e.g., 15 days ago) to ensure they appear as **overdue**.
   - **Amount:** Any value > 0 (e.g., $100, $250, $500).
   - **Balance:** > 0 (unpaid or partially paid; do not fully pay).

3. Save the invoices and note at least one invoice number (e.g., "INV-001").

### 4.2 Trigger Initial Sync

1. Return to the NudgePay dashboard.
2. Locate the **Refresh from QuickBooks** button (or **Sync Now**, **Pull Invoices**, etc.).
3. Click the button.
   - **Route triggered:** `POST /api/qbo/refresh` (nudgepay-app/app/routes/api.qbo.refresh.tsx)
   - The endpoint queries the Intuit API for the organization's invoices, filters to overdue invoices, and upserts them into the local database.

### 4.3 Verify Sync Completion

1. The page redirects to `/dashboard?sync=ok` or displays a success message (e.g., "Invoices refreshed successfully").
2. **Verify on the dashboard:** The worklist now displays the invoices you created in Step 4.1:
   - Invoice number (e.g., "INV-001")
   - Customer name
   - Due date (in the past)
   - Outstanding balance (matches the sandbox)

3. **Verify in the database:**
   ```sql
   SELECT id, qbo_id, customer_name, due_date, balance_amount, last_synced_at
   FROM invoices
   WHERE organization_id = '<your-org-id>'
   ORDER BY due_date;
   ```
   - Rows exist for each invoice created in Step 4.1.
   - `qbo_id` matches the Intuit invoice ID.
   - `balance_amount` matches the sandbox balance.
   - `last_synced_at` is a recent timestamp (≤ 1 minute ago).

4. **Verify sync metadata:**
   ```sql
   SELECT last_sync_at, last_cdc_time FROM qbo_connections
   WHERE organization_id = '<your-org-id>';
   ```
   - `last_sync_at` is updated to the current timestamp.

---

## Step 5: Test Webhook Delivery and Real-Time Updates

**Observable Result:** Sandbox changes are delivered to the webhook endpoint and invoices are updated in real-time.

### 5.1 Register Webhook Endpoint

1. In the Intuit Developer Portal, navigate to your **sandbox app** → **Keys & Credentials** (or **Webhooks** section).
2. **Webhook URL:** Set to `${APP_BASE_URL}/webhooks/qbo` (e.g., `https://nudgepay.example.com/webhooks/qbo`).
3. **Subscribed Events:** Enable at least:
   - `Invoice` (Create, Update, Delete)
   - `Customer` (Create, Update, Delete)
4. Save the configuration.
5. **Verify the endpoint:** Intuit sends a test request to validate the URL. Confirm in your application logs or a monitoring dashboard that a request was received with status `HTTP 200` or `HTTP 204`.
   - **Route:** `POST /webhooks/qbo` (nudgepay-app/app/routes/webhooks.qbo.tsx)

### 5.2 Verify Webhook Signature Verification

The application validates the `intuit-signature` header on every webhook request. Confirm this by testing a bad signature:

1. Open a terminal and send a test request with an invalid signature:
   ```bash
   curl -X POST "${APP_BASE_URL}/webhooks/qbo" \
     -H "Content-Type: application/json" \
     -H "intuit-signature: invalid-signature" \
     -d '{"eventNotifications":[{"realmId":"<realm-id>","dataChangeEvent":{"entities":[{"id":"123","type":"Invoice","changeType":"Update"}]}}]}'
   ```
2. **Verify:** The endpoint returns **HTTP 401 Unauthorized** and logs a signature mismatch error.
   - No invoice updates occur; the request is rejected before processing.

### 5.3 Trigger Real-Time Update via Webhook

1. Return to your sandbox company in Intuit.
2. **Edit one of the test invoices** from Step 4.1:
   - Reduce the outstanding balance (e.g., apply a partial payment).
   - Or update the due date.
   - Or update a memo or other detail.
3. Save the invoice.
4. **Within 5-10 seconds,** check the NudgePay dashboard worklist:
   - **Verify:** The edited invoice's balance (or other field) is updated in the dashboard.
   - The change arrived via the webhook; no manual refresh was needed.

5. **Verify in the database:**
   ```sql
   SELECT id, qbo_id, balance_amount, updated_at FROM invoices
   WHERE qbo_id = '<invoice-id>'
   LIMIT 1;
   ```
   - `balance_amount` reflects the new balance from the sandbox.
   - `updated_at` is recent (indicates the webhook triggered an upsert).

### 5.4 Verify CDC Cron Catch-Up Path (Optional)

The application also runs a scheduled Change Data Capture (CDC) cron job every 30 minutes as a catch-up mechanism if webhooks are missed.

- **Cron route:** The app registers a Cloudflare Cron Trigger for `*/30 * * * *` (every 30 minutes).
- **Behavior:** The cron queries the Intuit API for changed entities since `last_cdc_time` and upserts them into the local database.
- **Note:** In production, this runs automatically. For testing, refer to the Phase 2B Live Sandbox Verification Guide (`docs/superpowers/phase2b-live-sandbox-verification.md`, Step 4) for instructions on triggering the cron manually in a local environment.

---

## Step 6: Disconnect and Revoke Tokens

**Observable Result:** OAuth tokens are revoked at Intuit; local database is cleared; "Disconnected" status is shown.

### 6.1 Initiate Disconnect

1. On the dashboard, locate the **Disconnect QuickBooks** button or **Manage Connection** → **Disconnect** option.
2. Click **Disconnect QuickBooks**.
   - **Route triggered:** `POST /api/qbo/disconnect` (nudgepay-app/app/routes/api.qbo.disconnect.tsx)
   - The endpoint calls Intuit's token revocation endpoint and then clears the local database record.

### 6.2 Verify Token Revocation

1. The page redirects to the dashboard and displays "Disconnected from QuickBooks" or a similar status message.
2. **Verify in the database:**
   ```sql
   SELECT status, access_token_enc, refresh_token_enc FROM qbo_connections
   WHERE organization_id = '<your-org-id>';
   ```
   - `status` = `'disconnected'`
   - `access_token_enc` = `NULL`
   - `refresh_token_enc` = `NULL`
   - The row remains for audit purposes but contains no sensitive data.

### 6.3 Verify Intuit Disconnect URL (Optional)

Intuit may initiate a disconnect from their side (e.g., if the user disconnects the app from their Intuit account). The app provides a landing URL for this:

- **Disconnect URL:** `${APP_BASE_URL}/auth/qbo/disconnect` (configured in the Intuit app's **Keys & Credentials** section, **Disconnect URL** field)
- **Behavior:** If Intuit POSTs to this URL, it clears the local `qbo_connections` record.
- **Verification:** This path is not tested in this demonstration but is available if Intuit requires it.

### 6.4 Verify Sync Is Blocked After Disconnect

1. Return to the dashboard.
2. Click **Refresh from QuickBooks** (or **Sync Now**).
   - **Expected behavior:** The endpoint returns an error (e.g., "Not connected to QuickBooks" or HTTP 403 Unauthorized).
   - No invoices are synced; the endpoint validates that a connected `qbo_connections` record exists before proceeding.

---

## Step 7: Cross-Reference Phase 2B Live Sandbox Verification

For detailed, per-endpoint verification steps and troubleshooting, refer to the Phase 2B Live Sandbox Verification Guide:

**Document:** `docs/superpowers/phase2b-live-sandbox-verification.md`

**Relevant sections:**
- **Step 1 (Backfill and Manual Refresh):** Detailed verification of the initial sync endpoint, data population, and idempotency.
- **Step 2 (Idempotency):** How to confirm repeated syncs do not create duplicates and correctly handle updates.
- **Step 3 (Webhooks):** Lower-level webhook delivery, signature verification, and entity upsert confirmation.
- **Step 4 (CDC Cron):** Instructions for manually triggering the CDC cron in a local Wrangler dev environment.
- **Troubleshooting:** Solutions for common issues (webhook endpoint unreachable, token expiration, signature verification failures, etc.).

---

## Summary: Evidence for Intuit Production Approval

This demonstration script documents the following capabilities for Intuit's review:

1. ✅ **OAuth 2.0 Authorization Flow:** User authorizes NudgePay to access sandbox company data.
2. ✅ **Token Encryption at Rest:** Access and refresh tokens are encrypted (AES-256-GCM) before storage; no plaintext credentials in the database.
3. ✅ **Overdue Invoice Sync:** Initial backfill of past-due invoices from the sandbox company.
4. ✅ **Real-Time Webhook Integration:** Intuit webhooks deliver live updates; invoices are upserted immediately.
5. ✅ **Change Data Capture (CDC) Catch-Up:** Scheduled cron job catches up on missed changes.
6. ✅ **Token Revocation and Disconnection:** OAuth tokens are revoked; local data is cleared; reconnection is possible.
7. ✅ **Signature Verification:** All webhook requests are validated using Intuit's `intuit-signature` header.

**Next Steps:** With this demonstration completed and documented, submit this script to Intuit's application review team. Upon approval, request production credentials and proceed with the Phase 4 Production Deploy Runbook to go live.

---

## References

- **Intuit OAuth 2.0 Documentation:** https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
- **Intuit Webhooks Documentation:** https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks
- **Intuit Change Data Capture (CDC):** https://developer.intuit.com/app/developer/qbo/docs/develop/explore-the-quickbooks-online-api/change-data-capture
- **Phase 4 Deploy Runbook:** `docs/superpowers/phase4-deploy-runbook.md`
- **Phase 2B Live Sandbox Verification:** `docs/superpowers/phase2b-live-sandbox-verification.md`
- **Cloudflare Workers Documentation:** https://developers.cloudflare.com/workers/
