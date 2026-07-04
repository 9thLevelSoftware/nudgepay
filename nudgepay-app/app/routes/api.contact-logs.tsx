import { data, redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { parseContactLogForm } from "../lib/contact-log";
import { safeReturnTo } from "../lib/return-to";
import { createPromiseForLog } from "../lib/promise-create.server";
import { applyNextStep } from "../lib/next-step.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));

  const parsed = parseContactLogForm(form);
  if (!parsed.ok) return data({ ok: false as const, error: parsed.error }, { status: 400, headers });
  const f = parsed.fields;

  // Active-org guard: a multi-org user can read cases in multiple orgs through
  // RLS, so bind submitted object ids to the dashboard org explicitly.
  const { data: cse } = await supabase
    .from("collection_cases")
    .select("id, customer_id")
    .eq("org_id", org.org_id)
    .eq("id", f.caseId)
    .maybeSingle();
  if (!cse) return data({ ok: false as const, error: "missing-case" }, { status: 400, headers });
  const customerId = cse.customer_id as string;
  if (f.customerId && f.customerId !== customerId) {
    return data({ ok: false as const, error: "missing-customer" }, { status: 400, headers });
  }

  // If an invoice was sub-selected, validate it too (own-org only).
  if (f.invoiceId) {
    const { data: inv } = await supabase
      .from("invoices")
      .select("id")
      .eq("org_id", org.org_id)
      .eq("id", f.invoiceId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (!inv) return data({ ok: false as const, error: "missing-invoice" }, { status: 400, headers });
  }

  const { data: logRow, error } = await supabase.from("contact_logs").insert({
    org_id: org.org_id,
    case_id: f.caseId,
    invoice_id: f.invoiceId,
    customer_id: customerId,
    user_id: user.id,
    method: f.method,
    outcome: f.outcome,
    notes: f.notes,
    follow_up_at: f.nextStep === "follow_up" ? f.followUpAt : null,
    promised_amount: f.nextStep === "promise" ? f.promisedAmount : null,
    promised_date: f.nextStep === "promise" ? f.promisedDate : null,
  }).select("id").single();
  if (error || !logRow) return data({ ok: false as const, error: "save-failed" }, { status: 400, headers });
  const contactLogId: string = logRow.id;

  if (f.nextStep === "promise" && f.promisedAmount != null && f.promisedDate != null) {
    const res = await createPromiseForLog(supabase, {
      orgId: org.org_id, caseId: f.caseId, customerId, userId: user.id,
      contactLogId, promisedAmount: f.promisedAmount, promisedDate: f.promisedDate,
    });
    if (!res.ok) return data({ ok: false as const, error: "save-failed" }, { status: 400, headers });
  } else {
    const res = await applyNextStep(supabase, org.org_id, f.caseId, f);
    if (!res.ok) return data({ ok: false as const, error: "save-failed" }, { status: 400, headers });
  }

  // Focus Mode (and future fetcher callers) opt into a JSON response so the
  // page can stay mounted and advance client-side.
  if (form.get("respond") === "json") {
    return data({ ok: true as const }, { headers });
  }

  const sep = returnTo.includes("?") ? "&" : "?";
  return redirect(`${returnTo}${sep}saved=1`, { headers });
}
