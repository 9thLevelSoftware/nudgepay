import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptSecret, decryptSecret } from "./crypto.server";
import {
  isDefinitiveQboRefreshFailure,
  refreshTokens,
  revokeToken,
  type QboHttpConfig,
  type QboTokens,
} from "./qbo-client.server";

const REFRESH_WAIT_TIMEOUT_MS = 5_000;
const REFRESH_POLL_MS = 75;

type QboConnectionRow = {
  realm_id: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  status: string;
  connection_generation: number;
};

type RefreshClaim = { state: "owner" | "wait" | "ready" | "stale" | "unavailable" };

export type QboRefreshRuntime = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  createLeaseId?: () => string;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readConnection(service: SupabaseClient, orgId: string): Promise<QboConnectionRow | null> {
  const { data, error } = await service.from("qbo_connections")
    .select(
      "realm_id, access_token_enc, refresh_token_enc, token_expires_at, status, connection_generation",
    )
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data as QboConnectionRow | null;
}

function requireConnected(row: QboConnectionRow | null): asserts row is QboConnectionRow & {
  realm_id: string;
  refresh_token_enc: string;
} {
  if (!row || row.status !== "connected" || !row.realm_id || !row.refresh_token_enc) {
    throw new Error("QBO not connected for this organization");
  }
}

async function freshTokenOrNull(
  row: QboConnectionRow,
  key: string,
  now: number,
): Promise<{ accessToken: string; realmId: string } | null> {
  const expiresAt = Date.parse(row.token_expires_at ?? "");
  if (!row.realm_id || !row.access_token_enc || !Number.isFinite(expiresAt) || expiresAt <= now + 60_000) {
    return null;
  }
  return { accessToken: await decryptSecret(row.access_token_enc, key), realmId: row.realm_id };
}

async function rpc<T>(
  service: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await service.rpc(name, args);
  if (error) throw error;
  return data as T;
}

export async function storeConnection(
  service: SupabaseClient, key: string, orgId: string, realmId: string, tokens: QboTokens,
): Promise<void> {
  const access_token_enc = await encryptSecret(tokens.accessToken, key);
  const refresh_token_enc = await encryptSecret(tokens.refreshToken, key);
  const token_expires_at = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
  const stored = await rpc<boolean>(service, "store_qbo_connection", {
    p_org_id: orgId,
    p_realm_id: realmId,
    p_access_token_enc: access_token_enc,
    p_refresh_token_enc: refresh_token_enc,
    p_token_expires_at: token_expires_at,
  });
  if (!stored) {
    throw new Error("QBO realm mismatch: disconnect before connecting a different company");
  }
}

export async function getConnectionStatus(
  service: SupabaseClient, orgId: string,
): Promise<{ status: string; realmId: string | null } | null> {
  const { data, error } = await service.from("qbo_connections")
    .select("status, realm_id").eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  return data ? { status: data.status as string, realmId: (data.realm_id as string) ?? null } : null;
}

