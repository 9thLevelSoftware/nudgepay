import { expect, test } from "vitest";
import {
  createBillingPortalSession,
  createCheckoutSession,
  createStripeCustomer,
} from "../app/lib/stripe.server";

const cfg = { secretKey: "sk_test_x", priceId: "price_x" };

test("createStripeCustomer posts form-encoded metadata", async () => {
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe("https://api.stripe.com/v1/customers");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer sk_test_x" });
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

test("createCheckoutSession is a subscription with org metadata", async () => {
  const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body);
    expect(body).toContain("mode=subscription");
    expect(body).toContain("line_items%5B0%5D%5Bprice%5D=price_x");
    expect(body).toContain("client_reference_id=org-1");
    expect(body).toContain("subscription_data%5Bmetadata%5D%5Borg_id%5D=org-1");
    return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_test" }), { status: 200 });
  };
  await expect(createCheckoutSession(fetchFn as typeof fetch, cfg, {
    orgId: "org-1",
    customerId: "cus_1",
    successUrl: "https://app.example/settings?tab=billing&billing=success",
    cancelUrl: "https://app.example/settings?tab=billing&billing=cancel",
  })).resolves.toBe("https://checkout.stripe.com/c/pay/cs_test");
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
