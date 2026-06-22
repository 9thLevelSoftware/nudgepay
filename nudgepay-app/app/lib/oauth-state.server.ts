import type { SupabaseClient } from "@supabase/supabase-js";

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export async function createOAuthState(
  service: SupabaseClient, orgId: string, ttlSeconds = 600,
): Promise<string> {
  const state = randomState();
  const expires_at = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const { error } = await service.from("oauth_states").insert({ state, org_id: orgId, expires_at });
  if (error) throw error;
  return state;
}

export async function consumeOAuthState(service: SupabaseClient, state: string): Promise<string> {
  const { data, error } = await service.from("oauth_states")
    .select("org_id, expires_at").eq("state", state).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Invalid OAuth state");
  // single-use: delete regardless of expiry outcome
  await service.from("oauth_states").delete().eq("state", state);
  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    throw new Error("Expired OAuth state");
  }
  return data.org_id as string;
}
