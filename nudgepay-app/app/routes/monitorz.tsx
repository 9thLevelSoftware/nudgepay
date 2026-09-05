import type { LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { failedSystemMonitorBody, monitorBearerAuthorized } from "../lib/system-health";
import { loadSystemMonitorBody } from "../lib/system-health.server";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

export async function loader({ request, context }: LoaderFunctionArgs) {
  const raw = (context as { cloudflare?: { env?: Record<string, string> } }).cloudflare?.env ?? {};
  if (!await monitorBearerAuthorized(request.headers.get("Authorization"), raw.MONITOR_TOKEN)) {
    return Response.json({ ok: false }, { status: 401, headers: RESPONSE_HEADERS });
  }

  try {
    const env = getEnv(context as { cloudflare: { env: Record<string, string> } });
    const body = await loadSystemMonitorBody(createSupabaseServiceClient(env), raw);
    return Response.json(body, { status: body.ok ? 200 : 503, headers: RESPONSE_HEADERS });
  } catch {
    return Response.json(failedSystemMonitorBody(), { status: 503, headers: RESPONSE_HEADERS });
  }
}
