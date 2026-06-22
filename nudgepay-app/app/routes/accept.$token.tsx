import { redirect, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser } from "../lib/session.server";
import { acceptInvite } from "../lib/orgs.server";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { headers, user } = await requireUser(request, env);
  const service = createSupabaseServiceClient(env);
  await acceptInvite(service, String(params.token), user.id);
  return redirect("/dashboard", { headers });
}
