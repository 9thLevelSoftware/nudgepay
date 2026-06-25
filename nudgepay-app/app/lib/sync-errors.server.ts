import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_MESSAGE_LEN = 500;

export async function recordSyncError(
  service: SupabaseClient,
  args: { orgId: string; source: "manual" | "webhook" | "cron"; scope: string; message: string },
): Promise<void> {
  const message = args.message.slice(0, MAX_MESSAGE_LEN);
  const { error } = await service.from("sync_errors").insert({
    org_id: args.orgId, source: args.source, scope: args.scope, message,
  });
  if (error) throw error;
}

// scope omitted => resolve ALL unresolved errors for the org (a full sync is the
// broad healer). scope provided => resolve only matching unresolved rows (a
// webhook apply is narrow).
export async function resolveSyncErrors(
  service: SupabaseClient,
  args: { orgId: string; scope?: string; resolvedBy?: string | null },
): Promise<void> {
  let q = service.from("sync_errors")
    .update({ resolved_at: new Date().toISOString(), resolved_by: args.resolvedBy ?? null })
    .eq("org_id", args.orgId).is("resolved_at", null);
  if (args.scope) q = q.eq("scope", args.scope);
  const { error } = await q;
  if (error) throw error;
}
