import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getTwilioEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import type { MessagingDeps } from "../lib/twilio-messaging.server";
import type { TwilioSender } from "../lib/twilio-client.server";
import { safeReturnTo } from "../lib/return-to";
import { runBulkSms } from "../lib/bulk-send.server";
import { clampBatch } from "../lib/bulk";

function envSender(t: { TWILIO_MESSAGING_SERVICE_SID: string | null; TWILIO_FROM_NUMBER: string | null }): TwilioSender {
  if (t.TWILIO_MESSAGING_SERVICE_SID) return { messagingServiceSid: t.TWILIO_MESSAGING_SERVICE_SID };
  return { from: t.TWILIO_FROM_NUMBER as string }; // getTwilioEnv guarantees one of the two
}

function parseIds(form: FormData): string[] {
  const raw = form.get("caseIds");
  if (typeof raw !== "string" || raw.length === 0) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function withParams(returnTo: string, params: Record<string, string>): string {
  const url = new URL(returnTo, "http://x");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.pathname + url.search;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const twilio = getTwilioEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const caseIds = clampBatch(parseIds(form));
  const bodyRaw = form.get("body");
  const templateBody = typeof bodyRaw === "string" ? bodyRaw.trim() : "";
  if (caseIds.length === 0 || templateBody === "") return redirect(returnTo, { headers });

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
  const today = new Date().toISOString().slice(0, 10);
  const { sent, failed, skipped } = await runBulkSms(deps, {
    orgId: org.org_id, userId: user.id, caseIds, today, templateBody,
  });

  return redirect(
    withParams(returnTo, { bulkSms: "done", sent: String(sent), failed: String(failed), skipped: String(skipped) }),
    { headers },
  );
}

export function loader() {
  return redirect("/dashboard");
}
