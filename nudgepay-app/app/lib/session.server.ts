import { redirect } from "react-router";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AppEnv } from "./env.server";
import { createSupabaseUserClient } from "./supabase.server";

export async function getOptionalUser(request: Request, env: AppEnv) {
  const { supabase, headers } = createSupabaseUserClient(request, env);
  const { data } = await supabase.auth.getUser();
  return { supabase, headers, user: data.user ?? null };
}

export async function requireUser(request: Request, env: AppEnv) {
  const { supabase, headers, user } = await getOptionalUser(request, env);
  if (!user) {
    const url = new URL(request.url);
    const returnTo = url.pathname + url.search;
    const target =
      request.method === "GET" &&
      returnTo !== "/" &&
      !returnTo.startsWith("/login")
        ? `/login?returnTo=${encodeURIComponent(returnTo)}`
        : "/login";
    throw redirect(target, { headers });
  }
  return { supabase, headers, user: user as User };
}

export async function resolveOrg(
  supabase: SupabaseClient,
  userId: string
): Promise<{ org_id: string; role: string } | null> {
  const { data } = await supabase
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? { org_id: data.org_id as string, role: data.role as string } : null;
}
