import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getPublicBaseUrls, getStripeEnvOrNull } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { createCheckoutSession, createStripeCustomer } from "../lib/stripe.server";
import { safeReturnTo } from "../lib/return-to";
import { hasPermission } from "../lib/roles";
import { ProviderSendRejectedError } from "../lib/provider-send-error";
import { safeErrorDetails } from "../lib/log-redaction";

function flag(returnTo: string, key: string, val: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}${key}=${val}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id, request, headers);
  if (!org) throw redirect("/onboarding", { headers });
  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"), "/settings?tab=billing");
  if (!hasPermission(org.role, "manageWorkspace")) return redirect(flag(returnTo, "billing", "forbidden"), { headers });

  const stripe = getStripeEnvOrNull(context as any);
  if (!stripe) return redirect(flag(returnTo, "billing", "unconfigured"), { headers });

  const service = createSupabaseServiceClient(env);
  const { data: reservation, error: reservationError } = await service.rpc("reserve_billing_checkout", {
    p_org_id: org.org_id,
    p_user_id: user.id,
  });
  if (reservationError) return redirect(flag(returnTo, "billing", "error"), { headers });
  const attempt = reservation as {
    state?: "reserved" | "ready" | "in_progress" | "unknown" | "blocked_subscription";
    attempt_id?: string;
    checkout_url?: string;
  } | null;
  if (attempt?.state === "ready" && attempt.checkout_url) {
    return redirect(attempt.checkout_url, { headers });
  }
  if (attempt?.state === "blocked_subscription") {
    return redirect(flag(returnTo, "billing", "existing"), { headers });
  }
  if (attempt?.state === "in_progress" || attempt?.state === "unknown") {
    return redirect(flag(returnTo, "billing", "pending"), { headers });
  }
  if (attempt?.state !== "reserved" || !attempt.attempt_id) {
    return redirect(flag(returnTo, "billing", "error"), { headers });
  }

  const finishAttempt = async (
    state: "ready" | "unknown" | "failed",
    checkoutUrl: string | null,
    checkoutSessionId: string | null,
    expiresAt: string | null,
    errorCode: string | null,
  ) => service.rpc("finish_billing_checkout", {
    p_org_id: org.org_id,
    p_attempt_id: attempt.attempt_id,
    p_state: state,
    p_checkout_url: checkoutUrl,
    p_checkout_session_id: checkoutSessionId,
    p_expires_at: expiresAt,
    p_error_code: errorCode,
  });

  try {
    const { data: orgRow, error: orgError } = await service.from("organizations")
      .select("name").eq("id", org.org_id).maybeSingle();
    if (orgError) throw orgError;
    const { data: billing, error: billingError } = await service.from("org_billing")
      .select("stripe_customer_id").eq("org_id", org.org_id).maybeSingle();
    if (billingError) throw billingError;
    let customerId = (billing?.stripe_customer_id as string | null) ?? null;
    if (!customerId) {
      customerId = await createStripeCustomer(fetch, {
        secretKey: stripe.STRIPE_SECRET_KEY,
        priceId: stripe.STRIPE_PRICE_ID,
      }, {
        orgId: org.org_id,
        name: ((orgRow?.name as string) ?? "").trim() || "Workspace",
        email: user.email ?? null,
      });
    }

    const { data: bound, error: bindError } = await service.rpc("set_billing_customer_if_unsubscribed", {
      p_org_id: org.org_id,
      p_user_id: user.id,
      p_stripe_customer_id: customerId,
    });
    if (bindError) throw bindError;
    if (bound !== true) {
      await finishAttempt("failed", null, null, null, "subscription_exists");
      return redirect(flag(returnTo, "billing", "existing"), { headers });
    }

    const base = (getPublicBaseUrls(context as any).appBaseUrl ?? new URL(request.url).origin).replace(/\/$/, "");
    const checkout = await createCheckoutSession(fetch, {
      secretKey: stripe.STRIPE_SECRET_KEY,
      priceId: stripe.STRIPE_PRICE_ID,
    }, {
      orgId: org.org_id,
      attemptId: attempt.attempt_id,
      customerId,
      successUrl: `${base}/settings?tab=billing&billing=success`,
      cancelUrl: `${base}/settings?tab=billing&billing=cancel`,
    });
    const { data: finished, error: finishError } = await finishAttempt(
      "ready",
      checkout.url,
      checkout.sessionId,
      checkout.expiresAt,
      null,
    );
    if (finishError || finished !== true) {
      return redirect(flag(returnTo, "billing", "pending"), { headers });
    }
    return redirect(checkout.url, { headers });
  } catch (err) {
    const rejected = err instanceof ProviderSendRejectedError;
    const { error: finishError } = await finishAttempt(
      rejected ? "failed" : "unknown",
      null,
      null,
      null,
      rejected ? `provider_${err.status}` : "transport_ambiguous",
    );
    if (finishError) {
      console.error({
        event: "billing_checkout_attempt_persist_failed",
        requestId: request.headers.get("x-request-id") ?? request.headers.get("cf-ray") ?? undefined,
        ...safeErrorDetails(finishError),
      });
    }
    return redirect(flag(returnTo, "billing", rejected ? "error" : "pending"), { headers });
  }
}

export function loader() {
  return redirect("/settings?tab=billing");
}
