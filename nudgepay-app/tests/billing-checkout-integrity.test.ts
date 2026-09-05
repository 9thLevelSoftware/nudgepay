import { beforeAll, expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";

let orgId: string;
let userId: string;

beforeAll(async () => {
  ({ userId } = await makeUserClient("checkout-owner@example.com"));
  const { data, error } = await serviceClient().from("organizations")
    .insert({ name: "Checkout integrity fixture" }).select("id").single();
  if (error) throw error;
  orgId = data!.id as string;
  const { error: membershipError } = await serviceClient().from("memberships")
    .insert({ org_id: orgId, user_id: userId, role: "owner" });
  if (membershipError) throw membershipError;
});

test("concurrent checkout initiation reserves one durable provider attempt", async () => {
  const service = serviceClient();
  const [left, right] = await Promise.all([
    service.rpc("reserve_billing_checkout", { p_org_id: orgId, p_user_id: userId }),
    service.rpc("reserve_billing_checkout", { p_org_id: orgId, p_user_id: userId }),
  ]);
  if (left.error) throw left.error;
  if (right.error) throw right.error;

  const results = [left.data, right.data] as Array<{ state: string; attempt_id: string }>;
  expect(results.map((result) => result.state).sort()).toEqual(["in_progress", "reserved"]);
  expect(new Set(results.map((result) => result.attempt_id)).size).toBe(1);

  const attemptId = results[0].attempt_id;
  await service.from("billing_checkout_attempts")
    .update({ lease_expires_at: "2000-01-01T00:00:00.000Z" })
    .eq("id", attemptId);
  const { data: reclaimed, error: reclaimError } = await service.rpc("reserve_billing_checkout", {
    p_org_id: orgId,
    p_user_id: userId,
  });
  if (reclaimError) throw reclaimError;
  expect(reclaimed).toMatchObject({ state: "reserved", attempt_id: attemptId });
});

test("authenticated clients cannot call checkout reservation directly", async () => {
  const user = await makeUserClient("checkout-rpc-denied@example.com");
  const { error } = await user.client.rpc("reserve_billing_checkout", {
    p_org_id: orgId,
    p_user_id: user.userId,
  });
  expect(error?.code).toBe("42501");
});

test("a removed owner cannot reserve a checkout through the service boundary", async () => {
  const service = serviceClient();
  const removed = await makeUserClient("checkout-removed@example.com");
  const { data: org, error: orgError } = await service.from("organizations")
    .insert({ name: "Removed checkout owner" }).select("id").single();
  if (orgError) throw orgError;
  await service.from("memberships").insert({
    org_id: org!.id, user_id: removed.userId, role: "owner",
  });
  await service.from("memberships").insert({
    org_id: org!.id, user_id: userId, role: "owner",
  });
  const { error: removeError } = await service.from("memberships").delete()
    .eq("org_id", org!.id).eq("user_id", removed.userId);
  if (removeError) throw removeError;

  const { error } = await service.rpc("reserve_billing_checkout", {
    p_org_id: org!.id,
    p_user_id: removed.userId,
  });
  expect(error?.code).toBe("42501");
});

test("an existing subscription blocks a new checkout attempt", async () => {
  const service = serviceClient();
  const { data: activeOrg, error: orgError } = await service.from("organizations")
    .insert({ name: "Already subscribed fixture" }).select("id").single();
  if (orgError) throw orgError;
  await service.from("memberships").insert({ org_id: activeOrg!.id, user_id: userId, role: "owner" });
  await service.from("org_billing").insert({
    org_id: activeOrg!.id,
    status: "active",
    stripe_subscription_id: "sub_existing",
  });

  const { data, error } = await service.rpc("reserve_billing_checkout", {
    p_org_id: activeOrg!.id,
    p_user_id: userId,
  });
  if (error) throw error;
  expect(data).toEqual({ state: "blocked_subscription" });
});

test("a ready checkout is reused until Stripe's persisted expiry", async () => {
  const service = serviceClient();
  const { data: org, error: orgError } = await service.from("organizations")
    .insert({ name: "Checkout expiry fixture" }).select("id").single();
  if (orgError) throw orgError;
  await service.from("memberships").insert({ org_id: org!.id, user_id: userId, role: "owner" });
  const { data: reservation, error: reserveError } = await service.rpc("reserve_billing_checkout", {
    p_org_id: org!.id,
    p_user_id: userId,
  });
  if (reserveError) throw reserveError;
  const attemptId = (reservation as { attempt_id: string }).attempt_id;
  const expiresAt = "2100-01-01T00:00:00.000Z";
  const { data: finished, error: finishError } = await service.rpc("finish_billing_checkout", {
    p_org_id: org!.id,
    p_attempt_id: attemptId,
    p_state: "ready",
    p_checkout_url: "https://checkout.stripe.test/session",
    p_checkout_session_id: "cs_expiry_fixture",
    p_expires_at: expiresAt,
    p_error_code: null,
  });
  if (finishError) throw finishError;
  expect(finished).toBe(true);

  const { data: reused, error: reuseError } = await service.rpc("reserve_billing_checkout", {
    p_org_id: org!.id,
    p_user_id: userId,
  });
  if (reuseError) throw reuseError;
  expect(reused).toMatchObject({
    state: "ready",
    attempt_id: attemptId,
    checkout_url: "https://checkout.stripe.test/session",
  });

  await service.from("billing_checkout_attempts")
    .update({ expires_at: "2000-01-01T00:00:00.000Z" })
    .eq("id", attemptId);
  const { data: expired, error: expiredError } = await service.rpc("reserve_billing_checkout", {
    p_org_id: org!.id,
    p_user_id: userId,
  });
  if (expiredError) throw expiredError;
  expect(expired).toMatchObject({ state: "unknown", attempt_id: attemptId });
});

test("customer binding cannot overwrite an active subscription", async () => {
  const service = serviceClient();
  const { data: org, error: orgError } = await service.from("organizations")
    .insert({ name: "Billing bind race fixture" }).select("id").single();
  if (orgError) throw orgError;
  await service.from("memberships").insert({ org_id: org!.id, user_id: userId, role: "owner" });
  const { error: billingError } = await service.from("org_billing").insert({
    org_id: org!.id,
    stripe_customer_id: "cus_current",
    stripe_subscription_id: "sub_current",
    status: "active",
  });
  if (billingError) throw billingError;

  const { data: bound, error: bindError } = await service.rpc(
    "set_billing_customer_if_unsubscribed",
    { p_org_id: org!.id, p_user_id: userId, p_stripe_customer_id: "cus_replacement" },
  );
  if (bindError) throw bindError;
  expect(bound).toBe(false);
  const { data: billing } = await service.from("org_billing")
    .select("stripe_customer_id, stripe_subscription_id, status")
    .eq("org_id", org!.id).single();
  expect(billing).toEqual({
    stripe_customer_id: "cus_current",
    stripe_subscription_id: "sub_current",
    status: "active",
  });
});
