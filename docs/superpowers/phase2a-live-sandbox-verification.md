# Phase 2A Live Sandbox Verification Guide

This document describes the steps to verify the QuickBooks Online (QBO) OAuth flow against a **real Intuit sandbox** when credentials become available. Local mock testing (QBO Tokens service stub) was completed in Phase 2A; this guide covers the deferred manual verification step.

## Prerequisites

- Phase 2A implementation is complete: OAuth routes, token encryption, state management, and disconnect are all deployed to a Workers environment or running locally via `wrangler dev`.
- You have access to the [Intuit Developer Portal](https://developer.intuit.com/).
- An Intuit sandbox company (test entity) is available in your Intuit account.

## Step 1: Obtain Sandbox Credentials from Intuit Developer Portal

1. Log in to the Intuit Developer Portal.
2. Open your app (or create one if not yet done).
3. Under **Keys & Credentials** (or similar section):
   - Copy the **sandbox Client ID** (also called Consumer Key).
   - Copy the **sandbox Client Secret** (also called Consumer Secret).
   - Note the **Realm ID** (sandbox company ID) if you already have a test company, or create one.

Keep these credentials secure; you'll use them in Step 3.

## Step 2: Register the Redirect URI

1. In the Intuit Developer Portal, navigate to your app's **OAuth 2.0 settings** or **Redirect URIs** section.
2. Add (or confirm) the redirect URI matching your `QBO_REDIRECT_URI` environment variable.
   - **For deployed Workers (production/staging):** Use the full URL, e.g., `https://yourdomain.com/auth/qbo/callback`.
   - **For local development with `wrangler dev`:** Intuit requires a reachable HTTPS endpoint. Localhost is *not* reliably supported for OAuth redirects in sandbox. Use a tunnel:
     - **Option A: Cloudflare Tunnel** (if your Workers is on Cloudflare): Set up `cloudflared tunnel` to expose your local dev server.
     - **Option B: ngrok**: Run `ngrok http 8787` (or your Wrangler dev port) and use the generated HTTPS URL as your `QBO_REDIRECT_URI`.
   - Example: `https://abc123.ngrok.io/auth/qbo/callback`

3. Save/confirm the redirect URI in the Intuit portal.

## Step 3: Configure Secrets

Choose one approach based on your deployment:

### For Production / Staging Workers

Use `wrangler secret put` to store credentials securely in Cloudflare:

```bash
wrangler secret put QBO_CLIENT_ID
# Paste: <sandbox Client ID>

wrangler secret put QBO_CLIENT_SECRET
# Paste: <sandbox Client Secret>

wrangler secret put QBO_REDIRECT_URI
# Paste: https://yourdomain.com/auth/qbo/callback

wrangler secret put QBO_ENCRYPTION_KEY
# Paste: <base64-encoded 32-byte AES key; e.g., generated via `openssl rand -base64 32`>
```

The `wrangler deploy` or `wrangler publish` step will then use these secrets at runtime.

### For Local Development with `wrangler dev`

Create or update your `.dev.vars` file in the project root:

```env
QBO_CLIENT_ID=<sandbox Client ID>
QBO_CLIENT_SECRET=<sandbox Client Secret>
QBO_REDIRECT_URI=<ngrok/tunnel HTTPS URL>/auth/qbo/callback
QBO_ENCRYPTION_KEY=<base64-encoded 32-byte AES key>
```

Then run:

```bash
npx wrangler dev
```

Wrangler will load `.dev.vars` and make these available to your worker code.

## Step 4: Log In and Complete OAuth Flow

1. **Log in to your NudgePay app** as an organization owner (required to initiate QBO connection).
2. Navigate to the **Dashboard**.
3. Click the **Connect QuickBooks** button (or equivalent UI element).
4. **Intuit Consent Screen:** You will be redirected to Intuit's authorization page. Sign in with your Intuit sandbox credentials and select the sandbox company (test entity) to authorize.
5. **Consent:** Grant the requested permissions (e.g., read access to customers, invoices, etc.).
6. **Redirect:** Upon successful authorization, Intuit redirects back to your configured `QBO_REDIRECT_URI` with an authorization code.
7. **Callback Processing:** Your `/auth/qbo/callback` route:
   - Exchanges the code for access and refresh tokens (via Intuit's token endpoint).
   - Encrypts both tokens using AES-GCM (never stores plaintext).
   - Saves the `qbo_connections` record with:
     - `status = 'connected'`
     - `access_token_enc` = encrypted access token
     - `refresh_token_enc` = encrypted refresh token
     - `realm_id` = Intuit sandbox company ID
     - Timestamp fields for audit.
   - Redirects to `/dashboard?qbo=connected`.

8. **Verification:** On the dashboard:
   - Confirm you see a "Connected" or "Active" status for the QBO connection.
   - Open your database (Supabase or equivalent) and check the `qbo_connections` table:
     - A new row exists for your organization.
     - `status` = `'connected'`.
     - `access_token_enc` and `refresh_token_enc` are non-empty **encrypted** blobs (not plaintext JSON).
     - You cannot decode them without the `QBO_ENCRYPTION_KEY`.

## Step 5: Verify Disconnect / Revocation

1. **On the Dashboard**, locate the QBO connection status and click **Disconnect** (or equivalent button).
2. **Revocation Request:** Your `/api/qbo/disconnect` route:
   - Calls Intuit's revocation endpoint with the access token (best-effort; Intuit may return 200 OK or silently succeed).
   - Deletes or clears the `qbo_connections` row for your organization.
3. **Verification:**
   - Dashboard should show "Not Connected" or similar.
   - Check the database: the `qbo_connections` row is deleted or `status` is set to `'disconnected'` (depending on your implementation).
   - Attempt to reconnect to verify the flow can be repeated.

## Step 6: Token Refresh (Optional Verification)

If your implementation calls the `/auth/qbo/refresh` route (e.g., when the access token expires):

1. Wait for access token expiration, or manually trigger a refresh (if there's a test endpoint).
2. Verify that:
   - A new access token is obtained from Intuit.
   - The new `refresh_token` (if Intuit rotates it) replaces the old one in `qbo_connections`.
   - No plaintext tokens appear in logs or the database.
   - The connection remains active on the dashboard.

## Scope Notes

### Included in Phase 2A
- OAuth 2.0 connection/disconnection flow.
- Token encryption at rest (AES-GCM).
- State nonce (CSRF protection).
- Owner-only connect/disconnect permissions.

### Out of Scope (Phase 2B and Later)
- **Invoice/Customer Sync:** Initial backfill and manual "Refresh from QuickBooks" queries (Phase 2B).
- **Webhooks & Change Data Capture (CDC):** Signature verification and async syncs (Phase 2B).
- **Live Intuit Production Credentials:** Only sandbox testing in Phase 2A; production submission is Phase 4.

## Troubleshooting

- **"Invalid redirect URI":** Ensure the URI in the Intuit portal **exactly matches** your configured `QBO_REDIRECT_URI` (including trailing slashes, protocol, etc.).
- **"Localhost not reachable":** Use ngrok, Cloudflare Tunnel, or deploy to staging. Intuit cannot redirect to unauthenticated localhost.
- **"Encryption key is invalid":** `QBO_ENCRYPTION_KEY` must be a base64-encoded 32-byte value. Generate one with `openssl rand -base64 32`.
- **Tokens still plaintext:** Check that the encryption middleware is correctly applied. All token columns should be overwritten with encrypted ciphertext before commit to the database.
- **Disconnect doesn't clear row:** Verify the `DELETE` statement in the disconnect route is being executed and that there are no foreign key constraints blocking the delete.

## References

- [Intuit OAuth 2.0 Documentation](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)
- [Intuit Sandbox Environment](https://developer.intuit.com/app/developer/qbo/docs/get-started/hello-world)
- Phase 2A implementation code (all under `nudgepay-app/`):
  - QBO env vars (`getQboEnv`): `nudgepay-app/app/lib/env.server.ts`
  - AES-GCM token encryption: `nudgepay-app/app/lib/crypto.server.ts`
  - Intuit OAuth HTTP calls: `nudgepay-app/app/lib/qbo-client.server.ts`
  - Store / refresh / disconnect: `nudgepay-app/app/lib/qbo-connection.server.ts`
  - CSRF state nonce: `nudgepay-app/app/lib/oauth-state.server.ts`
  - Connect route (start OAuth, owner): `nudgepay-app/app/routes/api.qbo.connect.tsx`
  - Callback route: `nudgepay-app/app/routes/auth.qbo.callback.tsx`
  - Disconnect route (owner): `nudgepay-app/app/routes/api.qbo.disconnect.tsx`
  - Connect/Disconnect UI: `nudgepay-app/app/routes/dashboard.tsx`
  - Migration (oauth_states + token columns): `nudgepay-app/supabase/migrations/0004_qbo_oauth.sql`
