// Stripe REST client. Workers-friendly (fetch-only, no SDK). Fetch injected.

export const STRIPE_API_TIMEOUT_MS = 10_000;

export type StripeConfig = { secretKey: string; priceId: string };

async function stripeForm(
  fetchFn: typeof fetch,
  secretKey: string,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params);
  const res = await fetchFn(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(STRIPE_API_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Stripe ${path} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

export async function createStripeCustomer(
  fetchFn: typeof fetch,
  cfg: StripeConfig,
  input: { orgId: string; name: string; email: string },
): Promise<string> {
  const json = await stripeForm(fetchFn, cfg.secretKey, "customers", {
    name: input.name,
    email: input.email,
    "metadata[org_id]": input.orgId,
  });
  const id = typeof json.id === "string" ? json.id : "";
  if (!id) throw new Error("Stripe customer missing id");
  return id;
}

export async function createCheckoutSession(
  fetchFn: typeof fetch,
  cfg: StripeConfig,
  input: { orgId: string; customerId: string; successUrl: string; cancelUrl: string },
): Promise<string> {
  const json = await stripeForm(fetchFn, cfg.secretKey, "checkout/sessions", {
    mode: "subscription",
    customer: input.customerId,
    client_reference_id: input.orgId,
    "line_items[0][price]": cfg.priceId,
    "line_items[0][quantity]": "1",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "metadata[org_id]": input.orgId,
    "subscription_data[metadata][org_id]": input.orgId,
  });
  const url = typeof json.url === "string" ? json.url : "";
  if (!url) throw new Error("Stripe checkout missing url");
  return url;
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
