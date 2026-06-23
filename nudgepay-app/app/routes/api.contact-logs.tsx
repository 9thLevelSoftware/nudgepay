import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { parseContactLogForm } from "../lib/contact-log";
import { safeReturnTo } from "../lib/return-to";

function withError(returnTo: string, code: string): string {
  const sep = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${sep}log=1&logError=${encodeURIComponent(code)}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));

  const parsed = parseContactLogForm(form);
  if (!parsed.ok) return redirect(withError(returnTo, parsed.error), { headers });
  const f = parsed.fields;

  // Cross-org guard: the case must belong to the caller's org. RLS lets the user
  // client read only own-org cases, so a foreign caseId returns no row.
  const { data: cse } = await supabase
    .from("collection_cases").select("id").eq("id", f.caseId).maybeSingle();
  if (!cse) return redirect(withError(returnTo, "missing-case"), { headers });

  // If an invoice was sub-selected, validate it too (own-org only).
  if (f.invoiceId) {
    const { data: inv } = await supabase
      .from("invoices").select("id").eq("id", f.invoiceId).maybeSingle();
    if (!inv) return redirect(withError(returnTo, "missing-invoice"), { headers });
  }

  const { error } = await supabase.from("contact_logs").insert({
    org_id: org.org_id,
    case_id: f.caseId,
    invoice_id: f.invoiceId,
    customer_id: f.customerId,
    user_id: user.id,
    method: f.method,
    outcome: f.outcome,
    notes: f.notes,
    follow_up_at: f.followUpAt,
    promised_amount: f.promisedAmount,
    promised_date: f.promisedDate,
  });
  if (error) return redirect(withError(returnTo, "save-failed"), { headers });

  // Keep next-action durable: a logged contact moves the case to "working" and,
  // when a follow-up date was given, sets it as the next action.
  if (f.followUpAt) {
    await supabase.from("collection_cases")
      .update({ status: "working", next_action_type: "follow_up", next_action_at: f.followUpAt })
      .eq("id", f.caseId);
  } else {
    await supabase.from("collection_cases")
      .update({ status: "working" })
      .eq("id", f.caseId);
  }

  return redirect(returnTo, { headers });
}
