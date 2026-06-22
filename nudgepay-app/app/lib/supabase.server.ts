import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppEnv } from "./env.server";

export function createSupabaseUserClient(request: Request, env: AppEnv) {
  const headers = new Headers();
  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        // parseCookieHeader returns { name, value? }[] — filter to entries with
        // a defined value so the return type satisfies { name, value: string }[].
        return parseCookieHeader(request.headers.get("Cookie") ?? "").flatMap(
          ({ name, value }) => (value !== undefined ? [{ name, value }] : []),
        );
      },
      setAll(cookiesToSet, responseHeaders) {
        for (const { name, value, options } of cookiesToSet) {
          headers.append("Set-Cookie", serializeCookieHeader(name, value, options));
        }
        // Also apply any cache-control / pragma headers the library passes for
        // CDN protection (e.g. Cache-Control: private, no-store).
        if (responseHeaders) {
          for (const [key, val] of Object.entries(responseHeaders)) {
            headers.set(key, val);
          }
        }
      },
    },
  });
  return { supabase, headers };
}

export function createSupabaseServiceClient(env: AppEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
