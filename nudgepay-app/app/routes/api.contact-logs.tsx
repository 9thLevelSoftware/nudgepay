import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { parseContactLogForm } from "../lib/contact-log";

// Resolve a safe same-origin redirect target. We only accept an app-relative
// path (must start with a single "/", not "//") to avoid open-redirects.
function safeReturnTo(raw: FormData): string {
  const v = raw.get("returnTo");
  if (typeof v === "string" && v.startsWith("/") && !v.startsWith("//")) return v;
  return "/dashboard";
}

function withError(returnTo: string, code: string): string {
  const sep = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${sep}logError=${encodeURIComponent(code)}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form);

  const parsed = parseContactLogForm(form);
  if (!parsed.ok) return redirect(withError(returnTo, parsed.error), { headers });
  const f = parsed.fields;

  // Cross-org guard: the RLS user client can only read invoices in the caller's
  // org, so a foreign invoice_id returns no row even though contact_logs RLS
  // would otherwise accept the insert (it only checks org_id).
  const { data: inv } = await supabase
    .from("invoices").select("id").eq("id", f.invoiceId).maybeSingle();
  if (!inv) return redirect(withError(returnTo, "missing-invoice"), { headers });

  const { error } = await supabase.from("contact_logs").insert({
    org_id: org.org_id,
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

  return redirect(returnTo, { headers });
}
