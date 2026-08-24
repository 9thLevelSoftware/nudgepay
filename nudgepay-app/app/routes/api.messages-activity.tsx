import { data, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireOrgUser } from "../lib/session.server";

/** Latest-inbound fingerprint. Realtime toast fallback when the public channel is down. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, org } = await requireOrgUser(request, env);
  const [{ data: smsRows }, { data: emailRows }] = await Promise.all([
    supabase
      .from("text_messages")
      .select("created_at")
      .eq("org_id", org.org_id)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("email_messages")
      .select("created_at")
      .eq("org_id", org.org_id)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const timestamps = [
    (smsRows as { created_at: string }[] | null)?.[0]?.created_at,
    (emailRows as { created_at: string }[] | null)?.[0]?.created_at,
  ].filter((value): value is string => Boolean(value));
  const lastInboundAt = timestamps.sort().at(-1) ?? null;
  return data({ lastInboundAt }, { headers });
}
