// Pure chase-recipient rows from the QBO one-email / one-phone pair. No I/O.

import { canSendEmail, type CommPrefs } from "./comm-prefs";
import { resolveCallAction } from "./channel-actions";
import { smsGateFor } from "./sms-gate";

export type ChaseRecipient = {
  channel: "sms" | "email" | "call";
  address: string;              // E.164 / email; omit the row if empty
  enabled: boolean;
  reasonDisabled: string | null;
};

export function chaseRecipientsFrom(input: {
  phone: string | null;
  email: string | null;
  commPrefs: CommPrefs;
  smsConsent: boolean;
  contactBlocked: boolean;
  exceptionReason: import("./contact-log").ExceptionReason | null;
  smsEnabled: boolean;
  emailEnabled: boolean;
  hasInvoice: boolean;
}): ChaseRecipient[] {
  const out: ChaseRecipient[] = [];
  if (input.phone) {
    const gate = smsGateFor({
      smsEnabled: input.smsEnabled,
      contactBlocked: input.contactBlocked,
      exceptionReason: input.exceptionReason,
      doNotText: input.commPrefs.doNotText,
      hasInvoice: input.hasInvoice,
      consent: input.smsConsent,
      phone: input.phone,
    });
    out.push({
      channel: "sms",
      address: input.phone,
      enabled: gate == null,
      reasonDisabled: gate?.reason ?? null,
    });
  }
  if (input.email) {
    const reasonDisabled = !input.emailEnabled
      ? "Email is turned off for this workspace"
      : input.contactBlocked
        ? "Case is marked do-not-contact / legal"
        : !input.hasInvoice
          ? "No invoice to reference"
          : !canSendEmail(input.commPrefs)
            ? "Customer opted out of email"
            : null;
    out.push({
      channel: "email",
      address: input.email,
      enabled: reasonDisabled == null,
      reasonDisabled,
    });
  }
  const call = resolveCallAction(input.commPrefs, input.phone, input.contactBlocked);
  if (call.kind === "live") {
    out.push({ channel: "call", address: input.phone as string, enabled: true, reasonDisabled: null });
  } else if (call.kind === "blocked" && input.phone) {
    out.push({ channel: "call", address: input.phone, enabled: false, reasonDisabled: call.reason });
  }
  return out;
}
