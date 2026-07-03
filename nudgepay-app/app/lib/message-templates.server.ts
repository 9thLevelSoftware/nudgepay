import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTemplates, type OrgTemplates, type MessageTemplateRow } from "./message-templates";

export async function loadTemplates(
  client: SupabaseClient,
  orgId: string,
): Promise<OrgTemplates> {
  const { data, error } = await client
    .from("message_templates")
    .select("id, channel, slug, label, subject, body, sort")
    .eq("org_id", orgId)
    .order("sort");
  if (error) throw error;
  return resolveTemplates((data ?? []) as MessageTemplateRow[]);
}
