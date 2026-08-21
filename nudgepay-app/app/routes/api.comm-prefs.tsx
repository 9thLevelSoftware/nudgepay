import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";
import { parseCommPrefsUpdate } from "../lib/comm-prefs";

export { parseCommPrefsUpdate };

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
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

  const { error } = await supabase.from("customers")
    .update(parseCommPrefsUpdate(form)).eq("org_id", org.org_id).eq("id", customerId);
  // Fail loud on a write error (matches api.assign / api.account-notes) — a silent
  // redirect would imply the preferences saved when they didn't.
  if (error) throw new Error(`Failed to save communication preferences: ${error.message}`);

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
