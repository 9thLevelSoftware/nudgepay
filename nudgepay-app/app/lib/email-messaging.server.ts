import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, type EmailConfig } from "./email-client.server";
import { legacySendAttemptIdentity, sendAttemptIdentity } from "./send-limits";
import { AmbiguousSendError, ProviderSendRejectedError } from "./provider-send-error";
import { signUnsubscribeToken } from "./unsubscribe-token";
import {
  activeCaseForSend,
  activeCaseId,
  loadQuietHoursWindow,
  type QuietHoursWindow,
} from "./twilio-messaging.server";
import { isContactBlocked } from "./exceptions";
import { assertFromAddressAllowed } from "./email-settings";
import { isWithinSendWindow, quietHoursWindowLabel } from "./quiet-hours";

export type EmailDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;
  email: EmailConfig;
  unsubscribeBaseUrl: string; // APP_PUBLIC_BASE_URL (non-null at call site)
  unsubscribeSecret: string;
  /** Pre-fetched quiet-hours window; when absent, sendInvoiceEmail reads org_settings. */
  quietHoursWindow?: QuietHoursWindow;
  /** Injectable "now" for the quiet-hours check — defaults to `new Date()`. Test-only override. */
  now?: Date;
};

function formatSender(fromAddress: string, fromName: string): string {
  return fromName ? `${fromName} <${fromAddress}>` : fromAddress;
}

