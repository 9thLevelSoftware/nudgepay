export type AppEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY: string;
};

// RR7 Cloudflare adapter exposes vars on context.cloudflare.env
export function getEnv(context: { cloudflare: { env: Record<string, string> } }): AppEnv {
  const e = context.cloudflare.env;
  for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY"]) {
    if (!e[k]) throw new Error(`Missing required env var: ${k}`);
  }
  return {
    SUPABASE_URL: e.SUPABASE_URL,
    SUPABASE_ANON_KEY: e.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY: e.SUPABASE_SERVICE_KEY,
  };
}
