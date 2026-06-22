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

export type QboEnv = {
  QBO_CLIENT_ID: string;
  QBO_CLIENT_SECRET: string;
  QBO_REDIRECT_URI: string;
  QBO_ENCRYPTION_KEY: string; // base64 of 32 random bytes (AES-256)
  QBO_SANDBOX: boolean;
};

export function getQboEnv(context: { cloudflare: { env: Record<string, string> } }): QboEnv {
  const e = context.cloudflare.env;
  const required = ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REDIRECT_URI", "QBO_ENCRYPTION_KEY"];
  for (const k of required) {
    if (!e[k]) throw new Error(`Missing required env var: ${k}`);
  }
  return {
    QBO_CLIENT_ID: e.QBO_CLIENT_ID,
    QBO_CLIENT_SECRET: e.QBO_CLIENT_SECRET,
    QBO_REDIRECT_URI: e.QBO_REDIRECT_URI,
    QBO_ENCRYPTION_KEY: e.QBO_ENCRYPTION_KEY,
    QBO_SANDBOX: e.QBO_SANDBOX !== "false", // default true
  };
}
