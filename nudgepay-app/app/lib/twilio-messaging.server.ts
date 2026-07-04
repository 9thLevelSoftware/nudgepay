import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSms, type TwilioConfig, type TwilioSender } from "./twilio-client.server";
import { isContactBlocked, type ExceptionState } from "./exceptions";
import { isWithinSendWindow, resolveQuietHours, quietHoursWindowLabel } from "./quiet-hours";
import { DEFAULT_COMPANY_PROFILE } from "./org-profile";

// Pre-resolved quiet-hours window, threaded through from the caller's already
// -loaded org config (bulk path) to avoid a repeat org_settings read per case
// (runBulkSms sends ≤50 cases through this same function per Phase 7 plan).
export type QuietHoursWindow = { timezone: string; startHour: number; endHour: number };

export type MessagingDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;
  twilio: TwilioConfig;
  defaultSender: TwilioSender;
  statusCallback?: string | null;
  /** Pre-fetched quiet-hours window; when absent, sendInvoiceText reads org_settings itself. */
  quietHoursWindow?: QuietHoursWindow;
  /** Injectable "now" for the quiet-hours check — defaults to `new Date()`. Test-only override. */
  now?: Date;
};

async function loadQuietHoursWindow(service: SupabaseClient, orgId: string): Promise<QuietHoursWindow> {
  const { data, error } = await service.from("org_settings")
    .select("timezone, sms_send_start_hour, sms_send_end_hour").eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  const { startHour, endHour } = resolveQuietHours(data as { sms_send_start_hour?: number | null; sms_send_end_hour?: number | null } | null);
  return {
    timezone: (data?.timezone as string | null) || DEFAULT_COMPANY_PROFILE.timezone,
    startHour,
    endHour,
  };
}

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
  const { data, error } = await service.from("collection_cases")
    .select("id").eq("org_id", orgId).eq("customer_id", customerId).is("closed_at", null).maybeSingle();
  // Don't swallow a DB error: a silent null would drop case_id and mis-attribute
  // the message. Surface it like the other reads in this module (e.g. invErr).
  if (error) throw error;
  return (data?.id as string) ?? null;
}

