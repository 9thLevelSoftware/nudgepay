import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getEmailEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { sendInvoiceEmail, type EmailDeps } from "../lib/email-messaging.server";
import { safeReturnTo, withEmail } from "../lib/return-to";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const emailEnv = getEmailEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const invoiceId = typeof form.get("invoiceId") === "string" ? (form.get("invoiceId") as string) : "";
  const subject = typeof form.get("subject") === "string" ? (form.get("subject") as string).trim() : "";
  const body = typeof form.get("body") === "string" ? (form.get("body") as string).trim() : "";
  if (!invoiceId || !subject || !body) return redirect(withEmail(returnTo, "error"), { headers });
  if (!emailEnv.APP_PUBLIC_BASE_URL) return redirect(withEmail(returnTo, "error"), { headers });

  const service = createSupabaseServiceClient(env);
  const deps: EmailDeps = {
    fetchFn: fetch,
    service,
    email: { apiKey: emailEnv.RESEND_API_KEY },
    unsubscribeBaseUrl: emailEnv.APP_PUBLIC_BASE_URL,
    unsubscribeSecret: emailEnv.UNSUBSCRIBE_SECRET,
  };
  try {
    await sendInvoiceEmail(deps, { orgId: org.org_id, invoiceId, userId: user.id, subject, body });
    return redirect(withEmail(returnTo, "sent"), { headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    const reason = /disabled/i.test(msg) ? "disabled"
      : /blocked/i.test(msg) ? "blocked"
      : /opted out/i.test(msg) ? "optout"
      : "error";
    return redirect(withEmail(returnTo, reason), { headers });
  }
}

export function loader() {
  return redirect("/dashboard");
}
