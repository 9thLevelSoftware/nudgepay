# Phase 3 Live Trial Verification Guide

This document describes the steps to verify the Twilio SMS flow against a **real Twilio trial account** when ready. Local mock testing (Twilio API stub) was completed in Phase 3; this guide covers the deferred manual verification step.

## Prerequisites

Before proceeding with Phase 3 live trial verification, ensure:

1. **Phase 3 implementation is complete:** Outbound send, inbound reply matching, consent/STOP/START tracking, and status callbacks are all deployed to a Workers environment or running locally via `wrangler dev`.
2. You have access to a [Twilio Console](https://www.twilio.com/console).
3. A Twilio trial account is available (if not yet created, sign up at twilio.com).

## Step 1: Trial Prerequisites & Limits

A Twilio trial account has important restrictions and setup requirements:

### Trial Phone Number Limits

- **Trial accounts can only send messages to verified phone numbers.** Before sending any SMS, you must verify your own phone number in the Twilio Console:
  1. Log in to [Twilio Console](https://www.twilio.com/console).
  2. Navigate to **Phone Numbers** → **Verified Caller IDs**.
  3. Click **Verify a Number** and follow the SMS verification flow to confirm your personal phone number (E.164 format, e.g., `+1234567890`).
  4. Once verified, this number can receive messages sent from your trial account.

### Trial Message Prefix

- All trial messages are automatically prefixed with **"Sent from your Twilio trial account"** (Twilio appends this to every message). This is invisible to your code but visible to the recipient and aids debugging.

### A2P 10DLC Registration (Start Now, Use Later)

- **For production use**, SMS to arbitrary US numbers requires **A2P 10DLC (Application-to-Person, 10-digit Long Code) campaign registration** under your organization's registered brand.
- This is a **long-lead** external process (Twilio/carrier approval can take days to weeks).
- **Important:** Even though Phase 3 uses a trial account for testing, begin the A2P 10DLC registration **now** (under Chancey's registered brand) so it is approved before moving to production. Register via the Twilio Console under **Messaging** → **Campaign Builders**.
- Trial-to-verified-number testing (Step 3–5 below) does not require A2P 10DLC; full production use does.

## Step 2: Secrets & Tunnel Configuration

### Set Twilio Environment Variables

Configure your Twilio credentials via `wrangler secret put` or `.dev.vars`:

```bash
# For production / staging Workers
wrangler secret put TWILIO_ACCOUNT_SID
# Paste: <your-trial-account-SID>

wrangler secret put TWILIO_AUTH_TOKEN
# Paste: <your-trial-auth-token>

# Either set a Messaging Service SID (recommended for production)
wrangler secret put TWILIO_MESSAGING_SERVICE_SID
# Paste: <messaging-service-SID, or leave empty if using FROM_NUMBER>

# Or set a trial phone number
wrangler secret put TWILIO_FROM_NUMBER
# Paste: <trial-number-in-E.164-format, e.g., +11234567890>
```

For local development with `.dev.vars`:

```env
TWILIO_ACCOUNT_SID=<trial-SID>
TWILIO_AUTH_TOKEN=<trial-token>
TWILIO_FROM_NUMBER=<trial-number-E.164>
# Or TWILIO_MESSAGING_SERVICE_SID=<SID> if available
```

Then run:

```bash
npx wrangler dev
```

### Tunnel & Public HTTPS URL

Twilio webhooks require a reachable HTTPS endpoint. Your local `wrangler dev` or deployed Workers URL must be exposed:

- **Option A: Cloudflare Tunnel** (if your Workers is on Cloudflare):
  ```bash
  cloudflared tunnel --url http://localhost:8787
  ```
  Use the generated HTTPS URL (e.g., `https://abc123.cloudflare.com`) as your `TWILIO_PUBLIC_BASE_URL`.

- **Option B: ngrok**:
  ```bash
  ngrok http 8787
  ```
  Use the generated HTTPS URL (e.g., `https://abc123.ngrok.io`) as your `TWILIO_PUBLIC_BASE_URL`.

- **Option C: Deployed Workers URL**:
  If testing against staging, use the deployed HTTPS worker endpoint directly.

### Critical: TWILIO_PUBLIC_BASE_URL Must Match Exactly

**The most common cause of signature verification failures (Step 4) is a mismatch between `TWILIO_PUBLIC_BASE_URL` and the actual URL that Twilio calls your webhook with.** Ensure:

```env
# For local tunnel (example with ngrok)
TWILIO_PUBLIC_BASE_URL=https://abc123.ngrok.io
```

The webhook signature is computed over the exact request URL Twilio makes. If your code expects `https://example.com/webhooks/twilio/status` but Twilio is configured to call `https://example.com:8787/webhooks/twilio/status`, the signatures will not match.

## Step 3: Outbound Send Test

This step verifies that outbound SMS sends correctly via Twilio and writes a database row.

1. **Seed a test customer:**
   - Create a customer in your local/deployed NudgePay database with:
     - `phone` = your verified phone number (E.164 format, e.g., `+1234567890`).
     - `sms_consent` = `true`.

2. **Create an unpaid invoice for that customer:**
   - Create an invoice record linked to the customer with `balance > 0` and a past `due_date`.

3. **Log in to the NudgePay app** and navigate to the **Invoices** page.

4. **Open the invoice thread:**
   - Click on the invoice to view its detail / conversation thread.

5. **Mark consent:**
   - Click the **Mark consented** toggle or button to confirm SMS consent is enabled for this customer.

6. **Send a test message:**
   - Type a short message in the message input field (e.g., "Test payment reminder").
   - Click **Send text**.

7. **Verify SMS delivery:**
   - Within a few seconds, your phone should receive the text message.
   - The message will display the trial prefix: `"Sent from your Twilio trial account …"`.

8. **Verify database row:**
   - Check the `text_messages` table in your database for a new row:
     - `invoice_id` = your test invoice ID.
     - `customer_id` = your customer ID.
     - `direction` = `'outbound'`.
     - `twilio_message_sid` = the SID returned by Twilio (non-empty).
     - `status` = initial value (e.g., `'queued'` or `'accepted'`).
     - `to_number` and `from_number` = E.164 phone numbers.
     - `sent_by_user_id` = the ID of the logged-in user.

## Step 4: Status Callback & Signature Verification

This step verifies that Twilio webhooks deliver message delivery status and that bad signatures are rejected.

### Configure Status Callback URL

1. Log in to [Twilio Console](https://www.twilio.com/console).
2. Navigate to **Messaging** → **Services** (or the Phone Numbers section for trial numbers without a Service).
3. Find your phone number or Messaging Service configuration.
4. Set the **Status Callback URL** to:
   ```
   {TWILIO_PUBLIC_BASE_URL}/webhooks/twilio/status
   ```
   Example: `https://abc123.ngrok.io/webhooks/twilio/status`

5. Save the configuration.

### Test Status Updates

1. **Send another test message** (repeat Step 3 steps 1–6).
2. **Monitor the `text_messages` row:**
   - Within seconds to minutes, the `status` field should advance: `queued` → `sent` → `delivered`.
   - On failures, `error_code` should populate with a Twilio error code (e.g., `21610` for a blacklisted number).

3. **Check the webhook logs:**
   - Your application logs or database should show webhook delivery events.
   - Confirm that the Status Callback route processed the update without errors.

### Verify Bad Signature Rejection

1. **Send a malformed webhook request:**
   ```bash
   curl -X POST https://<your-public-host>/webhooks/twilio/status \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -H "X-Twilio-Signature: wrong-signature-value" \
     -d "MessageSid=SM1234567890abcdef&MessageStatus=delivered&AccountSid=ACabcdef1234567890"
   ```

2. **Verify the response is 403 Forbidden:**
   - The route must reject the request **before any database work** with a 403 status.
   - No row should be created or updated.

3. **Verify missing signature rejection:**
   ```bash
   curl -X POST https://<your-public-host>/webhooks/twilio/status \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "MessageSid=SM1234567890abcdef&MessageStatus=delivered&AccountSid=ACabcdef1234567890"
   ```
   - The route must also return 403 if the `X-Twilio-Signature` header is absent entirely.

## Step 5: Inbound Replies & Opt-Out (STOP/START)

This step verifies that inbound messages are matched to customers and that consent changes (STOP/START) are honored.

### Configure Inbound Webhook URL

1. Log in to [Twilio Console](https://www.twilio.com/console).
2. Navigate to **Phone Numbers** → **Active Numbers** and select your trial phone number.
3. In the **Messaging** section, find **"A message comes in"** (or similar).
4. Set the webhook URL to:
   ```
   {TWILIO_PUBLIC_BASE_URL}/webhooks/twilio/inbound
   ```
   Example: `https://abc123.ngrok.io/webhooks/twilio/inbound`

5. Save the configuration.

### Test Inbound Reply Threading

1. **From your verified phone number, send a reply** to the trial SMS.
   - For example, if the app sent "Test payment reminder," reply "Payment made" or any text.

2. **Check the `text_messages` table:**
   - A new inbound row should be created:
     - `direction` = `'inbound'`.
     - `body` = the text you sent (e.g., "Payment made").
     - `from_number` = your phone.
     - `to_number` = the trial number.
     - `twilio_message_sid` = the SID of the inbound message.

3. **Verify thread matching:**
   - The inbound message should link to the same `invoice_id` as the outbound message (or the latest outbound for this customer).
   - The message appears in the invoice thread UI.

### Test STOP Opt-Out

1. **From your phone, send the text "STOP"** (case-insensitive) to the trial number.

2. **Verify consent flip:**
   - The `customers.sms_consent` column for your test customer should flip from `true` to `false`.

3. **Verify UI disable:**
   - In the invoice thread UI, the **Send text** button should become disabled (greyed out or hidden).

4. **Verify no further sends:**
   - Any attempt to send a message for this customer should fail or be blocked until consent is re-enabled.

### Test START Opt-In

1. **From your phone, send the text "START"** (case-insensitive) to the trial number.

2. **Verify consent re-enable:**
   - The `customers.sms_consent` column should flip back to `true`.

3. **Verify UI re-enable:**
   - The **Send text** button should become enabled again.

4. **Verify sends work:**
   - You should be able to send a message again successfully (Step 3 test, repeat).

## Step 6: Messaging Service & Production Path

When moving from trial to production SMS, follow this path:

### Create a Messaging Service

1. Log in to [Twilio Console](https://www.twilio.com/console).
2. Navigate to **Messaging** → **Services**.
3. Click **Create Messaging Service**.
4. Configure:
   - **Friendly name:** e.g., "NudgePay SMS Reminders"
   - **Use case:** `Conversational`
   - Add your trial phone number (or a production 10DLC number) as the sender.

### Enable Advanced Opt-Out

1. In the Messaging Service settings, enable **Advanced Opt-Out:**
   - This automatically processes `STOP`, `START`, and `HELP` keywords.
   - No code change required; opt-out is handled by Twilio.

### Register A2P 10DLC Campaign

1. In the Twilio Console, navigate to **Messaging** → **Campaign Builder** (or **Compliance Manager**).
2. Register your SMS campaign under Chancey's brand:
   - **Brand:** Chancey LLC (already registered in Twilio account).
   - **Campaign use case:** e.g., "Customer Service / Account Notifications"
   - **Phone number(s):** List all 10DLC numbers that will send messages.
3. Submit for carrier approval (this may take 1–7 business days).

### Switch Configuration (No Code Change)

Once the Messaging Service is created and A2P campaign is approved:

1. Set the Messaging Service SID in your environment:
   ```bash
   wrangler secret put TWILIO_MESSAGING_SERVICE_SID
   # Paste: <messaging-service-SID>
   ```

2. In your database (per-org `messaging_config` table or equivalent), set:
   ```
   messaging_service_sid = <messaging-service-SID>
   ```

3. **The outbound send code path automatically switches:**
   - If `TWILIO_MESSAGING_SERVICE_SID` (or org-level `messaging_service_sid`) is set, the code uses the Messaging Service.
   - Otherwise, it falls back to `TWILIO_FROM_NUMBER`.
   - **No application code changes are needed.**

4. Deploy and test:
   - Send a message via the app.
   - Confirm it delivers from the Messaging Service number.
   - STOP/START processing is now handled automatically by Twilio's Advanced Opt-Out.

---

## Scope Notes

### Included in Phase 3
- Outbound SMS send with consent & phone gating.
- Per-org/env Messaging Service configuration with phone-number fallback.
- Twilio injection behind a mockable fetch dependency.
- Inbound SMS reply matching and threading to invoices.
- STOP/START consent toggling and opt-out state.
- Delivery-status callbacks updating message rows by SID.
- Webhook signature verification (reject 403 on bad/absent `X-Twilio-Signature`).
- Per-invoice thread UI with message history, consent toggle, and gated send form.

### Out of Scope (Later Phases)
- **A2P 10DLC registration itself:** This is an external Twilio/carrier process; the guide documents when to start it (now) but not how to approve/manage the campaign in Twilio's compliance portal.
- **Admin UI for per-tenant Messaging Service configuration:** Setting `messaging_config.messaging_service_sid` is schema-ready but has no UI. Phase 5/admin will add this.
- **Message templates, scheduled sends, bulk operations:** Phase 3 sends ad-hoc per-invoice texts only.
- **Rich iMessage-style UI polish:** Phase 5 will port the prototype's full thread view.
- **Multi-country phone normalization:** `normalizePhone` is US-only (last 10 digits); a normalized phone column is the future fix.
- **Inbound media (MMS):** Only text bodies are supported in Phase 3.

## Troubleshooting

- **"401 Unauthorized" on webhook requests:** Verify `TWILIO_PUBLIC_BASE_URL` matches **exactly** what Twilio is calling. Check Twilio Console logs or your application logs for the URL being hit. Signature computation is sensitive to URL differences (trailing slashes, scheme, host, port).
- **Signature verification failures (403 on webhook):** Confirm `TWILIO_AUTH_TOKEN` is correct. The signature is computed with the token and the exact request URL + body. Any mismatch causes 403. Log the computed vs. expected signature in your webhook handler for debugging.
- **Inbound messages not matching customers:** Verify the inbound phone number matches a customer's `phone` column (both in E.164 format). If using a non-verified number in trial, messages will not arrive.
- **STOP/START not working:** Ensure the `customers.sms_consent` column is being updated. If using a Messaging Service with Advanced Opt-Out enabled, Twilio processes STOP/START before your webhook is called; your code must still reflect the opt-out state in the database.
- **Trial message prefix appearing twice:** Twilio appends "Sent from your Twilio trial account" automatically on trial accounts. Your code should not add it. If it appears twice, remove any custom prefix logic.
- **Cannot connect ngrok/tunnel:** Ensure the tunnel is running and forwarding to the correct `localhost` port (default `8787` for `wrangler dev`). Test with `curl https://<tunnel-url>/` to confirm reachability.

## References

- [Twilio Console](https://www.twilio.com/console)
- [Twilio Verified Caller IDs (Phone Number Verification)](https://www.twilio.com/docs/phone-numbers/verified-caller-ids)
- [Twilio SMS (Messaging)](https://www.twilio.com/docs/sms)
- [Twilio Webhooks & Status Callbacks](https://www.twilio.com/docs/sms/tutorials/webhooks)
- [Twilio Signature Verification](https://www.twilio.com/docs/sms/tutorials/webhook-security)
- [Twilio Messaging Services](https://www.twilio.com/docs/messaging/services)
- [Twilio Advanced Opt-Out (Messaging Services)](https://www.twilio.com/docs/messaging/services/advanced-opt-out)
- [Twilio A2P 10DLC (Campaign Registration)](https://www.twilio.com/docs/sms/a2p-10dlc)
- Phase 3 implementation code (all under `nudgepay-worker/`):
  - Twilio config & helpers: `nudgepay-worker/src/lib/twilio-*.ts`
  - Send endpoint: `nudgepay-worker/src/routes/api.text.send.ts`
  - Webhook routes: `nudgepay-worker/src/routes/webhooks-twilio-*.ts`
  - Database helpers: `nudgepay-worker/src/db/text-messages.ts`
  - Test suites: `nudgepay-worker/src/__tests__/twilio-*.test.ts`
