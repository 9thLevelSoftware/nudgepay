// Pure module — no I/O, no .server suffix. Derives webhook URLs for display
// and validates test-send destinations. Nothing secret ever appears in outputs.

/** Trim trailing slash so concatenated paths match webhook signature URLs exactly. */
function trimSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * Derive the full webhook URLs for Twilio (inbound + status) and Resend.
 * Paths are the routes registered in app/routes.ts. Returns null per-URL when
 * the relevant base URL is absent — the operator hasn't configured it yet.
 */
export function deriveWebhookUrls(
  twilioBaseUrl: string | null,
  appBaseUrl: string | null,
): { twilioInbound: string | null; twilioStatus: string | null; resendWebhook: string | null } {
  const tb = twilioBaseUrl ? trimSlash(twilioBaseUrl) : null;
  const ab = appBaseUrl ? trimSlash(appBaseUrl) : null;
  return {
    twilioInbound: tb ? `${tb}/webhooks/twilio/inbound` : null,
    twilioStatus: tb ? `${tb}/webhooks/twilio/status` : null,
    resendWebhook: ab ? `${ab}/webhooks/resend` : null,
  };
}

const E164_RE = /^\+[1-9]\d{1,14}$/;
const US_10_RE = /^\d{10}$/;

/**
 * Parse and normalise a phone number for test SMS delivery.
 * Accepts E.164 as-is or a bare 10-digit US number (→ +1...). Returns null
 * when the input is empty, whitespace-only, or invalid.
 */
export function parseTestSmsDestination(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\s\-().]/g, "");
  if (s === "") return null;
  if (E164_RE.test(s)) return s;
  // Strip leading "1" from 11-digit US numbers (e.g. 15551234567)
  if (/^1\d{10}$/.test(s)) return `+${s}`;
  if (US_10_RE.test(s)) return `+1${s}`;
  return null;
}
