import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.test", import.meta.url), "utf8")
    .split("\n").filter(Boolean).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)];
    })
) as Record<string, string>;

export const TEST_ENV = env;

export const SUPABASE_URL = env.SUPABASE_URL;

export function serviceClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function makeUserClient(email: string, password = "test-pass-123") {
  const admin = serviceClient();
  // Create (idempotent) and confirm the user.
  const { data: created } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  const user = created?.user
    ?? (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === email)!;

  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  const { data: signedIn, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client: anon, userId: user.id, accessToken: signedIn.session!.access_token };
}
