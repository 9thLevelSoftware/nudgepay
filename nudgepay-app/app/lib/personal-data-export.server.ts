import type { SupabaseClient, User } from "@supabase/supabase-js";
import { PAGE_ALL_MAX_ROWS } from "./page-all";
import {
  buildPersonalDataExport,
  type PersonalDataExport,
} from "./personal-data-export";

export async function loadPersonalDataExport(
  service: SupabaseClient,
  user: User,
  exportedAt: string,
): Promise<PersonalDataExport> {
  const { data: mem } = await service
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  let membership: PersonalDataExport["membership"] = null;
  let notificationPrefs: PersonalDataExport["notificationPrefs"] = null;
  if (mem?.org_id) {
    const { data: orgRow } = await service
      .from("organizations")
      .select("name")
      .eq("id", mem.org_id)
      .maybeSingle();
    membership = {
      orgId: mem.org_id as string,
      orgName: typeof orgRow?.name === "string" ? orgRow.name : "",
      role: (mem.role as string) || "member",
    };
    const { data: prefs } = await service
      .from("user_notification_prefs")
      .select("broken_promise_email, daily_digest_email")
      .eq("org_id", mem.org_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (prefs) {
      notificationPrefs = {
        brokenPromiseEmail: Boolean(prefs.broken_promise_email),
        dailyDigestEmail: Boolean(prefs.daily_digest_email),
      };
    }
  }

  const { data: logRows, error: logErr } = await service
    .from("contact_logs")
    .select("id, created_at, method, outcome")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(PAGE_ALL_MAX_ROWS + 1);
  if (logErr) throw logErr;
  const truncated = (logRows?.length ?? 0) > PAGE_ALL_MAX_ROWS;
  const contactLogs = (logRows ?? []).slice(0, PAGE_ALL_MAX_ROWS).map((row) => ({
    id: row.id as string,
    createdAt: row.created_at as string,
    method: row.method as string,
    outcome: (row.outcome as string | null) ?? null,
  }));

  const displayNameRaw = user.user_metadata?.display_name;
  return buildPersonalDataExport({
    exportedAt,
    truncated,
    account: {
      id: user.id,
      email: user.email ?? "",
      displayName: typeof displayNameRaw === "string" && displayNameRaw.trim()
        ? displayNameRaw.trim()
        : null,
      createdAt: user.created_at ?? null,
    },
    membership,
    notificationPrefs,
    contactLogs,
  });
}
