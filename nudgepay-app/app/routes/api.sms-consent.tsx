import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo, withSms } from "../lib/return-to";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const raw = form.get("invoiceId");
  const invoiceId = typeof raw === "string" ? raw : "";
  const rawCustomer = form.get("customerId");
  const customerIdForm = typeof rawCustomer === "string" ? rawCustomer : "";
  const consent = form.get("consent") === "true";

  // Resolve the target customer. Prefer the invoice (the dashboard/invoice path);
  // fall back to a bare customerId so the Messages tab can toggle consent on
  // invoice-less inbound-only threads (mirrors the api.comm-prefs bare-customerId
  // branch). Both are RLS-scoped: a foreign id resolves to nothing / updates nothing.
  let customerId: string | null = null;
  if (invoiceId) {
    const { data: inv } = await supabase
      .from("invoices")
      .select("customer_id")
      .eq("org_id", org.org_id)
      .eq("id", invoiceId)
      .maybeSingle();
    customerId = (inv?.customer_id as string) ?? null;
  } else if (customerIdForm) {
    const { data: cust } = await supabase
      .from("customers")
      .select("id")
      .eq("org_id", org.org_id)
      .eq("id", customerIdForm)
      .maybeSingle();
    customerId = (cust?.id as string | undefined) ?? null;
  }
  if (!customerId) return redirect(withSms(returnTo, "error"), { headers });

  const { error } = await supabase
    .from("customers")
    .update({ sms_consent: consent })
    .eq("org_id", org.org_id)
    .eq("id", customerId);
  if (error) return redirect(withSms(returnTo, "error"), { headers });

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
