import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";
import { CHANNELS, type Channel } from "../lib/comm-prefs";

// Pure: shape the submitted form into the customers update. Deliberately OMITS
// sms_consent — the legal consent record is governed solely by STOP/START, never
// by a preferences write. Unknown/empty preferred_channel -> null (no preference).
export function parseCommPrefsUpdate(form: FormData): {
  preferred_channel: Channel | null;
  do_not_call: boolean;
  do_not_text: boolean;
} {
  const raw = form.get("preferred_channel");
  const ch = typeof raw === "string" ? raw : "";
  return {
    preferred_channel: (CHANNELS as readonly string[]).includes(ch) ? (ch as Channel) : null,
    do_not_call: form.get("do_not_call") === "true",
    do_not_text: form.get("do_not_text") === "true",
  };
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
  if (!invoiceId) return redirect(returnTo, { headers });

  // RLS-scoped: a member can only read invoices in their org, so a foreign
  // invoiceId resolves to nothing and updates nothing. Identical to api.sms-consent.
  const { data: inv } = await supabase
    .from("invoices").select("customer_id").eq("id", invoiceId).maybeSingle();
  if (!inv?.customer_id) return redirect(returnTo, { headers });

  const { error } = await supabase.from("customers")
    .update(parseCommPrefsUpdate(form)).eq("id", inv.customer_id as string);
  if (error) return redirect(returnTo, { headers });

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
