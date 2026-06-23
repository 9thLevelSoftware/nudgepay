# Intuit App Details Reference

**Purpose:** This document maps every field in Intuit's "App Details" production submission form to its exact value or templated URL, derived from verified routes in the NudgePay codebase.

## App Details Configuration Table

| Intuit Field | Value | Backing Route File |
|---|---|---|
| **Host Domain** | `${APP_BASE_URL}` (e.g., `nudgepay.<account>.workers.dev`) | — |
| **Launch URL** | `${APP_BASE_URL}/dashboard` | `app/routes/dashboard.tsx` |
| **Connect / Reconnect URL** | `${APP_BASE_URL}/api/qbo/connect` | `app/routes/api.qbo.connect.tsx` |
| **Disconnect URL** | `${APP_BASE_URL}/api/qbo/disconnect` | `app/routes/api.qbo.disconnect.tsx` (GET landing — Task 2) |
| **OAuth Redirect URI** | `${APP_BASE_URL}/auth/qbo/callback` | `app/routes/auth.qbo.callback.tsx` |
| **EULA URL** | `${APP_BASE_URL}/eula` | `app/routes/eula.tsx` |
| **Privacy Policy URL** | `${APP_BASE_URL}/privacy` | `app/routes/privacy.tsx` |
| **Webhook (Production) URL** | `${APP_BASE_URL}/webhooks/qbo` | `app/routes/webhooks.qbo.tsx` |

## Default APP_BASE_URL

Recommended default for initial review and deployment:
```
${APP_BASE_URL} = nudgepay.<account>.workers.dev
```

Replace `<account>` with your Cloudflare account subdomain. This deployment target leverages Cloudflare Workers for US-based hosting.

## OAuth Scopes

The application requests the following OAuth scope from Intuit:

```
com.intuit.quickbooks.accounting
```

This scope is verified in `nudgepay-app/app/lib/qbo-client.server.ts` (line 4, `SCOPE` constant) and provides access to QuickBooks Online accounting data.

## Categories / Regulated Industries / Hosting Regions

**Operator-supplied guidance:**

- **Category:** Collections/AR (Accounts Receivable) utility
- **Regulated Industries:** Collections (Fair Debt Collection Practices Act compliance required)
- **Hosting Region:** United States (via Cloudflare Workers, us.workers.dev edge network)

Operators deploying this application must ensure compliance with applicable collections regulations in their jurisdictions.

## Critical: OAuth Redirect URI Exact-Match Requirement

The OAuth Redirect URI registered in the Intuit App Details form **MUST match the `QBO_REDIRECT_URI` environment secret byte-for-byte**. Any trailing slash mismatch, query parameter, or protocol difference will cause OAuth callback failures.

**Verification steps:**
1. Confirm the Intuit App Details form lists: `${APP_BASE_URL}/auth/qbo/callback`
2. Verify your deployed `QBO_REDIRECT_URI` secret matches exactly (case-sensitive, no trailing slash unless registered with one)
3. Test the full OAuth flow before production deployment

## Webhook Verifier Token Configuration

The Intuit webhook verifier token displayed in the same "App Details" page (under Webhook Settings) must be stored as the `QBO_WEBHOOK_VERIFIER_TOKEN` environment secret.

**Setup:**
1. In Intuit App Center → your app → Webhook Settings, locate the **Webhook Token** value
2. Store this value (verbatim) as the `QBO_WEBHOOK_VERIFIER_TOKEN` secret in your deployment environment
3. This token is used by the `${APP_BASE_URL}/webhooks/qbo` endpoint to verify incoming webhook signatures

## Route Verification Summary

All 8 routes listed in the table above have been verified to exist in `nudgepay-app/app/routes/`:

- ✅ `dashboard.tsx`
- ✅ `api.qbo.connect.tsx`
- ✅ `api.qbo.disconnect.tsx`
- ✅ `auth.qbo.callback.tsx`
- ✅ `eula.tsx`
- ✅ `privacy.tsx`
- ✅ `webhooks.qbo.tsx`

OAuth scope `com.intuit.quickbooks.accounting` confirmed in `qbo-client.server.ts`.
