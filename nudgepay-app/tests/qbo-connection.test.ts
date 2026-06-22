import { expect, test, vi } from "vitest";
import { serviceClient } from "./helpers";
import { decryptSecret } from "../app/lib/crypto.server";
import {
  storeConnection, getConnectionStatus, getValidAccessToken, disconnectConnection,
} from "../app/lib/qbo-connection.server";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const cfg = { clientId: "cid", clientSecret: "secret", redirectUri: "http://x/cb" };
const svc = serviceClient();

async function freshOrg(): Promise<string> {
  const { data } = await svc.from("organizations").insert({ name: "QBO Org" }).select("id").single();
  return data!.id as string;
}

test("storeConnection encrypts tokens at rest (no plaintext in DB)", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-1", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  const { data } = await svc.from("qbo_connections")
    .select("status, realm_id, access_token_enc, refresh_token_enc").eq("org_id", org).single();
  expect(data!.status).toBe("connected");
  expect(data!.realm_id).toBe("realm-1");
  expect(data!.refresh_token_enc).not.toContain("RT");
  expect(await decryptSecret(data!.access_token_enc, KEY)).toBe("AT");
  expect(await decryptSecret(data!.refresh_token_enc, KEY)).toBe("RT");
});

test("getValidAccessToken refreshes + persists rotated refresh token when expired", async () => {
  const org = await freshOrg();
  // Store already-expired token by passing negative expiry via a direct store then patch.
  await storeConnection(svc, KEY, org, "realm-2", { accessToken: "old", refreshToken: "oldRT", expiresIn: 3600 });
  await svc.from("qbo_connections").update({ token_expires_at: new Date(Date.now() - 1000).toISOString() }).eq("org_id", org);

  const fetchFn = vi.fn(async () =>
    new Response(JSON.stringify({ access_token: "newAT", refresh_token: "newRT", expires_in: 3600 }),
      { status: 200, headers: { "Content-Type": "application/json" } }));

  const { accessToken, realmId } = await getValidAccessToken(fetchFn as any, svc, cfg, KEY, org);
  expect(accessToken).toBe("newAT");
  expect(realmId).toBe("realm-2");
  // rotated refresh token persisted, encrypted
  const { data } = await svc.from("qbo_connections").select("refresh_token_enc").eq("org_id", org).single();
  expect(await decryptSecret(data!.refresh_token_enc, KEY)).toBe("newRT");
});

test("getValidAccessToken does NOT refresh when token is still valid", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-3", { accessToken: "validAT", refreshToken: "RT", expiresIn: 3600 });
  const fetchFn = vi.fn();
  const { accessToken } = await getValidAccessToken(fetchFn as any, svc, cfg, KEY, org);
  expect(accessToken).toBe("validAT");
  expect(fetchFn).not.toHaveBeenCalled();
});

test("getConnectionStatus returns connected status and realmId", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-status", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  expect(await getConnectionStatus(svc, org)).toEqual({ status: "connected", realmId: "realm-status" });
});

test("getValidAccessToken throws when the org has no connection", async () => {
  const org = await freshOrg();
  const fetchFn = vi.fn();
  await expect(getValidAccessToken(fetchFn as any, svc, cfg, KEY, org)).rejects.toThrow();
  expect(fetchFn).not.toHaveBeenCalled();
});

test("disconnectConnection revokes and clears the row", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-4", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
  await disconnectConnection(fetchFn as any, svc, cfg, KEY, org);
  expect(fetchFn).toHaveBeenCalledOnce();
  const { data } = await svc.from("qbo_connections").select("status, access_token_enc").eq("org_id", org).single();
  expect(data!.status).toBe("disconnected");
  expect(data!.access_token_enc).toBeNull();
});
