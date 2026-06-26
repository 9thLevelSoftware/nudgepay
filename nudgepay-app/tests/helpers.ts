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

// Find an existing auth user by email, paging through results. GoTrue's
// listUsers() defaults to 50 rows on the first page only; the full suite
// accumulates far more auth users, so a single unpaged lookup misses anyone
// past page 1 (manifested as a flaky "Cannot read properties of undefined" in
// makeUserClient). Page until found or exhausted.
async function findUserByEmail(admin: SupabaseClient, email: string) {
  for (let page = 1; page <= 50; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const found = data.users.find((u) => u.email === email);
    if (found) return found;
    if (data.users.length === 0) return null;
  }
  return null;
}

export async function makeUserClient(email: string, password = "test-pass-123") {
  const admin = serviceClient();
  // createUser is not idempotent: a repeated email returns no user (an error),
  // in which case fall back to a paged lookup of the existing user.
  const { data: created } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  const user = created?.user ?? (await findUserByEmail(admin, email));
  if (!user) throw new Error(`makeUserClient: could not create or find auth user ${email}`);

  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  const { data: signedIn, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client: anon, userId: user.id, accessToken: signedIn.session!.access_token };
}
