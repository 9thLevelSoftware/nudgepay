// Pure module (no I/O, no node:*, no secrets) — safe in both the client bundle
// and the server. Hardcoded starter SMS templates for the collections workspace.
// {customer} {invoice} {balance} {dueDate} {company} {phone} {paymentLink} are
// filled from the selected account and org settings.

export type SmsTemplate = { id: string; label: string; body: string };
export type TemplateVars = {
  customer: string;
  invoice: string;
  balance: string;
  dueDate: string;
  company: string;
  phone: string;
  paymentLink: string;
};

export const TEMPLATE_TOKEN_KEYS = [
  "customer", "invoice", "balance", "dueDate",
  "company", "phone", "paymentLink",
] as const;

const TOKEN_REGEX = new RegExp(
  `\\{(${TEMPLATE_TOKEN_KEYS.join("|")})\\}`, "g"
);

export const DEFAULT_SMS_TEMPLATES: SmsTemplate[] = [
  {
    id: "friendly-reminder",
    label: "Friendly reminder",
    body: "Hi {customer}, a friendly reminder that invoice {invoice} for {balance} was due {dueDate}. Reply with any questions. — {company}",
  },
  {
    id: "past-due",
    label: "Past due",
    body: "Hi {customer}, invoice {invoice} ({balance}) is now past due as of {dueDate}. Please let us know when we can expect payment. — {company}",
  },
  {
    id: "final-notice",
    label: "Final notice",
    body: "{customer}, invoice {invoice} for {balance} remains unpaid and is now seriously past due. Please contact us promptly to avoid further action. — {company}",
  },
  {
    id: "payment-received",
    label: "Payment received",
    body: "Thanks {customer}! We've received payment for invoice {invoice}. We appreciate your business. — {company}",
  },
];

// Replace only the known tokens; leave any other {token} untouched.
export function applyTemplate(body: string, vars: TemplateVars): string {
  return body.replace(
    TOKEN_REGEX,
    (_match, key: keyof TemplateVars) => vars[key],
  );
}
