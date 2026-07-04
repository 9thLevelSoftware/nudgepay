import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, type EmailConfig } from "./email-client.server";
import { signUnsubscribeToken } from "./unsubscribe-token";
import { activeCaseForSend, activeCaseId } from "./twilio-messaging.server";
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
    .select("id, email, do_not_email")
    .eq("org_id", args.orgId)
    .eq("id", inv.customer_id as string)
    .maybeSingle();
  if (custErr) throw custErr;
  if (!cust?.email) throw new Error("Customer has no email address");

  // Org-level email switch. Absent row => DISABLED (email defaults off). Fail loud
  // on DB error so a silent null cannot bypass the gate (Phase 14 PR #21 lesson).
  const { data: ec, error: ecErr } = await deps.service.from("email_config")
    .select("email_enabled, from_address, from_name, postal_address").eq("org_id", args.orgId).maybeSingle();
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
  // CAN-SPAM footer: physical postal address (when configured) + unsubscribe link.
  const postal = ((ec.postal_address as string | null) ?? "").trim();
  const footerLines = ["—"];
  if (postal) footerLines.push(postal);
  footerLines.push(`To stop receiving these emails, unsubscribe: ${unsubUrl}`);
  const bodyWithFooter = `${args.body}\n\n${footerLines.join("\n")}`;
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
  const { data: rows, error } = await service
    .from("email_messages")
    .update({ status: args.status, error_code: args.errorCode })
    .eq("provider_message_id", args.providerMessageId)
    .select("customer_id, org_id");
  if (error) throw error;
  if (!args.optOut) return;
  for (const r of rows ?? []) {
    if (!r.customer_id) continue;
    const { error: upErr } = await service
      .from("customers")
      .update({ do_not_email: true })
      .eq("org_id", r.org_id as string)
      .eq("id", r.customer_id as string);
    if (upErr) throw upErr;
  }
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
  if (args.providerMessageId) {
    const { data: dup, error: dupErr } = await service
      .from("email_messages")
      .select("id")
      .eq("provider_message_id", args.providerMessageId)
      .limit(1)
      .maybeSingle();
    if (dupErr) throw dupErr;
    if (dup) return { matched: true };
  }

  // Resolve the org that owns the recipient (args.to) address. This is the
  // org's configured outbound from_address and identifies the tenant uniquely.
  // Compare normalized strings in process instead of passing user-controlled
  // input to an ILIKE pattern operator; zero or multiple matches are ambiguous.
  const { data: configs, error: configErr } = await service
    .from("email_config")
    .select("org_id, from_address")
    .not("from_address", "is", null);
  if (configErr) throw configErr;
  const matchingConfigs = (configs ?? []).filter(
    (cfg) => normalizeEmail(cfg.from_address as string) === toNorm,
  );
  if (matchingConfigs.length !== 1) return { matched: false };
  const orgId = matchingConfigs[0].org_id as string;

  // Scope the sender lookup to the resolved org only — never query across tenants.
  const { data: candidates, error: candErr } = await service
    .from("customers")
    .select("id, org_id, email")
    .eq("org_id", orgId)
    .not("email", "is", null);
  if (candErr) throw candErr;
  const match = (candidates ?? []).find(
    (c) => normalizeEmail(c.email as string) === fromNorm,
  );
  if (!match) return { matched: false };

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