export async function sendInvoiceEmail(
  deps: EmailDeps,
  args: { orgId: string; invoiceId: string; userId: string; subject: string; body: string; submissionId?: string },
): Promise<{ id: string; providerMessageId: string }> {
  const { data: inv, error: invErr } = await deps.service.from("invoices")
    .select("customer_id").eq("org_id", args.orgId).eq("id", args.invoiceId).maybeSingle();
  if (invErr) throw invErr;
  if (!inv?.customer_id) throw new Error("Invoice has no linked customer");

  const { data: cust, error: custErr } = await deps.service.from("customers")
    .select("id, email, do_not_email, erased_at")
    .eq("org_id", args.orgId)
    .eq("id", inv.customer_id as string)
    .maybeSingle();
  if (custErr) throw custErr;
  if (cust?.erased_at) throw new Error("Customer personal data was erased");
  if (!cust?.email) throw new Error("Customer has no email address");

  // Org-level email switch. Absent row => DISABLED (email defaults off). Fail loud
  // on DB error so a silent null cannot bypass the gate (Phase 14 PR #21 lesson).
  const { data: ec, error: ecErr } = await deps.service.from("email_config")
    .select("email_enabled, from_address, from_name, postal_address").eq("org_id", args.orgId).maybeSingle();
  if (ecErr) throw ecErr;
  if (!ec || ec.email_enabled !== true) throw new Error("Email disabled for this workspace");
  if (!ec.from_address) throw new Error("No from address configured");
  assertFromAddressAllowed(ec.from_address as string, deps.email.allowedFrom, args.orgId);

  const window = deps.quietHoursWindow ?? await loadQuietHoursWindow(deps.service, args.orgId);
  const now = deps.now ?? new Date();
  if (!isWithinSendWindow(now, window.timezone, window.startHour, window.endHour)) {
    throw new Error(`Quiet hours: emails can be sent only between ${quietHoursWindowLabel(window.startHour, window.endHour)} (${window.timezone})`);
  }

  // Contact-block (case legal hold) dominates the per-customer opt-out, mirroring SMS.
  const activeCase = await activeCaseForSend(deps.service, args.orgId, cust.id as string);
  if (isContactBlocked(activeCase.exceptionReason)) {
    throw new Error(`Contact blocked: ${activeCase.exceptionReason}`);
  }
  if (cust.do_not_email) throw new Error("Customer has opted out of email");

  const token = await signUnsubscribeToken(deps.unsubscribeSecret, args.orgId, cust.id as string);
  const unsubUrl = `${deps.unsubscribeBaseUrl}/unsubscribe?token=${token}`;
  const postal = ((ec.postal_address as string | null) ?? "").trim();
  if (!postal) throw new Error("Postal address required");
  const footerLines = ["—", postal, `To stop receiving these emails, unsubscribe: ${unsubUrl}`];
  const bodyWithFooter = `${args.body}\n\n${footerLines.join("\n")}`;
  const from = formatSender(ec.from_address as string, (ec.from_name as string | null) ?? "");
  const safetyParts = [
    args.orgId,
    args.invoiceId,
    cust.email as string,
    args.subject,
    args.body,
  ];
  const providerParts = [
    args.orgId,
    args.invoiceId,
    from,
    cust.email as string,
    args.subject,
    bodyWithFooter,
    `<${unsubUrl}>`,
    "List-Unsubscribe=One-Click",
  ];
  const safetyIdentity = args.submissionId
    ? sendAttemptIdentity("email", safetyParts, args.submissionId)
    : legacySendAttemptIdentity("email", safetyParts, now);
  const providerIdentity = args.submissionId
    ? sendAttemptIdentity("email-provider", providerParts, args.submissionId)
    : legacySendAttemptIdentity("email-provider", providerParts, now);
  const reserveArgs = {
    p_org_id: args.orgId,
    p_invoice_id: args.invoiceId,
    p_customer_id: cust.id as string,
    p_case_id: activeCase.id,
    p_sent_by_user_id: args.userId,
    p_from_address: ec.from_address as string,
    p_to_address: cust.email as string,
    p_subject: args.subject,
    p_body: bodyWithFooter,
    p_send_fingerprint: safetyIdentity.fingerprint,
    p_send_dedupe_key: safetyIdentity.dedupeKey,
    p_provider_idempotency_key: providerIdentity.dedupeKey,
    p_now: now.toISOString(),
    ...(args.submissionId ? { p_submission_id: args.submissionId } : {}),
  };
  const { data: reserved, error: reserveError } = await deps.service.rpc("reserve_email_send", reserveArgs);
  if (reserveError) throw reserveError;
  const attempt = reserved as {
    state?: "reserved" | "recorded" | "terminal" | "unknown" | "mismatch" | "org_cap" | "customer_cap";
    id?: string;
    provider_id?: string | null;
    provider_key?: string | null;
  } | null;
  if (attempt?.state === "org_cap") throw new Error("Send rate cap reached for this workspace");
  if (attempt?.state === "customer_cap") throw new Error("Send rate cap reached for this customer");
  if (attempt?.state === "mismatch") throw new Error("Send submission identity belongs to a different send");
  if (attempt?.state === "recorded" && attempt.id && attempt.provider_id) {
    return { id: attempt.id, providerMessageId: attempt.provider_id };
  }
  if (attempt?.state === "terminal") {
    throw new Error("Previous delivery failed; operator reconciliation is required before retry");
  }
  if (attempt?.state !== "reserved" || !attempt.id) throw new AmbiguousSendError();

  let result: Awaited<ReturnType<typeof sendEmail>>;
  try {
    result = await sendEmail(deps.fetchFn, deps.email, {
      from, to: cust.email as string, subject: args.subject, text: bodyWithFooter,
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      idempotencyKey: attempt.provider_key ?? providerIdentity.dedupeKey,
    });
  } catch (err) {
    if (err instanceof ProviderSendRejectedError) {
      const { data: deleted, error } = await deps.service.from("email_messages")
        .delete().eq("org_id", args.orgId).eq("id", attempt.id).eq("status", "sending")
        .select("id").maybeSingle();
      if (error || !deleted) throw new AmbiguousSendError();
      throw err;
    }
    const { data: markedUnknown, error: unknownError } = await deps.service.from("email_messages")
      .update({ status: "unknown", error_code: "transport_ambiguous" })
      .eq("org_id", args.orgId).eq("id", attempt.id).eq("status", "sending")
      .select("id").maybeSingle();
    if (unknownError || !markedUnknown) {
      console.error({ event: "email_ambiguous_attempt_persist_failed", attemptId: attempt.id });
    }
    throw new AmbiguousSendError();
  }

  const { data: updated, error: updateError } = await deps.service.from("email_messages").update({
    provider_message_id: result.id,
    status: "sent",
    error_code: null,
  }).eq("org_id", args.orgId).eq("id", attempt.id).eq("status", "sending")
    .select("id").maybeSingle();
  if (updateError || !updated) throw new AmbiguousSendError();

  return { id: attempt.id, providerMessageId: result.id };
}

