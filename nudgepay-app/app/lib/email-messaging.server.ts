import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, type EmailConfig } from "./email-client.server";
import { signUnsubscribeToken } from "./unsubscribe-token";
import { activeCaseForSend } from "./twilio-messaging.server";
import { isContactBlocked } from "./exceptions";

export type EmailDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;
  email: EmailConfig;
  unsubscribeBaseUrl: string; // APP_PUBLIC_BASE_URL (non-null at call site)
  unsubscribeSecret: string;
};

function formatSender(fromAddress: string, fromName: string): string {
  return fromName ? `${fromName} <${fromAddress}>` : fromAddress;
}

export async function sendInvoiceEmail(
  deps: EmailDeps,
  args: { orgId: string; invoiceId: string; userId: string; subject: string; body: string },
): Promise<{ id: string; providerMessageId: string }> {
  const { data: inv, error: invErr } = await deps.service.from("invoices")
    .select("customer_id").eq("org_id", args.orgId).eq("id", args.invoiceId).maybeSingle();
  if (invErr) throw invErr;
  if (!inv?.customer_id) throw new Error("Invoice has no linked customer");

  const { data: cust, error: custErr } = await deps.service.from("customers")
    .select("id, email, do_not_email").eq("id", inv.customer_id as string).maybeSingle();
  if (custErr) throw custErr;
  if (!cust?.email) throw new Error("Customer has no email address");

  // Org-level email switch. Absent row => DISABLED (email defaults off). Fail loud
  // on DB error so a silent null cannot bypass the gate (Phase 14 PR #21 lesson).
  const { data: ec, error: ecErr } = await deps.service.from("email_config")
    .select("email_enabled, from_address, from_name").eq("org_id", args.orgId).maybeSingle();
  if (ecErr) throw ecErr;
  if (!ec || ec.email_enabled !== true) throw new Error("Email disabled for this workspace");
  if (!ec.from_address) throw new Error("No from address configured");

  // Contact-block (case legal hold) dominates the per-customer opt-out, mirroring SMS.
  const activeCase = await activeCaseForSend(deps.service, args.orgId, cust.id as string);
  if (isContactBlocked(activeCase.exceptionReason)) {
    throw new Error(`Contact blocked: ${activeCase.exceptionReason}`);
  }
  if (cust.do_not_email) throw new Error("Customer has opted out of email");

  const token = await signUnsubscribeToken(deps.unsubscribeSecret, args.orgId, cust.id as string);
  const unsubUrl = `${deps.unsubscribeBaseUrl}/unsubscribe?token=${token}`;
  const bodyWithFooter = `${args.body}\n\n—\nTo stop receiving these emails, unsubscribe: ${unsubUrl}`;
  const from = formatSender(ec.from_address as string, (ec.from_name as string | null) ?? "");

  const result = await sendEmail(deps.fetchFn, deps.email, {
    from, to: cust.email as string, subject: args.subject, text: bodyWithFooter,
  });

  const { data: row, error: insErr } = await deps.service.from("email_messages").insert({
    org_id: args.orgId,
    invoice_id: args.invoiceId,
    customer_id: cust.id as string,
    case_id: activeCase.id,
    sent_by_user_id: args.userId,
    direction: "outbound",
    provider_message_id: result.id,
    status: "sent",
    from_address: ec.from_address as string,
    to_address: cust.email as string,
    subject: args.subject,
    body: bodyWithFooter,
  }).select("id").single();
  if (insErr) throw insErr;

  return { id: row!.id as string, providerMessageId: result.id };
}
