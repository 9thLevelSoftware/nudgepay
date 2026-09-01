import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo, withSms } from "../lib/return-to";
import { parseCommPrefsUpdate } from "../lib/comm-prefs";

export { parseCommPrefsUpdate };

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id, request);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const custRaw = form.get("customerId");
  const directCustomerId = typeof custRaw === "string" ? custRaw : "";
  const caseRaw = form.get("caseId");
  const caseId = typeof caseRaw === "string" ? caseRaw : "";
  const invRaw = form.get("invoiceId");
  const invoiceId = typeof invRaw === "string" ? invRaw : "";

  // Communication preferences are customer-level. Try a bare customerId first
  // (Accounts profile path), then fall back to caseId, then invoiceId. All reads
  // are explicit org-scoped (defense in depth on top of RLS), so a foreign id
  // resolves to nothing and updates nothing.
  let customerId: string | null = null;
  if (directCustomerId) {
    const { data: cust } = await supabase
      .from("customers").select("id").eq("org_id", org.org_id).eq("id", directCustomerId).maybeSingle();
    customerId = (cust?.id as string | undefined) ?? null;
  }
  if (!customerId && caseId) {
    const { data: cse } = await supabase
      .from("collection_cases")
      .select("customer_id")
      .eq("org_id", org.org_id)
      .eq("id", caseId)
      .maybeSingle();
    customerId = (cse?.customer_id as string | undefined) ?? null;
  }
  if (!customerId && invoiceId) {
    const { data: inv } = await supabase
      .from("invoices")
      .select("customer_id")
      .eq("org_id", org.org_id)
      .eq("id", invoiceId)
      .maybeSingle();
    customerId = (inv?.customer_id as string | undefined) ?? null;
  }
  if (!customerId) return redirect(returnTo, { headers });

  const patch = parseCommPrefsUpdate(form);
  let stopLocked = false;
  if (patch.do_not_text === false) {
    const { data: current, error: srcErr } = await supabase
      .from("customers")
      .select("sms_consent_source")
      .eq("org_id", org.org_id)
      .eq("id", customerId)
      .maybeSingle();
    if (srcErr) throw new Error(`Failed to read communication preferences: ${srcErr.message}`);
    // STOP undo is the owner+reason restore on /api/sms-consent. Prefs confirm
    // is for collector DNT only — posting it on inbound_stop must not 500
    // against prevent_inbound_stop_unlock (0047).
    if (current?.sms_consent_source === "inbound_stop") {
      delete patch.do_not_text;
      stopLocked = true;
    }
  }

  const { error } = await supabase.from("customers")
    .update(patch).eq("org_id", org.org_id).eq("id", customerId);
  if (error) {
    if (error.code === "42501" || /inbound STOP|STOP-sourced/i.test(error.message)) {
      return redirect(withSms(returnTo, "consent_locked"), { headers });
    }
    throw new Error(`Failed to save communication preferences: ${error.message}`);
  }
  if (stopLocked) return redirect(withSms(returnTo, "consent_locked"), { headers });

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