// Extract a bare email address from a "Name <addr>" or bare string; lowercase+trim.
export function normalizeEmail(s: string | null | undefined): string {
  const raw = (s ?? "").trim();
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

export async function updateEmailStatus(
  service: SupabaseClient,
  args: { providerMessageId: string; status: string; errorCode: string | null; optOut: boolean },
): Promise<void> {
  if (!args.providerMessageId) return;
  const predecessors: Record<string, readonly string[]> = {
    sent: ["sending", "unknown", "sent"],
    delayed: ["sending", "unknown", "sent", "delayed"],
    delivered: ["sending", "unknown", "sent", "delayed", "delivered"],
    failed: ["sending", "unknown", "sent", "delayed", "failed"],
    bounced: ["sending", "unknown", "sent", "delayed", "failed", "bounced"],
    complained: ["sending", "unknown", "sent", "delayed", "delivered", "failed", "bounced", "complained"],
  };
  const status = args.status.trim().toLowerCase();
  const allowed = predecessors[status];
  if (!allowed) return;
  const { data: rows, error } = await service
    .from("email_messages")
    .update({ status, error_code: args.errorCode })
    .eq("provider_message_id", args.providerMessageId)
    .or(`status.is.null,status.in.(${allowed.join(",")})`)
    .select("customer_id, org_id");
  if (error) throw error;
  if (!args.optOut) return;
  let optOutRows = rows ?? [];
  if (optOutRows.length === 0) {
    const { data: existing, error: existingError } = await service
      .from("email_messages")
      .select("customer_id, org_id")
      .eq("provider_message_id", args.providerMessageId);
    if (existingError) throw existingError;
    optOutRows = existing ?? [];
  }
  for (const r of optOutRows) {
    if (!r.customer_id) continue;
    const { error: upErr } = await service
      .from("customers")
      .update({ do_not_email: true })
      .eq("org_id", r.org_id as string)
      .eq("id", r.customer_id as string);
    if (upErr) throw upErr;
  }
}

export async function alreadyRecordedInboundEmail(
  service: SupabaseClient,
  providerMessageId: string,
): Promise<{ matched: boolean } | null> {
  if (!providerMessageId) return null;
  const { data: dup, error: dupErr } = await service
    .from("email_messages")
    .select("id")
    .eq("provider_message_id", providerMessageId)
    .limit(1)
    .maybeSingle();
  if (dupErr) throw dupErr;
  if (dup) return { matched: true };
  const { data: orphanDup, error: orphanErr } = await service
    .from("inbound_orphans")
    .select("id")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  if (orphanErr) throw orphanErr;
  if (orphanDup) return { matched: false };
  return null;
}

export async function recordInboundEmail(
  service: SupabaseClient,
  args: { from: string; to: string; subject: string; body: string; providerMessageId: string },
): Promise<{ matched: boolean }> {
  const fromNorm = normalizeEmail(args.from);
  if (!fromNorm) return { matched: false };

  const toNorm = normalizeEmail(args.to);
  if (!toNorm) return { matched: false };

  // Idempotency: Resend retries an event it does not see 2xx'd, and a signed
  // payload can be replayed within the ±5min window. Skip if we already recorded
  // this provider event (the unique index on provider_message_id is the backstop).
  const recorded = await alreadyRecordedInboundEmail(service, args.providerMessageId);
  if (recorded) return recorded;

  // Ambiguous (2) is unmatched, same as none. Include disabled configs so a
  // later reply to a previously sent message still routes, and so two orgs
  // sharing an address (one disabled) stay ambiguous rather than flipping
  // attribution when outbound is toggled.
  const { data: configs, error: configErr } = await service
    .from("email_config")
    .select("org_id, from_address")
    .eq("from_address_norm", toNorm)
    .limit(2);
  if (configErr) throw configErr;
  if ((configs ?? []).length !== 1) {
    await persistEmailOrphan(service, args);
    return { matched: false };
  }
  const orgId = configs![0].org_id as string;

  const { data: matches, error: candErr } = await service
    .from("customers")
    .select("id, org_id")
    .eq("org_id", orgId)
    .eq("email_norm", fromNorm)
    .limit(2);
  if (candErr) throw candErr;
  if ((matches ?? []).length !== 1) {
    await persistEmailOrphan(service, args);
    return { matched: false };
  }
  const match = matches![0];

  // Thread to the customer's most recent outbound invoice, if any.
  const { data: lastOut, error: lastOutErr } = await service
    .from("email_messages")
    .select("invoice_id")
    .eq("customer_id", match.id as string)
    .eq("direction", "outbound")
    .not("invoice_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Fail loud: a swallowed read error here would silently thread the inbound row
  // with invoice_id=null instead of surfacing the failure (plan fail-loud constraint).
  if (lastOutErr) throw lastOutErr;

  const caseId = await activeCaseId(service, match.org_id as string, match.id as string);

  const { error: insErr } = await service.from("email_messages").insert({
    org_id: match.org_id as string,
    customer_id: match.id as string,
    case_id: caseId,
    invoice_id: (lastOut?.invoice_id as string) ?? null,
    direction: "inbound",
    provider_message_id: args.providerMessageId,
    from_address: args.from,
    to_address: args.to,
    subject: args.subject,
    body: args.body,
  });
  if (insErr) {
    // Unique violation => a concurrent retry already recorded this event between
    // our dedup check and insert. Idempotent success, not a 500 retry-loop.
    if ((insErr as { code?: string }).code === "23505") return { matched: true };
    throw insErr;
  }

  return { matched: true };
}

async function persistEmailOrphan(
  service: SupabaseClient,
  args: { from: string; to: string; subject: string; body: string; providerMessageId: string },
): Promise<void> {
  const { error } = await service.from("inbound_orphans").insert({
    channel: "email",
    from_address: args.from,
    to_address: args.to,
    subject: args.subject,
    body: args.body,
    provider_message_id: args.providerMessageId || null,
    from_number: null,
    to_number: null,
  });
  if (error && (error as { code?: string }).code !== "23505") throw error;
  if (!error) {
    console.error({
      event: "inbound_orphan_email",
      providerMessageId: args.providerMessageId,
    });
  }
}
