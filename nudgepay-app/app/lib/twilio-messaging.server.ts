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

// The customer's currently-open collection case (one per customer, enforced by
// the partial unique index in 0009). Returns null if none is open.
export async function activeCaseId(
  service: SupabaseClient, orgId: string, customerId: string,
): Promise<string | null> {
  const { data } = await service.from("collection_cases")
    .select("id").eq("org_id", orgId).eq("customer_id", customerId).is("closed_at", null).maybeSingle();
  return (data?.id as string) ?? null;
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
  const caseId = await activeCaseId(deps.service, args.orgId, cust.id as string);
  const result = await sendSms(deps.fetchFn, deps.twilio, {
    to: cust.phone as string, body: args.body, sender, statusCallback: deps.statusCallback ?? null,
  });

  const { data: row, error: insErr } = await deps.service.from("text_messages").insert({
    org_id: args.orgId,
    invoice_id: args.invoiceId,
    customer_id: cust.id as string,
    case_id: caseId,
    sent_by_user_id: args.userId,
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

const STOP_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
const START_KEYWORDS = ["START", "YES", "UNSTOP"];

export async function recordInboundMessage(
  service: SupabaseClient,
  args: { from: string; to: string; body: string; messageSid: string },
): Promise<{ matched: boolean; optOut: boolean }> {
  const fromNorm = normalizePhone(args.from);
  if (fromNorm.length < 10) return { matched: false, optOut: false };

  // Match the sender to a customer by normalized phone. At Chancey scale this
  // in-memory match is fine; a normalized column would scale it later.
  const { data: candidates, error: candErr } = await service.from("customers")
    .select("id, org_id, phone").not("phone", "is", null);
  if (candErr) throw candErr;
  const match = (candidates ?? []).find((c) => normalizePhone(c.phone as string) === fromNorm);
  if (!match) return { matched: false, optOut: false };

  const keyword = args.body.trim().toUpperCase();
  const optOut = STOP_KEYWORDS.includes(keyword);
  if (optOut) {
    const { error } = await service.from("customers").update({ sms_consent: false }).eq("id", match.id as string);
    if (error) throw error;
  } else if (START_KEYWORDS.includes(keyword)) {
    const { error } = await service.from("customers").update({ sms_consent: true }).eq("id", match.id as string);
    if (error) throw error;
  }

  // Thread to the customer's most recent outbound invoice, if any.
  const { data: lastOut } = await service.from("text_messages")
    .select("invoice_id").eq("customer_id", match.id as string).eq("direction", "outbound")
    .not("invoice_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();

  const caseId = await activeCaseId(service, match.org_id as string, match.id as string);

  const { error: insErr } = await service.from("text_messages").insert({
    org_id: match.org_id as string,
    customer_id: match.id as string,
    case_id: caseId,
    invoice_id: (lastOut?.invoice_id as string) ?? null,
    direction: "inbound",
    twilio_message_sid: args.messageSid,
    from_number: args.from,
    to_number: args.to,
    body: args.body,
  });
  if (insErr) throw insErr;

  return { matched: true, optOut };
}

export async function updateMessageStatus(
  service: SupabaseClient,
  args: { messageSid: string; status: string; errorCode: string | null },
): Promise<void> {
  const { error } = await service.from("text_messages")
    .update({ status: args.status, error_code: args.errorCode })
    .eq("twilio_message_sid", args.messageSid);
  if (error) throw error;
}
