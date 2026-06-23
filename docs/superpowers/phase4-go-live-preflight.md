# Phase 4: Go-Live Pre-Flight Checklist

This checklist gates the real-Chancey cutover. Complete each item in order; **do not proceed past item 8 until all prior items are confirmed.**

---

## 1. All Production Secrets Set

**Task:** Verify all production environment variables are deployed.

**Verification:**
- [ ] `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENCRYPTION_KEY` set in Cloudflare production environment.
- [ ] `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` set.
- [ ] `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_PUBLIC_BASE_URL` set.
- [ ] `APP_BASE_URL` set to production domain.
- [ ] `QBO_WEBHOOK_VERIFIER_TOKEN` set (Intuit-provided).
- [ ] All secrets are non-empty strings (no `undefined` or placeholder values).

**Reference:** Task 3 manifest lists all required secrets.

**Failure mode:** Routes that depend on missing secrets will return HTTP 500.

---

## 2. QBO_SANDBOX=false + Production Keys

**Task:** Ensure QBO integration points to Intuit's production environment.

**Verification:**
- [ ] `QBO_SANDBOX=false` (or unset, since production is default) in Cloudflare environment.
- [ ] `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` are Intuit production keys (not sandbox keys).
- [ ] `QBO_REDIRECT_URI` points to production domain (not localhost, not staging).

**Reference:** Intuit app settings dashboard; confirm "Production" (not "Sandbox").

**Failure mode:** Authorization redirects to sandbox Intuit, tokens are sandbox-only and fail against production QBO API.

---

## 3. Intuit App URLs Match ${APP_BASE_URL} Exactly

**Task:** Verify all Intuit app configuration redirects match the deployed domain byte-for-byte.

**Verification:**
- [ ] In Intuit Developer Portal, app's OAuth Redirect URI is exactly `${APP_BASE_URL}/auth/qbo/callback` (e.g., `https://nudgepay.example.com/auth/qbo/callback`).
- [ ] Disconnect URL is exactly `${APP_BASE_URL}/api/qbo/disconnect`.
- [ ] Webhook URL is exactly `${APP_BASE_URL}/api/webhooks/qbo`.
- [ ] No trailing slashes, no typos, protocol matches (https required).

**Reference:** Intuit app settings in Developer Portal.

**Failure mode:** OAuth code exchange fails (Intuit rejects redirect_uri mismatch); disconnect fails; webhooks not delivered.

---

## 4. Twilio Webhooks + TWILIO_PUBLIC_BASE_URL Match Deployed Domain

**Task:** Ensure Twilio inbound SMS and status callbacks point to production.

**Verification:**
- [ ] In Twilio Console, phone number webhook (Incoming Messages) is `${TWILIO_PUBLIC_BASE_URL}/api/webhooks/twilio/sms` (e.g., `https://nudgepay.example.com/api/webhooks/twilio/sms`).
- [ ] Status callback (for SMS delivery confirmations) is `${TWILIO_PUBLIC_BASE_URL}/api/webhooks/twilio/status`.
- [ ] No trailing slashes, protocol is https.
- [ ] `TWILIO_PUBLIC_BASE_URL` in environment matches the production domain.

**Reference:** Twilio Console > Phone Numbers > Active Numbers > [number] > Messaging section.

**Failure mode:** Inbound SMS and delivery status updates fail to reach app; collections workflow breaks.

---

## 5. A2P 10DLC Brand & Campaign Approved

**Task:** Obtain Twilio A2P 10DLC compliance; required for US production SMS.

**Verification:**
- [ ] A2P 10DLC brand application submitted to Twilio (or Twilio's carrier partner).
- [ ] Brand approval status: **VERIFIED** (in Twilio Console > Messaging > Phone Numbers > Campaign).
- [ ] Campaign (use case: collections SMS) created and associated with phone number.
- [ ] Campaign status: **APPROVED**.
- [ ] Phone number tier is 10DLC, not shortcode or long code (legacy).

**Timeline:** Allow 2–5 business days for Twilio/carriers to review and approve. **Start early.**

**Reference:** Twilio A2P 10DLC docs; Intuit/NudgePay's brand guidelines.

**Failure mode:** Twilio rejects outbound SMS from non-compliant phone number; collections cannot send.

---

## 6. Legal Page Fill-Ins Replaced

**Task:** Replace all placeholder tokens in the legal page with actual company information.

**Verification:**
- [ ] `[Legal Entity Name]` replaced with actual company name (e.g., "NudgePay, Inc.").
- [ ] `[Contact Email]` replaced with support/legal email (e.g., "legal@nudgepay.example.com").
- [ ] `[Governing-Law State]` replaced with state of incorporation (e.g., "Delaware").
- [ ] `[Effective Date]` replaced with policy effective date (e.g., "2025-06-22").
- [ ] No square-bracket tokens remain in either legal page.

**Reference:** Legal page files (from Task 4): `nudgepay-app/app/routes/privacy.tsx` and `nudgepay-app/app/routes/eula.tsx`.

**Failure mode:** Users see template placeholders; lack of credibility; potential legal/compliance issues.

---

## 7. Sandbox Demonstration Passed & Shown to Intuit

**Task:** Complete a full collections workflow in sandbox and demonstrate to Intuit.

**Verification:**
- [ ] Task 7 (auth-flow.test.ts + manual sandbox demo) passed.
- [ ] Demonstration shown to Intuit (internal notes or email confirming review).
- [ ] Intuit has approved moving to production (confirmation from Intuit account manager or via developer portal).
- [ ] Production API credentials have been granted/activated by Intuit (if on allowlist).

**Reference:** Task 7 completion; Intuit correspondence.

**Failure mode:** Intuit may revoke production credentials if demo does not meet security/UX standards.

---

## 8. FINAL GATE: Connect the Real Chancey QBO Company

**Task:** Connect the actual Chancey QBO company account to NudgePay production.

**Verification:**
- [ ] All items 1–7 are confirmed complete.
- [ ] Operator is authorized (only VP Finance or CEO).
- [ ] QBO company account URL is verified (real Chancey production account, not test).
- [ ] OAuth flow is initiated in production NudgePay dashboard (user clicks "Connect QuickBooks").
- [ ] User signs in with real Chancey QBO credentials.
- [ ] NudgePay receives authorization; tokens are encrypted and stored.
- [ ] Dashboard displays "QuickBooks connected" with company name.
- [ ] A test invoice is synced and visible in NudgePay (confirm data is live).

**Reference:** NudgePay production dashboard; QBO company account credentials.

**Failure mode:** If this step fails or is rolled back, go-live is delayed. Data loss or misconfiguration may occur if credentials are not stored correctly.

**Post-completion:** Go-live is complete. Monitor Intuit API error rates and Twilio SMS delivery for 24 hours. Be ready to rollback if critical issues emerge.

---

## Rollback Plan

If any item fails post-completion:
1. Disconnect real Chancey QBO account immediately (dashboard button).
2. Revert `APP_BASE_URL` and secret environment variables to staging.
3. Clear `qbo_connections` row for the affected org.
4. Notify Intuit of the issue.
5. Debug; retry items 1–7 if configuration changed.

---

## Sign-Off

**Operator (print name):** ____________________________  
**Date completed:** ____________________________  
**Intuit contact (if applicable):** ____________________________  

---

**Next phase:** Phase 5 (cutover: retire Netlify/Railway, port remaining prototype UI, final security review).
