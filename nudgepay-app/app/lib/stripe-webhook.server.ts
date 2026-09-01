// Stripe webhook signature (t=,v1= HMAC-SHA256 of `${t}.${rawBody}`).
// Web Crypto only — no node:crypto, no Stripe SDK.

const FIVE_MIN_MS = 5 * 60_000;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function verifyStripeSignature(
  secret: string,
  header: string | null,
  rawBody: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!secret || !header) return false;
  const parts: Record<string, string> = {};
  for (const piece of header.split(",")) {
    const i = piece.indexOf("=");
    if (i <= 0) continue;
    parts[piece.slice(0, i).trim()] = piece.slice(i + 1).trim();
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowMs - ts * 1000) > FIVE_MIN_MS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${t}.${rawBody}`),
  );
  return timingSafeEqual(toHex(new Uint8Array(sig)), v1.toLowerCase());
}

export type StripeBillingPatch = {
  orgId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: string;
  currentPeriodEnd: string | null;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function unixToIso(v: unknown): string | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

/** Pull org billing fields from a signed Stripe event object. */
export function billingPatchFromStripeEvent(event: unknown): StripeBillingPatch | null {
  if (!event || typeof event !== "object") return null;
  const type = str((event as { type?: unknown }).type);
  const obj = (event as { data?: { object?: Record<string, unknown> } }).data?.object;
  if (!obj) return null;

  if (type === "checkout.session.completed") {
    const orgId = str(obj.client_reference_id) || str((obj.metadata as { org_id?: unknown } | undefined)?.org_id);
    if (!orgId) return null;
    const sub = obj.subscription;
    const subId = typeof sub === "string" ? sub : str((sub as { id?: unknown } | undefined)?.id);
    return {
      orgId,
      stripeCustomerId: typeof obj.customer === "string" ? obj.customer : str((obj.customer as { id?: unknown } | undefined)?.id) || null,
      stripeSubscriptionId: subId || null,
      status: obj.mode === "subscription" ? "active" : "none",
      currentPeriodEnd: null,
    };
  }

  if (
    type === "customer.subscription.created"
    || type === "customer.subscription.updated"
    || type === "customer.subscription.deleted"
  ) {
    const orgId = str((obj.metadata as { org_id?: unknown } | undefined)?.org_id);
    if (!orgId) return null;
    const status = type === "customer.subscription.deleted" ? "canceled" : str(obj.status) || "none";
    return {
      orgId,
      stripeCustomerId: typeof obj.customer === "string" ? obj.customer : null,
      stripeSubscriptionId: str(obj.id) || null,
      status,
      currentPeriodEnd: unixToIso(obj.current_period_end),
    };
  }

  if (type === "invoice.paid" || type === "invoice.payment_failed") {
    const parent = obj.parent as { subscription_details?: { metadata?: { org_id?: unknown } } } | undefined;
    const orgId = str((obj.metadata as { org_id?: unknown } | undefined)?.org_id)
      || str(parent?.subscription_details?.metadata?.org_id);
    if (!orgId) return null;
    const sub = obj.subscription;
    const subId = typeof sub === "string" ? sub : str((sub as { id?: unknown } | undefined)?.id);
    return {
      orgId,
      stripeCustomerId: typeof obj.customer === "string" ? obj.customer : null,
      stripeSubscriptionId: subId || null,
      status: type === "invoice.paid" ? "active" : "past_due",
      currentPeriodEnd: unixToIso(obj.period_end),
    };
  }

  return null;
}
