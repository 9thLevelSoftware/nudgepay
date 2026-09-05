import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getEmailEnv, resendTransport } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { sendInvoiceEmail, type EmailDeps } from "../lib/email-messaging.server";
import { safeReturnTo, withEmail, withSendResult } from "../lib/return-to";
import { isSendSubmissionId } from "../lib/send-submission";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const emailEnv = getEmailEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id, request, headers);
  if (!org) return redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const invoiceId = typeof form.get("invoiceId") === "string" ? (form.get("invoiceId") as string) : "";
  const subject = typeof form.get("subject") === "string" ? (form.get("subject") as string).trim() : "";
  const body = typeof form.get("body") === "string" ? (form.get("body") as string).trim() : "";
  const submissionRaw = form.get("submissionId");
  const submissionId = isSendSubmissionId(submissionRaw) ? submissionRaw : null;
  const respond = (code: string) => redirect(
    submissionId ? withSendResult(returnTo, "email", code, submissionId) : withEmail(returnTo, code),
    { headers },
  );
  if (!invoiceId || !subject || !body || !submissionId) return respond("error");
  if (!emailEnv.APP_PUBLIC_BASE_URL) return respond("error");

  const service = createSupabaseServiceClient(env);
  const deps: EmailDeps = {
    fetchFn: fetch,
    service,
    email: resendTransport(emailEnv),
    unsubscribeBaseUrl: emailEnv.APP_PUBLIC_BASE_URL,
    unsubscribeSecret: emailEnv.UNSUBSCRIBE_SECRET,
  };
  try {
    await sendInvoiceEmail(deps, { orgId: org.org_id, invoiceId, userId: user.id, subject, body, submissionId });
    return respond("sent");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    const reason = /disabled/i.test(msg) ? "disabled"
      : /quiet/i.test(msg) ? "quiet"
      : /allowlist/i.test(msg) ? "from_allowlist"
      : /blocked/i.test(msg) ? "blocked"
      : /opted out/i.test(msg) ? "optout"
      : /rate cap/i.test(msg) ? "limited"
      : "error";
    return respond(reason);
  }
}

export function loader() {
  return redirect("/dashboard");
}
