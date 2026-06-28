import type { ActionFunctionArgs } from "react-router";
import { getEnv, getEmailEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { verifyResendSignature } from "../lib/resend-webhook.server";
import { mapResendEvent } from "../lib/email-events";
import { updateEmailStatus, recordInboundEmail } from "../lib/email-messaging.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const emailEnv = getEmailEnv(context as any);
  const raw = await request.text();
  const ok = await verifyResendSignature(emailEnv.RESEND_WEBHOOK_SECRET, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  }, raw);
  if (!ok) return new Response("invalid signature", { status: 401 });

  let mapped;
  try {
    mapped = mapResendEvent(JSON.parse(raw));
  } catch {
    return new Response(null, { status: 204 }); // unparseable but signed: ack, don't retry-loop
  }

  try {
    const service = createSupabaseServiceClient(getEnv(context as any));
    if (mapped.kind === "status") {
      await updateEmailStatus(service, mapped);
    } else if (mapped.kind === "inbound") {
      await recordInboundEmail(service, mapped);
    }
  } catch (err) {
    console.error("Resend webhook processing failed", err);
    return new Response("processing error", { status: 500 });
  }
  return new Response(null, { status: 204 });
}
