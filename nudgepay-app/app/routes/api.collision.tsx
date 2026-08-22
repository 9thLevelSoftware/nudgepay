import { data, redirect, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireOrgUser } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { listOrgMembers } from "../lib/orgs.server";
import { readPresence } from "../lib/presence.server";
import { collisionState, type Collision, type RecentContactInput } from "../lib/collision";

const EMPTY: Collision = { level: "none", byUser: null, recentAt: null, liveUsers: [] };

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user, org } = await requireOrgUser(request, env);
  const caseId = new URL(request.url).searchParams.get("caseId");
  if (!caseId) return data({ collision: EMPTY }, { headers });

  const { data: cse, error } = await supabase
    .from("collection_cases")
    .select("id, customer_id")
    .eq("org_id", org.org_id)
    .eq("id", caseId)
    .maybeSingle();
  if (error || !cse?.customer_id) return data({ collision: EMPTY }, { headers });

  const service = createSupabaseServiceClient(env);
  const [{ data: logRows }, { data: msgRows }, { data: emailRows }, presenceRows, roster] = await Promise.all([
    supabase
      .from("contact_logs")
      .select("user_id, created_at")
      .eq("org_id", org.org_id)
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("text_messages")
      .select("sent_by_user_id, created_at")
      .eq("org_id", org.org_id)
      .eq("case_id", caseId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("email_messages")
      .select("sent_by_user_id, created_at")
      .eq("org_id", org.org_id)
      .eq("case_id", caseId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(50),
    readPresence(service, { orgId: org.org_id, customerIds: [cse.customer_id as string] }),
    listOrgMembers(service, org.org_id),
  ]);

  const labels = new Map(roster.map((m) => [m.userId, m.label]));
  const contacts: RecentContactInput[] = [];
  for (const r of (logRows as { user_id: string | null; created_at: string }[] | null) ?? []) {
    contacts.push({ userId: r.user_id, at: r.created_at });
  }
  for (const r of (msgRows as { sent_by_user_id: string | null; created_at: string }[] | null) ?? []) {
    contacts.push({ userId: r.sent_by_user_id, at: r.created_at });
  }
  for (const r of (emailRows as { sent_by_user_id: string | null; created_at: string }[] | null) ?? []) {
    contacts.push({ userId: r.sent_by_user_id, at: r.created_at });
  }

  return data({
    collision: collisionState({
      contacts,
      heartbeats: presenceRows.map((r) => ({ userId: r.user_id, lastSeenAt: r.last_seen_at })),
      currentUserId: user.id,
      nowMs: Date.now(),
      label: (id) => labels.get(id) ?? "A teammate",
    }),
  }, { headers });
}

export function action() {
  return redirect("/dashboard");
}
