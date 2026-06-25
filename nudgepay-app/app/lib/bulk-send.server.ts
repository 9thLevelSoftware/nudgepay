import { sendInvoiceText, type MessagingDeps } from "./twilio-messaging.server";
import { partitionEligibility, renderCaseBody, clampBatch, type TextableCase, type RenderableCase } from "./bulk";

export type BulkSmsResult = { sent: number; failed: number; skipped: number };

type CaseForSend = TextableCase & RenderableCase & { representativeInvoiceId: string | null };

// Load selected open cases (org-scoped), build per-case totals + oldest-invoice,
// partition eligibility, and send sequentially via sendInvoiceText (each send
// records its own text_messages row, so a mid-loop failure keeps prior sends).
export async function runBulkSms(
  deps: MessagingDeps,
  args: { orgId: string; userId: string; caseIds: string[]; today: string; templateBody: string },
): Promise<BulkSmsResult> {
  const ids = clampBatch(args.caseIds);
  if (ids.length === 0) return { sent: 0, failed: 0, skipped: 0 };
  const svc = deps.service;

  const { data: caseRows, error: caseErr } = await svc.from("collection_cases")
    .select("id, customer_id").eq("org_id", args.orgId).in("id", ids).is("closed_at", null);
  if (caseErr) throw caseErr;
  const cases = ((caseRows as { id: string; customer_id: string }[]) ?? []);
  const customerIds = [...new Set(cases.map((c) => c.customer_id).filter(Boolean))];
  if (customerIds.length === 0) return { sent: 0, failed: 0, skipped: 0 };

  const { data: custRows, error: custErr } = await svc.from("customers")
    .select("id, name, phone, sms_consent").eq("org_id", args.orgId).in("id", customerIds);
  if (custErr) throw custErr;
  const custById = new Map(((custRows as any[]) ?? []).map((c) => [c.id as string, c]));

  const { data: invRows, error: invErr } = await svc.from("invoices")
    .select("id, qbo_doc_number, due_date, balance, customer_id")
    .eq("org_id", args.orgId).in("customer_id", customerIds).gt("balance", 0).lt("due_date", args.today);
  if (invErr) throw invErr;
  const invByCustomer = new Map<string, { id: string; doc: string | null; due: string | null; bal: number }[]>();
  for (const r of ((invRows as any[]) ?? [])) {
    const list = invByCustomer.get(r.customer_id) ?? [];
    list.push({ id: r.id, doc: r.qbo_doc_number, due: r.due_date, bal: Number(r.balance) || 0 });
    invByCustomer.set(r.customer_id, list);
  }

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
      customerName: (cust.name as string) ?? "(unknown customer)",
      phone: (cust.phone as string) ?? null,
      smsConsent: Boolean(cust.sms_consent),
      totalOverdue,
      invoices: invs.map((i) => ({ invoiceId: i.id, docNumber: i.doc, dueDate: i.due })),
      representativeInvoiceId: invs[0]?.id ?? null,
    });
  }

  const { eligible, skipped } = partitionEligibility(built);
  let sent = 0;
  let failed = 0;
  for (const c of eligible) {
    if (!c.representativeInvoiceId) { failed++; continue; }
    try {
      await sendInvoiceText(deps, {
        orgId: args.orgId,
        invoiceId: c.representativeInvoiceId,
        userId: args.userId,
        body: renderCaseBody(args.templateBody, c),
      });
      sent++;
    } catch {
      failed++; // partial failure is tallied, never fatal
    }
  }
  return { sent, failed, skipped: skipped.length };
}
