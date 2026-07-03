// Pure module: maps a sendInvoiceText() thrown Error message to a short result
// code, used both for the dashboard's query-string flash (?sms=) and Focus
// Mode's JSON response. Extracted from api.text.send.tsx so the mapping is
// unit-testable without spinning up the full route (env bindings, cookies).
//
// Order matters: check the most specific/most-likely-first-thrown reasons
// first so overlapping substrings (e.g. "consent") don't misclassify.
export function smsSendReason(message: string): string {
  if (/disabled/i.test(message)) return "disabled";
  if (/quiet/i.test(message)) return "quiet";
  if (/blocked/i.test(message)) return "blocked";
  if (/opted out/i.test(message)) return "optout";
  if (/consent/i.test(message)) return "noconsent";
  return "error";
}
