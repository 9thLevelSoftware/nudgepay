// Pure module: maps a sendInvoiceText() thrown Error message to a short result
// code, used both for the dashboard's query-string flash (?sms=) and Focus
// Mode's JSON response. Extracted from api.text.send.tsx so the mapping is
// unit-testable without spinning up the full route (env bindings, cookies).
//
// Order matters: check the most specific/most-likely-first-thrown reasons
// first so overlapping substrings (e.g. "consent") don't misclassify.
// Display copy lives in flash-copy.ts (SMS_FLASH) — never show these codes raw.

export const SMS_SEND_REASON_CODES = [
  "disabled",
  "quiet",
  "blocked",
  "optout",
  "noconsent",
  "limited",
  "error",
] as const;

export type SmsSendReason = (typeof SMS_SEND_REASON_CODES)[number];

export function smsSendReason(message: string): SmsSendReason {
  if (/disabled/i.test(message)) return "disabled";
  if (/quiet/i.test(message)) return "quiet";
  if (/blocked/i.test(message)) return "blocked";
  if (/opted out/i.test(message)) return "optout";
  if (/consent/i.test(message)) return "noconsent";
  if (/rate cap/i.test(message)) return "limited";
  return "error";
}
