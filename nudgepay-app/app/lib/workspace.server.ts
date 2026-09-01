import { redirect } from "react-router";
import { requireOrgUser } from "./session.server";
import { createSupabaseServiceClient } from "./supabase.server";
import { getConnectionStatus } from "./qbo-connection.server";
import { connectionChrome, connectionSyncLabel } from "./connection-chrome";
import type { AppEnv } from "./env.server";
import { displayLabel, initialsFrom } from "./names";
import { listUserWorkspaces, type UserWorkspace } from "./orgs.server";
import { hasPermission, isAdminRole, isOwnerRole } from "./roles";
import { loadOrgConfig } from "./org-config.server";

export type ChromeSyncIssue = {
  id: string;
  source: string;
  scope: string;
  message: string;
  occurredAt: string;
};

export function mapSyncIssues(
  rows: { id: string; source: string; scope: string; message: string; occurred_at: string }[] | null | undefined,
): ChromeSyncIssue[] {
  return (rows ?? []).map((r) => ({
    id: r.id,
    source: r.source,
    scope: r.scope,
    message: r.message,
    occurredAt: r.occurred_at,
  }));
}

// Shared "chrome" prelude for authenticated workspace routes: auth + org
// membership + QBO connection status + sync label. Dedupes the ~45-line
// prelude that used to be copy-pasted across accounts/promises/messages/
// reports/settings. dashboard.tsx intentionally keeps its own batch
// structure (it parallelizes far more than this) and does NOT use this
// helper.
//
// requireQbo is opt-in. A disconnected first-run workspace should still open
// collections/accounts/settings instead of bouncing to Integrations.
export async function loadWorkspaceChrome(
  request: Request,
  env: AppEnv,
  opts?: { requireQbo?: boolean; requireOwner?: boolean; requireAdmin?: boolean },
) {
  const { supabase, headers, user, org } = await requireOrgUser(request, env);
  const isOwner = isOwnerRole(org.role);
  const isAdmin = isAdminRole(org.role);

  if (opts?.requireOwner && !isOwner) {
    throw redirect("/dashboard?denied=reports", { headers });
  }
  if (opts?.requireAdmin && !hasPermission(org.role, "viewReports")) {
    throw redirect("/dashboard?denied=reports", { headers });
  }

  const service = createSupabaseServiceClient(env);

  // Parallel: org name + connection status + connection metadata + unresolved
  // sync errors + org config (so callers do not pay a second RTT).
  const [orgRowRes, conn, connMetaRes, syncErrorRes, workspaces, orgConfig] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", org.org_id).single(),
    getConnectionStatus(service, org.org_id),
    service.from("qbo_connections").select("last_sync_at").eq("org_id", org.org_id).maybeSingle(),
    supabase.from("sync_errors")
      .select("id, source, scope, message, occurred_at").eq("org_id", org.org_id)
      .is("resolved_at", null).order("occurred_at", { ascending: false }).limit(20),
    listUserWorkspaces(service, user.id),
    loadOrgConfig(supabase, org.org_id),
  ]);

  if (connMetaRes.error) throw connMetaRes.error;

  const lastSyncAt = (connMetaRes.data?.last_sync_at as string | null) ?? null;
  const chrome = connectionChrome(conn?.status ?? null, lastSyncAt);
  const connected = chrome.kind === "connected";
  const needsReconnect = chrome.kind === "needs_reconnect";
  if (opts?.requireQbo === true && !connected) {
    throw redirect("/settings?tab=integrations", { headers });
  }

  // Initials from display name or email
  const userLabel = displayLabel(user.user_metadata?.display_name, user.email, user.id);
  const initials = initialsFrom(userLabel);

  const syncLabel = connectionSyncLabel(chrome);
  const orgName = (orgRowRes.data?.name as string) ?? "Workspace";

  return {
    supabase, service, headers, user, org, isOwner, isAdmin,
    orgId: org.org_id,
    orgName, initials, userLabel, connected, needsReconnect, connectionKind: chrome.kind,
    syncLabel, lastSyncAt,
    syncIssues: mapSyncIssues(syncErrorRes.data as {
      id: string; source: string; scope: string; message: string; occurred_at: string;
    }[] | null),
    workspaces,
    orgConfig,
  };
}

export type { UserWorkspace };
