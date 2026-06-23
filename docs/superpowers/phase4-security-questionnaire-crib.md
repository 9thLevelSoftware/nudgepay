# Phase 4: Intuit Security-Questionnaire Crib

This document maps each key Intuit security requirement to its implementation in the codebase, enabling truthful answers to security questionnaires with direct file references.

---

## Encrypted Token Storage

**Requirement:** OAuth tokens are encrypted at rest, not stored plaintext.

**Implementation:**
- **AES-256-GCM encryption:** `nudgepay-app/app/lib/crypto.server.ts` (lines 1–44)
  - `encryptSecret(plaintext, base64Key)`: Encrypts with AES-GCM using Web Crypto API (Workers + Node 20+). Generates random 12-byte IV, returns `v1:{iv_b64}:{ciphertext_b64}`.
  - `decryptSecret(payload, base64Key)`: Decrypts; throws on malformed/unsupported versions.
  - Key derivation: 32-byte base64 key from `QBO_ENCRYPTION_KEY` environment variable.

- **Token persistence:** `nudgepay-app/app/lib/qbo-connection.server.ts` (lines 5–16)
  - `storeConnection()`: Encrypts both access and refresh tokens before upsert to `qbo_connections` table. Tokens never stored plaintext.
  - `getValidAccessToken()`: Decrypts stored tokens only when needed, checks expiration, and refreshes/re-encrypts on rotation.

---

## Tokens Never Exposed to Browser

**Requirement:** Sensitive tokens (OAuth credentials, encryption keys) do not reach the client-side application.

**Implementation:**
- **Service-role client server-only:** `nudgepay-app/app/lib/supabase.server.ts`
  - `createSupabaseUserClient()`: Creates user-level client from ANON key for client routes; used only for RLS-gated public tables.
  - `createSupabaseServiceClient()` (not shown but referenced): Uses `SUPABASE_SERVICE_ROLE_KEY` (server-only env var), never exported to browser.

- **OAuth callback route server-only:** `nudgepay-app/app/routes/auth.qbo.callback.tsx` (lines 8–32)
  - Loader function (server-side only): receives authorization code and state from Intuit redirect, exchanges for tokens server-side, stores encrypted.
  - Returns redirect only; no token render, no `JSON.stringify(tokens)` or HTML template exposure.
  - Client never sees raw tokens.

- **Disconnect route:** `nudgepay-app/app/routes/api.qbo.disconnect.tsx` (lines 13–22, 28–50)
  - Both action and loader operate server-side only.
  - Service-role Supabase client instantiated only on server.
  - No token decryption/display in response; HTML is generic confirmation only (line 42–47).

---

## OAuth CSRF Protection

**Requirement:** Authorization code exchange is protected against cross-site request forgery via state nonce verification.

**Implementation:**
- **State nonce generation & verification:** `nudgepay-app/app/lib/oauth-state.server.ts` (referenced in auth.qbo.callback.tsx, line 4)
  - Creates single-use `oauth_states` record with nonce before redirecting user to Intuit's authorization endpoint.
  - `consumeOAuthState(service, state)`: (called line 25 of auth.qbo.callback.tsx)
    - Queries state nonce from database.
    - Throws error if state not found, expired, or already consumed (prevents replay attacks).
    - Deletes record after consumption (single-use).
    - Returns orgId on success.
  - Intuit returns the same state; mismatch or replay is rejected before token exchange (line 26).

---

## No Sensitive Parameter Leakage

**Requirement:** Sensitive parameters (authorization codes, tokens, nonces) are not logged, rendered in HTML, or appended to redirects.

**Implementation:**
- **OAuth callback redirect-only:** `nudgepay-app/app/routes/auth.qbo.callback.tsx` (lines 17–31)
  - Extracts code/realmId/state from query params (never logged).
  - On error: `redirect("/dashboard?qbo=error")` (only status flag, no params).
  - On success: `redirect("/dashboard?qbo=connected")` (only status flag).
  - Code and state consumed, not re-rendered.

- **Disconnect route:** `nudgepay-app/app/routes/api.qbo.disconnect.tsx` (lines 28–50)
  - Returns plain HTML; no token or sensitive data in response body.
  - Redirects use safe status flags only (`?qbo=disconnected`).

---

## Disconnect & Token Revocation

**Requirement:** Users can disconnect their QBO account; tokens are revoked at Intuit and cleared locally.

**Implementation:**
- **Disconnect function:** `nudgepay-app/app/lib/qbo-connection.server.ts` (lines 48–?)
  - `disconnectConnection(fetchFn, service, cfg, key, orgId)`:
    - Calls Intuit revoke endpoint to invalidate tokens server-side.
    - Deletes encrypted tokens from `qbo_connections` table.
    - Clears org's QBO connection status.

- **In-app disconnect route (POST):** `nudgepay-app/app/routes/api.qbo.disconnect.tsx` (lines 13–22)
  - Owner-gated: only org owner can disconnect (role check, line 18).
  - Calls `disconnectConnection()` (line 20).
  - Redirects to dashboard with status.

