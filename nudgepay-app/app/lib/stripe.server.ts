// Stripe REST client. Workers-friendly (fetch-only, no SDK). Fetch injected.

import { ProviderResponseAmbiguousError, ProviderSendRejectedError } from "./provider-send-error";

export const STRIPE_API_TIMEOUT_MS = 10_000;
export const STRIPE_API_VERSION = "2026-02-25.clover";

export type StripeConfig = { secretKey: string; priceId: string };

async function stripeForm(
  fetchFn: typeof fetch,
  secretKey: string,
  path: string,
  params: Record<string, string>,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params);
  const res = await fetchFn(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body,
    signal: AbortSignal.timeout(STRIPE_API_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) {
      throw new ProviderSendRejectedError("Stripe", res.status, `${path}: ${text}`);
    }
    throw new ProviderResponseAmbiguousError("Stripe", res.status, `${path}: ${text}`);
  }
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

async function stripeGet(
  fetchFn: typeof fetch,
  secretKey: string,
  path: string,
): Promise<Record<string, unknown>> {
  const res = await fetchFn(`https://api.stripe.com/v1/${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secretKey}`, "Stripe-Version": STRIPE_API_VERSION },
    signal: AbortSignal.timeout(STRIPE_API_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) {
      throw new ProviderSendRejectedError("Stripe", res.status, `${path}: ${text}`);
    }
    throw new ProviderResponseAmbiguousError("Stripe", res.status, `${path}: ${text}`);
  }
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function unixSecondsToIso(value: unknown): string | null {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

export async function createStripeCustomer(
  fetchFn: typeof fetch,
  cfg: StripeConfig,
  input: { orgId: string; name: string; email?: string | null },
): Promise<string> {
  const params: Record<string, string> = {
    name: input.name,
    "metadata[org_id]": input.orgId,
  };
  if (input.email) params.email = input.email;
  const json = await stripeForm(
    fetchFn,
    cfg.secretKey,
    "customers",
    params,
    `stripe-customer:${input.orgId}`,
  );
  const id = typeof json.id === "string" ? json.id : "";
  if (!id) throw new Error("Stripe customer missing id");
  return id;
}

export async function createCheckoutSession(
  fetchFn: typeof fetch,
  cfg: StripeConfig,
  input: { orgId: string; attemptId: string; customerId: string; successUrl: string; cancelUrl: string },
): Promise<{ sessionId: string; url: string; expiresAt: string }> {
  const json = await stripeForm(fetchFn, cfg.secretKey, "checkout/sessions", {
    mode: "subscription",
    customer: input.customerId,
    client_reference_id: input.orgId,
    "line_items[0][price]": cfg.priceId,
    "line_items[0][quantity]": "1",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "metadata[org_id]": input.orgId,
    "metadata[attempt_id]": input.attemptId,
    "subscription_data[metadata][org_id]": input.orgId,
    "subscription_data[metadata][attempt_id]": input.attemptId,
  }, `billing-checkout:${input.attemptId}`);
  const url = typeof json.url === "string" ? json.url : "";
  if (!url) throw new Error("Stripe checkout missing url");
  const sessionId = typeof json.id === "string" ? json.id : "";
  if (!sessionId) throw new Error("Stripe checkout missing session id");
  const expiresAt = unixSecondsToIso(json.expires_at);
  if (!expiresAt) throw new Error("Stripe checkout missing expiry");
  return { sessionId, url, expiresAt };
}

export type StripeSubscription = {
  id: string;
  customerId: string;
  status: string;
  currentPeriodEnd: string | null;
  orgId: string | null;
  attemptId: string | null;
};

export function assertStripeSubscriptionWorkspace(
  subscription: StripeSubscription,
  expected: { orgId: string; customerId?: string | null },
): void {
  if (subscription.orgId !== expected.orgId) {
    throw new Error("Stripe subscription workspace metadata mismatch");
  }
  if (expected.customerId && subscription.customerId !== expected.customerId) {
    throw new Error("Stripe subscription customer mismatch");
  }
}

export async function retrieveStripeSubscription(
  fetchFn: typeof fetch,
  cfg: StripeConfig,
  subscriptionId: string,
): Promise<StripeSubscription> {
  const json = await stripeGet(
    fetchFn,
    cfg.secretKey,
    `subscriptions/${encodeURIComponent(subscriptionId)}`,
  );
  const id = typeof json.id === "string" ? json.id : "";
  const customer = json.customer;
  const customerId = typeof customer === "string"
    ? customer
    : typeof customer === "object" && customer !== null && typeof (customer as { id?: unknown }).id === "string"
      ? (customer as { id: string }).id
      : "";
  const status = typeof json.status === "string" ? json.status : "";
  if (!id || !customerId || !status) throw new Error("Stripe subscription missing required fields");
  const metadata = json.metadata;
  const orgId = typeof metadata === "object"
    && metadata !== null
    && typeof (metadata as { org_id?: unknown }).org_id === "string"
    ? (metadata as { org_id: string }).org_id
    : null;
  const attemptId = typeof metadata === "object"
    && metadata !== null
    && typeof (metadata as { attempt_id?: unknown }).attempt_id === "string"
    ? (metadata as { attempt_id: string }).attempt_id
    : null;
  return {
    id,
    customerId,
    status,
    currentPeriodEnd: unixSecondsToIso(json.current_period_end),
    orgId,
    attemptId,
  };
}

export async function createBillingPortalSession(
  fetchFn: typeof fetch,
  cfg: StripeConfig,
  input: { customerId: string; returnUrl: string },
): Promise<string> {
  const json = await stripeForm(fetchFn, cfg.secretKey, "billing_portal/sessions", {
    customer: input.customerId,
    return_url: input.returnUrl,
  });
  const url = typeof json.url === "string" ? json.url : "";
  if (!url) throw new Error("Stripe portal missing url");
  return url;
}
