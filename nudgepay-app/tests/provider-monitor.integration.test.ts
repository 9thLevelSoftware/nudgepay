import { expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";

const NOW = new Date();
const HOUR = new Date(NOW);
HOUR.setUTCMinutes(0, 0, 0);
// These dates intentionally predate every normal test fixture. The monitor
// page is globally ordered, so relative-to-now fixture times can be crowded
// out by stale rows created by earlier focused integration files.
const SMS_PAGE_AT = "2000-01-01T00:00:00.000Z";
const FOLLOWING_PAGE_AT = "2000-01-01T00:01:00.000Z";

test("provider monitor RPC is service-only, leases claims, and progresses past sent SMS", async () => {
  const service = serviceClient();
  const orgId = crypto.randomUUID();
  const smsIds = Array.from({ length: 25 }, () => crypto.randomUUID());
  const emailId = crypto.randomUUID();
  const checkoutId = crypto.randomUUID();
  const claimAttemptId = crypto.randomUUID();
  const allIds = [...smsIds, emailId, checkoutId, claimAttemptId];
  const viewer = await makeUserClient(`provider-monitor-viewer-${crypto.randomUUID()}@example.com`);

  try {
    const { error: orgError } = await service.from("organizations").insert({ id: orgId, name: `Provider monitor ${orgId}` });
    expect(orgError).toBeNull();
    const { error: smsError } = await service.from("text_messages").insert(smsIds.map((id) => ({
      id, org_id: orgId, direction: "outbound", status: "sending", body: "fixture", created_at: SMS_PAGE_AT,
    })));
    expect(smsError).toBeNull();
    const { error: emailError } = await service.from("email_messages").insert({
      id: emailId, org_id: orgId, direction: "outbound", status: "unknown", subject: "fixture", body: "fixture", created_at: FOLLOWING_PAGE_AT,
    });
    expect(emailError).toBeNull();
    const { error: checkoutError } = await service.from("billing_checkout_attempts").insert({
      id: checkoutId, org_id: orgId, state: "reserved", updated_at: FOLLOWING_PAGE_AT, created_at: FOLLOWING_PAGE_AT, lease_expires_at: FOLLOWING_PAGE_AT,
    });
    expect(checkoutError).toBeNull();

    const forbiddenRpc = await viewer.client.rpc("list_provider_monitor_candidates", { p_now: NOW.toISOString(), p_limit: 1 });
    expect(forbiddenRpc.error).not.toBeNull();
    const forbiddenTable = await viewer.client.from("provider_monitor_alert_receipts").select("id").limit(1);
    expect(forbiddenTable.error).not.toBeNull();

    const firstPage = await service.rpc("list_provider_monitor_candidates", { p_now: NOW.toISOString(), p_limit: 26 });
    expect(firstPage.error).toBeNull();
    const firstSms = (firstPage.data ?? []).filter((row: { channel: string; attempt_id: string }) => row.channel === "sms" && smsIds.includes(row.attempt_id));
    expect(firstSms).toHaveLength(25);

    for (const attemptId of smsIds) {
      const token = crypto.randomUUID();
      const claim = await service.rpc("claim_provider_monitor_alert", {
        p_channel: "sms", p_attempt_id: attemptId, p_hour_bucket: HOUR.toISOString(), p_claim_token: token, p_now: NOW.toISOString(),
      });
      expect(claim).toMatchObject({ data: true, error: null });
      const complete = await service.rpc("complete_provider_monitor_alert", {
        p_channel: "sms", p_attempt_id: attemptId, p_hour_bucket: HOUR.toISOString(), p_claim_token: token, p_now: NOW.toISOString(),
      });
      expect(complete).toMatchObject({ data: true, error: null });
    }

    const progressed = await service.rpc("list_provider_monitor_candidates", { p_now: NOW.toISOString(), p_limit: 26 });
    expect(progressed.error).toBeNull();
    const progressedIds = (progressed.data ?? []).map((row: { attempt_id: string }) => row.attempt_id);
    expect(progressedIds).toContain(emailId);
    expect(progressedIds).toContain(checkoutId);

    const tokenA = crypto.randomUUID();
    const tokenB = crypto.randomUUID();
    const claims = await Promise.all([
      service.rpc("claim_provider_monitor_alert", { p_channel: "email", p_attempt_id: claimAttemptId, p_hour_bucket: HOUR.toISOString(), p_claim_token: tokenA, p_now: NOW.toISOString() }),
      service.rpc("claim_provider_monitor_alert", { p_channel: "email", p_attempt_id: claimAttemptId, p_hour_bucket: HOUR.toISOString(), p_claim_token: tokenB, p_now: NOW.toISOString() }),
    ]);
    expect(claims.filter((claim) => claim.data === true)).toHaveLength(1);
    const activeLease = await service.rpc("claim_provider_monitor_alert", {
      p_channel: "email", p_attempt_id: claimAttemptId, p_hour_bucket: HOUR.toISOString(), p_claim_token: crypto.randomUUID(), p_now: NOW.toISOString(),
    });
    expect(activeLease).toMatchObject({ data: false, error: null });
    const expiredLease = await service.rpc("claim_provider_monitor_alert", {
      p_channel: "email", p_attempt_id: claimAttemptId, p_hour_bucket: HOUR.toISOString(), p_claim_token: crypto.randomUUID(), p_now: new Date(NOW.getTime() + 5 * 60 * 1000).toISOString(),
    });
    expect(expiredLease).toMatchObject({ data: true, error: null });
  } finally {
    await service.from("provider_monitor_alert_receipts").delete().in("attempt_id", allIds);
    await service.from("organizations").delete().eq("id", orgId);
  }
}, 30_000);
