# Production Deploy & Secrets Runbook

**Target:** Take the NudgePay app live on Cloudflare Workers + production Supabase + Intuit + Twilio.

**Time estimate:** 30–45 min (parallel: Supabase setup, Worker deployment, portal wiring).

**Prerequisites**
- Cloudflare account with `wrangler` CLI logged in: `wrangler login`
- Supabase account (free tier supports this app)
- Intuit **production** app keys (from developer.intuit.com)
- Twilio **production** account + Messaging Service (account SID, auth token, service SID)
- A chosen public domain or Cloudflare-managed subdomain as `${APP_BASE_URL}` (e.g., `https://nudgepay.example.com`)

---

## 1. Prerequisites & Local Setup

Confirm you have access to all required credentials:

```bash
# Ensure wrangler CLI is logged in
wrangler whoami

# Verify nudgepay-app is in the working directory
ls nudgepay-app/wrangler.toml
```

**Environment:** You will need write access to your **production** Supabase project, Intuit developer app, and Twilio Messaging Services console.

---

## 2. Production Supabase Setup

### 2.1 Create Project

1. Log into [app.supabase.com](https://app.supabase.com).
2. Create a **new project** in your production region.
3. Copy and save:
   - **Project URL**: `https://<your-prod-project-ref>.supabase.co`
   - **Anon/publishable key**: used by the browser client
   - **Service-role key**: used by the Worker (server-side only, never expose)

### 2.2 Run Migrations

Update `nudgepay-app/wrangler.toml` `[env.production.vars]` with your actual project URL:

```toml
[env.production.vars]
SUPABASE_URL = "https://<your-prod-project-ref>.supabase.co"
```

Link your local Supabase CLI to the production project and push migrations:

```bash
cd nudgepay-app
supabase link --project-ref <your-prod-project-ref>
```

Then apply all migrations in order. The Supabase CLI will push them:

```bash
supabase db push
```

**Verify:** After push completes, confirm the following tables exist in the production dashboard (SQL Editor):

- `tenants` (with RLS enabled)
- `tenant_members` (with RLS enabled)
- `tenant_invites` (with RLS enabled)
- `qbo_auth_tokens` (with RLS enabled)
- `qbo_sync_state` (with RLS enabled)
- `twilio_conversations` (with RLS enabled)

**Migration files applied (in order):**
1. `0001_tenancy_schema.sql` — core tables: tenants, tenant_members, tenant_invites
2. `0002_rls_policies.sql` — row-level security policies (tenant isolation)
3. `0003_invites.sql` — invite tokens and status tracking
4. `0004_qbo_oauth.sql` — Intuit QBO OAuth tokens & refresh handling
5. `0005_qbo_sync.sql` — QBO sync state (last-sync, error tracking)
6. `0006_twilio_messaging.sql` — Twilio message history & conversation state

---

## 3. Supabase Auth Configuration

### 3.1 Enable Email Confirmation

In your production Supabase project dashboard:

1. Go **Authentication** → **Providers** → **Email**.
2. Toggle **Confirm email** to **ON**.
3. Optionally configure the email templates (confirm, recovery, magic link subjects) to match your branding.

### 3.2 Configure Site URL & Redirects

In **Authentication** → **URL Configuration**:

- **Site URL**: `${APP_BASE_URL}` (e.g., `https://nudgepay.example.com`)
- **Redirect URLs**: Add both:
  - `${APP_BASE_URL}/auth/callback`
  - `${APP_BASE_URL}/auth/qbo/callback`

**Rationale:** Email confirmation links and OAuth redirects must point to your deployed Worker domain; Supabase validates these strictly.

---

## 4. Set Secrets in Cloudflare Workers

The following secrets are required for production. Each is set independently:

```bash
# Supabase (anon key for browser, service key for server-side API calls)
npx wrangler secret put SUPABASE_ANON_KEY --env production
npx wrangler secret put SUPABASE_SERVICE_KEY --env production

# Intuit (production app, not sandbox)
npx wrangler secret put QBO_CLIENT_ID --env production
npx wrangler secret put QBO_CLIENT_SECRET --env production
npx wrangler secret put QBO_REDIRECT_URI --env production
# Value: ${APP_BASE_URL}/auth/qbo/callback (must match Intuit app exactly)
npx wrangler secret put QBO_ENCRYPTION_KEY --env production
# Value: base64(32 random bytes). Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put QBO_WEBHOOK_VERIFIER_TOKEN --env production
# From Intuit app Webhooks page; required for webhook signature verification

# Twilio (production Messaging Service SID or sender number)
npx wrangler secret put TWILIO_ACCOUNT_SID --env production
npx wrangler secret put TWILIO_AUTH_TOKEN --env production
npx wrangler secret put TWILIO_MESSAGING_SERVICE_SID --env production
# Value: Service SID from Twilio console (if using a Messaging Service; preferred)
# Alternative: npx wrangler secret put TWILIO_FROM_NUMBER --env production
# Value: E.164 format (e.g., +11234567890) if not using Messaging Service
npx wrangler secret put TWILIO_PUBLIC_BASE_URL --env production
# Value: ${APP_BASE_URL} (e.g., https://nudgepay.example.com)
```

### 4.1 Deploy Gate ⚠️

**Critical:** The following routes will return HTTP 500 at runtime until **all** secrets above are set:
- Any endpoint that calls `getQboEnv()` → requires all `QBO_*` secrets
- Any endpoint that calls `getTwilioEnv()` → requires all `TWILIO_*` secrets

Do not attempt to test signup or QBO/Twilio webhooks until all secrets are in place. If you see 500 errors, verify:

```bash
# List which secrets are set (does not show values)
wrangler secret list --env production
```

---

## 5. Deploy the Worker

Deploy the application to production:

```bash
cd nudgepay-app
npx wrangler deploy --env production
```

On success, you will see output like:

```
 ⛅ wrangler 3.x.x
 ✨ Successfully published your Worker
 ✨ Deployed to https://nudgepay-abc123.workers.dev
```

**Capture the deployed URL** (e.g., `https://nudgepay-abc123.workers.dev`) as your `${APP_BASE_URL}` if you do not yet have a custom domain.

**Verify the app is accessible:**

```bash
curl "${APP_BASE_URL}/" -I
# Should return HTTP 200
```

---

## 6. Custom Domain (Optional)

If you have a production domain and want to use it instead of the `.workers.dev` URL:

### 6.1 Attach Custom Domain in Cloudflare

1. Go to your Cloudflare dashboard for your domain.
2. **Workers Routes** → **Create Route**.
3. Route: `https://nudgepay.example.com/*`
4. Select your deployed Worker.
5. Save.

Cloudflare will provision the SSL certificate automatically.

### 6.2 Update Secrets & Supabase Config

After the custom domain is live, update:

1. **Update Supabase URL Configuration** (Section 3.2):
   - Site URL: `https://nudgepay.example.com`
   - Redirect URLs: `https://nudgepay.example.com/auth/callback`, `https://nudgepay.example.com/auth/qbo/callback`

2. **Update Worker secrets:**

```bash
npx wrangler secret put QBO_REDIRECT_URI --env production
# Value: https://nudgepay.example.com/auth/qbo/callback
npx wrangler secret put TWILIO_PUBLIC_BASE_URL --env production
# Value: https://nudgepay.example.com
```

---

## 7. Wire Intuit (QuickBooks Online) Portal

Configure your **production** Intuit app on [developer.intuit.com](https://developer.intuit.com).

### 7.1 Set OAuth Redirect & Disconnect URLs

- **Redirect URI**: `${APP_BASE_URL}/auth/qbo/callback` (e.g., `https://nudgepay.example.com/auth/qbo/callback`)
- **Disconnect URL**: `${APP_BASE_URL}/api/qbo/disconnect` (GET landing — clears stored tokens on Intuit-initiated disconnect)

### 7.2 Configure App Launch & Domain URLs

- **Launch URL**: `${APP_BASE_URL}` (your app home)
- **Host domain**: your full domain (e.g., `nudgepay.example.com`)

### 7.3 Privacy & Legal URLs

- **Privacy Policy URL**: `${APP_BASE_URL}/privacy`
- **EULA URL**: `${APP_BASE_URL}/eula`

### 7.4 Configure Webhooks

In the Intuit app **Webhooks** section:

- **Webhook URL**: `${APP_BASE_URL}/webhooks/qbo` (or your actual QBO webhook route; see Task 5)
- **Enable events**: Company Update, Bill, Invoice, etc. (per your app's QBO sync logic)

1. Generate a new **Webhook Verifier Token** in the Intuit portal.
2. Set it in Cloudflare:

```bash
npx wrangler secret put QBO_WEBHOOK_VERIFIER_TOKEN --env production
# Paste the token from Intuit portal
```

**Test webhook connectivity:** Intuit will attempt to validate the webhook URL by sending a signature-verified request. Your app logs should show acceptance.

---

## 8. Wire Twilio Portal

Configure your **production** Twilio Messaging Service to send webhooks to your app.

### 8.1 Set Inbound Webhook (Incoming Messages)

In your Twilio Messaging Service:

1. Go **Messaging** → **Services** → select your production Messaging Service.
2. Under **Inbound Settings**:
   - **Webhook URL** (inbound): `${APP_BASE_URL}/webhooks/twilio/inbound`
   - **HTTP Method**: `POST`
   - **Webhook Mode**: `Raw body` (the app parses Twilio form-encoded format)

### 8.2 Set Status Callback Webhook

1. Still in the Messaging Service, find **Status Callback URL** or configure it at the sender/number level:
   - **Status Callback URL**: `${APP_BASE_URL}/webhooks/twilio/status`
   - **HTTP Method**: `POST`

### 8.3 Confirm TWILIO_PUBLIC_BASE_URL Secret

Ensure the secret matches your actual domain:

```bash
npx wrangler secret put TWILIO_PUBLIC_BASE_URL --env production
# Value: ${APP_BASE_URL} (e.g., https://nudgepay.example.com)
# This must match EXACTLY what Twilio will see when validating signatures
```

**Signature validation:** The app uses `TWILIO_AUTH_TOKEN` + `TWILIO_PUBLIC_BASE_URL` to verify incoming webhooks. Twilio signs based on the exact URL it called; mismatch = 403 Forbidden.

---

## 9. Smoke Test

### 9.1 Public Pages Return 200

Test that static pages are accessible:

```bash
curl "${APP_BASE_URL}/privacy" -I
# HTTP 200

curl "${APP_BASE_URL}/eula" -I
# HTTP 200
```

### 9.2 Signup → Email Confirmation Flow

1. Navigate to `${APP_BASE_URL}` in a browser.
2. Click **Sign Up**.
3. Enter an email and password.
4. Check your inbox for a confirmation email from Supabase (subject: "Confirm Your Signup").
5. Click the confirmation link.
6. Verify you can log in and create/access a tenant workspace.

### 9.3 QBO OAuth Flow

1. Log in as a user.
2. Navigate to **Settings** → **Connect QuickBooks Online** (or your app's QBO flow).
3. Confirm you are redirected to Intuit's OAuth login (not an error page).
4. Complete OAuth; you should be redirected back to `${APP_BASE_URL}/auth/qbo/callback`.
5. Verify the QBO authorization was stored (check app UI or database: `qbo_auth_tokens` table should have a row for your user).

### 9.4 Twilio Messaging (Optional, if enabled in app)

If your app has an SMS/messaging feature:

1. Log in and navigate to the messaging UI.
2. Send a test message to a Twilio sandbox number or production number (if configured).
3. Check Twilio logs that the inbound/status callbacks were received (Twilio Console → Messaging → Logs).

---

## Rollback / Troubleshooting

- **Worker deployment failure:** Check `wrangler deploy` error message; ensure all secrets are set. Re-deploy: `npx wrangler deploy --env production`.
- **Email confirmation not working:** Verify Site URL and Redirect URLs in Supabase Auth settings match `${APP_BASE_URL}` exactly (case-sensitive).
- **QBO OAuth 403 or redirect error:** Confirm `QBO_REDIRECT_URI` secret matches Intuit app's registered Redirect URI.
- **Twilio webhook 403:** Verify `TWILIO_PUBLIC_BASE_URL` matches the domain Twilio sees and `TWILIO_AUTH_TOKEN` is correct.
- **500 on QBO/Twilio routes:** All corresponding secrets must be set; check `wrangler secret list --env production`.

---

## Sign-Off

- [ ] All migrations applied successfully
- [ ] Supabase Auth email confirmation enabled; Site URL & Redirect URLs configured
- [ ] All secrets set via `wrangler secret put`
- [ ] Worker deployed and accessible at `${APP_BASE_URL}`
- [ ] Intuit app Redirect URI, Privacy/EULA URLs, and Webhook URL configured
- [ ] Twilio Messaging Service webhooks (inbound + status) configured
- [ ] Signup flow tested (email confirmation works)
- [ ] QBO OAuth flow tested (redirect + token storage works)
- [ ] Privacy & EULA pages return 200

**Deployment complete.** The app is live and ready for user traffic.
