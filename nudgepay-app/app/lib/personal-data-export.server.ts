import type { SupabaseClient, User } from "@supabase/supabase-js";
import { orderPage, pageAllHonest, PAGE_ALL_MAX_ROWS } from "./page-all";
import {
  buildPersonalDataExport,
  type PersonalDataExport,
} from "./personal-data-export";

type PersonalContactLogRow = {
  id: string;
  created_at: string;
  method: string;
  outcome: string | null;
};

export async function loadPersonalDataExport(
  service: SupabaseClient,
  user: User,
  exportedAt: string,
): Promise<PersonalDataExport> {
  const { data: membershipRows, error: membershipError } = await service
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .order("org_id", { ascending: true });
  if (membershipError) throw membershipError;

  const memberships: PersonalDataExport["memberships"] = [];
  const notificationPrefs: PersonalDataExport["notificationPrefs"] = [];
  const orgIds = (membershipRows ?? []).map((row) => row.org_id as string);
  if (orgIds.length > 0) {
    const [orgResult, prefsResult] = await Promise.all([
      service
        .from("organizations")
        .select("id, name")
        .in("id", orgIds),
      service
        .from("user_notification_prefs")
        .select("org_id, broken_promise_email, daily_digest_email")
        .eq("user_id", user.id)
        .in("org_id", orgIds),
    ]);
    if (orgResult.error) throw orgResult.error;
    if (prefsResult.error) throw prefsResult.error;

    const orgNameById = new Map(
      (orgResult.data ?? []).map((row) => [row.id as string, typeof row.name === "string" ? row.name : ""]),
    );
    const prefsByOrgId = new Map(
      (prefsResult.data ?? []).map((row) => [row.org_id as string, row]),
    );
    for (const row of membershipRows ?? []) {
      const orgId = row.org_id as string;
      memberships.push({
        orgId,
        orgName: orgNameById.get(orgId) ?? "",
        role: (row.role as string) || "member",
      });
      const prefs = prefsByOrgId.get(orgId);
      if (prefs) {
        notificationPrefs.push({
          orgId,
          brokenPromiseEmail: Boolean(prefs.broken_promise_email),
          dailyDigestEmail: Boolean(prefs.daily_digest_email),
        });
      }
    }
  }

  const logPage = await pageAllHonest<PersonalContactLogRow>(
    (from, to) =>
      orderPage(
        service
          .from("contact_logs")
          .select("id, created_at, method, outcome", { count: "exact" })
          .eq("user_id", user.id),
      ).range(from, to),
    { maxRows: PAGE_ALL_MAX_ROWS },
  );
  if (logPage.error) throw logPage.error;
  const contactLogs = logPage.rows.map((row) => ({
    id: row.id as string,
    createdAt: row.created_at as string,
    method: row.method as string,
    outcome: (row.outcome as string | null) ?? null,
  }));

  const displayNameRaw = user.user_metadata?.display_name;
  return buildPersonalDataExport({
    exportedAt,
    truncated: logPage.truncated,
    account: {
      id: user.id,
      email: user.email ?? "",
      displayName: typeof displayNameRaw === "string" && displayNameRaw.trim()
        ? displayNameRaw.trim()
        : null,
      createdAt: user.created_at ?? null,
    },
    memberships,
    notificationPrefs,
    contactLogs,
  });
}
