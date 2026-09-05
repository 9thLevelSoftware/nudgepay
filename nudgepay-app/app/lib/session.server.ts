import { redirect } from "react-router";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AppEnv } from "./env.server";
import { createSupabaseUserClient } from "./supabase.server";
import { isUnsafeMethod, requireSameOrigin } from "./csrf.server";

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
  requireSameOrigin(request, headers);
  return { supabase, headers, user: user as User };
}

export const ORG_COOKIE = "nudgepay-org";

export function readPreferredOrgId(request: Request): string | null {
  const raw = request.headers.get("Cookie") ?? "";
  const m = raw.match(/(?:^|;\s*)nudgepay-org=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:;|$)/i);
  return m?.[1] ?? null;
}

export function orgCookieHeader(orgId: string): string {
  return `${ORG_COOKIE}=${orgId}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function clearOrgCookieHeader(): string {
  return `${ORG_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export async function resolveOrg(
  supabase: SupabaseClient,
  userId: string,
  preferred?: string | null | Request,
  responseHeaders?: Headers,
): Promise<{ org_id: string; role: string } | null> {
  const request = preferred instanceof Request ? preferred : null;
  const preferredOrgId = request
    ? readPreferredOrgId(request)
    : preferred ?? null;
  const { data, error } = await supabase
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("org_id", { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return null;
  const match = preferredOrgId
    ? rows.find((r) => r.org_id === preferredOrgId)
    : null;
  const missingOrInvalidRequestPreference = request !== null && !match;
  if (missingOrInvalidRequestPreference && isUnsafeMethod(request.method)) {
    throw new Response("workspace selection is required", {
      status: 409,
      headers: responseHeaders,
    });
  }
  const row = match ?? rows[0];
  if (missingOrInvalidRequestPreference && responseHeaders) {
    responseHeaders.append("Set-Cookie", orgCookieHeader(row.org_id as string));
  }
  return { org_id: row.org_id as string, role: row.role as string };
}

// Composed helper for routes that require both an authenticated user and an
// org membership. Deliberately excludes the QBO-connected gate — that must
// stay a per-route post-batch check so callers can parallelize their own
// data loads instead of serializing behind this helper.
export async function requireOrgUser(request: Request, env: AppEnv) {
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id, request, headers);
  if (!org) throw redirect("/onboarding", { headers });
  return { supabase, headers, user, org };
}
