import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getPublicBaseUrls, getStripeEnvOrNull } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { createCheckoutSession, createStripeCustomer } from "../lib/stripe.server";
import { safeReturnTo } from "../lib/return-to";
import { hasPermission } from "../lib/roles";

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
  if (!hasPermission(org.role, "manageWorkspace")) return redirect(flag(returnTo, "billing", "forbidden"), { headers });

  const stripe = getStripeEnvOrNull(context as any);
  if (!stripe) return redirect(flag(returnTo, "billing", "unconfigured"), { headers });

  const service = createSupabaseServiceClient(env);
  const { data: orgRow } = await service.from("organizations").select("name").eq("id", org.org_id).maybeSingle();
  const { data: billing } = await service.from("org_billing")
    .select("stripe_customer_id").eq("org_id", org.org_id).maybeSingle();
  let customerId = (billing?.stripe_customer_id as string | null) ?? null;
  if (!customerId) {
    customerId = await createStripeCustomer(fetch, {
      secretKey: stripe.STRIPE_SECRET_KEY,
      priceId: stripe.STRIPE_PRICE_ID,
    }, {
      orgId: org.org_id,
      name: ((orgRow?.name as string) ?? "").trim() || "Workspace",
      email: user.email ?? "",
    });
    const { error } = await service.from("org_billing").upsert({
      org_id: org.org_id,
      stripe_customer_id: customerId,
      status: "none",
      updated_at: new Date().toISOString(),
    });
    if (error) return redirect(flag(returnTo, "billing", "error"), { headers });
  }

  const base = (getPublicBaseUrls(context as any).appBaseUrl ?? new URL(request.url).origin).replace(/\/$/, "");
  try {
    const url = await createCheckoutSession(fetch, {
      secretKey: stripe.STRIPE_SECRET_KEY,
      priceId: stripe.STRIPE_PRICE_ID,
    }, {
      orgId: org.org_id,
      customerId,
      successUrl: `${base}/settings?tab=billing&billing=success`,
      cancelUrl: `${base}/settings?tab=billing&billing=cancel`,
    });
    return redirect(url, { headers });
  } catch {
    return redirect(flag(returnTo, "billing", "error"), { headers });
  }
}

export function loader() {
  return redirect("/settings?tab=billing");
}
