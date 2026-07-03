// Pure parse/resolve for per-org channel settings. No I/O, no node:*, no .server.
// Mirrors org-settings.ts / comm-prefs.ts. SMS-only this phase; email config is
// storage-only groundwork (subsystem #3) and is not represented here yet.

export type ChannelSettings = { smsEnabled: boolean };

export type ChannelSettingsRow = { sms_enabled?: boolean | null };

// A missing row or missing column means SMS is ENABLED (preserves the pre-toggle
// default — orgs without a messaging_config row still send).
export function resolveChannelSettings(row: ChannelSettingsRow | null | undefined): ChannelSettings {
  if (!row || row.sms_enabled == null) return { smsEnabled: true };
  return { smsEnabled: row.sms_enabled === true };
}

// The Settings toggle posts an explicit "true"/"false"; anything else is off.
export function parseChannelSettingsUpdate(form: FormData): { sms_enabled: boolean } {
  return { sms_enabled: form.get("sms_enabled") === "true" };
}

// ---------------------------------------------------------------------------
// Per-org SMS sender override (from number / Messaging Service SID)
// ---------------------------------------------------------------------------

export type SmsSenderRow = {
  sender?: string | null;
  messaging_service_sid?: string | null;
};

/** Resolve DB row → form-friendly defaults ("" for null). */
export function resolveSmsSenderSettings(
  row: SmsSenderRow | null | undefined,
): { sender: string; messagingServiceSid: string } {
  return {
    sender: (row?.sender ?? "").trim(),
    messagingServiceSid: (row?.messaging_service_sid ?? "").trim(),
  };
}

const E164_RE = /^\+[1-9]\d{1,14}$/;
const MG_SID_RE = /^MG[0-9a-fA-F]{32}$/;

export type SmsSenderUpdate =
  | { ok: true; value: { sender: string | null; messaging_service_sid: string | null } }
  | { ok: false; error: "sms_sender" | "sms_sid" };

/**
 * Parse the sender-override form. Empty strings clear the override (→ null,
 * fall back to env default). Non-empty values are validated: E.164 for sender,
 * `MG` + 32 hex for messaging_service_sid. Both may be set simultaneously —
 * `resolveSender` prefers messaging_service_sid when present.
 */
export function parseSmsSenderUpdate(form: FormData): SmsSenderUpdate {
  const rawSender = typeof form.get("sender") === "string" ? (form.get("sender") as string).trim() : "";
  const rawSid = typeof form.get("messaging_service_sid") === "string"
    ? (form.get("messaging_service_sid") as string).trim()
    : "";

  const sender = rawSender === "" ? null : rawSender;
  const sid = rawSid === "" ? null : rawSid;

  if (sender !== null && !E164_RE.test(sender)) return { ok: false, error: "sms_sender" };
  if (sid !== null && !MG_SID_RE.test(sid)) return { ok: false, error: "sms_sid" };

  return { ok: true, value: { sender, messaging_service_sid: sid } };
}
