// Test-message route: owner-only, fires a real SMS or email to verify provider
// configuration. Skips customer pipeline + ledger. Never 500s on missing env.

import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getTwilioEnvOrNull, getEmailEnvOrNull } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { parseTestSmsDestination } from "../lib/provider-status";
import { sendTestSms, sendTestEmail } from "../lib/test-message.server";
import type { TwilioSender } from "../lib/twilio-client.server";
import { safeReturnTo } from "../lib/return-to";
import { loadOrgConfig } from "../lib/org-config.server";
import { isWithinSendWindow } from "../lib/quiet-hours";
import { resolveChannelSettings } from "../lib/channel-settings";
import { assertTestBudget } from "../lib/send-limits.server";

function flag(returnTo: string, key: string, val: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}${key}=${val}`;
}

function envSender(t: { TWILIO_MESSAGING_SERVICE_SID: string | null; TWILIO_FROM_NUMBER: string | null }): TwilioSender {
  if (t.TWILIO_MESSAGING_SERVICE_SID) return { messagingServiceSid: t.TWILIO_MESSAGING_SERVICE_SID };
  return { from: t.TWILIO_FROM_NUMBER as string };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"), "/settings");
  // Owner-only surface gate; RLS is the real boundary.
  if (org.role !== "owner") return redirect(returnTo, { headers });

  const intent = form.get("intent");
  const service = createSupabaseServiceClient(env);

  // -------------------------------------------------------------------------
  // Test SMS
  // -------------------------------------------------------------------------
  if (intent === "test_sms") {
    const to = parseTestSmsDestination(form.get("to"));
    if (!to) return redirect(flag(returnTo, "test_sms", "invalid"), { headers });

    const twilio = getTwilioEnvOrNull(context as any);
    if (!twilio) return redirect(flag(returnTo, "test_sms", "env"), { headers });

    const { data: msg } = await service.from("messaging_config")
      .select("sms_enabled").eq("org_id", org.org_id).maybeSingle();
    if (!resolveChannelSettings(msg as { sms_enabled?: boolean | null } | null).smsEnabled) {
      return redirect(flag(returnTo, "test_sms", "disabled"), { headers });
    }
    const orgConfig = await loadOrgConfig(service, org.org_id);
    const { startHour, endHour } = orgConfig.quietHours;
    if (!isWithinSendWindow(new Date(), orgConfig.companyProfile.timezone, startHour, endHour)) {
      return redirect(flag(returnTo, "test_sms", "quiet"), { headers });
    }

    try {
      await assertTestBudget(service, "text_messages", { orgId: org.org_id });
      await sendTestSms(
        {
          fetchFn: fetch,
          service,
          twilio: { accountSid: twilio.TWILIO_ACCOUNT_SID, authToken: twilio.TWILIO_AUTH_TOKEN },
          defaultSender: envSender(twilio),
        },
        { orgId: org.org_id, to, userId: user.id },
      );
      return redirect(flag(returnTo, "test_sms", "sent"), { headers });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/rate cap/i.test(msg)) return redirect(flag(returnTo, "test_sms", "limited"), { headers });
      return redirect(flag(returnTo, "test_sms", "error"), { headers });
    }
  }

  // -------------------------------------------------------------------------
  // Test email
  // -------------------------------------------------------------------------
  if (intent === "test_email") {
    const to = user.email;
    if (!to) return redirect(flag(returnTo, "test_email", "error"), { headers });

    const emailEnv = getEmailEnvOrNull(context as any);
    if (!emailEnv) return redirect(flag(returnTo, "test_email", "env"), { headers });

    try {
      await assertTestBudget(service, "email_messages", { orgId: org.org_id });
      const result = await sendTestEmail(
        { fetchFn: fetch, service, email: { apiKey: emailEnv.RESEND_API_KEY } },
        { orgId: org.org_id, to, userId: user.id },
      );
      if (!result.ok) return redirect(flag(returnTo, "test_email", result.error), { headers });
      return redirect(flag(returnTo, "test_email", "sent"), { headers });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/rate cap/i.test(msg)) return redirect(flag(returnTo, "test_email", "limited"), { headers });
      return redirect(flag(returnTo, "test_email", "error"), { headers });
    }
  }

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/settings");
}
