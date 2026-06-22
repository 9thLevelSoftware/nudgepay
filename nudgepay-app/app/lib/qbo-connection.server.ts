import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptSecret, decryptSecret } from "./crypto.server";
import { refreshTokens, revokeToken, type QboHttpConfig, type QboTokens } from "./qbo-client.server";

export async function storeConnection(
  service: SupabaseClient, key: string, orgId: string, realmId: string, tokens: QboTokens,
): Promise<void> {
  const access_token_enc = await encryptSecret(tokens.accessToken, key);
  const refresh_token_enc = await encryptSecret(tokens.refreshToken, key);
  const token_expires_at = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
  const { error } = await service.from("qbo_connections").upsert({
    org_id: orgId, realm_id: realmId, access_token_enc, refresh_token_enc,
    token_expires_at, status: "connected",
  }, { onConflict: "org_id" });
  if (error) throw error;
}

export async function getConnectionStatus(
  service: SupabaseClient, orgId: string,
): Promise<{ status: string; realmId: string | null } | null> {
  const { data } = await service.from("qbo_connections")
    .select("status, realm_id").eq("org_id", orgId).maybeSingle();
  return data ? { status: data.status as string, realmId: (data.realm_id as string) ?? null } : null;
}

export async function getValidAccessToken(
  fetchFn: typeof fetch, service: SupabaseClient, cfg: QboHttpConfig, key: string, orgId: string,
): Promise<{ accessToken: string; realmId: string }> {
  const { data, error } = await service.from("qbo_connections")
    .select("realm_id, access_token_enc, refresh_token_enc, token_expires_at, status")
    .eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "connected" || !data.refresh_token_enc) {
    throw new Error("QBO not connected for this organization");
  }
  const realmId = data.realm_id as string;
  const expiresAt = new Date(data.token_expires_at as string).getTime();
  if (expiresAt > Date.now() + 60_000) {
    return { accessToken: await decryptSecret(data.access_token_enc as string, key), realmId };
  }
  // Refresh: tokens rotate — persist the new refresh token.
  const refreshToken = await decryptSecret(data.refresh_token_enc as string, key);
  const tokens = await refreshTokens(fetchFn, cfg, refreshToken);
  await storeConnection(service, key, orgId, realmId, tokens);
  return { accessToken: tokens.accessToken, realmId };
}

export async function disconnectConnection(
  fetchFn: typeof fetch, service: SupabaseClient, cfg: QboHttpConfig, key: string, orgId: string,
): Promise<void> {
  const { data } = await service.from("qbo_connections")
    .select("refresh_token_enc").eq("org_id", orgId).maybeSingle();
  if (data?.refresh_token_enc) {
    try {
      await revokeToken(fetchFn, cfg, await decryptSecret(data.refresh_token_enc as string, key));
    } catch {
      // Best-effort revoke: clear local tokens even if Intuit revoke errors.
    }
  }
  const { error } = await service.from("qbo_connections").update({
    access_token_enc: null, refresh_token_enc: null, token_expires_at: null,
    realm_id: null, status: "disconnected",
  }).eq("org_id", orgId);
  if (error) throw error;
}
