import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSms, type TwilioConfig, type TwilioSender } from "./twilio-client.server";
import { assertSmsBudget } from "./send-limits.server";
import { sendIdempotencyKey } from "./send-limits";
import { isContactBlocked, type ExceptionState } from "./exceptions";
import { isWithinSendWindow, resolveQuietHours, quietHoursWindowLabel } from "./quiet-hours";
import { DEFAULT_COMPANY_PROFILE } from "./org-profile";
import {
  classifyInboundSms,
  ensureStopLanguage,
  twimlForKeyword,
  type InboundKeyword,
} from "./sms-keywords";

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
  /** When true, send fails closed unless the org has an active inventory row. */
  requireInventory?: boolean;
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
  service: SupabaseClient,
  orgId: string,
  defaultSender: TwilioSender,
  opts?: { requireInventory?: boolean },
): Promise<TwilioSender> {
  const { data, error } = await service
    .from("sms_sender_inventory")
    .select("messaging_service_sid, from_number")
    .eq("org_id", orgId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  const sid = typeof data?.messaging_service_sid === "string" ? data.messaging_service_sid.trim() : "";
  if (sid) return { messagingServiceSid: sid };
  const from = typeof data?.from_number === "string" ? data.from_number.trim() : "";
  if (from) return { from };
  if (opts?.requireInventory) throw new Error("SMS sender not provisioned");
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

  const sender = await resolveSender(deps.service, args.orgId, deps.defaultSender, {
    requireInventory: deps.requireInventory,
  });
  const caseId = activeCase.id;
  const body = ensureStopLanguage(args.body);
  await assertSmsBudget(deps.service, { orgId: args.orgId, customerId: cust.id as string, now });
  const result = await sendSms(deps.fetchFn, deps.twilio, {
    to: cust.phone as string, body, sender, statusCallback: deps.statusCallback ?? null,
    idempotencyKey: sendIdempotencyKey("sms", [args.orgId, args.invoiceId, body], now),
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
    body,
  }).select("id").single();
  if (insErr) throw insErr;

  return { id: row!.id as string, sid: result.sid, status: result.status };
}

async function uniqueOutboundOrg(
  service: SupabaseClient,
  fromNorm: string,
  toNorm: string,
): Promise<string | null> {
  const { data: outbound, error: outboundErr } = await service.from("text_messages")
    .select("org_id")
    .eq("direction", "outbound")
    .eq("to_number_norm", fromNorm)
    .or(`from_number_norm.is.null,from_number_norm.eq."${toNorm}"`);
  if (outboundErr) throw outboundErr;
  const orgIds = new Set((outbound ?? []).map((msg) => msg.org_id as string));
  return orgIds.size === 1 ? [...orgIds][0]! : null;
}

function canonicalSid(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

async function resolveInboundOrgId(service: SupabaseClient, args: {
  from: string;
  to: string;
  messagingServiceSid?: string;
  fallbackFrom?: string;
  fallbackMessagingServiceSid?: string;
}): Promise<string | null> {
  const sid = canonicalSid(args.messagingServiceSid);
  const fallbackSid = canonicalSid(args.fallbackMessagingServiceSid);
  const overlapsFallbackSid = Boolean(sid && fallbackSid && sid === fallbackSid);

  let sidOrgs: string[] = [];
  if (sid) {
    const { data: sidHits, error: sidErr } = await service
      .from("sms_sender_inventory")
      .select("org_id, messaging_service_sid")
      .eq("status", "active")
      .not("messaging_service_sid", "is", null);
    if (sidErr) throw sidErr;
    sidOrgs = [...new Set(
      (sidHits ?? [])
        .filter((row) => canonicalSid(row.messaging_service_sid as string) === sid)
        .map((row) => row.org_id as string),
    )];
    if (sidOrgs.length > 1) return null;
    if (sidOrgs.length === 1 && !overlapsFallbackSid) return sidOrgs[0];
  }

  const toNorm = normalizePhone(args.to);
  const fromNorm = normalizePhone(args.from);
  const fallbackNorm = args.fallbackFrom ? normalizePhone(args.fallbackFrom) : "";
  const overlapsFallbackFrom = fallbackNorm.length >= 10 && fallbackNorm === toNorm;
  const overlapsFallback = overlapsFallbackFrom || overlapsFallbackSid;

  let invOrgs: string[] = [];
  if (toNorm.length >= 10) {
    const { data: inventoryHits, error: invErr } = await service
      .from("sms_sender_inventory")
      .select("org_id")
      .eq("status", "active")
      .eq("from_number_last10", toNorm)
      .limit(2);
    if (invErr) throw invErr;
    invOrgs = [...new Set((inventoryHits ?? []).map((row) => row.org_id as string))];
    if (invOrgs.length > 1) return null;
    if (invOrgs.length === 1 && !overlapsFallback) return invOrgs[0];
  }

  if (fromNorm.length < 10) return null;
  const historyOrg = toNorm.length >= 10 ? await uniqueOutboundOrg(service, fromNorm, toNorm) : null;
  if (historyOrg) return historyOrg;
  if (overlapsFallback) return null;
  return invOrgs[0] ?? sidOrgs[0] ?? null;
}

export type InboundResult = {
  matched: boolean;
  optOut: boolean;
  keyword: InboundKeyword;
  twiml: string | null;
};

async function alreadyRecordedInbound(service: SupabaseClient, messageSid: string): Promise<boolean> {
  if (!messageSid) return false;
  const { data: msg, error: msgErr } = await service
    .from("text_messages")
    .select("id")
    .eq("twilio_message_sid", messageSid)
    .eq("direction", "inbound")
    .limit(1)
    .maybeSingle();
  if (msgErr) throw msgErr;
  if (msg) return true;
  const { data: orphan, error: orphanErr } = await service
    .from("inbound_orphans")
    .select("id")
    .eq("twilio_message_sid", messageSid)
    .maybeSingle();
  if (orphanErr) throw orphanErr;
  return Boolean(orphan);
}

export type OrphanStopInfo = {
  event: "inbound_orphan_stop";
  from: string;
  to: string;
  sid: string;
};

async function persistOrphan(
  service: SupabaseClient,
  args: {
    from: string;
    to: string;
    body: string;
    messageSid: string;
    keyword: InboundKeyword;
    onOrphanStop?: (info: OrphanStopInfo) => void;
  },
): Promise<void> {
  const { error } = await service.from("inbound_orphans").insert({
    from_number: args.from,
    to_number: args.to,
    body: args.body,
    twilio_message_sid: args.messageSid || null,
    keyword: args.keyword,
  });
  if (error && (error as { code?: string }).code !== "23505") throw error;
  if (!error && args.keyword === "stop") {
    (args.onOrphanStop ?? console.error)({
      event: "inbound_orphan_stop",
      from: args.from,
      to: args.to,
      sid: args.messageSid,
    });
  }
}

async function applyKeywordByPhone(
  service: SupabaseClient,
  fromNorm: string,
  keyword: InboundKeyword,
): Promise<void> {
  if (keyword !== "stop" && keyword !== "start") return;
  const now = new Date().toISOString();
  const patch = keyword === "stop"
    ? {
        sms_consent: false,
        do_not_text: true,
        sms_consent_source: "inbound_stop",
        sms_consent_at: now,
        sms_consent_actor: null,
        sms_consent_reason: null,
      }
    : {
        sms_consent: true,
        do_not_text: false,
        sms_consent_source: "inbound_start",
        sms_consent_at: now,
      };
  const { error } = await service.from("customers").update(patch).eq("phone_last10", fromNorm);
  if (error) throw error;
}

async function loadOrgName(service: SupabaseClient, orgId: string | null): Promise<string> {
  if (!orgId) return "";
  const { data, error } = await service.from("organizations").select("name").eq("id", orgId).maybeSingle();
  if (error) throw error;
  return (data?.name as string) ?? "";
}

export async function recordInboundMessage(
  service: SupabaseClient,
  args: {
    from: string;
    to: string;
    body: string;
    messageSid: string;
    messagingServiceSid?: string;
    fallbackFrom?: string;
    fallbackMessagingServiceSid?: string;
    onOrphanStop?: (info: OrphanStopInfo) => void;
  },
): Promise<InboundResult> {
  const keyword = classifyInboundSms(args.body);
  const optOut = keyword === "stop";

  if (await alreadyRecordedInbound(service, args.messageSid)) {
    return { matched: true, optOut: false, keyword, twiml: twimlForKeyword(keyword, "") };
  }

  const fromNorm = normalizePhone(args.from);
  if (fromNorm.length >= 10 && (keyword === "stop" || keyword === "start")) {
    await applyKeywordByPhone(service, fromNorm, keyword);
  }

  const orgId = await resolveInboundOrgId(service, {
    from: args.from,
    to: args.to,
    messagingServiceSid: args.messagingServiceSid,
    fallbackFrom: args.fallbackFrom,
    fallbackMessagingServiceSid: args.fallbackMessagingServiceSid,
  });
  const name = await loadOrgName(service, orgId);
  const twiml = twimlForKeyword(keyword, name);

  if (!orgId || fromNorm.length < 10) {
    await persistOrphan(service, { ...args, keyword });
    return { matched: false, optOut, keyword, twiml };
  }

  const { data: matches, error: matchErr } = await service.from("customers")
    .select("id")
    .eq("org_id", orgId)
    .eq("phone_last10", fromNorm);
  if (matchErr) throw matchErr;
  const match = matches?.[0];
  if (!match) {
    await persistOrphan(service, { ...args, keyword });
    return { matched: false, optOut, keyword, twiml };
  }

  const { data: lastOut, error: lastOutErr } = await service.from("text_messages")
    .select("invoice_id")
    .eq("org_id", orgId)
    .eq("customer_id", match.id as string)
    .eq("direction", "outbound")
    .not("invoice_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
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
    if ((insErr as { code?: string }).code === "23505") {
      return { matched: true, optOut, keyword, twiml };
    }
    throw insErr;
  }

  return { matched: true, optOut, keyword, twiml };
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
