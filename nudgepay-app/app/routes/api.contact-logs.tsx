import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { parseContactLogForm } from "../lib/contact-log";
import { safeReturnTo } from "../lib/return-to";
import { createPromiseForLog } from "../lib/promise-create.server";

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
  // when a follow-up date was given, sets it as the next action. This case update
  // IS the durable next-action write, so a failed update must surface rather than
  // redirecting success and silently leaving the case in "new".
  const caseUpdate: Record<string, unknown> = { status: "working" };
  if (f.followUpAt) {
    caseUpdate.next_action_type = "follow_up";
    caseUpdate.next_action_at = f.followUpAt;
  }
  const { error: caseErr } = await supabase
    .from("collection_cases").update(caseUpdate).eq("id", f.caseId);
  if (caseErr) return redirect(withError(returnTo, "save-failed"), { headers });

  if (f.outcome === "promise-to-pay" && f.promisedAmount != null && f.promisedDate != null) {
    const res = await createPromiseForLog(supabase, {
      orgId: org.org_id, caseId: f.caseId, customerId: f.customerId, userId: user.id,
      contactLogId: null, promisedAmount: f.promisedAmount, promisedDate: f.promisedDate,
    });
    if (!res.ok) return redirect(withError(returnTo, "save-failed"), { headers });
  }

  return redirect(returnTo, { headers });
}
