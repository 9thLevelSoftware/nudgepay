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

  // Cross-org guard: the case must belong to the caller's org. RLS lets the user
  // client read only own-org cases, so a foreign caseId returns no row.
  const { data: cse } = await supabase
    .from("collection_cases").select("id").eq("id", f.caseId).maybeSingle();
  if (!cse) return data({ ok: false as const, error: "missing-case" }, { status: 400, headers });

  // If an invoice was sub-selected, validate it too (own-org only).
  if (f.invoiceId) {
    const { data: inv } = await supabase
      .from("invoices").select("id").eq("id", f.invoiceId).maybeSingle();
    if (!inv) return data({ ok: false as const, error: "missing-invoice" }, { status: 400, headers });
  }

  const { data: logRow, error } = await supabase.from("contact_logs").insert({
    org_id: org.org_id,
    case_id: f.caseId,
    invoice_id: f.invoiceId,
    customer_id: f.customerId,
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
      orgId: org.org_id, caseId: f.caseId, customerId: f.customerId, userId: user.id,
      contactLogId, promisedAmount: f.promisedAmount, promisedDate: f.promisedDate,
    });
    if (!res.ok) return data({ ok: false as const, error: "save-failed" }, { status: 400, headers });
  } else {
    const res = await applyNextStep(supabase, f.caseId, f);
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
