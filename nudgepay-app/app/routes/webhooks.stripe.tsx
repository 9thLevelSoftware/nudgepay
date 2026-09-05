import type { ActionFunctionArgs } from "react-router";
import { getEnv, getStripeEnvOrNull } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { billingPatchFromStripeEvent, verifyStripeSignature } from "../lib/stripe-webhook.server";
import { parseBillingStatus } from "../lib/billing";
import { assertStripeSubscriptionWorkspace, retrieveStripeSubscription } from "../lib/stripe.server";
import { safeErrorDetails } from "../lib/log-redaction";

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
    let status = patch.status;
    let customerId = patch.stripeCustomerId;
    let subscriptionId = patch.stripeSubscriptionId;
    let currentPeriodEnd = patch.currentPeriodEnd;
    let checkoutAttemptId = patch.checkoutAttemptId;
    if (subscriptionId) {
      const { data: existing, error: existingError } = await service.from("org_billing")
        .select("stripe_customer_id")
        .eq("org_id", patch.orgId)
        .maybeSingle();
      if (existingError) throw existingError;
      const canonical = await retrieveStripeSubscription(fetch, {
        secretKey: stripe.STRIPE_SECRET_KEY,
        priceId: stripe.STRIPE_PRICE_ID,
      }, subscriptionId);
      if (canonical.id !== subscriptionId) {
        throw new Error("Stripe subscription identity does not match webhook workspace");
      }
      assertStripeSubscriptionWorkspace(canonical, {
        orgId: patch.orgId,
        customerId: (existing?.stripe_customer_id as string | null) ?? null,
      });
      if (patch.eventType === "checkout.session.completed") {
        if (checkoutAttemptId && canonical.attemptId && checkoutAttemptId !== canonical.attemptId) {
          throw new Error("Stripe checkout attempt metadata mismatch");
        }
        // Both the Session and canonical Subscription must bind an app-created
        // checkout before its durable attempt can be completed.
        checkoutAttemptId = checkoutAttemptId && canonical.attemptId === checkoutAttemptId
          ? checkoutAttemptId
          : null;
      } else if (patch.eventType === "customer.subscription.created") {
        if (checkoutAttemptId && canonical.attemptId && checkoutAttemptId !== canonical.attemptId) {
          throw new Error("Stripe subscription attempt metadata mismatch");
        }
        checkoutAttemptId = canonical.attemptId;
      } else {
        checkoutAttemptId = null;
      }
      status = canonical.status;
      customerId = canonical.customerId;
      subscriptionId = canonical.id;
      currentPeriodEnd = canonical.currentPeriodEnd;
    }
    const { error } = await service.rpc("apply_stripe_billing_event", {
      p_event_id: patch.eventId,
      p_event_created_at: patch.eventCreatedAt,
      p_event_type: patch.eventType,
      p_org_id: patch.orgId,
      p_status: parseBillingStatus(status),
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: subscriptionId,
      p_current_period_end: currentPeriodEnd,
      p_checkout_attempt_id: checkoutAttemptId,
      p_checkout_session_id: patch.checkoutSessionId,
    });
    if (error) throw error;
  } catch (err) {
    console.error({
      event: "stripe_webhook_processing_failed",
      requestId: request.headers.get("x-request-id") ?? request.headers.get("cf-ray") ?? undefined,
      ...safeErrorDetails(err),
    });
    return new Response("processing error", { status: 500 });
  }
  return new Response(null, { status: 204 });
}

export function loader() {
  return new Response("method not allowed", { status: 405 });
}
