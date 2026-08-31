import type { LoaderFunctionArgs } from "react-router";
import { getEnv, getQboEnvOrNull, getTwilioEnvOrNull, getEmailEnvOrNull } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { operatorAlertWebhookOk } from "../lib/operator-alert";
import { readyzBody, type ReadyzProviders } from "../lib/readyz";

// Readiness (not liveness). Render healthCheckPath stays on /healthz so a
// transient Supabase blip does not roll back a deploy. Orchestration that
// must not take traffic can probe this route. Provider flags are config
// presence only — never live QBO/Twilio/Resend calls.

function providersFrom(context: LoaderFunctionArgs["context"]): ReadyzProviders {
  const env = (context as { cloudflare?: { env?: Record<string, string> } }).cloudflare?.env ?? {};
  return {
    qbo: Boolean(getQboEnvOrNull(context as any)),
    twilio: Boolean(getTwilioEnvOrNull(context as any)),
    email: Boolean(getEmailEnvOrNull(context as any)),
    operatorAlert: operatorAlertWebhookOk(env.OPERATOR_ALERT_WEBHOOK),
  };
}

export async function loader({ context }: LoaderFunctionArgs) {
  const raw = (context as { cloudflare?: { env?: Record<string, string> } }).cloudflare?.env ?? {};
  const providers = providersFrom(context);
  const url = raw.SUPABASE_URL ?? "";
  if (!url) {
    return Response.json(readyzBody({ ok: false, reason: "url", providers }), { status: 503 });
  }
  if (url.includes("<your-prod-project-ref>")) {
    return Response.json(readyzBody({ ok: false, reason: "placeholder", providers }), { status: 503 });
  }
  try {
    const env = getEnv(context as any);
    const svc = createSupabaseServiceClient(env);
    const { error } = await svc.from("organizations").select("id").limit(1);
    if (error) {
      return Response.json(readyzBody({ ok: false, reason: "db", providers }), { status: 503 });
    }
  } catch {
    return Response.json(readyzBody({ ok: false, reason: "config", providers }), { status: 503 });
  }
  return Response.json(readyzBody({ ok: true, providers }));
}
