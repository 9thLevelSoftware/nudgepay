import { expect, test } from "vitest";
import {
  BILLING_COPY,
  billingIsCurrent,
  billingStatusLabel,
  parseBillingStatus,
} from "../app/lib/billing";
import { billingPatchFromStripeEvent as patchFromEvent, verifyStripeSignature } from "../app/lib/stripe-webhook.server";

test("parseBillingStatus defaults unknown to none", () => {
  expect(parseBillingStatus("active")).toBe("active");
  expect(parseBillingStatus("nope")).toBe("none");
  expect(parseBillingStatus(null)).toBe("none");
});

test("billingIsCurrent is trial or active", () => {
  expect(billingIsCurrent("active")).toBe(true);
  expect(billingIsCurrent("trialing")).toBe(true);
  expect(billingIsCurrent("past_due")).toBe(false);
  expect(billingIsCurrent("none")).toBe(false);
});

test("billing copy does not charge customers", () => {
  expect(BILLING_COPY.body.toLowerCase()).toMatch(/does not charge your customers/);
  expect(billingStatusLabel("none")).toBe("Not subscribed");
});

test("checkout.session.completed maps org and customer", () => {
  expect(patchFromEvent({
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "subscription",
        client_reference_id: "org-1",
        customer: "cus_1",
        subscription: "sub_1",
      },
    },
  })).toEqual({
    orgId: "org-1",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    status: "active",
    currentPeriodEnd: null,
  });
});

test("subscription.updated maps status and period end", () => {
  const patch = patchFromEvent({
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_2",
        customer: "cus_2",
        status: "past_due",
        current_period_end: 1_800_000_000,
        metadata: { org_id: "org-2" },
      },
    },
  });
  expect(patch?.orgId).toBe("org-2");
  expect(patch?.status).toBe("past_due");
  expect(patch?.stripeSubscriptionId).toBe("sub_2");
  expect(patch?.currentPeriodEnd).toBe(new Date(1_800_000_000 * 1000).toISOString());
});

test("unknown events are ignored", () => {
  expect(patchFromEvent({ type: "ping", data: { object: {} } })).toBeNull();
});

test("verifyStripeSignature accepts a matching v1 hex HMAC", async () => {
  const secret = "whsec_test";
  const body = "{\"id\":\"evt_1\"}";
  const t = "1700000000";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  expect(await verifyStripeSignature(secret, `t=${t},v1=${hex}`, body, 1_700_000_000_000)).toBe(true);
  expect(await verifyStripeSignature(secret, `t=${t},v1=deadbeef`, body, 1_700_000_000_000)).toBe(false);
});


