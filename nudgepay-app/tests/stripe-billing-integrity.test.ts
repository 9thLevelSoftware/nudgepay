import { beforeAll, expect, test } from "vitest";
import { serviceClient } from "./helpers";

let orgId: string;

beforeAll(async () => {
  const { data, error } = await serviceClient()
    .from("organizations")
    .insert({ name: "Stripe ordering fixture" })
    .select("id")
    .single();
  if (error) throw error;
  orgId = data!.id as string;
});

async function applyEvent(args: {
  eventId: string;
  createdAt: string;
  status: string;
}): Promise<boolean> {
  const { data, error } = await serviceClient().rpc("apply_stripe_billing_event", {
    p_event_id: args.eventId,
    p_event_created_at: args.createdAt,
    p_event_type: "customer.subscription.updated",
    p_org_id: orgId,
    p_status: args.status,
    p_stripe_customer_id: "cus_ordering",
    p_stripe_subscription_id: "sub_ordering",
    p_current_period_end: "2027-02-01T00:00:00.000Z",
  });
  if (error) throw error;
  return data as boolean;
}

test("a duplicate Stripe event is acknowledged without applying its payload twice", async () => {
  const createdAt = "2027-01-15T08:00:00.000Z";
  await expect(applyEvent({ eventId: "evt_duplicate", createdAt, status: "active" }))
    .resolves.toBe(true);
  await expect(applyEvent({ eventId: "evt_duplicate", createdAt, status: "canceled" }))
    .resolves.toBe(false);

  const { data } = await serviceClient().from("org_billing")
    .select("status, last_stripe_event_id")
    .eq("org_id", orgId)
    .single();
  expect(data).toMatchObject({ status: "active", last_stripe_event_id: "evt_duplicate" });
});

test("a later event for a retired subscription cannot overwrite the current subscription", async () => {
  const service = serviceClient();
  await expect(applyEvent({
    eventId: "evt_current_subscription",
    createdAt: "2027-01-15T10:00:00.000Z",
    status: "active",
  })).resolves.toBe(true);

  const { data, error } = await service.rpc("apply_stripe_billing_event", {
    p_event_id: "evt_retired_subscription",
    p_event_created_at: "2027-01-15T11:00:00.000Z",
    p_event_type: "customer.subscription.deleted",
    p_org_id: orgId,
    p_status: "canceled",
    p_stripe_customer_id: "cus_ordering",
    p_stripe_subscription_id: "sub_retired",
    p_current_period_end: null,
  });
  if (error) throw error;
  expect(data).toBe(false);

  const { data: billing } = await service.from("org_billing")
    .select("status, stripe_subscription_id")
    .eq("org_id", orgId)
    .single();
  expect(billing).toMatchObject({ status: "active", stripe_subscription_id: "sub_ordering" });
});

test("an older Stripe event cannot regress newer subscription state", async () => {
  await expect(applyEvent({
    eventId: "evt_newer",
    createdAt: "2027-01-15T12:00:00.000Z",
    status: "past_due",
  })).resolves.toBe(true);
  await expect(applyEvent({
    eventId: "evt_older",
    createdAt: "2027-01-15T11:30:00.000Z",
    status: "active",
  })).resolves.toBe(false);

  const { data } = await serviceClient().from("org_billing")
    .select("status, last_stripe_event_id")
    .eq("org_id", orgId)
    .single();
  expect(data).toMatchObject({ status: "past_due", last_stripe_event_id: "evt_newer" });
});

test("a different Stripe customer cannot be rebound to the workspace", async () => {
  const { error } = await serviceClient().rpc("apply_stripe_billing_event", {
    p_event_id: "evt_wrong_customer",
    p_event_created_at: "2027-01-15T13:00:00.000Z",
    p_event_type: "customer.subscription.updated",
    p_org_id: orgId,
    p_status: "active",
    p_stripe_customer_id: "cus_other_tenant",
    p_stripe_subscription_id: "sub_ordering",
    p_current_period_end: "2027-02-01T00:00:00.000Z",
  });
  expect(error?.message).toMatch(/customer does not match workspace/i);
});

