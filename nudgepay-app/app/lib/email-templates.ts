// Pure module (no I/O, no node:*, no secrets) — safe in client bundle and server.
// Plain-text email templates. {customer} {invoice} {balance} {dueDate} are filled
// from the selected account. The unsubscribe footer is appended by the send path,
// NOT stored here, so it is always present even on free-typed bodies.

import type { TemplateVars } from "./sms-templates";

export type EmailTemplate = { id: string; label: string; subject: string; body: string };

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: "friendly-reminder",
    label: "Friendly reminder",
    subject: "Reminder: invoice {invoice} from Chancey Heating & Cooling",
    body: "Hi {customer},\n\nThis is a friendly reminder that invoice {invoice} for {balance} was due {dueDate}. If you have already sent payment, thank you — please disregard this note. Otherwise, reply with any questions and we'll be glad to help.\n\nThank you,\nChancey Heating & Cooling",
  },
  {
    id: "past-due",
    label: "Past due",
    subject: "Past due: invoice {invoice}",
    body: "Hi {customer},\n\nInvoice {invoice} for {balance} is now past due as of {dueDate}. Please let us know when we can expect payment, or reply if there is anything we can help resolve.\n\nThank you,\nChancey Heating & Cooling",
  },
  {
    id: "final-notice",
    label: "Final notice",
    subject: "Final notice: invoice {invoice}",
    body: "{customer},\n\nInvoice {invoice} for {balance} remains unpaid and is now seriously past due. Please contact us promptly to arrange payment and avoid further action.\n\nChancey Heating & Cooling",
  },
  {
    id: "payment-received",
    label: "Payment received",
    subject: "Payment received — thank you",
    body: "Thanks {customer}!\n\nWe've received payment for invoice {invoice}. We appreciate your business.\n\nChancey Heating & Cooling",
  },
];

// Replace only the known tokens; leave any other {token} untouched.
export function applyEmailTemplate(text: string, vars: TemplateVars): string {
  return text.replace(
    /\{(customer|invoice|balance|dueDate)\}/g,
    (_m, key: keyof TemplateVars) => vars[key],
  );
}
