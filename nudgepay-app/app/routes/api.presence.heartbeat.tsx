import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { recordHeartbeat } from "../lib/presence.server";

// Background heartbeat for presence (C1). Best-effort: a failure is logged and
// swallowed so the 20s poll never surfaces an error to the client.
export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return new Response(null, { status: 204, headers });

  const form = await request.formData();
  const customerId = form.get("customerId");
  if (typeof customerId !== "string" || customerId.length === 0) {
    return new Response(null, { status: 204, headers });
  }

  try {
    await recordHeartbeat(supabase, { orgId: org.org_id, customerId, userId: user.id });
  } catch (e) {
    console.error("presence heartbeat failed (best-effort):", e);
  }
  return new Response(null, { status: 204, headers });
}

export function loader() {
  return redirect("/dashboard");
}
