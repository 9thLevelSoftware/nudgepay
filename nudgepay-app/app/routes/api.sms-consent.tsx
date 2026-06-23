import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";

function withSms(returnTo: string, code: string): string {
  const sep = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${sep}sms=${code}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const raw = form.get("invoiceId");
  const invoiceId = typeof raw === "string" ? raw : "";
  const consent = form.get("consent") === "true";
  if (!invoiceId) return redirect(withSms(returnTo, "error"), { headers });

  // RLS-scoped: a member can only read invoices in their org, so a foreign
  // invoiceId resolves to nothing and updates nothing.
  const { data: inv } = await supabase
    .from("invoices").select("customer_id").eq("id", invoiceId).maybeSingle();
  if (!inv?.customer_id) return redirect(withSms(returnTo, "error"), { headers });

  const { error } = await supabase
    .from("customers").update({ sms_consent: consent }).eq("id", inv.customer_id as string);
  if (error) return redirect(withSms(returnTo, "error"), { headers });

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
