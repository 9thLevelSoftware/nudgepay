import type { ActionFunctionArgs } from "react-router";
import { getEnv, getTwilioEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { verifyTwilioSignature, parseTwilioForm } from "../lib/twilio-webhook.server";
import { updateMessageStatus } from "../lib/twilio-messaging.server";

function publicUrl(twilioPublicBaseUrl: string | null, request: Request, path: string): string {
  return twilioPublicBaseUrl ? `${twilioPublicBaseUrl}${path}` : request.url;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const twilio = getTwilioEnv(context as any);
  const rawBody = await request.text();
  const params = parseTwilioForm(rawBody);
  const url = publicUrl(twilio.TWILIO_PUBLIC_BASE_URL, request, "/webhooks/twilio/status");

  const ok = await verifyTwilioSignature(
    twilio.TWILIO_AUTH_TOKEN, url, params, request.headers.get("X-Twilio-Signature"),
  );
  if (!ok) return new Response("invalid signature", { status: 403 });

  try {
    const env = getEnv(context as any);
    const service = createSupabaseServiceClient(env);
    await updateMessageStatus(service, {
      messageSid: params.MessageSid ?? "", status: params.MessageStatus ?? "", errorCode: params.ErrorCode ?? null,
    });
  } catch (err) {
    console.error("Twilio status processing failed", err);
    return new Response("processing error", { status: 500 });
  }
  return new Response(null, { status: 204 });
}