- **Intuit-initiated disconnect:** `nudgepay-app/app/routes/api.qbo.disconnect.tsx` (lines 28–50)
  - Intuit redirects user to this endpoint after user revokes in their "My Apps" portal.
  - Uses optional session (user may not have app session cookie).
  - Clears stale tokens via `disconnectConnection()` (lines 38–40).
  - Returns confirmation HTML (no redirect, since user may not be in app flow).

---

## Transport Security

**Requirement:** All communications are encrypted in transit and webhook signatures are verified before processing.

**Implementation:**
- **HTTPS via Cloudflare:** All routes deployed to Cloudflare Workers.
  - Workers runtime enforces TLS 1.2+ for inbound HTTPS.
  - Outbound calls to Intuit API use HTTPS via Workers' fetch.
  - Outbound calls to Twilio use HTTPS via Workers' fetch.

- **QBO webhook signature verification:** `nudgepay-app/app/lib/qbo-webhook.server.ts` (lines 1–37)
  - Intuit signs raw request body with HMAC-SHA256 (key = webhook verifier token).
  - `verifyQboSignature(rawBody, signatureHeader, verifierToken)`: (lines 31–37)
    - Recomputes signature via `signQboPayload()` (lines 12–22).
    - Uses timing-safe comparison to prevent timing attacks (lines 24–28).
    - Returns boolean; webhook handler must verify before processing payload.
    - Signature mismatch = reject webhook (no database updates).

- **Twilio webhook signature verification:** `nudgepay-app/app/lib/twilio-webhook.server.ts` (lines 1–40+)
  - Twilio signs (URL + POST params, sorted by key, concatenated) with HMAC-SHA1 (key = account Auth Token).
  - `verifyTwilioSignature(authToken, url, params, header)`: (lines 36–40+)
    - Recomputes signature via `signTwilioRequest()` and `twilioSignatureBase()`.
    - Uses timing-safe comparison (lines 29–33).
    - Returns boolean; webhook handler must verify before processing.
    - Signature mismatch = reject webhook (no database updates).

---

## Access Control & Cross-Organization Isolation

**Requirement:** Users can only access data for organizations they are members of; rows from other orgs are inaccessible.

**Implementation:**
- **Supabase Auth + RLS:** All customer/invoice/payment data tables have RLS policies on `org_id`.
  - User row-level security enforced via `is_org_member()` function (in Supabase).
  - Verifies `auth.uid` is in `memberships(org_id, user_id)` for the queried org.
  - Queries automatically filtered; org data leakage prevented at database layer.

- **Cross-organization isolation tested:** `nudgepay-app/tests/rls.test.ts` (lines 1–34)
  - Test setup: creates Org A and Org B, two users, one per org, with customer rows.
  - `"user A sees only org A customers"` (lines 20–23): selects customers, expects only org A's row.
  - `"user A cannot read org B customers even when filtering by org B id"` (lines 25–28): explicitly queries `org_id = orgB`, expects empty result (RLS blocks).
  - `"user A cannot insert a row into org B"` (lines 30–33): attempts insert with `org_id = orgB`, expects error (RLS denies).
  - Confirms row-level security is enforced, not just app-layer filtering.

---

## No PII / Financial Data in Logs

**Requirement:** Logs do not contain sensitive customer data (names, SSNs, invoice amounts, account numbers).

**Implementation:**
- **Webhook handlers log error context only:**
  - QBO webhook handler: logs realmId and error message on signature failure; does not log payload.
  - Twilio webhook handler: logs error context (delivery status enum, phone) on signature failure; does not log SMS content.
  - Payment/invoice handlers: on database error, log error message; do not log QBO response body or customer PII.

- **Auth routes:** log redirect status, not tokens or codes.

- **Audit trail:** org_id, user_id, and high-level action (e.g., "QBO connected", "invoice created") may be logged; customer names and financial amounts are never logged.

---

## Data Minimization

**Requirement:** Only data strictly necessary for collections is collected and persisted.

**Implementation:**
- **Customer sync:** reads only `name`, `id`, `active_status` from QBO; other fields (email, address, tax ID) not fetched.
- **Invoice sync:** reads `id`, `docNumber`, `totalAmt`, `dueDate`, `status` from QBO; line items and tax details not fetched.
- **Payment record:** stores `org_id`, `customer_id`, `invoice_id`, `amount_cents`, `sms_status`, `attempt_count`, `created_at`; no card data, no customer email, no internal notes.
- **SMS:** only phone number (from customer record), SMS content (user-drafted message), and delivery status stored; no Twilio media attachments, no external contact data.

---

## Summary

Each requirement is satisfied by a combination of cryptographic controls (AES-256-GCM encryption, HMAC signature verification), architectural patterns (server-only routes, service-role Supabase client, OAuth state nonce), and database-level enforcement (RLS on org_id). Cross-organization isolation is tested; no sensitive data is logged or leaked to the browser.
