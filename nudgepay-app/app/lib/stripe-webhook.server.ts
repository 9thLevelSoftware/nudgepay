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
  let timestamp = "";
  const signatures: string[] = [];
  for (const piece of header.split(",")) {
    const i = piece.indexOf("=");
    if (i <= 0) continue;
    const key = piece.slice(0, i).trim();
    const value = piece.slice(i + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1") signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;
  const ts = Number(timestamp);
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
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = toHex(new Uint8Array(sig));
  return signatures.some((candidate) => timingSafeEqual(expected, candidate.toLowerCase()));
}

export type StripeBillingPatch = {
  eventId: string;
  eventCreatedAt: string;
  eventType: string;
  orgId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: string;
  currentPeriodEnd: string | null;
  checkoutAttemptId: string | null;
  checkoutSessionId: string | null;
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
  const envelope = event as { id?: unknown; created?: unknown; type?: unknown; data?: { object?: Record<string, unknown> } };
  const eventId = str(envelope.id);
  const eventCreatedAt = unixToIso(envelope.created);
  const type = str(envelope.type);
  const obj = envelope.data?.object;
  if (!eventId || !eventCreatedAt || !obj) return null;

  if (type === "checkout.session.completed") {
    const metadata = obj.metadata as { org_id?: unknown; attempt_id?: unknown } | undefined;
    const orgId = str(obj.client_reference_id) || str(metadata?.org_id);
    if (!orgId) return null;
    const sub = obj.subscription;
    const subId = typeof sub === "string" ? sub : str((sub as { id?: unknown } | undefined)?.id);
    return {
      eventId,
      eventCreatedAt,
      eventType: type,
      orgId,
      stripeCustomerId: typeof obj.customer === "string" ? obj.customer : str((obj.customer as { id?: unknown } | undefined)?.id) || null,
      stripeSubscriptionId: subId || null,
      status: obj.mode === "subscription" ? "active" : "none",
      currentPeriodEnd: null,
      checkoutAttemptId: str(metadata?.attempt_id) || null,
      checkoutSessionId: str(obj.id) || null,
    };
  }

  if (
    type === "customer.subscription.created"
    || type === "customer.subscription.updated"
    || type === "customer.subscription.deleted"
  ) {
    const metadata = obj.metadata as { org_id?: unknown; attempt_id?: unknown } | undefined;
    const orgId = str(metadata?.org_id);
    if (!orgId) return null;
    const status = type === "customer.subscription.deleted" ? "canceled" : str(obj.status) || "none";
    return {
      eventId,
      eventCreatedAt,
      eventType: type,
      orgId,
      stripeCustomerId: typeof obj.customer === "string" ? obj.customer : null,
      stripeSubscriptionId: str(obj.id) || null,
      status,
      currentPeriodEnd: unixToIso(obj.current_period_end),
      checkoutAttemptId: str(metadata?.attempt_id) || null,
      checkoutSessionId: null,
    };
  }

  if (type === "invoice.paid" || type === "invoice.payment_failed") {
    const parent = obj.parent as {
      subscription_details?: {
        metadata?: { org_id?: unknown };
        subscription?: unknown;
      };
    } | undefined;
    const orgId = str((obj.metadata as { org_id?: unknown } | undefined)?.org_id)
      || str(parent?.subscription_details?.metadata?.org_id);
    if (!orgId) return null;
    const sub = obj.subscription ?? parent?.subscription_details?.subscription;
    const subId = typeof sub === "string" ? sub : str((sub as { id?: unknown } | undefined)?.id);
    return {
      eventId,
      eventCreatedAt,
      eventType: type,
      orgId,
      stripeCustomerId: typeof obj.customer === "string" ? obj.customer : null,
      stripeSubscriptionId: subId || null,
      status: type === "invoice.paid" ? "active" : "past_due",
      currentPeriodEnd: unixToIso(obj.period_end),
      checkoutAttemptId: null,
      checkoutSessionId: null,
    };
  }

  return null;
}
