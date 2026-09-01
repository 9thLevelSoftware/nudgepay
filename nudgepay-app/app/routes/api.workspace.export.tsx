import type { LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { loadWorkspaceDataExport } from "../lib/workspace-export.server";
import { workspaceExportAllowed, workspaceExportFilename } from "../lib/workspace-export";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { headers, user, supabase } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id, request);
  if (!org) {
    return new Response("No workspace", { status: 403, headers });
  }
  if (!workspaceExportAllowed(org.role)) {
    return new Response("Only owners and admins can download workspace data.", { status: 403, headers });
  }

  const service = createSupabaseServiceClient(env);
  const { data: orgRow } = await service
    .from("organizations")
    .select("name")
    .eq("id", org.org_id)
    .maybeSingle();
  const orgName = typeof orgRow?.name === "string" ? orgRow.name : "";
  const exportedAt = new Date().toISOString();
  const payload = await loadWorkspaceDataExport(service, org.org_id, orgName, exportedAt);
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  const out = new Headers(headers);
  out.set("Content-Type", "application/json; charset=utf-8");
  out.set("Content-Disposition", `attachment; filename="${workspaceExportFilename(exportedAt)}"`);
  out.set("Cache-Control", "private, no-store");
  return new Response(body, { status: 200, headers: out });
}