// Like activeCaseId but also returns the open case's exception state, for the
// outbound contact-block guard. Errors are surfaced, not swallowed.
export async function activeCaseForSend(
  service: SupabaseClient, orgId: string, customerId: string,
): Promise<{ id: string | null; exceptionReason: ExceptionState | null }> {
  const { data, error } = await service.from("collection_cases")
    .select("id, exception_reason").eq("org_id", orgId).eq("customer_id", customerId).is("closed_at", null).maybeSingle();
  if (error) throw error;
  return {
    id: (data?.id as string) ?? null,
    exceptionReason: (data?.exception_reason as ExceptionState | null) ?? null,
  };
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
    .select("id, phone, sms_consent, do_not_text")
    .eq("org_id", args.orgId)
    .eq("id", inv.customer_id as string)
    .maybeSingle();
  if (custErr) throw custErr;
  if (!cust?.phone) throw new Error("Customer has no phone number");

  // Org-level SMS switch (Phase 14). Absent row => enabled (default). This single
  // gate also covers /api/bulk-sms, which sends via this function.
  const { data: mc, error: mcErr } = await deps.service.from("messaging_config")
    .select("sms_enabled").eq("org_id", args.orgId).maybeSingle();
  // Don't swallow a DB error: a silent null would read as "enabled" and bypass the
  // org switch on this critical send path. Surface it like the other reads above.
  if (mcErr) throw mcErr;
  if (mc && mc.sms_enabled === false) throw new Error("SMS disabled for this workspace");

  // Quiet hours (Phase 7): org-configurable SMS send window, org-local time.
  // The bulk path threads a pre-fetched window through deps to avoid a repeat
  // org_settings read per case; the single-send path reads it here.
  const window = deps.quietHoursWindow ?? await loadQuietHoursWindow(deps.service, args.orgId);
  const now = deps.now ?? new Date();
  if (!isWithinSendWindow(now, window.timezone, window.startHour, window.endHour)) {
    throw new Error(`Quiet hours: texts can be sent only between ${quietHoursWindowLabel(window.startHour, window.endHour)} (${window.timezone})`);
  }

  if (!cust.sms_consent) throw new Error("Customer has not consented to SMS");

  // Contact-block (a do_not_contact / legal_agency case hold) takes precedence over
  // the per-customer SMS opt-out, mirroring resolveCallAction's call-path precedence
  // so both channels surface the case-level legal hold as the dominant block reason.
  // We therefore resolve the active case before the do_not_text short-circuit; the
  // extra query on the single-send path (one user action) is negligible.
  const activeCase = await activeCaseForSend(deps.service, args.orgId, cust.id as string);
  if (isContactBlocked(activeCase.exceptionReason)) {
    throw new Error(`Contact blocked: ${activeCase.exceptionReason}`);
  }
  if (cust.do_not_text) throw new Error("Customer has opted out of SMS");

  const sender = await resolveSender(deps.service, args.orgId, deps.defaultSender);
  const caseId = activeCase.id;
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

async function resolveInboundOrgId(service: SupabaseClient, args: { from: string; to: string }): Promise<string | null> {
  const toNorm = normalizePhone(args.to);
  if (toNorm.length < 10) return null;

  const { data: configs, error } = await service
    .from("messaging_config")
    .select("org_id, sender")
    .not("sender", "is", null);
  if (error) throw error;
  const senderMatches = (configs ?? []).filter((cfg) => normalizePhone(cfg.sender as string) === toNorm);
  if (senderMatches.length === 1) return senderMatches[0].org_id as string;
  if (senderMatches.length > 1) return null;

  // Some workspaces send with the global Twilio sender (TWILIO_FROM_NUMBER) or a
  // Messaging Service SID instead of a per-org messaging_config.sender. In those
  // configurations inbound replies still arrive at this signed Twilio webhook, but
  // there is no sender row to resolve. Fall back to the outbound message ledger:
  // match the replying customer phone to a prior outbound text, and require any
  // stored from_number to match Twilio's inbound To number. Messaging Service sends
  // store from_number as null, so they are accepted only when the outbound history
  // resolves to one org unambiguously.
  const fromNorm = normalizePhone(args.from);
  if (fromNorm.length < 10) return null;
  const { data: outbound, error: outboundErr } = await service.from("text_messages")
    .select("org_id, from_number, to_number")
    .eq("direction", "outbound")
    .or("to_number.eq.\"" + args.from + "\",to_number.eq.\"" + fromNorm + "\",to_number.eq.\"+1" + fromNorm + "\"")
    .order("created_at", { ascending: false })
    .limit(100);
  if (outboundErr) throw outboundErr;

  const orgIds = new Set((outbound ?? [])
    .filter((msg) => normalizePhone(msg.to_number as string) === fromNorm)
    .filter((msg) => !msg.from_number || normalizePhone(msg.from_number as string) === toNorm)
    .map((msg) => msg.org_id as string));
  return orgIds.size === 1 ? [...orgIds][0] : null;
}

export async function recordInboundMessage(
  service: SupabaseClient,
  args: { from: string; to: string; body: string; messageSid: string },
): Promise<{ matched: boolean; optOut: boolean }> {
  if (args.messageSid) {
    const { data: dup, error: dupErr } = await service
      .from("text_messages")
      .select("id")
      .eq("twilio_message_sid", args.messageSid)
      .eq("direction", "inbound")
      .limit(1)
      .maybeSingle();
    if (dupErr) throw dupErr;
    if (dup) return { matched: true, optOut: false };
  }

  const orgId = await resolveInboundOrgId(service, { from: args.from, to: args.to });
  if (!orgId) return { matched: false, optOut: false };

  const fromNorm = normalizePhone(args.from);
  if (fromNorm.length < 10) return { matched: false, optOut: false };

  // Match the sender to a customer inside the org resolved from Twilio's To
  // number. At Chancey scale this in-memory match is fine; a normalized column
  // would scale it later.
  const { data: candidates, error: candErr } = await service.from("customers")
    .select("id, org_id, phone")
    .eq("org_id", orgId)
    .not("phone", "is", null);
  if (candErr) throw candErr;
  const match = (candidates ?? []).find((c) => normalizePhone(c.phone as string) === fromNorm);
  if (!match) return { matched: false, optOut: false };

  const keyword = args.body.trim().toUpperCase();
  const optOut = STOP_KEYWORDS.includes(keyword);
  if (optOut) {
    const { error } = await service.from("customers")
      .update({ sms_consent: false })
      .eq("org_id", orgId)
      .eq("id", match.id as string);
    if (error) throw error;
  } else if (START_KEYWORDS.includes(keyword)) {
    const { error } = await service.from("customers")
      .update({ sms_consent: true })
      .eq("org_id", orgId)
      .eq("id", match.id as string);
    if (error) throw error;
  }

  // Thread to the customer's most recent outbound invoice, if any.
  const { data: lastOut, error: lastOutErr } = await service.from("text_messages")
    .select("invoice_id")
    .eq("org_id", orgId)
    .eq("customer_id", match.id as string)
    .eq("direction", "outbound")
    .not("invoice_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  // Fail loud: a swallowed read error would silently thread the inbound row with a
  // null invoice_id instead of surfacing the failure (matches the other reads here).
  if (lastOutErr) throw lastOutErr;

  const caseId = await activeCaseId(service, orgId, match.id as string);

  const { error: insErr } = await service.from("text_messages").insert({
    org_id: orgId,
    customer_id: match.id as string,
    case_id: caseId,
    invoice_id: (lastOut?.invoice_id as string) ?? null,
    direction: "inbound",
    twilio_message_sid: args.messageSid,
    from_number: args.from,
    to_number: args.to,
    body: args.body,
  });
  if (insErr) {
    if ((insErr as { code?: string }).code === "23505") return { matched: true, optOut };
    throw insErr;
  }

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
