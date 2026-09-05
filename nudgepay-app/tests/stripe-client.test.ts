import { expect, test } from "vitest";
import {
  assertStripeSubscriptionWorkspace,
  createBillingPortalSession,
  createCheckoutSession,
  createStripeCustomer,
  retrieveStripeSubscription,
} from "../app/lib/stripe.server";

const cfg = { secretKey: "sk_test_x", priceId: "price_x" };

test("createStripeCustomer posts form-encoded metadata", async () => {
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe("https://api.stripe.com/v1/customers");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer sk_test_x" });
    expect(init?.headers).toMatchObject({ "Idempotency-Key": "stripe-customer:org-1" });
    const body = String(init?.body);
    expect(body).toContain("metadata%5Borg_id%5D=org-1");
    return new Response(JSON.stringify({ id: "cus_1" }), { status: 200 });
  };
  await expect(createStripeCustomer(fetchFn as typeof fetch, cfg, {
    orgId: "org-1",
    name: "Acme",
    email: "owner@example.com",
  })).resolves.toBe("cus_1");
});

test("createStripeCustomer omits email when Auth has no verified address", async () => {
  const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body));
    expect(body.has("email")).toBe(false);
    return new Response(JSON.stringify({ id: "cus_no_email" }), { status: 200 });
  };
  await expect(createStripeCustomer(fetchFn as typeof fetch, cfg, {
    orgId: "org-no-email",
    name: "No Email Workspace",
    email: null,
  })).resolves.toBe("cus_no_email");
});

test("createCheckoutSession is a subscription with org metadata", async () => {
  const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ "Idempotency-Key": "billing-checkout:attempt-1" });
    const body = String(init?.body);
    expect(body).toContain("mode=subscription");
    expect(body).toContain("line_items%5B0%5D%5Bprice%5D=price_x");
    expect(body).toContain("client_reference_id=org-1");
    expect(body).toContain("subscription_data%5Bmetadata%5D%5Borg_id%5D=org-1");
    expect(body).toContain("subscription_data%5Bmetadata%5D%5Battempt_id%5D=attempt-1");
    expect(body).toContain("metadata%5Battempt_id%5D=attempt-1");
    return new Response(JSON.stringify({
      id: "cs_test",
      url: "https://checkout.stripe.com/c/pay/cs_test",
      expires_at: 1_800_000_000,
    }), { status: 200 });
  };
  await expect(createCheckoutSession(fetchFn as typeof fetch, cfg, {
    orgId: "org-1",
    attemptId: "attempt-1",
    customerId: "cus_1",
    successUrl: "https://app.example/settings?tab=billing&billing=success",
    cancelUrl: "https://app.example/settings?tab=billing&billing=cancel",
  })).resolves.toEqual({
    sessionId: "cs_test",
    url: "https://checkout.stripe.com/c/pay/cs_test",
    expiresAt: "2027-01-15T08:00:00.000Z",
  });
});

test("retrieveStripeSubscription reads canonical current subscription state", async () => {
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe("https://api.stripe.com/v1/subscriptions/sub_current");
    expect(init?.method).toBe("GET");
    return new Response(JSON.stringify({
      id: "sub_current",
      customer: "cus_current",
      status: "past_due",
      current_period_end: 1_800_000_000,
      metadata: { org_id: "org-current", attempt_id: "attempt-current" },
    }), { status: 200 });
  };

  await expect(retrieveStripeSubscription(
    fetchFn as typeof fetch,
    cfg,
    "sub_current",
  )).resolves.toEqual({
    id: "sub_current",
    customerId: "cus_current",
    status: "past_due",
    currentPeriodEnd: "2027-01-15T08:00:00.000Z",
    orgId: "org-current",
    attemptId: "attempt-current",
  });
});

test("createCheckoutSession treats a Stripe 500 as an ambiguous outcome", async () => {
  const fetchFn = async () => new Response("internal error", { status: 500 });
  await expect(createCheckoutSession(fetchFn as typeof fetch, cfg, {
    orgId: "org-1",
    attemptId: "attempt-500",
    customerId: "cus-1",
    successUrl: "https://app.example/success",
    cancelUrl: "https://app.example/cancel",
  })).rejects.toMatchObject({
    name: "ProviderResponseAmbiguousError",
    provider: "Stripe",
    status: 500,
  });
});

test("canonical Stripe subscriptions require exact workspace metadata and customer linkage", () => {
  const subscription = {
    id: "sub_current",
    customerId: "cus_current",
    status: "active",
    currentPeriodEnd: null,
    orgId: "org_current",
    attemptId: null,
  };
  expect(() => assertStripeSubscriptionWorkspace(subscription, {
    orgId: "org_other",
    customerId: "cus_current",
  })).toThrow(/workspace metadata mismatch/i);
  expect(() => assertStripeSubscriptionWorkspace({ ...subscription, orgId: null }, {
    orgId: "org_current",
    customerId: "cus_current",
  })).toThrow(/workspace metadata mismatch/i);
  expect(() => assertStripeSubscriptionWorkspace(subscription, {
    orgId: "org_current",
    customerId: "cus_other",
  })).toThrow(/customer mismatch/i);
});

test("createBillingPortalSession returns the portal url", async () => {
  const fetchFn = async (url: string | URL | Request) => {
    expect(String(url)).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    return new Response(JSON.stringify({ url: "https://billing.stripe.com/p/session/test" }), { status: 200 });
  };
  await expect(createBillingPortalSession(fetchFn as typeof fetch, cfg, {
    customerId: "cus_1",
    returnUrl: "https://app.example/settings?tab=billing",
  })).resolves.toBe("https://billing.stripe.com/p/session/test");
});
