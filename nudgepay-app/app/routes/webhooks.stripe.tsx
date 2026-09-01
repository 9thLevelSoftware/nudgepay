import type { ActionFunctionArgs } from "react-router";
import { getEnv, getStripeEnvOrNull } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { billingPatchFromStripeEvent, verifyStripeSignature } from "../lib/stripe-webhook.server";
import { parseBillingStatus } from "../lib/billing";

export async function action({ request, context }: ActionFunctionArgs) {
  const stripe = getStripeEnvOrNull(context as any);
  if (!stripe) return new Response("unconfigured", { status: 503 });
  const raw = await request.text();
  const ok = await verifyStripeSignature(
    stripe.STRIPE_WEBHOOK_SECRET,
    request.headers.get("stripe-signature"),
    raw,
  );
  if (!ok) return new Response("invalid signature", { status: 401 });

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 204 });
  }

  const patch = billingPatchFromStripeEvent(event);
  if (!patch) return new Response(null, { status: 204 });

  try {
    const service = createSupabaseServiceClient(getEnv(context as any));
    const row: Record<string, unknown> = {
      org_id: patch.orgId,
      status: parseBillingStatus(patch.status),
      updated_at: new Date().toISOString(),
    };
    if (patch.stripeCustomerId) row.stripe_customer_id = patch.stripeCustomerId;
    if (patch.stripeSubscriptionId) row.stripe_subscription_id = patch.stripeSubscriptionId;
    if (patch.currentPeriodEnd) row.current_period_end = patch.currentPeriodEnd;
    const { error } = await service.from("org_billing").upsert(row);
    if (error) throw error;
  } catch (err) {
    console.error("Stripe webhook processing failed", err);
    return new Response("processing error", { status: 500 });
  }
  return new Response(null, { status: 204 });
}

export function loader() {
  return new Response("method not allowed", { status: 405 });
}
