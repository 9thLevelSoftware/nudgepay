import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getPublicBaseUrls, getStripeEnvOrNull } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { createBillingPortalSession } from "../lib/stripe.server";
import { safeReturnTo } from "../lib/return-to";

function flag(returnTo: string, key: string, val: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}${key}=${val}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id, request);
  if (!org) throw redirect("/onboarding", { headers });
  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"), "/settings?tab=billing");
  if (org.role !== "owner") return redirect(flag(returnTo, "billing", "forbidden"), { headers });

  const stripe = getStripeEnvOrNull(context as any);
  if (!stripe) return redirect(flag(returnTo, "billing", "unconfigured"), { headers });

  const service = createSupabaseServiceClient(env);
  const { data: billing } = await service.from("org_billing")
    .select("stripe_customer_id").eq("org_id", org.org_id).maybeSingle();
  const customerId = (billing?.stripe_customer_id as string | null) ?? "";
  if (!customerId) return redirect(flag(returnTo, "billing", "none"), { headers });

  const base = (getPublicBaseUrls(context as any).appBaseUrl ?? new URL(request.url).origin).replace(/\/$/, "");
  try {
    const url = await createBillingPortalSession(fetch, {
      secretKey: stripe.STRIPE_SECRET_KEY,
      priceId: stripe.STRIPE_PRICE_ID,
    }, {
      customerId,
      returnUrl: `${base}/settings?tab=billing`,
    });
    return redirect(url, { headers });
  } catch {
    return redirect(flag(returnTo, "billing", "error"), { headers });
  }
}

export function loader() {
  return redirect("/settings?tab=billing");
}
