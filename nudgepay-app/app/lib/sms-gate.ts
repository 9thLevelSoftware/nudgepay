// Pure SMS gate ladder. Determines whether a text can be sent and why not.
// Extracted from DetailPanel.tsx so Focus Mode and the detail panel share one
// source of truth. No I/O, no .server suffix.

import type { ExceptionReason } from "./contact-log";
import { exceptionLabel } from "./exceptions";

export type SmsGate = { reason: string; severity: "hard" | "soft" };

/**
 * Evaluate the SMS sending gates in priority order. Returns null when
 * sending is allowed.
 *
 * Order: workspace toggle → contact blocked → opted out (do-not-text) →
 * no invoice → no consent → no phone number. DoNotText MUST precede
 * !consent so agents never see "mark consent" when a customer opted out.
 */
export function smsGateFor(input: {
  smsEnabled: boolean;
  contactBlocked: boolean;
  exceptionReason: ExceptionReason | null;
  doNotText: boolean;
  hasInvoice: boolean;
  consent: boolean;
  phone: string | null;
}): SmsGate | null {
  if (!input.smsEnabled) {
    return { reason: "Text messaging is turned off for this workspace.", severity: "hard" };
  }
  if (input.contactBlocked) {
    return { reason: `Messaging blocked — ${exceptionLabel(input.exceptionReason)}.`, severity: "hard" };
  }
  if (input.doNotText) {
    return { reason: "Customer opted out of texts.", severity: "hard" };
  }
  if (!input.hasInvoice) {
    return { reason: "No invoice to reference.", severity: "soft" };
  }
  if (!input.consent) {
    return { reason: "Mark consent to enable sending.", severity: "soft" };
  }
  if (!input.phone) {
    return { reason: "Customer has no phone number.", severity: "soft" };
  }
  return null;
}