test("a new subscription replaces an incomplete-expired subscription", async () => {
  const service = serviceClient();
  await service.from("org_billing").update({ status: "incomplete_expired" }).eq("org_id", orgId);
  const { data, error } = await service.rpc("apply_stripe_billing_event", {
    p_event_id: "evt_replacement_subscription",
    p_event_created_at: "2027-01-15T14:00:00.000Z",
    p_event_type: "checkout.session.completed",
    p_org_id: orgId,
    p_status: "active",
    p_stripe_customer_id: "cus_ordering",
    p_stripe_subscription_id: "sub_replacement",
    p_current_period_end: "2027-03-01T00:00:00.000Z",
  });
  if (error) throw error;
  expect(data).toBe(true);
  const { data: billing } = await service.from("org_billing")
    .select("status, stripe_subscription_id").eq("org_id", orgId).single();
  expect(billing).toEqual({ status: "active", stripe_subscription_id: "sub_replacement" });
});

test("a delayed old checkout event cannot complete a newer ready attempt", async () => {
  const service = serviceClient();
  const isolatedOrgId = crypto.randomUUID();
  const oldAttemptId = crypto.randomUUID();
  const newAttemptId = crypto.randomUUID();
  const { error: orgError } = await service.from("organizations").insert({
    id: isolatedOrgId,
    name: "Stripe delayed checkout fixture",
  });
  expect(orgError).toBeNull();
  try {
    const seeded = await Promise.all([
      service.from("org_billing").insert({
        org_id: isolatedOrgId,
        stripe_customer_id: "cus_delayed_checkout",
        stripe_subscription_id: "sub_old_checkout",
        status: "canceled",
      }),
      service.from("billing_checkout_attempts").insert({
        id: oldAttemptId,
        org_id: isolatedOrgId,
        state: "completed",
        checkout_session_id: "cs_old_checkout",
      }),
      service.from("billing_checkout_attempts").insert({
        id: newAttemptId,
        org_id: isolatedOrgId,
        state: "ready",
        checkout_session_id: "cs_new_checkout",
        checkout_url: "https://checkout.stripe.test/new",
        expires_at: "2027-04-01T00:00:00.000Z",
      }),
    ]);
    expect(seeded.every((result) => result.error === null)).toBe(true);

    const applied = await service.rpc("apply_stripe_billing_event", {
      p_event_id: `evt_delayed_${crypto.randomUUID()}`,
      p_event_created_at: "2027-03-01T00:00:00.000Z",
      p_event_type: "checkout.session.completed",
      p_org_id: isolatedOrgId,
      p_status: "active",
      p_stripe_customer_id: "cus_delayed_checkout",
      p_stripe_subscription_id: "sub_old_checkout",
      p_current_period_end: "2027-04-01T00:00:00.000Z",
      p_checkout_attempt_id: oldAttemptId,
      p_checkout_session_id: "cs_old_checkout",
    });
    expect(applied).toMatchObject({ data: true, error: null });

    const mismatchedSession = await service.rpc("apply_stripe_billing_event", {
      p_event_id: `evt_wrong_session_${crypto.randomUUID()}`,
      p_event_created_at: "2027-03-01T00:01:00.000Z",
      p_event_type: "checkout.session.completed",
      p_org_id: isolatedOrgId,
      p_status: "active",
      p_stripe_customer_id: "cus_delayed_checkout",
      p_stripe_subscription_id: "sub_old_checkout",
      p_current_period_end: "2027-04-01T00:00:00.000Z",
      p_checkout_attempt_id: newAttemptId,
      p_checkout_session_id: "cs_old_checkout",
    });
    expect(mismatchedSession).toMatchObject({ data: true, error: null });

    const { data: currentAttempt, error: attemptError } = await service
      .from("billing_checkout_attempts")
      .select("state, checkout_session_id")
      .eq("id", newAttemptId)
      .single();
    expect(attemptError).toBeNull();
    expect(currentAttempt).toEqual({
      state: "ready",
      checkout_session_id: "cs_new_checkout",
    });
  } finally {
    await service.from("organizations").delete().eq("id", isolatedOrgId);
  }
});
