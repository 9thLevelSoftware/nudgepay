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

  const { data: current, error: curErr } = await supabase
    .from("customers")
    .select("sms_consent, sms_consent_source")
    .eq("org_id", org.org_id)
    .eq("id", customerId)
    .maybeSingle();
  if (curErr || !current) return redirect(withSms(returnTo, "error"), { headers });

  const reason = typeof form.get("reason") === "string" ? (form.get("reason") as string).trim() : "";
  const overrideStop = consent === true && current.sms_consent_source === "inbound_stop";
  if (overrideStop) {
    if (org.role !== "owner" || reason.length < 3) {
      return redirect(withSms(returnTo, "consent_locked"), { headers });
    }
  }

  const { error } = await supabase
    .from("customers")
    .update({
      sms_consent: consent,
      sms_consent_source: "staff",
      sms_consent_at: new Date().toISOString(),
      sms_consent_actor: user.id,
      sms_consent_reason: overrideStop ? reason : null,
      // Inbound STOP also sets do_not_text; the SMS gate and inbox canReply
      // prioritize it, so override must restore a sendable state atomically.
      ...(overrideStop ? { do_not_text: false } : {}),
    })
    .eq("org_id", org.org_id)
    .eq("id", customerId);
  if (error) return redirect(withSms(returnTo, "error"), { headers });

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
