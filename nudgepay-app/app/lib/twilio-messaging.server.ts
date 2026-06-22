import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSms, type TwilioConfig, type TwilioSender } from "./twilio-client.server";

export type MessagingDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;
  twilio: TwilioConfig;
  defaultSender: TwilioSender;
  statusCallback?: string | null;
};

// US-oriented: compare on the last 10 digits. (A normalized phone column is a
// future optimization if multi-country support is added.)
export function normalizePhone(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "").slice(-10);
}

export async function resolveSender(
  service: SupabaseClient, orgId: string, defaultSender: TwilioSender,
): Promise<TwilioSender> {
  const { data } = await service.from("messaging_config")
    .select("messaging_service_sid, sender").eq("org_id", orgId).maybeSingle();
  if (data?.messaging_service_sid) return { messagingServiceSid: data.messaging_service_sid as string };
  if (data?.sender) return { from: data.sender as string };
  return defaultSender;
}

export async function sendInvoiceText(
  deps: MessagingDeps,
  args: { orgId: string; invoiceId: string; userId: string; body: string },
): Promise<{ id: string; sid: string; status: string }> {
  const { data: inv, error: invErr } = await deps.service.from("invoices")
    .select("customer_id").eq("org_id", args.orgId).eq("id", args.invoiceId).maybeSingle();
  if (invErr) throw invErr;
  if (!inv?.customer_id) throw new Error("Invoice has no linked customer");

  const { data: cust, error: custErr } = await deps.service.from("customers")
    .select("id, phone, sms_consent").eq("id", inv.customer_id as string).maybeSingle();
  if (custErr) throw custErr;
  if (!cust?.phone) throw new Error("Customer has no phone number");
  if (!cust.sms_consent) throw new Error("Customer has not consented to SMS");

  const sender = await resolveSender(deps.service, args.orgId, deps.defaultSender);
  const result = await sendSms(deps.fetchFn, deps.twilio, {
    to: cust.phone as string, body: args.body, sender, statusCallback: deps.statusCallback ?? null,
  });

  // The nil UUID is not a valid auth.users FK target (Supabase rejects it at
  // the DB level). Treat it — and any blank value — as "no real user" (e.g.
  // cron-triggered system sends). Callers that supply a real user UUID are
  // stored as-is so UI attribution still works.
  const NIL_UUID = "00000000-0000-0000-0000-000000000000";
  const sentByUserId = args.userId && args.userId !== NIL_UUID ? args.userId : null;

  const { data: row, error: insErr } = await deps.service.from("text_messages").insert({
    org_id: args.orgId,
    invoice_id: args.invoiceId,
    customer_id: cust.id as string,
    sent_by_user_id: sentByUserId,
    direction: "outbound",
    twilio_message_sid: result.sid,
    status: result.status,
    from_number: "from" in sender ? sender.from : null,
    to_number: cust.phone as string,
    body: args.body,
  }).select("id").single();
  if (insErr) throw insErr;

  return { id: row!.id as string, sid: result.sid, status: result.status };
}
