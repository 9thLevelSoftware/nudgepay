import { expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";
import { decryptSecret } from "../app/lib/crypto.server";
import { storeConnection } from "../app/lib/qbo-connection.server";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

test("QBO refresh RPCs enforce grants, leases, generation CAS, and trigger invalidation", async () => {
  const service = serviceClient();
  const orgId = crypto.randomUUID();
  const realmId = `realm-${crypto.randomUUID()}`;
  const leaseA = crypto.randomUUID();
  const leaseB = crypto.randomUUID();
  const viewer = await makeUserClient(`qbo-refresh-rpc-${crypto.randomUUID()}@example.com`);
  const expiredAt = new Date(Date.now() - 60_000).toISOString();

  try {
    const { error: orgError } = await service.from("organizations").insert({
      id: orgId,
      name: `QBO refresh RPC ${orgId}`,
    });
    expect(orgError).toBeNull();
    const { error: connectionError } = await service.from("qbo_connections").insert({
      org_id: orgId,
      realm_id: realmId,
      access_token_enc: "access-old",
      refresh_token_enc: "refresh-old",
      token_expires_at: expiredAt,
      status: "connected",
    });
    expect(connectionError).toBeNull();

    const forbidden = await viewer.client.rpc("claim_qbo_token_refresh", {
      p_org_id: orgId,
      p_lease_id: crypto.randomUUID(),
      p_expected_generation: 1,
      p_expected_realm_id: realmId,
    });
    expect(forbidden.error).not.toBeNull();
    const forbiddenStore = await viewer.client.rpc("store_qbo_connection", {
      p_org_id: orgId,
      p_realm_id: realmId,
      p_access_token_enc: "forbidden",
      p_refresh_token_enc: "forbidden",
      p_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(forbiddenStore.error).not.toBeNull();

    const claimArgs = (leaseId: string) => ({
      p_org_id: orgId,
      p_lease_id: leaseId,
      p_expected_generation: 1,
      p_expected_realm_id: realmId,
    });
    const concurrentClaims = await Promise.all([
      service.rpc("claim_qbo_token_refresh", claimArgs(leaseA)),
      service.rpc("claim_qbo_token_refresh", claimArgs(leaseB)),
    ]);
    for (const claim of concurrentClaims) expect(claim.error).toBeNull();
    expect(concurrentClaims.map((claim) => claim.data?.state).sort()).toEqual(["owner", "wait"]);
    const ownerLease = concurrentClaims[0].data?.state === "owner" ? leaseA : leaseB;

    const finish = await service.rpc("finish_qbo_token_refresh", {
      p_org_id: orgId,
      p_lease_id: ownerLease,
      p_expected_generation: 1,
      p_expected_realm_id: realmId,
      p_access_token_enc: "access-new",
      p_refresh_token_enc: "refresh-new",
      p_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(finish).toMatchObject({ data: true, error: null });
    const afterFinish = await service.from("qbo_connections")
      .select("connection_generation, access_token_enc, refresh_token_enc, refresh_lease_id, refresh_lease_expires_at")
      .eq("org_id", orgId)
      .single();
    expect(afterFinish.error).toBeNull();
    expect(Number(afterFinish.data!.connection_generation)).toBe(2);
    expect(afterFinish.data).toMatchObject({
      access_token_enc: "access-new",
      refresh_token_enc: "refresh-new",
      refresh_lease_id: null,
      refresh_lease_expires_at: null,
    });

    const makeExpired = await service.from("qbo_connections")
      .update({ token_expires_at: expiredAt })
      .eq("org_id", orgId);
    expect(makeExpired.error).toBeNull();
    const staleLease = crypto.randomUUID();
    const staleClaim = await service.rpc("claim_qbo_token_refresh", {
      p_org_id: orgId,
      p_lease_id: staleLease,
      p_expected_generation: 3,
      p_expected_realm_id: realmId,
    });
    expect(staleClaim).toMatchObject({ data: { state: "owner" }, error: null });

    const generationChange = await service.from("qbo_connections")
      .update({ access_token_enc: "access-reconnected" })
      .eq("org_id", orgId);
    expect(generationChange.error).toBeNull();
    const staleFinish = await service.rpc("finish_qbo_token_refresh", {
      p_org_id: orgId,
      p_lease_id: staleLease,
      p_expected_generation: 3,
      p_expected_realm_id: realmId,
      p_access_token_enc: "access-stale",
      p_refresh_token_enc: "refresh-stale",
      p_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const staleFail = await service.rpc("fail_qbo_token_refresh", {
      p_org_id: orgId,
      p_lease_id: staleLease,
      p_expected_generation: 3,
      p_expected_realm_id: realmId,
      p_definitive: true,
    });
    expect(staleFinish).toMatchObject({ data: false, error: null });
    expect(staleFail).toMatchObject({ data: false, error: null });

    const firstReclaimLease = crypto.randomUUID();
    const reclaimClaim = await service.rpc("claim_qbo_token_refresh", {
      p_org_id: orgId,
      p_lease_id: firstReclaimLease,
      p_expected_generation: 4,
      p_expected_realm_id: realmId,
    });
    expect(reclaimClaim).toMatchObject({ data: { state: "owner" }, error: null });
    const expireLease = await service.from("qbo_connections")
      .update({ refresh_lease_expires_at: new Date(Date.now() - 1_000).toISOString() })
      .eq("org_id", orgId);
    expect(expireLease.error).toBeNull();
    const secondReclaimLease = crypto.randomUUID();
    const reclaimed = await service.rpc("claim_qbo_token_refresh", {
      p_org_id: orgId,
      p_lease_id: secondReclaimLease,
      p_expected_generation: 4,
      p_expected_realm_id: realmId,
    });
    expect(reclaimed).toMatchObject({ data: { state: "owner" }, error: null });
    const finalRow = await service.from("qbo_connections")
      .select("connection_generation, refresh_lease_id, status, access_token_enc")
      .eq("org_id", orgId)
      .single();
    expect(finalRow.data).toMatchObject({
      connection_generation: 4,
      refresh_lease_id: secondReclaimLease,
      status: "connected",
      access_token_enc: "access-reconnected",
    });
  } finally {
    await service.from("organizations").delete().eq("id", orgId);
  }
}, 30_000);

test("concurrent first connections cannot bind one organization to different QBO realms", async () => {
  const service = serviceClient();
  const orgId = crypto.randomUUID();
  const realms = [`realm-a-${crypto.randomUUID()}`, `realm-b-${crypto.randomUUID()}`];
  const tokenPairs = [
    { accessToken: "access-a", refreshToken: "refresh-a", expiresIn: 3600 },
    { accessToken: "access-b", refreshToken: "refresh-b", expiresIn: 3600 },
  ];

  try {
    const { error: orgError } = await service.from("organizations").insert({
      id: orgId,
      name: `QBO connect race ${orgId}`,
    });
    expect(orgError).toBeNull();

    const invalidStore = await service.rpc("store_qbo_connection", {
      p_org_id: orgId,
      p_realm_id: " ",
      p_access_token_enc: "access-invalid",
      p_refresh_token_enc: "refresh-invalid",
      p_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(invalidStore).toMatchObject({ data: false, error: null });

    const outcomes = await Promise.allSettled(realms.map((realmId, index) =>
      storeConnection(service, KEY, orgId, realmId, tokenPairs[index])));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ message: expect.stringMatching(/realm mismatch/) }),
    });

    const winner = outcomes.findIndex((outcome) => outcome.status === "fulfilled");
    const stored = await service.from("qbo_connections")
      .select("realm_id, access_token_enc, refresh_token_enc, status, connection_generation, refresh_lease_id")
      .eq("org_id", orgId)
      .single();
    expect(stored.error).toBeNull();
    expect(stored.data).toMatchObject({
      realm_id: realms[winner],
      status: "connected",
      connection_generation: 1,
      refresh_lease_id: null,
    });
    expect(await decryptSecret(stored.data!.access_token_enc, KEY)).toBe(tokenPairs[winner].accessToken);
    expect(await decryptSecret(stored.data!.refresh_token_enc, KEY)).toBe(tokenPairs[winner].refreshToken);

    await storeConnection(service, KEY, orgId, realms[winner], {
      accessToken: "access-same-realm-new",
      refreshToken: "refresh-same-realm-new",
      expiresIn: 3600,
    });
    const afterSameRealm = await service.from("qbo_connections")
      .select("connection_generation, refresh_lease_id, refresh_lease_expires_at")
      .eq("org_id", orgId)
      .single();
    expect(afterSameRealm.data).toMatchObject({
      connection_generation: 2,
      refresh_lease_id: null,
      refresh_lease_expires_at: null,
    });
  } finally {
    await service.from("organizations").delete().eq("id", orgId);
  }
}, 30_000);
