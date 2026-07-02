// Notification preferences upsert — self-only (user client, RLS enforces).
// Every org member can toggle their own alert preferences.

import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { parseNotificationPrefsUpdate } from "../lib/notification-prefs";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const orgId = form.get("org_id") as string;

  if (!orgId || orgId !== org.org_id) return redirect("/settings?error=invalid_org", { headers });

  const result = parseNotificationPrefsUpdate(form);
  if (!result.ok) return redirect(`/settings?error=${encodeURIComponent(result.error)}`, { headers });

  const { patch } = result;
  const { error } = await supabase.from("user_notification_prefs").upsert(
    {
      org_id: orgId,
      user_id: user.id,
      broken_promise_email: patch.brokenPromiseEmail,
      daily_digest_email: patch.dailyDigestEmail,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,user_id" },
  );

  if (error) {
    console.error("notification prefs upsert failed", error);
    return redirect("/settings?error=save_failed", { headers });
  }

  return redirect("/settings?saved=notifications", { headers });
}
