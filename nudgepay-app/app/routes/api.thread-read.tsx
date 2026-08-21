import { data, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { requireSameOrigin } from "../lib/csrf.server";

export async function action({ request, context }: ActionFunctionArgs) {
  requireSameOrigin(request);
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return data({ ok: false }, { status: 401, headers });

  const form = await request.formData();
  const customerId = typeof form.get("customerId") === "string" ? (form.get("customerId") as string) : "";
  const channel = form.get("channel") === "email" ? "email" : "sms";
  if (!customerId) return data({ ok: false }, { status: 400, headers });

  const { error } = await supabase.from("thread_reads").upsert({
    org_id: org.org_id,
    user_id: user.id,
    customer_id: customerId,
    channel,
    last_read_at: new Date().toISOString(),
  }, { onConflict: "org_id,user_id,customer_id,channel" });
  if (error) return data({ ok: false }, { status: 400, headers });
  return data({ ok: true }, { headers });
}

export function loader() {
  return data({ ok: false }, { status: 404 });
}
