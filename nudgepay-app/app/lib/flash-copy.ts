// Pure copy for query-param flash banners.

import type { SmsSendReason } from "./sms-send-reason";

export const QBO_FLASH: Record<string, { tone: "ok" | "warn" | "err"; text: string }> = {
  connected: { tone: "ok", text: "QuickBooks connected. Overdue invoices will appear after the first sync." },
  disconnected: { tone: "ok", text: "QuickBooks disconnected." },
  confirm: { tone: "err", text: "Type the workspace name to confirm disconnecting QuickBooks." },
  error: { tone: "err", text: "Could not connect QuickBooks. Try again from Settings → Integrations." },
  forbidden: { tone: "err", text: "Only workspace owners can connect or disconnect QuickBooks." },
  unconfigured: { tone: "warn", text: "QuickBooks isn't configured on this server yet. An operator needs to set the QBO Worker secrets." },
  sync_error: { tone: "warn", text: "QuickBooks connected, but the first sync hit an error. Check Settings → Integrations." },
  unsupported: { tone: "err", text: "This workspace only supports US QuickBooks companies billed in USD." },
};

export const SYNC_FLASH: Record<string, { tone: "ok" | "warn" | "err"; text: string }> = {
  ok: { tone: "ok", text: "Sync finished." },
  error: { tone: "err", text: "Sync failed. See Settings → Integrations for details." },
};

// SMS result flash (?sms= on dashboard/inbox, Focus JSON `sms` field).
// `tone` is the Tailwind text class used by inline banners (not FlashBanner's
// semantic ok/warn/err) so DetailPanel and MessageThreadPanel can share this map.
export type SmsFlashCode = SmsSendReason | "sent" | "consent_locked";

export type SmsFlash = { text: string; tone: string };

export const SMS_FLASH: { [K in SmsFlashCode]: SmsFlash } = {
  sent:            { text: "Text sent.",                                                  tone: "text-cool" },
  noconsent:       { text: "Not sent — customer has not consented to SMS.",               tone: "text-hot" },
  optout:          { text: "Not sent — customer opted out of texts.",                     tone: "text-hot" },
  error:           { text: "Could not send the text.",                                    tone: "text-hot" },
  blocked:         { text: "Not sent — this case is marked do-not-contact / legal.",      tone: "text-hot" },
  disabled:        { text: "Not sent — text messaging is turned off for this workspace.", tone: "text-hot" },
  quiet:           { text: "Not sent — outside quiet hours.",                             tone: "text-warm" },
  limited:         { text: "Not sent — send limit reached. Try again later.",             tone: "text-hot" },
  consent_locked:  { text: "Could not mark consented — inbound STOP requires an owner override with a reason.", tone: "text-hot" },
};

/** Human copy for an SMS result code. Unknown codes use the generic error. */
export function smsFlashCopy(code: string): string {
  return (smsFlash(code) ?? SMS_FLASH.error).text;
}

/** Banner payload for ?sms=. Null when no code; unknown codes use the generic error. */
export function smsFlash(code: string | null | undefined): SmsFlash | null {
  if (!code) return null;
  return (SMS_FLASH as Record<string, SmsFlash>)[code] ?? SMS_FLASH.error;
}

// Bulk SMS result flash (?bulkSms=done&bulkErrors= on dashboard). Names only —
// per-case error copy stays on BulkSmsResult.failures, not in the URL.

/** Max customer names in ?bulkErrors= (URL size). */
export const BULK_ERROR_NAME_CAP = 5;

const BULK_ERROR_NAME_MAX_LEN = 40;

function sanitizeBulkErrorName(name: string): string {
  return name.replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, BULK_ERROR_NAME_MAX_LEN);
}

/** Comma-separated names for ?bulkErrors=. Commas stripped so the query stays split-safe. */
export function encodeBulkErrorNames(names: string[], cap = BULK_ERROR_NAME_CAP): string {
  return names.map(sanitizeBulkErrorName).filter(Boolean).slice(0, cap).join(",");
}

export function parseBulkErrorNames(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Flash remainder after the Sent/Failed/Skipped counts.
 * Example: "3 failed: Acme, Beta, +1 more"
 */
export function bulkSmsFailureSummary(failed: number, names: string[]): string | null {
  if (!Number.isFinite(failed) || failed <= 0) return null;
  const shown = names.map((n) => n.trim()).filter(Boolean);
  if (shown.length === 0) return `${failed} failed`;
  const extra = Math.max(failed - shown.length, 0);
  return extra > 0
    ? `${failed} failed: ${shown.join(", ")}, +${extra} more`
    : `${failed} failed: ${shown.join(", ")}`;
}
