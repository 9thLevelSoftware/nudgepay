import { sendInvoiceText, type MessagingDeps } from "./twilio-messaging.server";
import { partitionEligibility, renderCaseBody, clampBatch, type TextableCase, type RenderableCase } from "./bulk";
import { isContactBlocked, type ExceptionState } from "./exceptions";
import type { OrgConfig } from "./org-config";
import { smsSendReason } from "./sms-send-reason";
import { smsFlashCopy } from "./flash-copy";
import { orderPage, pageAll } from "./page-all";
import { deriveBulkSubmissionId } from "./send-submission";

export type BulkSmsFailure = { caseId: string; name: string; error: string };

/** `failed` always equals `failures.length` (missing-invoice is recorded as a failure). */
export type BulkSmsResult = { sent: number; failed: number; skipped: number; failures: BulkSmsFailure[] };

function emptyResult(): BulkSmsResult {
  return { sent: 0, failed: 0, skipped: 0, failures: [] };
}

function humanSafeSmsError(err: unknown): string {
  let message = "";
  if (err instanceof Error) message = err.message;
  else if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string") message = m;
  }
  return smsFlashCopy(smsSendReason(message));
}

type CaseForSend = TextableCase & RenderableCase & { representativeInvoiceId: string | null };

type CustomerRow = { id: string; name: string | null; phone: string | null; sms_consent: boolean | null; do_not_text: boolean | null };
type InvoiceRow = { id: string; qbo_doc_number: string | null; due_date: string | null; balance: number | string | null; customer_id: string };

// Load selected open cases (org-scoped), build per-case totals + oldest-invoice,
// partition eligibility, and send sequentially via sendInvoiceText (each send
// records its own text_messages row, so a mid-loop failure keeps prior sends).
//
// `orgConfig` must be the caller's already-resolved org config (single
// org_settings read per request) — it sources both the batch-size clamp
// (orgConfig.workflow.smsBatchLimit, which MUST match the client's cap) and
// the message template vars (company/phone/paymentLink).
export async function runBulkSms(
  deps: MessagingDeps,
  args: { orgId: string; userId: string; caseIds: string[]; today: string; templateBody: string; orgConfig: OrgConfig; submissionId?: string },
): Promise<BulkSmsResult> {
  const ids = clampBatch(args.caseIds, args.orgConfig.workflow.smsBatchLimit);
  if (ids.length === 0) return emptyResult();
  const svc = deps.service;

  // Org token values (company name, phone, payment link) — loaded ONCE per
  // batch, not per case, then reused across every renderCaseBody call below.
  const [{ data: caseRows, error: caseErr }, { data: orgRow, error: orgErr }] = await Promise.all([
    svc.from("collection_cases")
      .select("id, customer_id, exception_reason").eq("org_id", args.orgId).in("id", ids).is("closed_at", null),
    svc.from("organizations").select("name").eq("id", args.orgId).maybeSingle(),
  ]);
  if (caseErr) throw caseErr;
  if (orgErr) throw orgErr;
  const orgVars = {
    company: (orgRow?.name as string | null) ?? "",
    phone: args.orgConfig.companyProfile.phone ?? "",
    paymentLink: args.orgConfig.companyProfile.paymentPortalUrl ?? "",
  };
  const cases = ((caseRows as { id: string; customer_id: string; exception_reason: ExceptionState | null }[]) ?? []);
  const customerIds = [...new Set(cases.map((c) => c.customer_id).filter(Boolean))];
  if (customerIds.length === 0) return emptyResult();

  const { data: custRows, error: custErr } = await svc.from("customers")
    .select("id, name, phone, sms_consent, do_not_text").eq("org_id", args.orgId).in("id", customerIds);
  if (custErr) throw custErr;
  const custById = new Map(((custRows as CustomerRow[]) ?? []).map((c) => [c.id, c]));

  const invPage = await pageAll<InvoiceRow>(
    (from, to) =>
      orderPage(
        svc.from("invoices")
          .select("id, qbo_doc_number, due_date, balance, customer_id", { count: "exact" })
          .eq("org_id", args.orgId)
          .in("customer_id", customerIds)
          .gt("balance", 0)
          .lt("due_date", args.today),
      ).range(from, to),
  );
  const invByCustomer = new Map<string, { id: string; doc: string | null; due: string | null; bal: number }[]>();
  for (const r of invPage.rows) {
    const list = invByCustomer.get(r.customer_id) ?? [];
    list.push({ id: r.id, doc: r.qbo_doc_number, due: r.due_date, bal: Number(r.balance) || 0 });
    invByCustomer.set(r.customer_id, list);
  }
  const totalsTruncated = invPage.truncated;

  const built: CaseForSend[] = [];
  for (const c of cases) {
    const cust = custById.get(c.customer_id);
    if (!cust) continue;
    // Oldest overdue invoice first (smallest due_date; ISO strings sort chronologically).
    const invs = (invByCustomer.get(c.customer_id) ?? []).slice()
      .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
    const totalOverdue = invs.reduce((s, i) => s + i.bal, 0);
    built.push({
      caseId: c.id,
      customerName: cust.name ?? "(unknown customer)",
      phone: cust.phone ?? null,
      smsConsent: Boolean(cust.sms_consent),
      doNotText: Boolean(cust.do_not_text),
      contactBlocked: isContactBlocked(c.exception_reason),
      totalOverdue,
      invoices: invs.map((i) => ({ invoiceId: i.id, docNumber: i.doc, dueDate: i.due })),
      representativeInvoiceId: invs[0]?.id ?? null,
    });
  }

  const { eligible, skipped } = partitionEligibility(built);
  const failures: BulkSmsFailure[] = [];
  let sent = 0;
  if (totalsTruncated) {
    for (const c of eligible) {
      failures.push({ caseId: c.caseId, name: c.customerName, error: smsFlashCopy("error") });
    }
    return { sent: 0, failed: failures.length, skipped: skipped.length, failures };
  }
  for (const c of eligible) {
    // Missing overdue invoice is a per-case failure (not skipped), so
    // failed === failures.length including this bucket.
    if (!c.representativeInvoiceId) {
      failures.push({ caseId: c.caseId, name: c.customerName, error: smsFlashCopy("error") });
      continue;
    }
    try {
      await sendInvoiceText(deps, {
        orgId: args.orgId,
        invoiceId: c.representativeInvoiceId,
        userId: args.userId,
        body: renderCaseBody(args.templateBody, c, orgVars),
        submissionId: args.submissionId
          ? deriveBulkSubmissionId(args.submissionId, c.caseId)
          : undefined,
      });
      sent++;
    } catch (err) {
      // Partial failure is tallied, never fatal. Error copy is mapped through
      // smsSendReason → smsFlashCopy so we never surface stacks or provider text.
      failures.push({ caseId: c.caseId, name: c.customerName, error: humanSafeSmsError(err) });
    }
  }
  return { sent, failed: failures.length, skipped: skipped.length, failures };
}
