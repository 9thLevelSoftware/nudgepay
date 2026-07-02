# Intuit Production Checklist

Pre-launch verification for the QuickBooks Online integration.

> **TODO(deploy):** Replace every `WORKER_PROD_URL_PLACEHOLDER` with the actual
> Worker production URL before going live.

## 1. Intuit App Card URLs

| Field              | Value                                                | Where                          |
|--------------------|------------------------------------------------------|--------------------------------|
| Privacy Policy URL | `https://WORKER_PROD_URL_PLACEHOLDER/privacy`        | Intuit Developer → App → URLs  |
| EULA URL           | `https://WORKER_PROD_URL_PLACEHOLDER/eula`            | Intuit Developer → App → URLs  |
| Launch URL         | `https://WORKER_PROD_URL_PLACEHOLDER/dashboard`       | Intuit Developer → App → URLs  |
| Disconnect URL     | `https://WORKER_PROD_URL_PLACEHOLDER/api/qbo/disconnect` | Intuit Developer → App → URLs  |

**Verified by:** Browsing each URL; 200 response with correct page content.

## 2. Netlify Redirects

Deploy the `netlify/` directory to the existing `nudgepay-ar.netlify.app` site:
```
cd netlify && netlify deploy --prod --dir .
```
Verify: `curl -I https://nudgepay-ar.netlify.app/privacy` → 301 to Worker.

## 3. Production QBO Credentials

| Secret                    | Source                                       | Set with                                          |
|---------------------------|----------------------------------------------|---------------------------------------------------|
| `QBO_CLIENT_ID`           | Intuit Developer → Production Keys           | `npx wrangler secret put QBO_CLIENT_ID --env production` |
| `QBO_CLIENT_SECRET`       | Intuit Developer → Production Keys           | `npx wrangler secret put QBO_CLIENT_SECRET --env production` |
| `QBO_REDIRECT_URI`        | Must exactly match: `https://WORKER_PROD_URL_PLACEHOLDER/auth/qbo/callback` | `npx wrangler secret put QBO_REDIRECT_URI --env production` |
| `QBO_ENCRYPTION_KEY`      | `openssl rand -base64 32`                    | `npx wrangler secret put QBO_ENCRYPTION_KEY --env production` |
| `QBO_WEBHOOK_VERIFIER_TOKEN` | Intuit Developer → Webhooks page          | `npx wrangler secret put QBO_WEBHOOK_VERIFIER_TOKEN --env production` |

**Verified by:** Owner connects QBO from Settings; invoices sync within 30 min.

## 4. Webhook Endpoint

| Setting          | Value                                                      |
|------------------|------------------------------------------------------------|
| Endpoint URL     | `https://WORKER_PROD_URL_PLACEHOLDER/webhooks/qbo`          |
| Subscribed events| Invoice, Customer, Payment, CreditMemo                     |

**Verified by:** Create a test invoice in QBO → appears in NudgePay within seconds.

## 5. Environment Configuration

Ensure `wrangler.toml` production vars:
```toml
[env.production.vars]
QBO_SANDBOX = "false"
```

## 6. Resend / Email Secrets

| Secret                  | Source                     | Set with                                              |
|-------------------------|----------------------------|-------------------------------------------------------|
| `RESEND_API_KEY`        | Resend dashboard → API Keys | `npx wrangler secret put RESEND_API_KEY --env production` |
| `RESEND_WEBHOOK_SECRET` | Resend dashboard → Webhooks | `npx wrangler secret put RESEND_WEBHOOK_SECRET --env production` |
| `UNSUBSCRIBE_SECRET`    | `openssl rand -base64 32`  | `npx wrangler secret put UNSUBSCRIBE_SECRET --env production` |
| `APP_PUBLIC_BASE_URL`   | Worker production URL       | `npx wrangler secret put APP_PUBLIC_BASE_URL --env production` |

## 7. Twilio Secrets

| Secret                        | Source                       | Set with                                                    |
|-------------------------------|------------------------------|-------------------------------------------------------------|
| `TWILIO_ACCOUNT_SID`          | Twilio console               | `npx wrangler secret put TWILIO_ACCOUNT_SID --env production` |
| `TWILIO_AUTH_TOKEN`           | Twilio console               | `npx wrangler secret put TWILIO_AUTH_TOKEN --env production` |
| `TWILIO_MESSAGING_SERVICE_SID`| Twilio console → Messaging   | `npx wrangler secret put TWILIO_MESSAGING_SERVICE_SID --env production` |
| `TWILIO_PUBLIC_BASE_URL`      | Worker production URL        | `npx wrangler secret put TWILIO_PUBLIC_BASE_URL --env production` |

## 8. Post-Connect Smoke Test

1. Owner signs up, connects QBO from Settings → Syncs invoices.
2. Dashboard shows overdue accounts with correct balances.
3. Coming-due tab shows invoices due within 7 days.
4. Log a contact → author name appears in timeline.
5. Send a test email → Resend delivery confirmed.
6. Send a test SMS → Twilio delivery confirmed.
7. Late fees (if enabled) show on detail panel.
8. Break a promise → owner receives alert email.
9. Wait for digest cron → members receive daily digest.
