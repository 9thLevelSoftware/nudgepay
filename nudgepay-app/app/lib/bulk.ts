// Pure module — no I/O, no node:*, no .server suffix. Bulk-ops eligibility +
// per-case message rendering, shared by routes, components, and tests.
import { applyTemplate } from "./sms-templates";
import { formatUSD } from "./format";
import { formatDate } from "./dates";

export const MAX_BATCH = 50;

export type SkipReason = "no-phone" | "no-consent" | "do-not-contact" | "do-not-text";

export type TextableCase = {
  caseId: string;
  customerName: string;
  phone: string | null;
  smsConsent: boolean;
  doNotText: boolean;
  contactBlocked?: boolean;
};

export type RepInvoice = { invoiceId: string; docNumber: string | null; dueDate: string | null };

export type RenderableCase = {
  customerName: string;
  totalOverdue: number;
  invoices: RepInvoice[];
};

export type EligibilitySplit<T extends TextableCase> = {
  eligible: T[];
  skipped: { caseId: string; name: string; reason: SkipReason }[];
};

// Partition selected cases into textable vs skipped. Order: do-not-contact
// → no-phone → no-consent → do-not-text.
export function partitionEligibility<T extends TextableCase>(cases: T[]): EligibilitySplit<T> {
  const eligible: T[] = [];
  const skipped: { caseId: string; name: string; reason: SkipReason }[] = [];
  for (const c of cases) {
    if (c.contactBlocked) skipped.push({ caseId: c.caseId, name: c.customerName, reason: "do-not-contact" });
    else if (!c.phone) skipped.push({ caseId: c.caseId, name: c.customerName, reason: "no-phone" });
    else if (!c.smsConsent) skipped.push({ caseId: c.caseId, name: c.customerName, reason: "no-consent" });
    else if (c.doNotText) skipped.push({ caseId: c.caseId, name: c.customerName, reason: "do-not-text" });
    else eligible.push(c);
  }
  return { eligible, skipped };
}

// Render one personalized body using case totals + the oldest overdue invoice
// (invoices[0], caller-sorted oldest-first) as the representative. Unknown
// {tokens} pass through (applyTemplate only replaces known keys).
export function renderCaseBody(templateBody: string, c: RenderableCase): string {
  const oldest = c.invoices[0] ?? null;
  return applyTemplate(templateBody, {
    customer: c.customerName,
    invoice: oldest?.docNumber ?? "your account",
    balance: formatUSD(c.totalOverdue),
    dueDate: oldest?.dueDate ? formatDate(oldest.dueDate) : "",
    company: "",
    phone: "",
    paymentLink: "",
  });
}

// Shared clamp so client select-all and server routes agree on the cap.
export function clampBatch<T>(ids: T[]): T[] {
  return ids.slice(0, MAX_BATCH);
}