export async function getValidAccessToken(
  fetchFn: typeof fetch, service: SupabaseClient, cfg: QboHttpConfig, key: string, orgId: string,
  runtime: QboRefreshRuntime = {},
): Promise<{ accessToken: string; realmId: string }> {
  const now = runtime.now ?? Date.now;
  const sleep = runtime.sleep ?? defaultSleep;
  const createLeaseId = runtime.createLeaseId ?? (() => crypto.randomUUID());
  const waitDeadline = now() + REFRESH_WAIT_TIMEOUT_MS;
  let row = await readConnection(service, orgId);

  for (let attempt = 0; attempt < 128; attempt += 1) {
    requireConnected(row);
    const fresh = await freshTokenOrNull(row, key, now());
    if (fresh) return fresh;

    const generation = Number(row.connection_generation);
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new Error("QBO connection generation is invalid");
    }
    const realmId = row.realm_id;
    const leaseId = createLeaseId();
    const claim = await rpc<RefreshClaim>(service, "claim_qbo_token_refresh", {
      p_org_id: orgId,
      p_lease_id: leaseId,
      p_expected_generation: generation,
      p_expected_realm_id: realmId,
    });

    if (claim?.state === "owner") {
      const refreshToken = await decryptSecret(row.refresh_token_enc, key);
      try {
        const tokens = await refreshTokens(fetchFn, cfg, refreshToken);
        const [accessTokenEnc, refreshTokenEnc] = await Promise.all([
          encryptSecret(tokens.accessToken, key),
          encryptSecret(tokens.refreshToken, key),
        ]);
        const committed = await rpc<boolean>(service, "finish_qbo_token_refresh", {
          p_org_id: orgId,
          p_lease_id: leaseId,
          p_expected_generation: generation,
          p_expected_realm_id: realmId,
          p_access_token_enc: accessTokenEnc,
          p_refresh_token_enc: refreshTokenEnc,
          p_token_expires_at: new Date(now() + tokens.expiresIn * 1_000).toISOString(),
        });
        if (committed) return { accessToken: tokens.accessToken, realmId };
      } catch (err) {
        try {
          await rpc<boolean>(service, "fail_qbo_token_refresh", {
            p_org_id: orgId,
            p_lease_id: leaseId,
            p_expected_generation: generation,
            p_expected_realm_id: realmId,
            p_definitive: isDefinitiveQboRefreshFailure(err),
          });
        } catch {
          // Preserve the provider failure. The durable lease expires after 30
          // seconds, so a cleanup outage cannot lock refresh indefinitely.
        }
        throw err;
      }
      // A reconnect, disconnect, or newer lease won the CAS while the provider
      // request was in flight. Never return or persist this stale token pair.
      row = await readConnection(service, orgId);
      continue;
    }

    if (claim?.state === "unavailable") {
      throw new Error("QBO not connected for this organization");
    }

    row = await readConnection(service, orgId);
    if (claim?.state === "wait") {
      if (now() >= waitDeadline) {
        throw new Error("QBO token refresh is already in progress");
      }
      await sleep(Math.min(REFRESH_POLL_MS, Math.max(1, waitDeadline - now())));
      row = await readConnection(service, orgId);
    }
  }

  throw new Error("QBO token refresh did not stabilize");
}

export async function disconnectConnection(
  fetchFn: typeof fetch, service: SupabaseClient, cfg: QboHttpConfig, key: string, orgId: string,
): Promise<void> {
  const { data, error: readError } = await service.from("qbo_connections")
    .select("refresh_token_enc, connection_generation").eq("org_id", orgId).maybeSingle();
  if (readError) throw readError;
  const refreshTokenEnc = data?.refresh_token_enc as string | null | undefined;
  const generation = Number(data?.connection_generation);
  if (refreshTokenEnc) {
    // Preserve the encrypted credentials when Intuit cannot confirm the
    // revoke. That keeps a retry path and prevents callers from erasing the
    // only token that can retire the external connection.
    await revokeToken(fetchFn, cfg, await decryptSecret(refreshTokenEnc, key));
  }
  if (!data || !Number.isSafeInteger(generation) || generation < 1) return;
  let clearQuery = service.from("qbo_connections").update({
    access_token_enc: null, refresh_token_enc: null, token_expires_at: null,
    realm_id: null, status: "disconnected",
  }).eq("org_id", orgId).eq("connection_generation", generation);
  clearQuery = refreshTokenEnc
    ? clearQuery.eq("refresh_token_enc", refreshTokenEnc)
    : clearQuery.is("refresh_token_enc", null);
  const { data: clearedRows, error } = await clearQuery.select("org_id");
  if (error) throw error;
  if (!Array.isArray(clearedRows) || clearedRows.length !== 1) {
    throw new Error("QBO connection changed while revoke was in progress");
  }
}
