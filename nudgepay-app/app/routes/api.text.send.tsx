import { data, redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getTwilioEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { sendInvoiceText, type MessagingDeps } from "../lib/twilio-messaging.server";
import type { TwilioSender } from "../lib/twilio-client.server";
import { safeReturnTo, withSms } from "../lib/return-to";
import { smsSendReason } from "../lib/sms-send-reason";

function envSender(t: { TWILIO_MESSAGING_SERVICE_SID: string | null; TWILIO_FROM_NUMBER: string | null }): TwilioSender {
  if (t.TWILIO_MESSAGING_SERVICE_SID) return { messagingServiceSid: t.TWILIO_MESSAGING_SERVICE_SID };
  return { from: t.TWILIO_FROM_NUMBER as string }; // getTwilioEnv guarantees one of the two
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const twilio = getTwilioEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const respondJson = form.get("respond") === "json";
  const raw = form.get("invoiceId");
  const invoiceId = typeof raw === "string" ? raw : "";
  const bodyRaw = form.get("body");
  const body = typeof bodyRaw === "string" ? bodyRaw.trim() : "";

  // Helper: respond with the SMS result code, either as JSON (Focus Mode) or
  // as a redirect with the code in a query parameter (existing dashboard flow).
  const respond = (code: string) => respondJson
    ? data({ ok: code === "sent", sms: code }, { headers })
    : redirect(withSms(returnTo, code), { headers });

  if (!invoiceId || !body) return respond("error");

  const service = createSupabaseServiceClient(env);
  const statusCallback = twilio.TWILIO_PUBLIC_BASE_URL
    ? `${twilio.TWILIO_PUBLIC_BASE_URL}/webhooks/twilio/status` : null;
  const deps: MessagingDeps = {
    fetchFn: fetch,
    service,
    twilio: { accountSid: twilio.TWILIO_ACCOUNT_SID, authToken: twilio.TWILIO_AUTH_TOKEN },
    defaultSender: envSender(twilio),
    statusCallback,
  };
  try {
    await sendInvoiceText(deps, { orgId: org.org_id, invoiceId, userId: user.id, body });
    return respond("sent");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    return respond(smsSendReason(msg));
  }
}

export function loader() {
  return redirect("/dashboard");
}
