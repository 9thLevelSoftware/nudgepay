import type { LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";

// Readiness (not liveness). Render healthCheckPath stays on /healthz so a
// transient Supabase blip does not roll back a deploy. Orchestration that
// must not take traffic can probe this route.

export async function loader({ context }: LoaderFunctionArgs) {
  const raw = (context as { cloudflare?: { env?: Record<string, string> } }).cloudflare?.env ?? {};
  const url = raw.SUPABASE_URL ?? "";
  if (!url || url.includes("<your-prod-project-ref>")) {
    return Response.json({ ok: false }, { status: 503 });
  }
  try {
    const env = getEnv(context as any);
    const svc = createSupabaseServiceClient(env);
    const { error } = await svc.from("organizations").select("id").limit(1);
    if (error) return Response.json({ ok: false }, { status: 503 });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
  return Response.json({ ok: true });
}
