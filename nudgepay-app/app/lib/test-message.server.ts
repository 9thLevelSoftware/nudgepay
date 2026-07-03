// Test-message sender for provider configuration verification. Deps-injected
// for testability, calls the thin transport clients directly (no customer
// pipeline, no consent gates, no ledger inserts). Test sends are owner-only,
// internal, and never recorded in text_messages/email_messages.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSms, type TwilioConfig, type TwilioSender, type TwilioSendResult } from "./twilio-client.server";
import { sendEmail, type EmailConfig } from "./email-client.server";
import { resolveSender } from "./twilio-messaging.server";

// ---------------------------------------------------------------------------
// Test SMS
// ---------------------------------------------------------------------------

export type TestSmsDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;
  twilio: TwilioConfig;
  defaultSender: TwilioSender;
};

/**
 * Send a test SMS to verify the org's sender configuration. Resolves the
 * per-org sender override (exercises the exact same precedence as the real
 * pipeline), then calls sendSms with no StatusCallback and no ledger insert.
 */
export async function sendTestSms(
  deps: TestSmsDeps,
  args: { orgId: string; to: string },
): Promise<TwilioSendResult> {
  const sender = await resolveSender(deps.service, args.orgId, deps.defaultSender);
  return sendSms(deps.fetchFn, deps.twilio, {
    to: args.to,
    body: "NudgePay test message — your SMS sender configuration works.",
    sender,
    statusCallback: null,
  });
}

// ---------------------------------------------------------------------------
// Test email
// ---------------------------------------------------------------------------

export type TestEmailDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;
  email: EmailConfig;
};

export type TestEmailResult = { ok: true; id: string } | { ok: false; error: "nofrom" };

/**
 * Send a test email to verify the org's email configuration. Uses the org's
 * configured from_address so the test exercises the real sender identity.
 * Returns { error: "nofrom" } when no from_address is configured (the test
 * would prove nothing with a made-up sender). No CAN-SPAM footer (internal
 * transactional to the owner), no ledger insert.
 */
export async function sendTestEmail(
  deps: TestEmailDeps,
  args: { orgId: string; to: string },
): Promise<TestEmailResult> {
  const { data: ecfg } = await deps.service
    .from("email_config")
    .select("from_address, from_name")
    .eq("org_id", args.orgId)
    .maybeSingle();

  const fromAddress = ((ecfg?.from_address as string) ?? "").trim();
  if (!fromAddress) return { ok: false, error: "nofrom" };
  const fromName = ((ecfg?.from_name as string) ?? "").trim();
  const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;

  const result = await sendEmail(deps.fetchFn, deps.email, {
    from,
    to: args.to,
    subject: "NudgePay test email",
    html: "<p>Your email sender configuration works. This is a test message from NudgePay.</p>",
  });
  return { ok: true, id: result.id };
}
