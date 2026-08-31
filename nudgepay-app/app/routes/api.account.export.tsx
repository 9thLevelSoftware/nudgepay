import type { LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { loadPersonalDataExport } from "../lib/personal-data-export.server";
import { personalExportFilename } from "../lib/personal-data-export";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { headers, user } = await requireUser(request, env);
  const service = createSupabaseServiceClient(env);
  const exportedAt = new Date().toISOString();
  const payload = await loadPersonalDataExport(service, user, exportedAt);
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  const out = new Headers(headers);
  out.set("Content-Type", "application/json; charset=utf-8");
  out.set("Content-Disposition", `attachment; filename="${personalExportFilename(exportedAt)}"`);
  out.set("Cache-Control", "private, no-store");
  return new Response(body, { status: 200, headers: out });
}
